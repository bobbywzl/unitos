"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { ACCOUNT_HEADER } from "@/lib/constants";
import { refreshWhenOnline } from "@/lib/offline/queue";
import { isImeKey, useImeGuard } from "@/lib/ime";
import { postUndoPill } from "@/lib/notes/undo-pill";
import { tabAccount } from "@/lib/tab-account";
import { loadCardDrafts, writeCardDrafts } from "@/lib/toolbar-drafts";
import type { CrossAccountView, ReplyView } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { PersonBadge } from "@/components/collab/person-badge";
import { useLang, useT } from "@/components/lang-provider";
import { VoiceTypingButton } from "@/components/voice/voice-typing-button";

/** When a reply, or the comment it answers, was written, as the thread prints it. */
export function replyTime(iso: string, lang: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? date.toLocaleString() : replyFormat(lang).format(date);
}

// One formatter per language: building one costs about a millisecond, and a
// card draws its time on every key typed into its suggestion.
const replyFormats = new Map<string, Intl.DateTimeFormat>();
function replyFormat(lang: string): Intl.DateTimeFormat {
  let format = replyFormats.get(lang);
  if (!format) {
    format = new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    replyFormats.set(lang, format);
  }
  return format;
}

/** What the thread is under: a note, an edit, or a link. A reply on a link
    names the project it is changed from (SPEC.md §13: a link belongs to a
    project, and a link of another project is not found there). */
type Target = { noteId: string } | { blockEditId: string } | { docLinkId: string; notebookId?: string };

/** The reply box's draft key in the card drafts (toolbar-drafts.ts). */
function draftKey(target: Target): string {
  if ("noteId" in target) return `reply:note:${target.noteId}`;
  if ("blockEditId" in target) return `reply:edit:${target.blockEditId}`;
  return `reply:link:${target.docLinkId}`;
}

/** The route of one reply; a reply on a link carries the project (lib/link-scope.ts). */
function replyPath(id: string, target: Target): string {
  const path = `/api/replies/${encodeURIComponent(id)}`;
  return "docLinkId" in target && target.notebookId
    ? `${path}?notebookId=${encodeURIComponent(target.notebookId)}`
    : path;
}

function keepDraft(key: string, text: string | null) {
  writeCardDrafts(new Map([[key, text?.trim() ? text : null]]), new Map([[key, null]]));
}

// Replies deleted while their Undo pill shows: every thread on the page
// leaves them out until the pill goes, and the server delete runs then.
let going: ReadonlySet<string> = new Set();
const goingListeners = new Set<() => void>();
const NONE: ReadonlySet<string> = new Set();
function setGoing(id: string, on: boolean) {
  const next = new Set(going);
  if (on) next.add(id);
  else next.delete(id);
  going = next;
  for (const listener of goingListeners) listener();
}
function subscribeGoing(listener: () => void) {
  goingListeners.add(listener);
  return () => goingListeners.delete(listener);
}

// The discussion under one note (notes and annotations alike), one edit, or
// one link — how collaborators comment on each other's work. Open replies
// always show; resolved ones collapse behind a count. Any editor resolves a
// reply; its author or the owner deletes it. A delete asks nothing and
// shows the Undo pill (lib/notes/undo-pill.ts); the server delete waits for
// the pill to go. The words typed in the reply box are kept with the card
// drafts until the server takes the reply. Editors reply; viewers read.
// On a link shared across accounts (crossAccount, SPEC.md §13) no one
// deletes another account's reply, and a viewer outside the link maker's
// projects resolves and deletes only its own replies and writes none.
export function ReplyThread({
  target,
  replies,
  onChange,
  crossAccount,
  openRequest,
  composerFirst = false,
}: {
  target: Target;
  replies: ReplyView[];
  /** Runs after a reply is sent, resolved, reopened, or deleted: a caller
      that loaded the replies itself loads them again. */
  onChange?: () => void;
  /** A link shared across accounts (lib/types.ts): what this account may do
      to the replies on it. */
  crossAccount?: CrossAccountView;
  /** The caller draws its own Reply (the link panel's action row): each new
      value opens the box, and the thread draws no Reply of its own. Left
      out: the thread's own Reply. */
  openRequest?: number;
  /** The box sits above the replies, under the caller's Reply. */
  composerFirst?: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  const ime = useImeGuard();
  const { authOn, canEdit, myId, role, people } = useCollab();
  const [composing, setComposing] = useState(false);
  // The box takes the focus when the reader opens it, not when a kept draft does.
  const [focusBox, setFocusBox] = useState(false);
  // The caller's Reply pressed: the box opens and takes the focus.
  const [seenRequest, setSeenRequest] = useState(openRequest);
  if (seenRequest !== openRequest) {
    setSeenRequest(openRequest);
    if ((openRequest ?? 0) > 0) {
      setFocusBox(true);
      setComposing(true);
    }
  }
  const [showResolved, setShowResolved] = useState(false);
  const [draft, setDraftState] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Resolve and Reopen answer at once (WALK2-12): the row reads the new state
  // until the server's copy moves (the refresh after the write), and goes back
  // when the server refuses. `was` is the server's state the answer replaced.
  const [resolvedNow, setResolvedNow] = useState<Record<string, { value: string | null; was: string | null }>>({});
  const hidden = useSyncExternalStore(subscribeGoing, () => going, () => NONE);
  const key = draftKey(target);
  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
  });
  // A draft kept from before (a closed card, a reload) opens the box with it.
  useEffect(() => {
    const kept = loadCardDrafts()[key];
    if (!kept) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setDraftState(kept);
    setComposing(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [key]);
  const setDraft = (text: string) => {
    setDraftState(text);
    keepDraft(key, text);
  };

  // Outside the link maker's projects, this account reads and keeps to its
  // own replies.
  const outside = crossAccount?.outside === true;
  const canReply = canEdit && !outside;

  const shown = replies
    .filter((r) => !hidden.has(r.id))
    .map((r) => {
      const now = resolvedNow[r.id];
      return now && r.resolvedById === now.was ? { ...r, resolvedById: now.value } : r;
    });
  // Replies need an account to sign them: with sign-in off there is no Reply.
  // Any editor replies, on a shared corpus or their own — a reply on one's
  // own note is a dated update under it.
  if (shown.length === 0 && (!authOn || !canReply)) return null;

  const openReplies = shown.filter((r) => r.resolvedById === null);
  const resolvedReplies = shown.filter((r) => r.resolvedById !== null);

  /** Runs one write; true when the server took it (or the queue holds it). */
  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await fn();
      refreshWhenOnline(router);
      onChange?.();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  // The draft stays until the server takes the reply (or the offline queue
  // holds it); a failed send keeps it in the box.
  const send = () => {
    const content = draft.trim();
    if (!content) return;
    const sentKey = key;
    void run(async () => {
      await api("/api/replies", "POST", { ...target, content });
      keepDraft(sentKey, null);
      if (keyRef.current === sentKey) {
        setDraftState("");
        setComposing(false);
      }
    });
  };
  // The reply leaves the thread now; the pill's Undo brings it back, and the
  // delete runs once the pill goes (keepalive: the page may be closing).
  const remove = (id: string) => {
    setError(null);
    setGoing(id, true);
    const back = () => setGoing(id, false);
    postUndoPill({
      message: t("common.replyDeleted"),
      undo: back,
      commit: async () => {
        const path = replyPath(id, target);
        const failed = (reason: unknown) => {
          console.error("reply delete", reason);
          back();
          setError(t("common.notSaved"));
        };
        let res: Response;
        try {
          const account = tabAccount();
          res = await fetch(path, {
            method: "DELETE",
            keepalive: true,
            headers: account ? { [ACCOUNT_HEADER]: account } : undefined,
          });
        } catch {
          // No network: the offline queue takes the delete when it can.
          try {
            await api(path, "DELETE");
            refreshWhenOnline(router);
            onChange?.();
          } catch (err) {
            failed(err);
          }
          return;
        }
        if (!res.ok && res.status !== 404) {
          failed(res.status);
          return;
        }
        // The reply stays out of every thread: it is gone.
        refreshWhenOnline(router);
        onChange?.();
      },
    });
  };
  const setResolved = (id: string, resolvedValue: boolean) => {
    if (busy) return;
    const was = replies.find((r) => r.id === id)?.resolvedById ?? null;
    setResolvedNow((prev) => ({ ...prev, [id]: { value: resolvedValue ? (myId ?? "me") : null, was } }));
    void run(() => api(replyPath(id, target), "PATCH", { resolved: resolvedValue })).then((ok) => {
      if (ok) return;
      setResolvedNow((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    });
  };

  const row = (reply: ReplyView) => {
    const person = people[reply.userId];
    const isResolved = reply.resolvedById !== null;
    const mine = reply.userId === myId;
    return (
      <div key={reply.id} className={`flex items-start gap-2 ${isResolved ? "opacity-60" : ""}`}>
        {person && <PersonBadge person={person} size={16} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[11px] font-semibold text-sand-700">
              {person?.name ?? "?"}
            </span>
            <span suppressHydrationWarning className="text-[10px] text-sand-500">
              {replyTime(reply.createdAt, lang)}
            </span>
            <span className="-my-1 ml-auto flex items-center gap-2 pointer-coarse:-my-2.5 pointer-coarse:gap-3">
              {canEdit && (!outside || mine) && (
                <button
                  onClick={() => setResolved(reply.id, !isResolved)}
                  data-track="reply-resolve"
                  data-tip={isResolved ? t("common.reopenTitle") : t("common.resolveTitle")}
                  className="inline-flex min-h-6 items-center px-1 text-[10px] font-semibold text-sand-500 hover:text-sage-700 pointer-coarse:min-h-10 pointer-coarse:px-2.5"
                >
                  {isResolved ? t("common.reopen") : t("common.resolve")}
                </button>
              )}
              {(mine || (role === "owner" && !crossAccount)) && (
                <button
                  onClick={() => remove(reply.id)}
                  data-track="reply-delete"
                  aria-label={t("common.delete")}
                  data-tip={t("common.delete")}
                  // The × stays small; its box is 24 px, 40 under a finger (WALK4-16), and the
                  // row's negative margin keeps the line's height.
                  className="flex size-6 items-center justify-center text-[11px] text-sand-400 hover:text-red-600 pointer-coarse:size-10 pointer-coarse:text-[15px]"
                >
                  ×
                </button>
              )}
            </span>
          </div>
          <p
            className={`text-[12.5px] leading-relaxed whitespace-pre-wrap ${
              isResolved ? "line-through decoration-sand-400" : ""
            }`}
          >
            {reply.content}
          </p>
        </div>
      </div>
    );
  };

  const composer = canReply && composing && (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      className="flex items-end gap-1.5"
    >
      <textarea
        autoFocus={focusBox}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        {...ime.props}
        onKeyDown={(e) => {
          if (ime.isImeEnter(e) || isImeKey(e)) return;
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
          // The box closes; its words stay in the draft for the next Reply.
          if (e.key === "Escape") setComposing(false);
        }}
        placeholder={t("common.replyPlaceholder")}
        rows={1}
        className="min-w-0 flex-1 resize-none rounded-2xl bg-sand-100 px-3 py-1.5 text-[12.5px] outline-none placeholder:text-sand-500"
      />
      <VoiceTypingButton track="reply-voice-typing" />
      <button
        type="submit"
        data-track="reply-send"
        disabled={!draft.trim() || busy}
        className="rounded-full bg-clay px-3 py-1.5 text-[11px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40 pointer-coarse:min-h-10 pointer-coarse:px-4"
      >
        {t("common.reply")}
      </button>
    </form>
  );

  return (
    <div
      className={`flex flex-col gap-2 ${shown.length > 0 ? "mt-2.5 border-t border-line pt-2.5" : "mt-1.5"}`}
    >
      {composerFirst && composer}
      {openReplies.map(row)}

      {resolvedReplies.length > 0 && (
        <button
          onClick={() => setShowResolved(!showResolved)}
          data-track="reply-show-resolved"
          className="self-start text-[10px] font-semibold text-sand-500 hover:text-clay-700"
        >
          {resolvedReplies.length === 1
            ? t("common.resolvedCountOne")
            : t("common.resolvedCountMany", { n: resolvedReplies.length })}
        </button>
      )}
      {showResolved && resolvedReplies.map(row)}

      {canReply && !composing && openRequest === undefined && (
        <button
          onClick={() => {
            setFocusBox(true);
            setComposing(true);
          }}
          data-track="reply"
          data-tip={t("common.replyTitle")}
          className="inline-flex items-center self-start text-[11px] font-semibold text-sand-600 hover:text-clay-700 pointer-coarse:min-h-10 pointer-coarse:pr-3"
        >
          {t("common.reply")}
        </button>
      )}
      {!composerFirst && composer}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { readReplyDraft, writeReplyDraft } from "@/lib/note-drafts";
import { refreshWhenOnline } from "@/lib/offline/queue";
import { isImeKey, useImeGuard } from "@/lib/ime";
import type { CrossAccountView, ReplyView } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { PersonBadge } from "@/components/collab/person-badge";
import { useLang, useT } from "@/components/lang-provider";
import { VoiceTypingButton } from "@/components/voice/voice-typing-button";

/** When a reply, or the comment it answers, was written, as the thread prints it. */
export function replyTime(iso: string, lang: string): string {
  return new Date(iso).toLocaleString(lang === "zh" ? "zh-CN" : undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The key of one thread's reply draft (lib/note-drafts.ts). */
function draftTarget(
  target: { noteId: string } | { blockEditId: string } | { docLinkId: string; notebookId?: string },
): string {
  if ("noteId" in target) return `note:${target.noteId}`;
  if ("blockEditId" in target) return `edit:${target.blockEditId}`;
  return `link:${target.docLinkId}`;
}

const noSubscribe = () => () => {};

// The discussion under one note (notes and annotations alike), one edit, or
// one link — how collaborators comment on each other's work. Open replies
// always show; resolved ones collapse behind a count. Any editor resolves a
// reply; its author or the owner deletes it. Editors reply; viewers read.
// On a link with no project shared across accounts (crossAccount, SPEC.md
// §13) no one deletes another account's reply, and a viewer outside the
// link maker's projects resolves and deletes only its own replies and
// writes none. What is typed in the reply box is kept in the browser until
// the server has the reply (or the offline queue holds it): ✕, Back, and a
// reload keep it, and the box opens on it again. Resolve, Reopen, and
// delete show at once and come back if the server refuses.
export function ReplyThread({
  target,
  replies,
  onChange,
  crossAccount,
  openRequest,
  composerFirst = false,
}: {
  target: { noteId: string } | { blockEditId: string } | { docLinkId: string; notebookId?: string };
  replies: ReplyView[];
  /** Runs after a reply is sent, resolved, reopened, or deleted: a caller
      that loaded the replies itself loads them again. */
  onChange?: () => void;
  crossAccount?: CrossAccountView;
  /** [panel6] The caller draws its own Reply (the link panel's action row,
      WALK6-05): each new value opens the box, and the thread draws no Reply
      of its own. Left out: the thread's own Reply. */
  openRequest?: number;
  /** [panel6] The box sits above the replies, under the caller's Reply. */
  composerFirst?: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  const ime = useImeGuard();
  const { authOn, canEdit, myId, role, people } = useCollab();
  const key = draftTarget(target);
  // The kept draft: null on the server and while hydrating, then what this
  // browser holds for this account (another account's draft never shows). Typing takes over (typed !== null).
  const kept = useSyncExternalStore(noSubscribe, () => readReplyDraft(myId, key), () => null);
  const [typed, setTyped] = useState<string | null>(null);
  const draft = typed ?? kept ?? "";
  const [composingState, setComposing] = useState<boolean | null>(null);
  const [seenRequest, setSeenRequest] = useState(openRequest);
  if (seenRequest !== openRequest) {
    setSeenRequest(openRequest);
    if ((openRequest ?? 0) > 0) setComposing(true);
  }
  const composing = composingState ?? draft !== "";
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Changes shown before the server answers: a reply's resolver (null =
  // open) and the replies deleted. A refresh of the replies drops the ones
  // whose call has finished.
  const [resolvedNow, setResolvedNow] = useState<Record<string, string | null>>({});
  const [removedNow, setRemovedNow] = useState<Set<string>>(() => new Set());
  const [inFlight, setInFlight] = useState<Set<string>>(() => new Set());
  // A reply sent here shows at once, marked Sending… until the server has
  // it, then stays until the thread's replies bring it (WALK4-15). Its words
  // stay in the draft until the server confirms.
  const [sent, setSent] = useState<{ content: string; at: string; done: boolean; id: string | null } | null>(null);
  const isSent = (r: ReplyView) =>
    sent !== null && sent.done && (r.id === sent.id || (r.userId === myId && r.content.trim() === sent.content));
  const [prevReplies, setPrevReplies] = useState(replies);
  if (prevReplies !== replies) {
    setPrevReplies(replies);
    if (replies.some(isSent)) setSent(null);
    setResolvedNow((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => inFlight.has(id))));
    setRemovedNow((prev) => new Set([...prev].filter((id) => inFlight.has(id))));
  }

  const outside = crossAccount?.outside === true;
  const canReply = canEdit && !outside;

  // Replies need an account to sign them: with sign-in off there is no Reply.
  // Any editor replies, on a shared corpus or their own — a reply on one's
  // own note is a dated update under it.
  if (replies.length === 0 && (!authOn || !canReply)) return null;

  const shown = replies
    .filter((r) => !removedNow.has(r.id))
    .map((r) => (r.id in resolvedNow ? { ...r, resolvedById: resolvedNow[r.id] } : r));
  const openReplies = shown.filter((r) => r.resolvedById === null);
  const resolvedReplies = shown.filter((r) => r.resolvedById !== null);

  function setDraft(content: string) {
    setTyped(content);
    writeReplyDraft(myId, key, content);
  }

  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      refreshWhenOnline(router);
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  // One reply's change, shown at once: `show` paints it, `undo` takes it back
  // when the server refuses.
  async function change(id: string, show: () => void, undo: () => void, call: () => Promise<unknown>) {
    if (inFlight.has(id)) return;
    setError(null);
    setInFlight((prev) => new Set(prev).add(id));
    show();
    try {
      await call();
      refreshWhenOnline(router);
      onChange?.();
    } catch (err) {
      undo();
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setInFlight((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  // A reply on a link names the project it is changed from (SPEC.md §13).
  const scope = "docLinkId" in target && target.notebookId ? `?notebookId=${encodeURIComponent(target.notebookId)}` : "";

  const send = () => {
    const content = draft.trim();
    if (!content || busy) return;
    setSent({ content, at: new Date().toISOString(), done: false, id: null });
    setComposing(false);
    void run(async () => {
      let made: unknown;
      try {
        made = await api("/api/replies", "POST", { ...target, content });
      } catch (err) {
        // Refused: the row goes, and the box opens again on the kept draft.
        setSent(null);
        setComposing(true);
        throw err;
      }
      // The server has it, or the offline queue does: the draft goes.
      const id = made && typeof made === "object" && "id" in made && typeof made.id === "string" ? made.id : null;
      setSent((prev) => (prev ? { ...prev, done: true, id } : prev));
      setDraft("");
    });
  };
  const remove = (id: string) =>
    void change(
      id,
      () => setRemovedNow((prev) => new Set(prev).add(id)),
      () =>
        setRemovedNow((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        }),
      () => api(`/api/replies/${id}${scope}`, "DELETE"),
    );
  const setResolved = (id: string, resolvedValue: boolean) =>
    void change(
      id,
      () => setResolvedNow((prev) => ({ ...prev, [id]: resolvedValue ? myId : null })),
      () =>
        setResolvedNow((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        }),
      () => api(`/api/replies/${id}${scope}`, "PATCH", { resolved: resolvedValue }),
    );

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
              {/* [lists9] WALK9-09: an author with no account (deleted) is named, never "?", the waiting glyph. */}
              {person?.name ?? t("common.formerCollaborator")}
            </span>
            <span suppressHydrationWarning className="text-[10px] text-sand-500">
              {replyTime(reply.createdAt, lang)}
            </span>
            {/* Under a finger, Resolve and Delete are 40px targets, 8px
                apart (WALK4-16); under a mouse, 24px targets, 8px apart
                (WALK5-15, WCAG 2.5.8), the row's height kept. */}
            <span className="-my-1 ml-auto flex items-center gap-2 pointer-coarse:-my-2.5 pointer-coarse:gap-3">
              {canEdit && (!outside || mine) && (
                <button
                  onClick={() => setResolved(reply.id, !isResolved)}
                  disabled={inFlight.has(reply.id)}
                  data-track="reply-resolve"
                  data-tip={isResolved ? t("common.reopenTitle") : t("common.resolveTitle")}
                  className="inline-flex min-h-6 items-center px-1 text-[10px] font-semibold text-sand-500 hover:text-sage-700 pointer-coarse:min-h-10 pointer-coarse:px-1.5"
                >
                  {isResolved ? t("common.reopen") : t("common.resolve")}
                </button>
              )}
              {(mine || (role === "owner" && !crossAccount)) && (
                <button
                  onClick={() => remove(reply.id)}
                  disabled={inFlight.has(reply.id)}
                  data-track="reply-delete"
                  aria-label={t("common.delete")}
                  data-tip={t("common.delete")}
                  className="flex size-6 items-center justify-center text-[13px] text-sand-400 hover:text-red-600 pointer-coarse:size-10 pointer-coarse:text-[15px]"
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
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        {...ime.props}
        onKeyDown={(e) => {
          if (ime.isImeEnter(e) || isImeKey(e)) return;
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
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
      {sent && !shown.some(isSent) && (
        <div data-reply-sent={sent.done ? "" : "sending"} className="flex items-start gap-2">
          {people[myId] && <PersonBadge person={people[myId]} size={16} />}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="truncate text-[11px] font-semibold text-sand-700">{people[myId]?.name ?? "?"}</span>
              <span suppressHydrationWarning className="text-[10px] text-sand-500">
                {sent.done ? replyTime(sent.at, lang) : t("common.replySending")}
              </span>
            </div>
            <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap">{sent.content}</p>
          </div>
        </div>
      )}

      {resolvedReplies.length > 0 && (
        <button
          onClick={() => setShowResolved(!showResolved)}
          data-track="reply-show-resolved"
          className="inline-flex min-h-6 min-w-6 items-center justify-center self-start text-[10px] font-semibold text-sand-500 hover:text-clay-700"
        >
          {resolvedReplies.length === 1
            ? t("common.resolvedCountOne")
            : t("common.resolvedCountMany", { n: resolvedReplies.length })}
        </button>
      )}
      {showResolved && resolvedReplies.map(row)}

      {canReply && !composing && openRequest === undefined && (
        <button
          onClick={() => setComposing(true)}
          data-track="reply"
          data-tip={t("common.replyTitle")}
          className="inline-flex min-h-6 min-w-6 items-center justify-center self-start text-[11px] font-semibold text-sand-600 hover:text-clay-700 pointer-coarse:min-h-10 pointer-coarse:pr-3"
        >
          {t("common.reply")}
        </button>
      )}
      {!composerFirst && composer}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}

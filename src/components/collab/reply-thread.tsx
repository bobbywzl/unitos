"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { isImeKey, useImeGuard } from "@/lib/ime";
import type { ReplyView } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { PersonBadge } from "@/components/collab/person-badge";
import { useLang, useT } from "@/components/lang-provider";

// The discussion under one note (notes and annotations alike), one edit, or
// one link — how collaborators comment on each other's work. Open replies
// always show; resolved ones collapse behind a count. Any editor resolves a
// reply; its author or the owner deletes it. Editors reply; viewers read.
export function ReplyThread({
  target,
  replies,
}: {
  target: { noteId: string } | { blockEditId: string } | { docLinkId: string };
  replies: ReplyView[];
}) {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  const ime = useImeGuard();
  const { authOn, canEdit, myId, role, shared, people } = useCollab();
  const [composing, setComposing] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Replies are a collaboration surface: the Reply affordance appears once the
  // corpus is shared. Existing threads still render wherever they exist.
  if (replies.length === 0 && (!authOn || !shared || !canEdit)) return null;

  const dateLocale = lang === "zh" ? "zh-CN" : undefined;
  const openReplies = replies.filter((r) => r.resolvedById === null);
  const resolvedReplies = replies.filter((r) => r.resolvedById !== null);

  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  const send = () => {
    const content = draft.trim();
    if (!content) return;
    void run(async () => {
      await api("/api/replies", "POST", { ...target, content });
      setDraft("");
      setComposing(false);
    });
  };
  const remove = (id: string) => void run(() => api(`/api/replies/${id}`, "DELETE"));
  const setResolved = (id: string, resolvedValue: boolean) =>
    void run(() => api(`/api/replies/${id}`, "PATCH", { resolved: resolvedValue }));

  const row = (reply: ReplyView) => {
    const person = people[reply.userId];
    const isResolved = reply.resolvedById !== null;
    return (
      <div key={reply.id} className={`flex items-start gap-2 ${isResolved ? "opacity-60" : ""}`}>
        {person && <PersonBadge person={person} size={16} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[11px] font-semibold text-sand-700">
              {person?.name ?? "?"}
            </span>
            <span suppressHydrationWarning className="text-[10px] text-sand-500">
              {new Date(reply.createdAt).toLocaleString(dateLocale, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span className="ml-auto flex items-center gap-2">
              {canEdit && (
                <button
                  onClick={() => setResolved(reply.id, !isResolved)}
                  data-track="reply-resolve"
                  data-tip={isResolved ? t("common.reopenTitle") : t("common.resolveTitle")}
                  className="text-[10px] font-semibold text-sand-500 hover:text-sage-700"
                >
                  {isResolved ? t("common.reopen") : t("common.resolve")}
                </button>
              )}
              {(reply.userId === myId || role === "owner") && (
                <button
                  onClick={() => remove(reply.id)}
                  data-track="reply-delete"
                  aria-label={t("common.delete")}
                  data-tip={t("common.delete")}
                  className="text-[11px] text-sand-400 hover:text-red-600"
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

  return (
    <div
      className={`flex flex-col gap-2 ${replies.length > 0 ? "mt-2.5 border-t border-line pt-2.5" : "mt-1.5"}`}
    >
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

      {canEdit && !composing && (
        <button
          onClick={() => setComposing(true)}
          data-track="reply"
          data-tip={t("common.replyTitle")}
          className="self-start text-[11px] font-semibold text-sand-600 hover:text-clay-700"
        >
          {t("common.reply")}
        </button>
      )}
      {canEdit && composing && (
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
          <button
            type="submit"
            data-track="reply-send"
            disabled={!draft.trim() || busy}
            className="rounded-full bg-clay px-3 py-1.5 text-[11px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
          >
            {t("common.reply")}
          </button>
        </form>
      )}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}

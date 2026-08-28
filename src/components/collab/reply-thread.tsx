"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import type { ReplyView } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { PersonBadge } from "@/components/collab/person-badge";
import { useLang, useT } from "@/components/lang-provider";

// The discussion under one note (notes and annotations alike) or one edit —
// how collaborators comment on each other's work. Collapsed to a count until
// opened; a flat thread, oldest first. Editors reply; viewers read; a reply
// deletes by its author or the owner.
export function ReplyThread({
  target,
  replies,
}: {
  target: { noteId: string } | { blockEditId: string };
  replies: ReplyView[];
}) {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  const { authOn, canEdit, myId, role, shared, people } = useCollab();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Replies are a collaboration surface: the Reply affordance appears once the
  // corpus is shared. Existing threads still render wherever they exist.
  if (replies.length === 0 && (!authOn || !shared || !canEdit)) return null;

  const dateLocale = lang === "zh" ? "zh-CN" : undefined;

  async function send() {
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/replies", "POST", { ...target, content });
      setDraft("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/replies/${id}`, "DELETE");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 text-[11px] font-semibold text-sand-600 hover:text-clay-700"
      >
        {replies.length === 0
          ? t("common.reply")
          : replies.length === 1
            ? t("common.replyCountOne")
            : t("common.replyCountMany", { n: replies.length })}
      </button>
    );
  }

  return (
    <div className="mt-2.5 flex flex-col gap-2 border-t border-line pt-2.5">
      {replies.map((reply) => {
        const person = people[reply.userId];
        return (
          <div key={reply.id} className="flex items-start gap-2">
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
                {(reply.userId === myId || role === "owner") && (
                  <button
                    onClick={() => void remove(reply.id)}
                    aria-label={t("common.delete")}
                    title={t("common.delete")}
                    className="ml-auto text-[11px] text-sand-400 hover:text-red-600"
                  >
                    ×
                  </button>
                )}
              </div>
              <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap">{reply.content}</p>
            </div>
          </div>
        );
      })}

      {canEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="flex items-end gap-1.5"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder={t("common.replyPlaceholder")}
            rows={1}
            className="min-w-0 flex-1 resize-none rounded-2xl bg-sand-100 px-3 py-1.5 text-[12.5px] outline-none placeholder:text-sand-500"
          />
          <button
            type="submit"
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

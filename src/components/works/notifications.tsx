"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { useLang, useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { NotificationKindChip } from "@/components/notification-kind";
import { Presence } from "@/components/presence";

export type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  body: string; // markdown
  createdAt: string;
  // Kind "feedback": the feedback the reply answers. Null when that feedback
  // row is gone; the title then carries its message.
  feedback: { message: string } | null;
};

// The account's open notifications (SPEC.md §18) as one pop-up over the
// dashboard, top right under the header: the newest open notification — kind,
// date, title, body — and "1 of 3" when more are open. A reply to feedback
// (kind "feedback") reads "Reply to your feedback", the feedback's message,
// then the reply. Dismiss takes this one off and shows the next; Dismiss all
// takes every one off. A dismissed notification leaves at once and comes back
// only if the request fails.
export function Notifications({ items }: { items: NotificationItem[] }) {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  // Dates follow the app language; English keeps the browser default.
  const dateLocale = lang === "zh" ? "zh-CN" : undefined;
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  const open = items.filter((n) => !dismissed.has(n.id));
  const n = open[0];

  async function dismiss(ids: string[]) {
    setError(null);
    setDismissed((prev) => new Set([...prev, ...ids]));
    const failed: string[] = [];
    let message: string | null = null;
    for (const id of ids) {
      try {
        await api(`/api/notifications/${id}`, "PATCH", { dismissed: true });
      } catch (err) {
        failed.push(id);
        message = err instanceof Error ? err.message : t("common.requestFailed");
      }
    }
    if (failed.length > 0) {
      setDismissed((prev) => {
        const next = new Set(prev);
        for (const id of failed) next.delete(id);
        return next;
      });
      setError(message);
    }
    router.refresh();
  }

  return (
    <Presence show={n !== undefined} exit="pop">
      {n && (
        <aside
          role="status"
          aria-label={t("works.notifications")}
          className="pop-in fixed top-20 right-4 left-4 z-40 max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-[28px] bg-card p-5 shadow-float sm:left-auto sm:w-96 print:hidden"
        >
          <div className="flex items-center gap-2 text-xs text-sand-600">
            <NotificationKindChip kind={n.kind} />
            <span>{new Date(n.createdAt).toLocaleDateString(dateLocale)}</span>
            {open.length > 1 && (
              <span className="ml-auto">{t("works.notificationCount", { n: 1, total: open.length })}</span>
            )}
          </div>
          <p className="mt-2 text-sm font-semibold text-sand-800">
            {n.kind === "feedback" ? t("works.feedbackReplyTitle") : n.title}
          </p>
          {n.kind === "feedback" && (
            <p className="mt-1 border-l-2 border-line pl-3 text-sm whitespace-pre-wrap text-sand-600">
              {n.feedback?.message ?? n.title}
            </p>
          )}
          <div className="mt-1 text-sm text-sand-700">
            <Markdown>{n.body}</Markdown>
          </div>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          <div className="mt-3 flex items-center justify-end gap-2">
            {open.length > 1 && (
              <button
                onClick={() => void dismiss(open.map((o) => o.id))}
                className="rounded-full px-3 py-1 text-xs text-sand-600 hover:text-clay-700"
              >
                {t("works.dismissAll")}
              </button>
            )}
            <button
              onClick={() => void dismiss([n.id])}
              className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
            >
              {t("works.dismiss")}
            </button>
          </div>
        </aside>
      )}
    </Presence>
  );
}

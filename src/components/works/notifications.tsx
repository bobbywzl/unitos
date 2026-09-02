"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { useLang, useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { NotificationKindChip } from "@/components/notification-kind";

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

// The account's open notifications from the admin (SPEC.md §18), above the
// Projects shelf: kind, date, title, body. A reply to feedback (kind
// "feedback") reads "Reply to your feedback", the feedback's message, then the
// reply. Dismiss takes one off; the card leaves at once and comes back only if
// the request fails.
export function Notifications({ items }: { items: NotificationItem[] }) {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  // Dates follow the app language; English keeps the browser default.
  const dateLocale = lang === "zh" ? "zh-CN" : undefined;
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  const open = items.filter((n) => !dismissed.has(n.id));
  if (open.length === 0) return null;

  async function dismiss(id: string) {
    setError(null);
    setDismissed((prev) => new Set(prev).add(id));
    try {
      await api(`/api/notifications/${id}`, "PATCH", { dismissed: true });
      router.refresh();
    } catch (err) {
      setDismissed((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    }
  }

  return (
    <section className="mb-12">
      <h2 className="mb-3 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
        {t("works.notifications")}
      </h2>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <ul className="space-y-3">
        {open.map((n) => (
          <li key={n.id} className="rounded-2xl bg-card p-4 shadow-soft">
            <div className="flex items-center gap-2 text-xs text-sand-600">
              <NotificationKindChip kind={n.kind} />
              <span>{new Date(n.createdAt).toLocaleDateString(dateLocale)}</span>
              <button
                onClick={() => void dismiss(n.id)}
                className="ml-auto rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
              >
                {t("works.dismiss")}
              </button>
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
          </li>
        ))}
      </ul>
    </section>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
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

// The account's open notifications (SPEC.md §18) as one card above Projects,
// in the page's flow, so it covers no project card: the newest open
// notification — kind, "1 of 3" when more are open, Dismiss all and Dismiss
// on one row; then the title and the date; then the body, folded to two
// lines. A press on a folded body opens it whole, and a press again folds
// it. A reply to feedback (kind "feedback") reads "Reply to your feedback",
// the feedback's message, then the reply. Dismiss takes this one off and
// shows the next; Dismiss all takes every one off. A dismissed notification
// leaves at once and comes back only if the request fails.
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
          className="pop-in mb-6 rounded-[24px] bg-card px-5 py-3.5 shadow-soft print:hidden"
        >
          <div className="flex items-center gap-2 text-xs text-sand-600">
            <NotificationKindChip kind={n.kind} />
            {open.length > 1 && <span>{t("works.notificationCount", { n: 1, total: open.length })}</span>}
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {open.length > 1 && (
                <button
                  onClick={() => void dismiss(open.map((o) => o.id))}
                  className="rounded-full px-2.5 py-1 text-xs text-sand-600 hover:text-clay-700"
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
            </span>
          </div>
          <p className="mt-1.5 text-sm font-semibold text-sand-800">
            {n.kind === "feedback" ? t("works.feedbackReplyTitle") : n.title}
            <span className="ml-2 text-xs font-normal text-sand-500">
              {new Date(n.createdAt).toLocaleDateString(dateLocale)}
            </span>
          </p>
          <NotificationBody key={n.id}>
            {n.kind === "feedback" && (
              <p className="mb-1 border-l-2 border-line pl-3 whitespace-pre-wrap text-sand-600">
                {n.feedback?.message ?? n.title}
              </p>
            )}
            <Markdown>{n.body}</Markdown>
          </NotificationBody>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </aside>
      )}
    </Presence>
  );
}

/** A notification's body, folded to two lines. When the words run past
    them, a press on the body opens it whole and a press again folds it; a
    press on a link in it follows the link. */
function NotificationBody({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [folds, setFolds] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    // Measured once, folded: does the body run past its two lines?
    if (el && !open) setFolds(el.scrollHeight > el.clientHeight + 1);
  }, [open]);
  const toggle = () => {
    if (folds) setOpen((o) => !o);
  };
  return (
    <div
      ref={ref}
      role={folds ? "button" : undefined}
      tabIndex={folds ? 0 : undefined}
      aria-expanded={folds ? open : undefined}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) return;
        toggle();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      }}
      className={`mt-0.5 text-sm text-sand-700 ${folds ? "cursor-pointer" : ""} ${
        open ? "max-h-[50dvh] overflow-y-auto" : "line-clamp-2"
      }`}
    >
      {children}
    </div>
  );
}

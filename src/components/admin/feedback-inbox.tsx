"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLang, useT } from "@/components/lang-provider";
import type { TFunc, TKey } from "@/lib/i18n/dictionaries";

// One reply the admin sent: a notification of kind "feedback" to the account
// that sent the feedback (SPEC.md §18). dismissed = the account took it off its
// dashboard.
export type FeedbackReply = {
  id: string;
  body: string;
  createdAt: string;
  dismissed: boolean;
};

export type FeedbackItem = {
  id: string;
  category: string;
  message: string;
  page: string | null;
  userAgent: string | null;
  status: string;
  createdAt: string;
  // The account that sent it, by name. Null = no account to reply to.
  account: string | null;
  replies: FeedbackReply[];
};

const FILTERS = ["new", "seen", "resolved", "all"] as const;
type Filter = (typeof FILTERS)[number];

// Display labels of the wire values; the values themselves never change.
const VALUE_LABELS: Record<string, TKey> = {
  new: "admin.statusNew",
  seen: "admin.statusSeen",
  resolved: "admin.statusResolved",
  all: "admin.filterAll",
  bug: "admin.categoryBug",
  idea: "admin.categoryIdea",
  other: "admin.categoryOther",
};

function valueLabel(t: TFunc, value: string): string {
  const key = VALUE_LABELS[value];
  return key ? t(key) : value;
}

export function FeedbackInbox({ items }: { items: FeedbackItem[] }) {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  // Dates follow the app language; English keeps the browser default.
  const dateLocale = lang === "zh" ? "zh-CN" : undefined;
  const [filter, setFilter] = useState<Filter>("new");
  // The reply form: the feedback it is open on, its draft, and its state. One
  // form at a time.
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const newCount = items.filter((f) => f.status === "new").length;
  const visible = filter === "all" ? items : items.filter((f) => f.status === filter);

  async function setStatus(id: string, status: string) {
    await fetch("/api/admin/feedback", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    router.refresh();
  }

  function openReply(id: string) {
    setReplyTo(id);
    setDraft("");
    setError(null);
  }

  // Send the reply: the server writes the notification to the account that
  // sent the feedback and marks new feedback seen; the refresh shows the reply
  // under the feedback.
  async function sendReply(id: string) {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, body }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(json?.error ?? t("admin.sendFailed"));
      setReplyTo(null);
      setDraft("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.sendFailed"));
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <header className="mb-6 flex items-center gap-3">
        <h1 className="text-[28px]">{t("admin.feedback")}</h1>
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                filter === f
                  ? "bg-ink text-paper"
                  : "bg-card text-sand-600 shadow-soft hover:text-clay-800"
              }`}
            >
              {valueLabel(t, f)}
              {f === "new" && newCount > 0 ? ` (${newCount})` : ""}
            </button>
          ))}
        </div>
      </header>

      {visible.length === 0 ? (
        <p className="text-sm text-sand-600">
          {filter === "all"
            ? t("admin.feedbackEmpty")
            : t("admin.feedbackEmptyFiltered", { filter: valueLabel(t, filter) })}
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map((f) => (
            <li key={f.id} className="rounded-2xl bg-card p-4 shadow-soft">
              <div className="flex items-center gap-2 text-xs text-sand-600">
                <span
                  className={`rounded-full px-2.5 py-0.5 font-semibold ${
                    f.category === "bug"
                      ? "bg-clay-200 text-clay-800"
                      : f.category === "idea"
                        ? "bg-sage-200 text-sage-800"
                        : "bg-sand-200 text-sand-700"
                  }`}
                >
                  {valueLabel(t, f.category)}
                </span>
                <span>{new Date(f.createdAt).toLocaleString(dateLocale)}</span>
                {f.page && <span className="truncate">· {f.page}</span>}
                {f.account && (
                  <span className="truncate">· {t("admin.feedbackFrom", { name: f.account })}</span>
                )}
                <span className="ml-auto">{valueLabel(t, f.status)}</span>
              </div>
              <p className="mt-2 text-sm whitespace-pre-wrap">{f.message}</p>
              {f.replies.length > 0 && (
                <ul className="mt-3 space-y-3 border-l-2 border-line pl-3">
                  {f.replies.map((r) => (
                    <li key={r.id}>
                      <div className="text-xs text-sand-600">
                        {t("admin.reply")} · {new Date(r.createdAt).toLocaleString(dateLocale)} ·{" "}
                        {r.dismissed ? t("admin.replyDismissed") : t("admin.replyOpen")}
                      </div>
                      <p className="mt-1 text-sm whitespace-pre-wrap text-sand-700">{r.body}</p>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex items-center gap-2">
                {f.account ? (
                  replyTo !== f.id && (
                    <button
                      onClick={() => openReply(f.id)}
                      className="text-xs font-semibold text-clay-700 hover:text-clay-800"
                    >
                      {t("admin.reply")}
                    </button>
                  )
                ) : (
                  <span className="text-xs text-sand-500">{t("admin.replyNoAccount")}</span>
                )}
                {f.status !== "seen" && (
                  <button
                    onClick={() => void setStatus(f.id, "seen")}
                    className="text-xs text-sand-600 hover:text-clay-700"
                  >
                    {t("admin.markSeen")}
                  </button>
                )}
                {f.status !== "resolved" && (
                  <button
                    onClick={() => void setStatus(f.id, "resolved")}
                    className="text-xs font-semibold text-sage-700 hover:text-sage-800"
                  >
                    {t("admin.resolve")}
                  </button>
                )}
                {f.status === "resolved" && (
                  <button
                    onClick={() => void setStatus(f.id, "new")}
                    className="text-xs text-sand-600 hover:text-clay-700"
                  >
                    {t("admin.reopen")}
                  </button>
                )}
              </div>
              {replyTo === f.id && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void sendReply(f.id);
                  }}
                  className="mt-3 space-y-2"
                >
                  <textarea
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={t("admin.replyPh")}
                    rows={3}
                    maxLength={4000}
                    className="w-full rounded-2xl bg-sand-100 p-3 text-sm outline-none placeholder:text-sand-500"
                  />
                  <div className="flex items-center gap-2">
                    {error && <span className="text-xs text-red-600">{error}</span>}
                    <button
                      type="button"
                      onClick={() => setReplyTo(null)}
                      className="ml-auto rounded-full px-3 py-1 text-xs text-sand-600 hover:text-clay-700"
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      type="submit"
                      disabled={sending || !draft.trim()}
                      className="rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
                    >
                      {sending ? t("admin.sending") : t("admin.send")}
                    </button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

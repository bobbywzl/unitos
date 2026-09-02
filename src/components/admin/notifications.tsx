"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useLang, useT } from "@/components/lang-provider";
import {
  NOTIFICATION_KIND_LABEL,
  NOTIFICATION_KINDS,
  NotificationKindChip,
  type NotificationKind,
} from "@/components/notification-kind";

export type RecipientOption = { id: string; name: string; email: string };

export type SentNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  createdAt: string;
  recipients: string[]; // recipient names
  dismissed: number;
};

const chip = (on: boolean) =>
  `rounded-full px-3 py-1 text-xs font-semibold ${
    on ? "bg-ink text-paper" : "bg-sand-100 text-sand-600 hover:text-clay-800"
  }`;

// Compose and send a notification (SPEC.md §18), then the list of sends. The
// account list is for picking recipients only — name and email, no link, no
// edit: the admin cannot open or change an account.
export function AdminNotifications({
  accounts,
  sent,
}: {
  accounts: RecipientOption[];
  sent: SentNotification[];
}) {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  // Dates follow the app language; English keeps the browser default.
  const dateLocale = lang === "zh" ? "zh-CN" : undefined;

  const [kind, setKind] = useState<NotificationKind>("update");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"all" | "chosen">("all");
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [sentCount, setSentCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) => a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q),
    );
  }, [accounts, filter]);

  const ready =
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    (audience === "all" ? accounts.length > 0 : chosen.size > 0);

  function toggle(id: string) {
    setState("idle");
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || state === "busy") return;
    setState("busy");
    setError(null);
    try {
      const res = await fetch("/api/admin/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          title: title.trim(),
          body: body.trim(),
          recipients: audience === "all" ? "all" : [...chosen],
        }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string; sent?: number } | null;
      if (!res.ok) throw new Error(json?.error ?? t("admin.sendFailed"));
      setSentCount(json?.sent ?? 0);
      setState("sent");
      setTitle("");
      setBody("");
      setChosen(new Set());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.sendFailed"));
      setState("idle");
    }
  }

  async function remove(id: string) {
    if (!confirm(t("admin.deleteNotificationConfirm"))) return;
    await fetch("/api/admin/notifications", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <form onSubmit={send} className="space-y-3 rounded-2xl bg-card p-5 shadow-soft">
        <div className="flex gap-1">
          {NOTIFICATION_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setKind(k);
                setState("idle");
              }}
              className={chip(kind === k)}
            >
              {t(NOTIFICATION_KIND_LABEL[k])}
            </button>
          ))}
        </div>
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setState("idle");
          }}
          placeholder={t("admin.notificationTitlePh")}
          maxLength={200}
          className="w-full rounded-full bg-sand-100 px-4 py-2 text-sm outline-none placeholder:text-sand-500"
        />
        <textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setState("idle");
          }}
          placeholder={t("admin.notificationBodyPh")}
          rows={4}
          maxLength={4000}
          className="w-full rounded-2xl bg-sand-100 p-3 text-sm outline-none placeholder:text-sand-500"
        />

        <div>
          <p className="mb-1.5 text-xs text-sand-700">{t("admin.recipients")}</p>
          <div className="flex flex-wrap items-center gap-1">
            <button type="button" onClick={() => setAudience("all")} className={chip(audience === "all")}>
              {t("admin.recipientsAll")}
              {accounts.length > 0 ? ` (${accounts.length})` : ""}
            </button>
            <button
              type="button"
              onClick={() => setAudience("chosen")}
              className={chip(audience === "chosen")}
            >
              {t("admin.recipientsChosen")}
              {chosen.size > 0 ? ` (${chosen.size})` : ""}
            </button>
          </div>
          {accounts.length === 0 && (
            <p className="mt-2 text-xs text-sand-600">{t("admin.recipientsNone")}</p>
          )}
          {audience === "chosen" && accounts.length > 0 && (
            <div className="mt-2 space-y-2">
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t("admin.recipientsFilterPh")}
                className="w-full rounded-full bg-sand-100 px-4 py-1.5 text-xs outline-none placeholder:text-sand-500"
              />
              <ul className="max-h-56 space-y-0.5 overflow-y-auto rounded-2xl bg-sand-100 p-2">
                {shown.map((a) => (
                  <li key={a.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-full px-2 py-1 text-xs hover:bg-clay-100">
                      <input
                        type="checkbox"
                        checked={chosen.has(a.id)}
                        onChange={() => toggle(a.id)}
                        className="accent-clay"
                      />
                      <span className="truncate font-semibold text-sand-800">{a.name}</span>
                      {a.email && <span className="truncate text-sand-600">{a.email}</span>}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {error && <span className="text-xs text-red-600">{error}</span>}
          {state === "sent" && (
            <span className="text-xs text-sage-700">{t("admin.sentTo", { n: sentCount })}</span>
          )}
          <button
            type="submit"
            disabled={!ready || state === "busy"}
            className="ml-auto rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
          >
            {state === "busy" ? t("admin.sending") : t("admin.send")}
          </button>
        </div>
      </form>

      <section>
        <h2 className="mb-3 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
          {t("admin.sentList")}
        </h2>
        {sent.length === 0 ? (
          <p className="text-sm text-sand-600">{t("admin.sentEmpty")}</p>
        ) : (
          <ul className="space-y-3">
            {sent.map((n) => (
              <li key={n.id} className="rounded-2xl bg-card p-4 shadow-soft">
                <div className="flex flex-wrap items-center gap-2 text-xs text-sand-600">
                  <NotificationKindChip kind={n.kind} />
                  <span>{new Date(n.createdAt).toLocaleString(dateLocale)}</span>
                  <span>· {t("admin.sentRecipients", { n: n.recipients.length })}</span>
                  <span className="ml-auto">{t("admin.sentDismissed", { n: n.dismissed })}</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-sand-800">{n.title}</p>
                <p className="mt-1 text-sm whitespace-pre-wrap text-sand-700">{n.body}</p>
                <p className="mt-2 line-clamp-2 text-[11px] text-sand-500">{n.recipients.join(", ")}</p>
                <div className="mt-2 flex">
                  <button
                    onClick={() => void remove(n.id)}
                    className="text-xs text-sand-600 hover:text-red-600"
                  >
                    {t("common.delete")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

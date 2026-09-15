"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/components/lang-provider";

// The block list on the admin accounts page (lib/block.ts). BlockButton sits
// on one account's card: Block or Unblock, by the account's email. BlockList
// is the list of every blocked email, with Unblock on each row and a form
// that blocks an email with no account yet. Both post to
// /api/admin/accounts/block; the page refreshes so every row shows the
// result.

type Status = { kind: "done" | "error"; text: string } | null;

async function setBlocked(email: string, blocked: boolean, failed: (status: number) => string) {
  const res = await fetch("/api/admin/accounts/block", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, blocked }),
  });
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new Error(json?.error ?? failed(res.status));
}

const button =
  "rounded-full border border-line px-3 py-1 text-xs text-sand-700 disabled:opacity-40";

export function BlockButton({ email, blocked }: { email: string; blocked: boolean }) {
  const router = useRouter();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      await setBlocked(email, !blocked, (s) => t("admin.blockFailedStatus", { status: s }));
      setStatus({ kind: "done", text: blocked ? t("admin.unblocked") : t("admin.blocked") });
      router.refresh();
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : t("admin.blockFailed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
      <button
        onClick={() => void toggle()}
        disabled={busy}
        className={`${button} ${blocked ? "hover:border-sage-400 hover:text-sage-700" : "hover:border-red-300 hover:text-red-600"}`}
      >
        {busy ? t("common.saving") : blocked ? t("admin.unblock") : t("admin.block")}
      </button>
      <span className="text-[11px] text-sand-500">
        {blocked ? t("admin.unblockDesc") : t("admin.blockDesc")}
      </span>
      {status && (
        <span className={`text-xs ${status.kind === "error" ? "text-red-600" : "text-sage-700"}`}>
          {status.text}
        </span>
      )}
    </div>
  );
}

export function BlockList({ emails }: { emails: string[] }) {
  const router = useRouter();
  const t = useT();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function run(target: string, blocked: boolean) {
    if (busy) return;
    setBusy(target);
    setStatus(null);
    try {
      await setBlocked(target, blocked, (s) => t("admin.blockFailedStatus", { status: s }));
      setStatus({ kind: "done", text: blocked ? t("admin.blocked") : t("admin.unblocked") });
      if (blocked) setEmail("");
      router.refresh();
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : t("admin.blockFailed") });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mb-6 rounded-2xl bg-card p-4 shadow-soft">
      <h2 className="text-sm font-bold text-sand-800">{t("admin.blockList")}</h2>
      <p className="mt-1 text-[11px] text-sand-500">{t("admin.blockListDesc")}</p>
      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void run(email.trim().toLowerCase(), true);
        }}
      >
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("admin.blockEmailPh")}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-full bg-paper px-4 py-1.5 text-sm outline-none placeholder:text-sand-500"
        />
        <button
          type="submit"
          disabled={busy !== null || !valid}
          className="rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
        >
          {busy === email.trim().toLowerCase() ? t("common.saving") : t("admin.block")}
        </button>
        {status && (
          <span className={`text-xs ${status.kind === "error" ? "text-red-600" : "text-sage-700"}`}>
            {status.text}
          </span>
        )}
      </form>
      {emails.length === 0 ? (
        <p className="mt-3 text-xs text-sand-600">{t("admin.blockListEmpty")}</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {emails.map((e) => (
            <li key={e} className="flex flex-wrap items-center gap-2 text-sm text-sand-800">
              <span className="min-w-0 flex-1 truncate">{e}</span>
              <button
                onClick={() => void run(e, false)}
                disabled={busy !== null}
                className={`${button} hover:border-sage-400 hover:text-sage-700`}
              >
                {busy === e ? t("common.saving") : t("admin.unblock")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

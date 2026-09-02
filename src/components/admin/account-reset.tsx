"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/components/lang-provider";

// Reset one account (lib/account-reset.ts) behind a typed confirmation: the
// admin types the account's email (the local reader's id when sign-in is off);
// the server checks it too.
export function AccountReset({ userId, confirm }: { userId: string; confirm: string }) {
  const router = useRouter();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "done" | "error"; text: string } | null>(null);
  const matches = typed.trim().toLowerCase() === confirm;

  async function reset() {
    if (busy || !matches) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/accounts/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, confirm: typed.trim() }),
      });
      const json = (await res.json().catch(() => null)) as {
        error?: string;
        projects?: number;
        documents?: number;
        notes?: number;
      } | null;
      if (!res.ok) {
        throw new Error(json?.error ?? t("admin.resetFailedStatus", { status: res.status }));
      }
      setStatus({
        kind: "done",
        text: t("admin.resetDone", {
          projects: json?.projects ?? 0,
          documents: json?.documents ?? 0,
          notes: json?.notes ?? 0,
        }),
      });
      setOpen(false);
      setTyped("");
      router.refresh();
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : t("admin.resetFailed") });
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setOpen(false);
    setTyped("");
    setStatus(null);
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {status && (
          <span
            className={`mr-auto text-xs ${status.kind === "error" ? "text-red-600" : "text-sage-700"}`}
          >
            {status.text}
          </span>
        )}
        {!open && (
          <button
            onClick={() => {
              setOpen(true);
              setStatus(null);
            }}
            className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:border-red-300 hover:text-red-600"
          >
            {t("admin.resetAccount")}
          </button>
        )}
      </div>
      {open && (
        <form
          className="mt-2 space-y-2 rounded-xl bg-paper p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void reset();
          }}
        >
          <p className="text-xs text-sand-700">{t("admin.resetConfirmDesc", { confirm })}</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={confirm}
              autoFocus
              autoComplete="off"
              className="min-w-0 flex-1 rounded-full bg-card px-4 py-1.5 text-sm shadow-soft outline-none placeholder:text-sand-500"
            />
            <button
              type="button"
              onClick={cancel}
              className="rounded-full px-3 py-1.5 text-xs text-sand-600 hover:text-clay-700"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={busy || !matches}
              className="rounded-full bg-red-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40"
            >
              {busy ? t("admin.resetting") : t("admin.resetAccount")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

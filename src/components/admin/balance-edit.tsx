"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/components/lang-provider";

// One balance's form on the admin usage page (lib/balances.ts): the figure
// the provider's billing page shows now, and the warn level. A balance read
// live takes the warn level alone. Save posts to /api/admin/balances and the
// page refreshes, so the row shows the new estimate. The button and the form
// sit in the row's flex line; the form wraps to a line of its own.
export function BalanceEdit({
  balanceKey,
  canSet,
  showWarn,
  warnUsd,
}: {
  balanceKey: string;
  /** The balance itself can be typed: not read live, or the live reading failed. */
  canSet: boolean;
  /** The warn level applies: a USD balance. */
  showWarn: boolean;
  warnUsd: number;
}) {
  const router = useRouter();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [usd, setUsd] = useState("");
  const [warn, setWarn] = useState(String(warnUsd));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // An empty slot of the button's width keeps the row's figures in line.
  if (!canSet && !showWarn) return <span className="hidden w-28 shrink-0 sm:block" />;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const body: { key: string; usd?: number; warnUsd?: number } = { key: balanceKey };
    if (canSet && usd.trim() !== "") body.usd = Number(usd);
    if (showWarn && warn.trim() !== "") body.warnUsd = Number(warn);
    if (body.usd === undefined && body.warnUsd === undefined) {
      setError(t("admin.balanceNothingTyped"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/balances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(json?.error ?? t("admin.balanceSaveFailedStatus", { status: res.status }));
      setOpen(false);
      setUsd("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.balanceSaveFailed"));
    } finally {
      setBusy(false);
    }
  }

  const input =
    "w-32 rounded-lg border border-line bg-paper px-2 py-1 text-sm tabular-nums text-sand-800 focus:border-clay-400 focus:outline-none";

  return (
    <>
      <span className="ml-auto flex w-28 shrink-0 justify-end sm:ml-0">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-sand-700 hover:border-clay-300 hover:text-clay-800"
        >
          {canSet ? t("admin.balanceSet") : t("admin.balanceWarnLevel")}
        </button>
      </span>
      {open && (
        <form onSubmit={(e) => void save(e)} className="flex basis-full flex-wrap items-end gap-3 rounded-xl bg-sand-100 px-3 py-3">
          {canSet && (
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-sand-600">
              {t("admin.balanceFieldUsd")}
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={usd}
                onChange={(e) => setUsd(e.target.value)}
                className={input}
                autoFocus
              />
            </label>
          )}
          {showWarn && (
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-sand-600">
              {t("admin.balanceFieldWarn")}
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="1"
                value={warn}
                onChange={(e) => setWarn(e.target.value)}
                className={input}
                autoFocus={!canSet}
              />
            </label>
          )}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
            >
              {busy ? t("common.saving") : t("common.save")}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError("");
              }}
              className="rounded-full px-3 py-1.5 text-xs text-sand-600 hover:text-clay-800"
            >
              {t("common.cancel")}
            </button>
          </div>
          <p className="basis-full text-xs text-sand-500">
            {canSet ? t("admin.balanceFieldHint") : t("admin.balanceWarnHint")}
          </p>
          {error && <p className="basis-full text-xs text-red-600">{error}</p>}
        </form>
      )}
    </>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TierState } from "@/lib/tiers";
import { useT } from "@/components/lang-provider";
import { TierMark } from "@/components/tier-mark";

// Set one account's tier (TIERS.md): Unitos Ultra, Unitos Premium for good,
// or Unitos Premium on a trial until a date. Save posts to
// /api/admin/accounts/tier; the page refreshes so the chip shows the result.

type Plan = "ultra" | "premium" | "trial";

function planOf(state: TierState): Plan {
  return state === "ultra" ? "ultra" : state === "premium" ? "premium" : "trial";
}

export function TierControl({
  userId,
  state,
  trialEndsAt,
}: {
  userId: string;
  state: TierState;
  // ISO date of the trial's end, when the account has one.
  trialEndsAt: string | null;
}) {
  const router = useRouter();
  const t = useT();
  const [plan, setPlan] = useState<Plan>(planOf(state));
  const [date, setDate] = useState(trialEndsAt ? trialEndsAt.slice(0, 10) : "");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "done" | "error"; text: string } | null>(null);
  const changed = plan !== planOf(state) || (plan === "trial" && date !== (trialEndsAt ?? "").slice(0, 10));
  const valid = plan !== "trial" || /^\d{4}-\d{2}-\d{2}$/.test(date);

  async function save() {
    if (busy || !changed || !valid) return;
    setBusy(true);
    setStatus(null);
    try {
      const body =
        plan === "trial"
          ? { userId, plan, trialEndsAt: new Date(`${date}T00:00:00.000Z`).toISOString() }
          : { userId, plan };
      const res = await fetch("/api/admin/accounts/tier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(json?.error ?? t("admin.tierSaveFailedStatus", { status: res.status }));
      }
      setStatus({ kind: "done", text: t("admin.tierSaved") });
      router.refresh();
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : t("admin.tierSaveFailed") });
    } finally {
      setBusy(false);
    }
  }

  const select =
    "rounded-full bg-card px-3 py-1.5 text-xs text-sand-800 shadow-soft outline-none";

  return (
    <form
      className="mt-3 space-y-2 border-t border-line pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-sand-800">
          <TierMark state={plan === "ultra" ? "ultra" : "premium"} size={13} />
          {t("admin.tier")}
        </span>
        <select value={plan} onChange={(e) => setPlan(e.target.value as Plan)} className={select}>
          <option value="ultra">{t("common.tierUltra")}</option>
          <option value="premium">{t("common.tierPremium")}</option>
          <option value="trial">{t("admin.tierOptionTrial")}</option>
        </select>
        {plan === "trial" && (
          <label className="flex items-center gap-1.5 text-xs text-sand-700">
            {t("admin.tierTrialEnds")}
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className={select}
            />
          </label>
        )}
        <button
          type="submit"
          disabled={busy || !changed || !valid}
          className="rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
        >
          {busy ? t("common.saving") : t("common.save")}
        </button>
        {status && (
          <span className={`text-xs ${status.kind === "error" ? "text-red-600" : "text-sage-700"}`}>
            {status.text}
          </span>
        )}
      </div>
      <p className="text-[11px] text-sand-500">{t("admin.tierDesc")}</p>
    </form>
  );
}

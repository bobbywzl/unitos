"use client";

import { useState } from "react";
import { useT } from "@/components/lang-provider";
import { planButton } from "@/components/billing/plan-card";
import { api } from "@/lib/api";

// Pay (SPEC.md §24): asks /api/billing/checkout for the Stripe Checkout URL
// and sends the browser there. Stripe returns to /billing/confirmed.
export function PayButton({ tier }: { tier: "premium" | "ultra" }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { url } = await api<{ url: string }>("/api/billing/checkout", "POST", { tier });
      window.location.assign(url);
    } catch (err) {
      setError(t("billing.payFailed", { reason: err instanceof Error ? err.message : String(err) }));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={() => void pay()} disabled={busy} className={planButton}>
        {busy ? t("billing.paying") : t("billing.pay")}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

"use client";

import type { Tier } from "@prisma/client";
import { useState } from "react";
import { useT } from "@/components/lang-provider";
import { planButton } from "@/components/billing/plan-button";
import { api } from "@/lib/api";

// Pay with Stripe (SPEC.md §24): asks /api/billing/checkout for the Stripe
// Checkout URL and sends the browser there. While the URL comes, the page
// dims under the Stripe hand-off overlay: a spinning ring, "Opening
// Stripe…", and the line that says Stripe brings the reader back here.
// Stripe returns to /billing/confirmed.
export function PayButton({ tier, interval }: { tier: Tier; interval: "month" | "year" }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { url } = await api<{ url: string }>("/api/billing/checkout", "POST", {
        tier: tier === "ULTRA" ? "ultra" : "premium",
        interval,
      });
      window.location.assign(url);
    } catch (err) {
      setError(t("billing.payFailed", { reason: err instanceof Error ? err.message : String(err) }));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void pay()}
        disabled={busy}
        className={`${planButton(tier)} w-full py-3.5 text-[15px]`}
      >
        <svg
          aria-hidden
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        {t("billing.pay")}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {busy && (
        <div
          role="status"
          className="billing-overlay fixed inset-0 z-10 flex items-center justify-center p-6"
        >
          <div className="billing-overlay-card w-full max-w-[380px] rounded-2xl px-7 py-8 text-center">
            <div aria-hidden className="billing-spinner mx-auto mb-[18px] size-11 rounded-full" />
            <h2 className="mb-2 font-display text-[24px] text-[#2e2b25]">{t("billing.paying")}</h2>
            <p className="text-[13px] leading-relaxed text-[#645c50] text-pretty">{t("billing.payingBody")}</p>
          </div>
        </div>
      )}
    </div>
  );
}

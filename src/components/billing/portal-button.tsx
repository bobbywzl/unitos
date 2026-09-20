"use client";

import { useState } from "react";
import { useT } from "@/components/lang-provider";
import type { PortalFlow } from "@/lib/billing/checkout";
import { api } from "@/lib/api";

// Manage subscription (SPEC.md §24): asks /api/billing/portal for the Stripe
// billing portal URL and sends the browser there. The account changes its
// card, switches tier, or cancels there; Stripe returns to the plan page,
// or to Settings when back is "settings". A flow opens the portal at that
// job — Change plan, Update card, Cancel subscription — with the label the
// job needs; without one the button is Manage subscription.
export function PortalButton({
  className,
  flow,
  back = "billing",
  label,
}: {
  className?: string;
  flow?: PortalFlow;
  back?: "billing" | "settings";
  label?: string;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { url } = await api<{ url: string }>("/api/billing/portal", "POST", { flow, back });
      window.location.assign(url);
    } catch (err) {
      setError(t("billing.manageFailed", { reason: err instanceof Error ? err.message : String(err) }));
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void open()}
        disabled={busy}
        className={
          className ??
          "rounded-full bg-card px-4 py-1.5 text-xs font-semibold text-sand-700 shadow-soft hover:text-clay-800 disabled:opacity-40"
        }
      >
        {busy ? t("billing.manageOpening") : (label ?? t("billing.manage"))}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

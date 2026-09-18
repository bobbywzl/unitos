"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/components/lang-provider";

// The billing switch (SPEC.md §24): Turn on / Turn off posts to
// /api/admin/billing; the page refreshes so the state shows the result. The
// route refuses On with the reason when Stripe is not ready; ready says
// whether it would, so the button reads disabled with the reason beside it.
export function BillingSwitch({ on, ready, reason }: { on: boolean; ready: boolean; reason: string }) {
  const router = useRouter();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "done" | "error"; text: string } | null>(null);

  async function flip() {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: !on }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(json?.error ?? t("admin.billingSaveFailedStatus", { status: res.status }));
      }
      setStatus({ kind: "done", text: t("admin.billingSaved") });
      router.refresh();
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : t("admin.billingSaveFailed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span
        className={`rounded-full px-3 py-0.5 text-xs font-semibold ${
          on ? "bg-sage-200 text-sage-800" : "bg-sand-200 text-sand-600"
        }`}
      >
        {on ? t("admin.billingOn") : t("admin.billingOff")}
      </span>
      <button
        type="button"
        onClick={() => void flip()}
        disabled={busy || (!on && !ready)}
        className="rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
      >
        {busy ? t("common.saving") : on ? t("admin.billingTurnOff") : t("admin.billingTurnOn")}
      </button>
      {!on && !ready && <span className="text-xs text-sand-600">{reason}</span>}
      {status && (
        <span className={`text-xs ${status.kind === "error" ? "text-red-600" : "text-sage-700"}`}>
          {status.text}
        </span>
      )}
    </div>
  );
}

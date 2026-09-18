"use client";

import { useState } from "react";
import { useT } from "@/components/lang-provider";

// Check models: one probe call per model on the gateway (lib/gateway-admin.ts),
// run from this button, never on load — every probe is a real, billed call.
type Health = { healthy: string[]; unhealthy: { model: string; error: string }[] };

export function GatewayHealth() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);

  async function check() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/gateway/health", { method: "POST" });
      const json = (await res.json().catch(() => null)) as (Partial<Health> & { error?: string }) | null;
      if (!res.ok) throw new Error(json?.error ?? t("admin.gatewayHealthFailed"));
      setHealth({ healthy: json?.healthy ?? [], unhealthy: json?.unhealthy ?? [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.gatewayHealthFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-line py-2">
      {health && (
        <ul className="mb-2 space-y-1 text-xs">
          {health.healthy.map((m) => (
            <li key={`ok-${m}`} className="flex items-center gap-2">
              <span className="rounded-full bg-sage-200 px-2 py-0.5 font-semibold text-sage-800">
                {t("admin.gatewayHealthy")}
              </span>
              <span className="font-mono text-sand-800">{m}</span>
            </li>
          ))}
          {health.unhealthy.map((m, i) => (
            <li key={`bad-${m.model}-${i}`} className="flex items-start gap-2">
              <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700">
                {t("admin.gatewayUnhealthy")}
              </span>
              <span className="font-mono text-sand-800">{m.model}</span>
              <span className="text-sand-500">{m.error}</span>
            </li>
          ))}
          {health.healthy.length === 0 && health.unhealthy.length === 0 && (
            <li className="text-sand-500">{t("admin.gatewayHealthNone")}</li>
          )}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {error && <span className="mr-auto text-xs text-red-600">{error}</span>}
        <button
          onClick={() => void check()}
          disabled={busy}
          className="rounded-full bg-sand-100 px-3 py-1 text-xs font-semibold text-sand-700 shadow-soft hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
        >
          {busy ? t("admin.gatewayHealthChecking") : t("admin.gatewayHealthCheck")}
        </button>
      </div>
    </div>
  );
}

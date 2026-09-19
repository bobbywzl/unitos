"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/components/lang-provider";

// The app key's limits (lib/gateway-admin.ts): requests and tokens per
// minute, the budget, and how often it resets. With no app key set, Create
// issues one and shows it once — it goes into LITELLM_API_KEY on the host.
type Limits = {
  rpm: number | null;
  tpm: number | null;
  maxBudget: number | null;
  budgetDuration: string | null;
};

export function GatewayKey({ exists, initial }: { exists: boolean; initial: Limits }) {
  const router = useRouter();
  const t = useT();
  const [rpm, setRpm] = useState(initial.rpm?.toString() ?? "");
  const [tpm, setTpm] = useState(initial.tpm?.toString() ?? "");
  const [maxBudget, setMaxBudget] = useState(initial.maxBudget?.toString() ?? "");
  const [budgetDuration, setBudgetDuration] = useState(initial.budgetDuration ?? "");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "done" | "error"; text: string } | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const body = (): Limits | null => {
    const int = (v: string) => (v.trim() === "" ? null : Number.parseInt(v, 10));
    const num = (v: string) => (v.trim() === "" ? null : Number.parseFloat(v));
    const limits = {
      rpm: int(rpm),
      tpm: int(tpm),
      maxBudget: num(maxBudget),
      budgetDuration: budgetDuration.trim() === "" ? null : budgetDuration.trim(),
    };
    const bad =
      [limits.rpm, limits.tpm].some((v) => v !== null && (!Number.isInteger(v) || v <= 0)) ||
      (limits.maxBudget !== null && (Number.isNaN(limits.maxBudget) || limits.maxBudget < 0)) ||
      (limits.budgetDuration !== null && !/^\d+[smhd]$/.test(limits.budgetDuration));
    return bad ? null : limits;
  };

  async function submit() {
    if (busy) return;
    const limits = body();
    if (!limits) {
      setStatus({ kind: "error", text: t("admin.gatewayKeyInvalid") });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/gateway/key", {
        method: exists ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(limits),
      });
      const json = (await res.json().catch(() => null)) as { error?: string; key?: string } | null;
      if (!res.ok) throw new Error(json?.error ?? t("admin.gatewayKeyFailed"));
      if (exists) {
        setStatus({ kind: "done", text: t("admin.gatewayKeySaved") });
        router.refresh();
      } else if (json?.key) {
        setCreated(json.key);
      }
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : t("admin.gatewayKeyFailed") });
    } finally {
      setBusy(false);
    }
  }

  const field = (label: string, value: string, set: (v: string) => void, placeholder: string) => (
    <label className="flex flex-col gap-1 text-xs text-sand-600">
      {label}
      <input
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder}
        className="rounded-lg border border-line bg-paper px-2 py-1 font-mono text-sm text-sand-800"
      />
    </label>
  );

  return (
    <div className="border-t border-line py-3">
      <div className="grid gap-3 sm:grid-cols-4">
        {field(t("admin.gatewayKeyRpm"), rpm, setRpm, "600")}
        {field(t("admin.gatewayKeyTpm"), tpm, setTpm, "2000000")}
        {field(t("admin.gatewayKeyBudget"), maxBudget, setMaxBudget, "500")}
        {field(t("admin.gatewayKeyBudgetDuration"), budgetDuration, setBudgetDuration, "30d")}
      </div>
      <p className="mt-2 text-xs text-sand-500">{t("admin.gatewayKeyHint")}</p>
      {created && (
        <div className="mt-3 rounded-xl bg-sand-100 p-3">
          <p className="text-xs font-semibold text-sand-800">{t("admin.gatewayKeyCreated")}</p>
          <code className="mt-1 block break-all font-mono text-sm text-sand-800">{created}</code>
          <p className="mt-1 text-xs text-sand-600">{t("admin.gatewayKeyCreatedHint")}</p>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {status && (
          <span className={`mr-auto text-xs ${status.kind === "error" ? "text-red-600" : "text-sage-700"}`}>
            {status.text}
          </span>
        )}
        <button
          onClick={() => void submit()}
          disabled={busy || created !== null}
          className="rounded-full bg-sand-100 px-3 py-1 text-xs font-semibold text-sand-700 shadow-soft hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
        >
          {busy
            ? t("admin.gatewayKeyWorking")
            : exists
              ? t("admin.gatewayKeySave")
              : t("admin.gatewayKeyCreate")}
        </button>
      </div>
    </div>
  );
}

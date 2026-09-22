"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/components/lang-provider";

// The model per feature (lib/feature-models.ts): one row per feature with a
// select of the role models and Other for any id. A pick saves at once;
// the route probes the id first, and a pick the probe refuses leaves the
// feature where it was.

export type FeatureModelRow = {
  feature: string;
  label: string;
  modelId: string;
  defaultId: string;
};

export type FeatureModelOption = { id: string; name: string; provider: string };

const OTHER = "other";

const select = "rounded-full bg-card px-3 py-1.5 text-xs text-sand-800 shadow-soft outline-none";

export function FeatureModels({ features, options }: { features: FeatureModelRow[]; options: FeatureModelOption[] }) {
  return (
    <div>
      {features.map((row) => (
        <Row key={row.feature} row={row} options={options} />
      ))}
    </div>
  );
}

function Row({ row, options }: { row: FeatureModelRow; options: FeatureModelOption[] }) {
  const router = useRouter();
  const t = useT();
  const listed = options.some((o) => o.id === row.modelId);
  const [modelId, setModelId] = useState(row.modelId);
  const [other, setOther] = useState(!listed);
  const [custom, setCustom] = useState(listed ? "" : row.modelId);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "done" | "error"; text: string } | null>(null);

  async function save(id: string) {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/feature-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature: row.feature, modelId: id }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string; modelId?: string } | null;
      if (!res.ok) throw new Error(json?.error ?? t("admin.featureSaveFailed"));
      const saved = json?.modelId ?? id;
      setModelId(saved);
      setOther(!options.some((o) => o.id === saved));
      setStatus({ kind: "done", text: t("admin.featureSaved") });
      router.refresh();
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : t("admin.featureSaveFailed") });
    } finally {
      setBusy(false);
    }
  }

  function pick(value: string) {
    if (value === OTHER) {
      setOther(true);
      setCustom("");
      return;
    }
    setOther(false);
    void save(value);
  }

  return (
    <div className="flex flex-col gap-1 border-t border-line py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm">{row.label}</div>
          <div className="font-mono text-xs text-sand-600">
            {modelId}
            {modelId === row.defaultId && ` · ${t("admin.featureDefault")}`}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={other ? OTHER : modelId} disabled={busy} onChange={(e) => pick(e.target.value)} className={select}>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · {o.id}
                {o.id === row.defaultId && ` (${t("admin.featureDefault")})`}
              </option>
            ))}
            <option value={OTHER}>{t("admin.featureOther")}</option>
          </select>
          {other && (
            <>
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder={t("admin.featureOtherPh")}
                disabled={busy}
                className={`${select} w-48 font-mono`}
              />
              <button
                onClick={() => void save(custom)}
                disabled={busy || !custom.trim()}
                className="rounded-full bg-clay px-3 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
              >
                {t("admin.featureSave")}
              </button>
            </>
          )}
        </div>
      </div>
      {(busy || status) && (
        <div className={`text-xs ${status?.kind === "error" ? "text-red-600" : "text-sage-700"}`}>
          {busy ? t("admin.featureSaving") : status?.text}
        </div>
      )}
    </div>
  );
}

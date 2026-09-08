"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/components/lang-provider";

// Check now: runs the model update outside its schedule (lib/model-update.ts)
// and refreshes the list above with what it found.
export function ModelCheck() {
  const router = useRouter();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "done" | "error"; text: string } | null>(null);

  async function check() {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/models", { method: "POST" });
      const json = (await res.json().catch(() => null)) as {
        error?: string;
        results?: { changed: boolean }[];
      } | null;
      if (!res.ok) throw new Error(json?.error ?? t("admin.modelsCheckFailed"));
      const results = json?.results ?? [];
      setStatus({
        kind: "done",
        text: t("admin.modelsChecked", {
          n: results.length,
          changed: results.filter((r) => r.changed).length,
        }),
      });
      router.refresh();
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : t("admin.modelsCheckFailed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line py-2">
      {status && (
        <span className={`mr-auto text-xs ${status.kind === "error" ? "text-red-600" : "text-sage-700"}`}>
          {status.text}
        </span>
      )}
      <button
        onClick={() => void check()}
        disabled={busy}
        className="rounded-full bg-sand-100 px-3 py-1 text-xs font-semibold text-sand-700 shadow-soft hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
      >
        {busy ? t("admin.modelsChecking") : t("admin.modelsCheck")}
      </button>
    </div>
  );
}

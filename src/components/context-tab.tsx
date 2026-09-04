"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { isImeKey } from "@/lib/ime";
import { useT } from "@/components/lang-provider";
import { Presence } from "@/components/presence";

export type ContextValues = { background: string; purpose: string; application: string };

// The stored fields merge into one Background text; the next save writes it
// back as background alone and clears the older purpose and application columns.
function merged(values: ContextValues | null): string {
  if (!values) return "";
  return [values.background, values.purpose, values.application]
    .map((v) => v.trim())
    .filter(Boolean)
    .join("\n");
}

// The Context tab in the workspace header: the reader's background, injected
// into every AI prompt. Optional — it never blocks reading or upload. Saves
// globally (ReaderProfile) or as this work's override (notebook.profile).
export function ContextTab({
  notebookId,
  initial,
  hasOverride,
  isSet,
}: {
  notebookId: string;
  initial: ContextValues | null;
  hasOverride: boolean;
  isSet: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [background, setBackground] = useState(merged(initial));
  const [scope, setScope] = useState<"global" | "notebook">(hasOverride ? "notebook" : "global");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opening seeds the field from the saved state, so the panel always shows
  // what is stored, not what a dismissed edit left behind.
  function toggle() {
    if (!open) {
      setBackground(merged(initial));
      setScope(hasOverride ? "notebook" : "global");
      setError(null);
    }
    setOpen(!open);
  }

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isImeKey(e)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function save() {
    if (busy) return;
    const values = { background: background.trim(), purpose: "", application: "" };
    setBusy(true);
    setError(null);
    try {
      if (scope === "global") {
        await api("/api/profile", "PUT", values);
        if (hasOverride) await api(`/api/notebooks/${notebookId}`, "PATCH", { profile: null });
      } else {
        await api(`/api/notebooks/${notebookId}`, "PATCH", { profile: values });
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("panels.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={panelRef} className="relative shrink-0">
      <button
        onClick={toggle}
        data-track="context"
        aria-expanded={open}
        data-tip={t("panels.contextHint")}
        className={`rounded-full px-3.5 py-1.5 text-[13px] hover:bg-clay-100 hover:text-clay-800 ${
          isSet
            ? "border border-line text-sand-700"
            : "border border-dashed border-sand-400 text-sand-600"
        }`}
      >
        {isSet ? t("panels.context") : t("panels.addContext")}
      </button>

      <Presence show={open} exit="menu">
      {open && (
        <div className="menu-in absolute right-0 z-30 mt-2 w-[340px] rounded-2xl bg-card p-4 shadow-float">
          <p className="text-xs text-sand-600">{t("panels.contextDesc")}</p>
          <label className="mt-3 block">
            <span className="text-xs text-sand-700">{t("panels.fieldBackground")}</span>
            <textarea
              value={background}
              onChange={(e) => setBackground(e.target.value)}
              placeholder={t("panels.fieldBackgroundPh")}
              rows={4}
              className="mt-1 w-full rounded-2xl bg-sand-100 p-3 text-sm outline-none placeholder:text-sand-500"
            />
          </label>
          <div className="mt-3 flex items-center gap-4 text-xs text-sand-700">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                className="accent-clay"
                checked={scope === "global"}
                onChange={() => setScope("global")}
              />
              {t("panels.scopeEverywhere")}
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                className="accent-clay"
                checked={scope === "notebook"}
                onChange={() => setScope("notebook")}
              />
              {t("panels.scopeThisCorpus")}
            </label>
          </div>
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
          <div className="mt-3 flex justify-end">
            <button
              onClick={() => void save()}
              data-track="context-save"
              disabled={busy}
              className="rounded-full bg-clay px-5 py-2 text-sm font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
            >
              {busy ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </div>
      )}
      </Presence>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

export type ContextValues = { background: string; purpose: string; application: string };

const EMPTY: ContextValues = { background: "", purpose: "", application: "" };

// The Context tab in the workspace header: who the reader is and what they're
// after. Injected into every AI prompt: notes, extraction, analysis. Optional —
// it never blocks reading or upload. Saves globally (ReaderProfile) or as this
// work's override (notebook.profile).
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
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<ContextValues>(initial ?? EMPTY);
  const [scope, setScope] = useState<"global" | "notebook">(hasOverride ? "notebook" : "global");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opening seeds the fields from the saved state, so the panel always shows
  // what is stored, not what a dismissed edit left behind.
  function toggle() {
    if (!open) {
      setValues(initial ?? EMPTY);
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
      if (e.key === "Escape") setOpen(false);
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
    const trimmed = {
      background: values.background.trim(),
      purpose: values.purpose.trim(),
      application: values.application.trim(),
    };
    setBusy(true);
    setError(null);
    try {
      if (scope === "global") {
        await api("/api/profile", "PUT", trimmed);
        if (hasOverride) await api(`/api/notebooks/${notebookId}`, "PATCH", { profile: null });
      } else {
        await api(`/api/notebooks/${notebookId}`, "PATCH", { profile: trimmed });
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof ContextValues, label: string, placeholder: string) => (
    <label className="block">
      <span className="text-xs text-sand-700">{label}</span>
      <textarea
        value={values[key]}
        onChange={(e) => setValues({ ...values, [key]: e.target.value })}
        placeholder={placeholder}
        rows={2}
        className="mt-1 w-full rounded-2xl bg-sand-100 p-3 text-sm outline-none placeholder:text-sand-500"
      />
    </label>
  );

  return (
    <div ref={panelRef} className="relative shrink-0">
      <button
        onClick={toggle}
        aria-expanded={open}
        title="Injected into every AI prompt: notes, extraction, analysis."
        className={`rounded-full px-3.5 py-1.5 text-[13px] hover:bg-clay-100 hover:text-clay-800 ${
          isSet
            ? "border border-line text-sand-700"
            : "border border-dashed border-sand-400 text-sand-600"
        }`}
      >
        {isSet ? "Context" : "Add context"}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[340px] rounded-2xl bg-card p-4 shadow-float">
          <p className="text-xs text-sand-600">
            Injected into every AI prompt: notes, extraction, analysis. Every field is optional.
          </p>
          <div className="mt-3 space-y-3">
            {field(
              "background",
              "Background",
              "e.g. Stanford student, stochastic calc + stats + quantum",
            )}
            {field("purpose", "Purpose", "e.g. due diligence, exam prep, replicate results")}
            {field("application", "Application", "e.g. investment decision for Bough Capital")}
          </div>
          <div className="mt-3 flex items-center gap-4 text-xs text-sand-700">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                className="accent-clay"
                checked={scope === "global"}
                onChange={() => setScope("global")}
              />
              Everywhere
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                className="accent-clay"
                checked={scope === "notebook"}
                onChange={() => setScope("notebook")}
              />
              This corpus only
            </label>
          </div>
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
          <div className="mt-3 flex justify-end">
            <button
              onClick={() => void save()}
              disabled={busy}
              className="rounded-full bg-clay px-5 py-2 text-sm font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

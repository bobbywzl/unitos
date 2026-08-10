"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export type ProfileValues = { background: string; purpose: string; application: string };

// Reader profile onboarding: 3 questions, shown on first work creation, editable
// per work (SPEC.md §6). Controlled — the workspace rail opens it from its ⋯ menu.
export function ProfileDialog({
  notebookId,
  initial,
  hasOverride,
  open,
  onClose,
}: {
  notebookId: string;
  initial: ProfileValues | null;
  hasOverride: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<ProfileValues>(
    initial ?? { background: "", purpose: "", application: "" },
  );
  const [scope, setScope] = useState<"global" | "notebook">(hasOverride ? "notebook" : "global");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  async function save() {
    const trimmed = {
      background: values.background.trim(),
      purpose: values.purpose.trim(),
      application: values.application.trim(),
    };
    if (!trimmed.background || !trimmed.purpose || !trimmed.application) return;
    setBusy(true);
    try {
      if (scope === "global") {
        await api("/api/profile", "PUT", trimmed);
        if (hasOverride) await api(`/api/notebooks/${notebookId}`, "PATCH", { profile: null });
      } else {
        await api(`/api/notebooks/${notebookId}`, "PATCH", { profile: trimmed });
      }
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof ProfileValues, label: string, placeholder: string) => (
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
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-sand-900/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal
        aria-label="Reader profile"
        className="w-full max-w-lg rounded-[32px] bg-card p-6 shadow-float"
      >
        <h2 className="text-xl">Reader profile</h2>
        <p className="mt-1 text-xs text-sand-600">
          Injected into every AI prompt. Three questions, be concrete.
        </p>
        <div className="mt-4 space-y-3">
          {field("background", "Background", "e.g. Stanford student, stochastic calc + stats + quantum")}
          {field("purpose", "Purpose", "e.g. due diligence, exam prep, replicate results")}
          {field("application", "Application", "e.g. investment decision for Bough Capital")}
        </div>
        <div className="mt-4 flex items-center gap-4 text-xs text-sand-700">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input type="radio" checked={scope === "global"} onChange={() => setScope("global")} />
            Everywhere
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              checked={scope === "notebook"}
              onChange={() => setScope("notebook")}
            />
            This work only
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-full border border-line px-4 py-2 text-sm text-sand-700 hover:bg-clay-100 hover:text-clay-800"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={busy}
            className="rounded-full bg-clay px-5 py-2 text-sm font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

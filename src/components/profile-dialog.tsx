"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";

type ProfileValues = { background: string; purpose: string; application: string };

// Reader profile onboarding: 3 questions, shown on first notebook creation,
// editable per notebook (SPEC.md §6).
export function ProfileDialog({
  notebookId,
  initial,
  hasOverride,
  autoOpen,
}: {
  notebookId: string;
  initial: ProfileValues | null;
  hasOverride: boolean;
  autoOpen: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen);
  const [values, setValues] = useState<ProfileValues>(
    initial ?? { background: "", purpose: "", application: "" },
  );
  const [scope, setScope] = useState<"global" | "notebook">(hasOverride ? "notebook" : "global");
  const [busy, setBusy] = useState(false);

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
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const field = (
    key: keyof ProfileValues,
    label: string,
    placeholder: string,
  ) => (
    <label className="block">
      <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{label}</span>
      <textarea
        value={values[key]}
        onChange={(e) => setValues({ ...values, [key]: e.target.value })}
        placeholder={placeholder}
        rows={2}
        className="mt-1 w-full rounded-md border border-neutral-300 bg-white p-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
      />
    </label>
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`text-sm ${initial ? "text-neutral-500 hover:text-neutral-900 dark:hover:text-white" : "font-medium text-amber-600 hover:text-amber-800"}`}
      >
        {initial ? "Profile" : "Set reader profile"}
      </button>
      {open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
            <h2 className="text-base font-semibold">Reader profile</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Injected into every AI prompt. Three questions, be concrete.
            </p>
            <div className="mt-4 space-y-3">
              {field("background", "Background", "e.g. Stanford student, stochastic calc + stats + quantum")}
              {field("purpose", "Purpose", "e.g. due diligence, exam prep, replicate results")}
              {field("application", "Application", "e.g. investment decision for Bough Capital")}
            </div>
            <div className="mt-4 flex items-center gap-3 text-xs text-neutral-600 dark:text-neutral-300">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={scope === "global"}
                  onChange={() => setScope("global")}
                />
                Everywhere
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={scope === "notebook"}
                  onChange={() => setScope("notebook")}
                />
                This notebook only
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={() => void save()}
                disabled={busy}
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

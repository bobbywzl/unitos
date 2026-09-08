"use client";

import { useT } from "@/components/lang-provider";

// The save state at the top of a note being edited (SPEC.md §6): "Saving…"
// while the draft differs from what the server holds, "Saved" once the server
// confirmed it, "Not saved" when the last save failed (the next keystroke
// retries). One line, the same on the tray card, the floating card, and a
// section's composer.
export type SaveState = "saving" | "saved" | "failed";

export function SaveStateLabel({ state }: { state: SaveState | null }) {
  const t = useT();
  if (!state) return null;
  const key = state === "saving" ? "outline.saving" : state === "saved" ? "outline.saved" : "outline.saveFailed";
  return (
    <span
      role="status"
      aria-live="polite"
      data-save-state={state}
      className={`shrink-0 text-[11px] ${state === "failed" ? "text-red-500" : "text-sand-500"}`}
    >
      {t(key)}
    </span>
  );
}

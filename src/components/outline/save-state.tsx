"use client";

import { useT } from "@/components/lang-provider";
import { OfflineIcon, WarningIcon } from "@/components/icons";

// The save state at the top of a note being edited (SPEC.md §6): "Saving…"
// while the draft differs from what the server holds, "Saved" once the server
// confirmed it, "Not saved" when the last save failed (the next keystroke
// retries), "Saved · both versions kept" when the note changed in another
// tab or by a collaborator meanwhile and some lines are kept twice
// (lib/notes/conflict.ts). One line, the same on the tray card, the floating
// card, and a section's composer. "Waiting to sync" on a note saved offline,
// until the queue syncs (lib/offline/queued-notes.ts); its tooltip reads
// "Saved on this device · syncs when online".
export type SaveState = "saving" | "saved" | "failed" | "both" | "offline";

// compact: a collapsed row's one line has no room for the words; the state
// shows as its icon, the words in its tooltip (Waiting to sync, Not saved).
export function SaveStateLabel({ state, compact = false }: { state: SaveState | null; compact?: boolean }) {
  const t = useT();
  if (!state) return null;
  const key =
    state === "saving"
      ? "outline.saving"
      : state === "saved"
        ? "outline.saved"
        : state === "both"
          ? "outline.savedBoth"
          : state === "offline"
            ? "outline.waitingSync"
            : "outline.saveFailed";
  if (compact && (state === "offline" || state === "failed")) {
    const tip = state === "offline" ? `${t(key)} · ${t("outline.savedOffline")}` : t(key);
    return (
      <span
        role="status"
        aria-label={t(key)}
        data-save-state={state}
        data-tip={tip}
        className={`flex shrink-0 items-center ${state === "failed" ? "text-red-500" : "text-sand-500"}`}
      >
        {state === "offline" ? <OfflineIcon size={13} /> : <WarningIcon size={13} />}
      </span>
    );
  }
  return (
    <span
      role="status"
      aria-live="polite"
      data-save-state={state}
      data-tip={state === "offline" ? t("outline.savedOffline") : undefined}
      className={`shrink-0 text-[11px] ${state === "failed" ? "text-red-500" : state === "both" ? "text-clay-600" : "text-sand-500"}`}
    >
      {t(key)}
    </span>
  );
}

"use client";

import { useSyncExternalStore } from "react";
import { useCollab } from "@/components/collab/collab-context";
import { useT } from "@/components/lang-provider";
import { readSaveState, readSaveTouched, subscribeSaveState } from "@/lib/save-state";

function subscribeOnline(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

// The save indicator (SPEC.md §6): one small dim line in the header of the
// reader and of the notes full page, left of Share. "Saving…" while a write
// is in flight or a draft waits for its save, "Saved" once every write
// landed, "Not saved" when the last write failed. Offline with Unitos Premium,
// a landed write is saved on this device and syncs later, and the line says
// so. Nothing shows until the first write of the tab.
export function SaveIndicator() {
  const t = useT();
  const { premium } = useCollab();
  const state = useSyncExternalStore(subscribeSaveState, readSaveState, () => "saved" as const);
  const touched = useSyncExternalStore(subscribeSaveState, readSaveTouched, () => false);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  if (!touched) return null;
  const key =
    state === "saving"
      ? "outline.saving"
      : state === "failed"
        ? "outline.saveFailed"
        : !online && premium
          ? "outline.savedOffline"
          : "outline.saved";
  return (
    <span
      role="status"
      aria-live="polite"
      data-save-state={state}
      className={`hidden shrink-0 text-[11px] sm:inline ${state === "failed" ? "text-red-500" : "text-sand-500"}`}
    >
      {t(key)}
    </span>
  );
}

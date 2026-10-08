"use client";

import { useEffect, useSyncExternalStore } from "react";
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

// A page editor's own status carries the app's writes too while it shows
// (SPEC.md §29), so the header's line hides: one save state on screen.
let statusShown = 0;
const statusListeners = new Set<() => void>();
const fireStatus = () => {
  for (const listener of statusListeners) listener();
};

/** A page editor's status shows this state as well: hides the header's
    line while it is mounted. */
export function usePageStatusCarries(): void {
  useEffect(() => {
    statusShown += 1;
    fireStatus();
    return () => {
      statusShown -= 1;
      fireStatus();
    };
  }, []);
}

function subscribeStatusShown(listener: () => void) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

// The save indicator (SPEC.md §6): one small dim line in the header of the
// reader and of the notes full page, left of Share. "Saving…" while a write
// is in flight or a draft waits for its save, "Saved" once every write
// landed, "Not saved" when the last write failed. Offline with Unitos Premium,
// a landed write is saved on this device and syncs later, and the line says
// so. Nothing shows until the first write of the tab. While a page editor's
// status carries this state, this line hides.
export function SaveIndicator() {
  const t = useT();
  const { premium } = useCollab();
  const state = useSyncExternalStore(subscribeSaveState, readSaveState, () => "saved" as const);
  const touched = useSyncExternalStore(subscribeSaveState, readSaveTouched, () => false);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const inPage = useSyncExternalStore(subscribeStatusShown, () => statusShown > 0, () => false);
  if (!touched || inPage) return null;
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

"use client";

// The save state of the open project (SPEC.md §6): what the save indicator
// in the header reads. Every write api() sends counts while it is in flight;
// a note editor counts its draft from the keystroke to the save it starts;
// a write that fails leaves the state failed until the next write lands. One
// store for the tab, read with useSyncExternalStore.

export type SaveState = "saving" | "saved" | "failed";

let inflight = 0;
const dirty = new Set<string>();
let failed = false;
let touched = false;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function subscribeSaveState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function readSaveState(): SaveState {
  if (inflight > 0 || dirty.size > 0) return "saving";
  return failed ? "failed" : "saved";
}

/** True once any write ran in this tab: the indicator shows nothing before. */
export function readSaveTouched(): boolean {
  return touched;
}

export function beginWrite(): void {
  inflight++;
  touched = true;
  notify();
}

export function endWrite(ok: boolean): void {
  inflight = Math.max(0, inflight - 1);
  failed = !ok;
  notify();
}

/** A draft that differs from what the server holds, until its save starts. */
export function markDirty(id: string): void {
  if (dirty.has(id)) return;
  dirty.add(id);
  touched = true;
  notify();
}

export function clearDirty(id: string): void {
  if (!dirty.delete(id)) return;
  notify();
}

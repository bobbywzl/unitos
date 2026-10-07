"use client";

// Recommended links accepted in this tab whose Accept the graph's data does
// not show yet (WALK4-15): the header counts them at once, and the refetch
// that follows the Accept takes over (a link no longer recommended in the
// data is not counted twice). A refused Accept takes its link back out.

import { useSyncExternalStore } from "react";

let accepted: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function set(next: ReadonlySet<string>) {
  accepted = next;
  for (const l of listeners) l();
}

export function markAccepted(linkId: string): void {
  if (accepted.has(linkId)) return;
  set(new Set([...accepted, linkId]));
}

export function unmarkAccepted(linkId: string): void {
  if (!accepted.has(linkId)) return;
  const next = new Set(accepted);
  next.delete(linkId);
  set(next);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const NONE: ReadonlySet<string> = new Set();

export function useAcceptedNow(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => accepted, () => NONE);
}

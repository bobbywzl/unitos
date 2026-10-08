"use client";

import { useSyncExternalStore } from "react";

// Whether the cards stand under their words (SPEC.md §29): with no card
// column beside the page — a pane too narrow for one, a split view — only
// the open card shows, under the caret's line, and it draws as one line, so
// it covers one line of the words instead of four. The layer measures it
// (suggest/layer.tsx placeCards) and the cards read it.

let under = false;
const listeners = new Set<() => void>();

export function setCardsUnderWords(value: boolean): void {
  if (value === under) return;
  under = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCardsUnderWords(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => under,
    () => false,
  );
}

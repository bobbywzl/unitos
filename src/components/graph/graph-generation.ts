"use client";

import { useSyncExternalStore } from "react";

// The graph's generation per project: it moves each time the project's rev
// moves while the graph is open, or a graph answer lands (graph-data.tsx).
// What a tab keeps beside the graph's answer — a link's passages, the
// Documents list's part titles — is read again once its generation is older,
// even when the graph itself answered 304 (an edit to a linked paragraph
// outside its quote changes nothing the graph's body carries; REV4-02).
// The kept copy shows until the new one lands, and stays when the call fails.

const generations = new Map<string, number>();
const listeners = new Set<() => void>();

export function graphGeneration(notebookId: string): number {
  return generations.get(notebookId) ?? 0;
}

export function bumpGraphGeneration(notebookId: string): void {
  generations.set(notebookId, graphGeneration(notebookId) + 1);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGraphGeneration(notebookId: string | undefined): number {
  return useSyncExternalStore(
    subscribe,
    () => (notebookId ? graphGeneration(notebookId) : 0),
    () => 0,
  );
}

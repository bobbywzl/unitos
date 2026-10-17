"use client";

import { useSyncExternalStore } from "react";
import type { ProjectPartTitles } from "@/lib/graph/outline-titles";

// [cost10] COST10-03: the coverage answer carries each part's counts in the
// part titles' order and no block ids (lib/graph/coverage-view.ts,
// compactCoverage). The ids come from whoever read them: the Documents
// list's titles answer (GET …/outline?parts=titles) and the node card's
// outline (GET …/outline?documentId=) put a document's part ids here, and
// the coverage provider (coverage.tsx) pairs its counts with them. Per
// project and document, the ids in the titles' order. Copy on write: each
// change is a new map, so a snapshot never moves under a render.

const EMPTY: ReadonlyMap<string, readonly string[]> = new Map();
const store = new Map<string, ReadonlyMap<string, readonly string[]>>();
const listeners = new Set<() => void>();

/** One document's part ids, in the titles' order. */
export function rememberPartIds(notebookId: string, documentId: string, ids: readonly string[]): void {
  rememberMany(notebookId, [[documentId, ids]]);
}

/** Every document's part ids, from a titles answer. */
export function rememberPartTitles(notebookId: string, titles: ProjectPartTitles): void {
  rememberMany(
    notebookId,
    Object.entries(titles.documents).map(([id, parts]) => [id, parts.map((p) => p.blockId)]),
  );
}

function rememberMany(notebookId: string, entries: [string, readonly string[]][]): void {
  const before = store.get(notebookId) ?? EMPTY;
  let next: Map<string, readonly string[]> | null = null;
  for (const [documentId, ids] of entries) {
    const had = before.get(documentId);
    if (had && had.length === ids.length && had.every((x, i) => x === ids[i])) continue;
    (next ??= new Map(before)).set(documentId, ids);
  }
  if (!next) return;
  store.set(notebookId, next);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The project's known part ids by document; empty until a list read them. */
export function usePartIds(notebookId: string): ReadonlyMap<string, readonly string[]> {
  return useSyncExternalStore(subscribe, () => store.get(notebookId) ?? EMPTY, () => EMPTY);
}

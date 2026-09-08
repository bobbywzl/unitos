"use client";

import { useSyncExternalStore } from "react";

// The error log: every error the workspace shows since the page opened, so a
// notice that came and went is still readable. Producers call reportError
// with the document the error is about; the reader lists that document's
// entries under its Distill and Extract buttons (article-errors.tsx), and
// Dismiss there drops them. Module state: one log per tab, shared by every
// component.

export type ErrorEntry = { id: number; documentId: string | null; message: string; at: number };

const MAX_ENTRIES = 50;

let entries: ErrorEntry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function reportError(message: string, documentId: string | null = null): void {
  const text = message.trim();
  if (!text) return;
  // The same message twice in a row for the same document is one entry: a
  // retry loop must not fill the log.
  const last = entries[0];
  if (last && last.message === text && last.documentId === documentId) {
    entries = [{ ...last, at: Date.now() }, ...entries.slice(1)];
  } else {
    entries = [{ id: nextId++, documentId, message: text, at: Date.now() }, ...entries].slice(
      0,
      MAX_ENTRIES,
    );
  }
  emit();
}

// Dismiss drops one document's entries; the other documents' entries stay.
export function dismissErrors(documentId: string | null): void {
  const kept = entries.filter((e) => e.documentId !== documentId);
  if (kept.length === entries.length) return;
  entries = kept;
  emit();
}

export function clearErrors(): void {
  if (entries.length === 0) return;
  entries = [];
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): ErrorEntry[] {
  return entries;
}

const EMPTY: ErrorEntry[] = [];
function serverSnapshot(): ErrorEntry[] {
  return EMPTY;
}

// The log, newest first. Re-renders on every report and dismiss.
export function useErrorLog(): ErrorEntry[] {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

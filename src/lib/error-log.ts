"use client";

import { useSyncExternalStore } from "react";

// The error log: every error the workspace shows since the page opened, so a
// notice that came and went is still readable. Producers call reportError;
// the rail's error button (workspace.tsx) lists the entries newest first.
// Module state: one log per tab, shared by every component.

export type ErrorEntry = { id: number; message: string; at: number };

const MAX_ENTRIES = 50;

let entries: ErrorEntry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function reportError(message: string): void {
  const text = message.trim();
  if (!text) return;
  // The same message twice in a row is one entry: a retry loop must not
  // fill the log.
  const last = entries[0];
  if (last && last.message === text) {
    entries = [{ ...last, at: Date.now() }, ...entries.slice(1)];
  } else {
    entries = [{ id: nextId++, message: text, at: Date.now() }, ...entries].slice(0, MAX_ENTRIES);
  }
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

// The log, newest first. Re-renders on every report and clear.
export function useErrorLog(): ErrorEntry[] {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

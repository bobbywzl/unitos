"use client";

import { useSyncExternalStore } from "react";

// The notes whose editor is open (note-card.tsx). A search keeps them in
// the list, whether or not they match, until their editor closes: a search
// never closes the editor the reader is typing in (use-outline.ts
// noteMatches).

const open = new Map<string, number>();
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version += 1;
  for (const listener of listeners) listener();
}

/** The note's editor opened; the returned function closes it. */
export function holdEditing(id: string): () => void {
  open.set(id, (open.get(id) ?? 0) + 1);
  changed();
  return () => {
    const left = (open.get(id) ?? 1) - 1;
    if (left > 0) open.set(id, left);
    else open.delete(id);
    changed();
  };
}

/** Whether the note's editor is open. */
export function isEditingNote(id: string): boolean {
  return open.has(id);
}

/** Draws again when an editor opens or closes: a list filtered by a search
    takes the open editors in. */
export function useEditingNotes(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => version,
    () => 0,
  );
}

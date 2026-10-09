"use client";

// Words of a write the offline queue dropped (lib/offline/queue.ts): the
// server refused it on replay with a 4xx, and no box's draft takes the words
// back — a comment, a note's edit, a gathered note, a block's edit, when the
// role went to viewer or the note, the section, or the document is gone.
// They are kept in the browser for the account that queued them, until the
// reader copies them from the offline pill (components/offline-status.tsx):
// a dropped write never throws typed words away (REV9-03, rule zero 6). A
// reply and a Note on this link go back into their box's draft instead
// (keepDroppedWords, lib/note-drafts.ts).

const PREFIX = "unitos-not-saved:";
// The list is capped: the oldest entry goes once more than this many wait.
const MAX = 50;
/** Fired on window when the list of the account changes in this tab. */
export const NOT_SAVED_EVENT = "unitos:not-saved";

export type NotSaved = {
  /** When the write was queued (ms). */
  at: number;
  path: string;
  method: string;
  /** The reader's words: the text, the comment, or the edit, with the quotes under them. */
  words: string;
};

// The account part of the key: the signed-in id, or "local" with sign-in off.
const key = (account: string | null) => `${PREFIX}${account || "local"}`;

function parse(raw: string | null): NotSaved[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.flatMap((e) => {
      if (!e || typeof e !== "object") return [];
      const v = e as Record<string, unknown>;
      if (typeof v.words !== "string" || !v.words || typeof v.path !== "string") return [];
      return [{ at: typeof v.at === "number" ? v.at : 0, path: v.path, method: typeof v.method === "string" ? v.method : "POST", words: v.words }];
    });
  } catch {
    return [];
  }
}

/** The account's dropped writes, oldest first. */
export function readNotSaved(account: string | null): NotSaved[] {
  try {
    return parse(localStorage.getItem(key(account)));
  } catch {
    return [];
  }
}

function announce() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NOT_SAVED_EVENT));
}

/** Keep one dropped write's words. The same words of the same path twice
    (a record the queue drained twice) are kept once. */
export function addNotSaved(account: string | null, entry: NotSaved) {
  if (!entry.words.trim()) return;
  const list = readNotSaved(account);
  if (list.some((e) => e.path === entry.path && e.words === entry.words)) return;
  list.push(entry);
  while (list.length > MAX) list.shift();
  try {
    localStorage.setItem(key(account), JSON.stringify(list));
  } catch {
    // Storage blocked: the words are gone with the drop, as before.
    return;
  }
  announce();
}

/** The reader copied the words: the list goes. */
export function clearNotSaved(account: string | null) {
  try {
    localStorage.removeItem(key(account));
  } catch {
    // Nothing to clear.
  }
  announce();
}

/** The words of every entry, one block per write, for the clipboard. */
export function notSavedText(list: NotSaved[]): string {
  return list.map((e) => e.words.trim()).join("\n\n");
}

/** Subscribe to changes of the list: this tab's (NOT_SAVED_EVENT) and
    another tab's (the storage event). */
export function subscribeNotSaved(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith(PREFIX)) onChange();
  };
  window.addEventListener(NOT_SAVED_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(NOT_SAVED_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

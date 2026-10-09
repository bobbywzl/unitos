"use client";

import { readAccountCookie, tabAccount } from "@/lib/tab-account";

// Local drafts (SPEC.md §6): the text of an open note editor, written to
// localStorage on every edit. The server save is debounced and the closing
// flush is a network call, so the last words typed before a crash, a power
// loss, or a lost connection would otherwise be gone. A draft is written
// synchronously with the keystroke, cleared when the server confirms the same
// content, and replayed on the next load when it did not (use-outline.ts,
// use-note-compose.ts).
//
// A draft is kept until the server confirms its words. A save that waits in
// the offline queue is not a confirmation: while the queue holds a note's
// text (holdNoteDraft), confirmNoteDraft leaves the draft that holds that
// text, and the queue confirms it when its write lands (lib/offline/queue.ts).
// Each draft names the account that wrote it; a page signed in as another
// account neither reads nor sends it, so one account's words never go out
// as another's.
//
// Two kinds. A note draft belongs to a note that exists (its editor in the
// tray, on the notes full page, or in the floating card). A compose draft
// belongs to the composer of one section: a new note being written, with the
// id of the note the composer created on the server once it has one.

const NOTE_PREFIX = "unitos-note-draft:";
const COMPOSE_PREFIX = "unitos-note-compose:";
// A draft nobody replayed in this long is stale: the note was deleted, or the
// section is gone.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// base: the note's text the draft was made from (lib/notes/save-text.ts);
// sent: the text of a save that was on its way when the draft was written —
// when the note holds it, the save landed and the draft was made from it.
// Both absent in a draft written before they existed. account: the account
// that wrote it; absent in a draft written before drafts named it, or with
// sign-in off.
export type NoteDraft = { content: string; savedAt: number; base?: string; sent?: string; account?: string };
// createId: the id the composer's create carries (lib/notes/client-id.ts),
// written before the create leaves, so a reload adopts the note it made.
// account: the account that typed it. legacy: read from a draft written
// before compose drafts named their account (never stored).
export type ComposeDraft = {
  content: string;
  noteId: string | null;
  savedAt: number;
  createId?: string;
  account?: string;
  legacy?: boolean;
};

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<T> & { savedAt?: unknown };
    if (typeof stored.savedAt !== "number") return null;
    return stored as T;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: the server save alone carries the draft.
  }
}

function remove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to clear.
  }
}

/** The account signed in on this page, when sign-in is on. */
function currentAccount(): string | null {
  return tabAccount() ?? readAccountCookie();
}

/** True when the draft was written by another account than this page's. */
function foreign(draft: { account?: unknown }): boolean {
  const account = currentAccount();
  return typeof draft.account === "string" && account !== null && draft.account !== account;
}

export function readNoteDraft(noteId: string): NoteDraft | null {
  const draft = read<NoteDraft>(NOTE_PREFIX + noteId);
  if (!draft || typeof draft.content !== "string" || foreign(draft)) return null;
  return {
    content: draft.content,
    savedAt: draft.savedAt,
    ...(typeof draft.base === "string" ? { base: draft.base } : {}),
    ...(typeof draft.sent === "string" ? { sent: draft.sent } : {}),
    ...(typeof draft.account === "string" ? { account: draft.account } : {}),
  };
}

export function writeNoteDraft(noteId: string, content: string, base?: string, sent?: string | null) {
  const account = currentAccount();
  write(NOTE_PREFIX + noteId, {
    content,
    savedAt: Date.now(),
    ...(base !== undefined ? { base } : {}),
    ...(sent ? { sent } : {}),
    ...(account ? { account } : {}),
  } satisfies NoteDraft);
}

// The note texts the offline queue holds, by note, with the time each was
// held: a mirror of the queue's note writes (lib/offline/queue.ts), added to
// as a write queues and set again from the queue whenever a record leaves it.
let held = new Map<string, Map<string, number>>();

/** The offline queue holds `content` for the note: a draft holding it stays. */
export function holdNoteDraft(noteId: string, content: string) {
  const texts = held.get(noteId) ?? new Map<string, number>();
  texts.set(content.trim(), Date.now());
  held.set(noteId, texts);
}

/** The note texts the offline queue held when it was read at `readAt`.
    A text held since that read stays held: its write queued meanwhile. */
export function setHeldNoteDrafts(texts: { noteId: string; content: string }[], readAt: number) {
  const next = new Map<string, Map<string, number>>();
  const add = (noteId: string, content: string, at: number) => {
    const set = next.get(noteId) ?? new Map<string, number>();
    set.set(content, at);
    next.set(noteId, set);
  };
  for (const [noteId, set] of held) for (const [content, at] of set) if (at >= readAt) add(noteId, content, at);
  for (const { noteId, content } of texts) add(noteId, content.trim(), readAt);
  held = next;
}

function isHeld(noteId: string, content: string): boolean {
  return held.get(noteId)?.has(content.trim()) ?? false;
}

/** The text a draft was made from, given the note's text now: the save that
    was on its way when the note holds it, else the base. Undefined for a
    draft written before drafts kept their base. */
export function noteDraftBase(draft: NoteDraft, stored: string): string | undefined {
  if (draft.sent !== undefined && draft.sent.trim() === stored.trim()) return draft.sent;
  return draft.base;
}

/** Fired on window when a note's draft is cleared (detail: { noteId }): the
    notes stop drawing its kept words (use-outline.ts). */
export const NOTE_DRAFT_CLEARED_EVENT = "unitos:note-draft-cleared";

export function clearNoteDraft(noteId: string) {
  remove(NOTE_PREFIX + noteId);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(NOTE_DRAFT_CLEARED_EVENT, { detail: { noteId } }));
  }
}

/** True when the draft holds words the server never confirmed: the text it
    was made from is known, and the draft differs from it. */
export function draftHoldsWords(draft: NoteDraft): boolean {
  return draft.base !== undefined && draft.content.trim() !== "" && draft.content.trim() !== draft.base.trim();
}

/** Every note draft in this browser, by note id. */
export function listNoteDrafts(): { noteId: string; draft: NoteDraft }[] {
  const out: { noteId: string; draft: NoteDraft }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(NOTE_PREFIX)) continue;
      const noteId = key.slice(NOTE_PREFIX.length);
      const draft = readNoteDraft(noteId);
      if (draft) out.push({ noteId, draft });
    }
  } catch {
    // Storage blocked: no drafts.
  }
  return out;
}

/** Clear the note's draft when it holds this content: the server has it now.
    A text the offline queue still holds is not on the server: its draft stays. */
export function confirmNoteDraft(noteId: string, content: string) {
  if (isHeld(noteId, content)) return;
  const draft = readNoteDraft(noteId);
  if (draft && draft.content.trim() === content.trim()) clearNoteDraft(noteId);
}

// A compose draft is kept per section and per account (SPEC.md §6): each
// account's composer reads and writes its own key, so one account's words
// are never shown to, saved as, or written over by another account in the
// same browser. Drafts written before the key named the account sit at the
// section's plain key, with no account: the first composer of the section
// to open takes such a draft into its own key (as before, it shows the
// words; it does not save them until the reader types). A draft at the
// plain key that names another account stays where it is.
function composeKey(sectionId: string, account: string | null): string {
  return account ? `${COMPOSE_PREFIX}${sectionId}@${encodeURIComponent(account)}` : COMPOSE_PREFIX + sectionId;
}

function composeFrom(draft: (Partial<ComposeDraft> & { savedAt: number }) | null): ComposeDraft | null {
  if (!draft || typeof draft.content !== "string") return null;
  return {
    content: draft.content,
    savedAt: draft.savedAt,
    noteId: typeof draft.noteId === "string" ? draft.noteId : null,
    ...(typeof draft.createId === "string" ? { createId: draft.createId } : {}),
    ...(typeof draft.account === "string" ? { account: draft.account } : {}),
  };
}

export function readComposeDraft(sectionId: string): ComposeDraft | null {
  const account = currentAccount();
  const own = composeFrom(read<ComposeDraft>(composeKey(sectionId, account)));
  if (own && !foreign(own)) return own;
  if (!account) return null;
  // A draft from before compose drafts named their account: taken into
  // this account's key, so it is shown once and cleared from one place.
  const plain = composeFrom(read<ComposeDraft>(composeKey(sectionId, null)));
  if (!plain || plain.account !== undefined) return null;
  write(composeKey(sectionId, account), { ...plain, account } satisfies ComposeDraft);
  remove(composeKey(sectionId, null));
  return { ...plain, account, legacy: true };
}

export function writeComposeDraft(sectionId: string, content: string, noteId: string | null, createId?: string) {
  const account = currentAccount();
  write(composeKey(sectionId, account), {
    content,
    noteId,
    savedAt: Date.now(),
    ...(createId ? { createId } : {}),
    ...(account ? { account } : {}),
  } satisfies ComposeDraft);
}

/** Clear this account's compose draft of the section; another account's stays. */
export function clearComposeDraft(sectionId: string) {
  remove(composeKey(sectionId, currentAccount()));
}

/** Drop drafts older than MAX_AGE_MS. Runs once per load (use-outline.ts). */
export function sweepStaleDrafts() {
  try {
    const now = Date.now();
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || (!key.startsWith(NOTE_PREFIX) && !key.startsWith(COMPOSE_PREFIX))) continue;
      const draft = read<{ savedAt: number }>(key);
      if (!draft || now - draft.savedAt > MAX_AGE_MS) stale.push(key);
    }
    for (const key of stale) remove(key);
  } catch {
    // Storage blocked: nothing to sweep.
  }
}

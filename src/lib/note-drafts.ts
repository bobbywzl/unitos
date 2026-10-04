"use client";

// Local drafts (SPEC.md §6): the text of an open note editor, written to
// localStorage on every edit. The server save is debounced and the closing
// flush is a network call, so the last words typed before a crash, a power
// loss, or a lost connection would otherwise be gone. A draft is written
// synchronously with the keystroke, cleared when the server confirms the same
// content, and replayed on the next load when it did not (use-outline.ts,
// use-note-compose.ts).
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
// Both absent in a draft written before they existed.
export type NoteDraft = { content: string; savedAt: number; base?: string; sent?: string };
// createId: the id the composer's create carries (lib/notes/client-id.ts),
// written before the create leaves, so a reload adopts the note it made.
export type ComposeDraft = { content: string; noteId: string | null; savedAt: number; createId?: string };

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

export function readNoteDraft(noteId: string): NoteDraft | null {
  const draft = read<NoteDraft>(NOTE_PREFIX + noteId);
  if (!draft || typeof draft.content !== "string") return null;
  return {
    content: draft.content,
    savedAt: draft.savedAt,
    ...(typeof draft.base === "string" ? { base: draft.base } : {}),
    ...(typeof draft.sent === "string" ? { sent: draft.sent } : {}),
  };
}

export function writeNoteDraft(noteId: string, content: string, base?: string, sent?: string | null) {
  write(NOTE_PREFIX + noteId, {
    content,
    savedAt: Date.now(),
    ...(base !== undefined ? { base } : {}),
    ...(sent ? { sent } : {}),
  } satisfies NoteDraft);
}

/** The text a draft was made from, given the note's text now: the save that
    was on its way when the note holds it, else the base. Undefined for a
    draft written before drafts kept their base. */
export function noteDraftBase(draft: NoteDraft, stored: string): string | undefined {
  if (draft.sent !== undefined && draft.sent.trim() === stored.trim()) return draft.sent;
  return draft.base;
}

export function clearNoteDraft(noteId: string) {
  remove(NOTE_PREFIX + noteId);
}

/** Clear the note's draft when it holds this content: the server has it now. */
export function confirmNoteDraft(noteId: string, content: string) {
  const draft = readNoteDraft(noteId);
  if (draft && draft.content.trim() === content.trim()) clearNoteDraft(noteId);
}

export function readComposeDraft(sectionId: string): ComposeDraft | null {
  const draft = read<ComposeDraft>(COMPOSE_PREFIX + sectionId);
  if (!draft || typeof draft.content !== "string") return null;
  return {
    content: draft.content,
    savedAt: draft.savedAt,
    noteId: typeof draft.noteId === "string" ? draft.noteId : null,
    ...(typeof draft.createId === "string" ? { createId: draft.createId } : {}),
  };
}

export function writeComposeDraft(sectionId: string, content: string, noteId: string | null, createId?: string) {
  write(COMPOSE_PREFIX + sectionId, {
    content,
    noteId,
    savedAt: Date.now(),
    ...(createId ? { createId } : {}),
  } satisfies ComposeDraft);
}

export function clearComposeDraft(sectionId: string) {
  remove(COMPOSE_PREFIX + sectionId);
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

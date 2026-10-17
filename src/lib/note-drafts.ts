"use client";

import { readAccountCookie, tabAccount } from "@/lib/tab-account";
import { loadCardDrafts } from "@/lib/toolbar-drafts";

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

// A relative path: the QA checks import this module straight, outside the
// app's path alias (scripts/qa/reply-drafts-check.ts).

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

// A Note on this link draft (LinkNoteComposer) belongs to the account that
// typed it: the key names the account, so on a browser two accounts share,
// one account's draft never opens in the other's box. Sign out keeps the
// draft for its account (rule zero item 6). A reply box's draft is a card
// draft (lib/toolbar-drafts.ts: `reply:note:<id>`, `reply:edit:<id>`,
// `reply:link:<id>`).
//
// Keys from before drafts named their account (graph-link-note:<linkId>)
// are moved to the signed-in account: on Sign out (claimLegacyDrafts), or
// when that account opens the box first.
const LINK_NOTE_PREFIX = "graph-link-note:";

export type LinkNoteDraft = { content: string; sectionId: string | null; savedAt: number };

// The account part of a key: the signed-in id, or "local" with sign-in off.
const accountPart = (account: string) => account || "local";
/** The storage key of a Note on this link draft: the account and the link. */
export const linkNoteDraftKey = (account: string, linkId: string) => `${LINK_NOTE_PREFIX}${accountPart(account)}:${linkId}`;

/** A key from before drafts named their account. */
function legacyKey(key: string): boolean {
  return key.startsWith(LINK_NOTE_PREFIX) && !key.slice(LINK_NOTE_PREFIX.length).includes(":");
}

/** Move one legacy key to the account. When the account has its own draft
    for the same box (a tab from before the change kept writing the old
    key), the newer of the two stays: both are the same box's words, typed
    on this browser. A legacy link-note draft carries no savedAt: it gets
    one now. */
function claim(key: string, account: string) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return;
    const to = linkNoteDraftKey(account, key.slice(LINK_NOTE_PREFIX.length));
    const value = JSON.parse(raw) as Record<string, unknown>;
    const savedAt = typeof value.savedAt === "number" ? value.savedAt : Date.now();
    const own = read<{ savedAt: number }>(to);
    if (!own || own.savedAt < savedAt) localStorage.setItem(to, JSON.stringify({ ...value, savedAt }));
    localStorage.removeItem(key);
  } catch {
    // Storage blocked, or the value does not parse: it stays where it is.
  }
}

/** Sign out (settings-form.tsx): every legacy draft goes to the account
    signing out, which typed it, so the next account never sees it. */
export function claimLegacyDrafts(account: string) {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && legacyKey(key)) keys.push(key);
    }
    for (const key of keys) claim(key, account);
  } catch {
    // Storage blocked: nothing to claim.
  }
}

/** Note on this link's draft: the text and the section picked. */
export function readLinkNoteDraft(account: string, linkId: string): { content: string; sectionId: string | null } | null {
  claim(LINK_NOTE_PREFIX + linkId, account);
  const draft = read<LinkNoteDraft>(linkNoteDraftKey(account, linkId));
  if (!draft || typeof draft.content !== "string" || !draft.content) return null;
  return { content: draft.content, sectionId: typeof draft.sectionId === "string" ? draft.sectionId : null };
}

export function writeLinkNoteDraft(account: string, linkId: string, content: string, sectionId: string | null) {
  if (content) write(linkNoteDraftKey(account, linkId), { content, sectionId, savedAt: Date.now() } satisfies LinkNoteDraft);
  else remove(linkNoteDraftKey(account, linkId));
}

// [ui5] WALK5-13: whether this browser holds unsent words on a link: a Note
// on this link draft for the account (legacy key too), or a reply draft in
// the card drafts. Read only: nothing is claimed or moved.
function hasContent(key: string): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const value = JSON.parse(raw) as { content?: unknown };
    return typeof value.content === "string" && value.content.trim() !== "";
  } catch {
    return false;
  }
}
export function hasLinkDraft(account: string, linkId: string): boolean {
  if (typeof window === "undefined") return false;
  return (
    hasContent(linkNoteDraftKey(account, linkId)) ||
    hasContent(LINK_NOTE_PREFIX + linkId) ||
    (loadCardDrafts()[`reply:link:${linkId}`] ?? "").trim() !== ""
  );
}
// [/ui5]

// The graph's new note (note-gather.tsx, VIEW4-03): the quotes collected
// with Add to note, the words typed, and the section picked, one per project
// per account. Written on every change; cleared once the server (or the
// offline queue) has the note.
const GATHER_PREFIX = "unitos-note-gather:";

export type GatherDraftQuote = {
  documentId: string;
  /** Absent: the quote is found across the document (a link's end). */
  blockId?: string;
  /** What the composer shows, and the quote the server re-finds. */
  text: string;
  /** No quotedText goes to the server: it quotes the block's words (a part's start). */
  whole?: boolean;
  /** [lists9] The link this quote is an end of (Note on this link, WALK9-10):
      a note of a link's two ends alone sends `fromLinkId`, so the server
      quotes the link's own anchors. */
  linkId?: string;
};
export type GatherDraft = { content: string; sectionId: string | null; quotes: GatherDraftQuote[]; savedAt: number };

const gatherKey = (account: string, notebookId: string) => `${GATHER_PREFIX}${accountPart(account)}:${notebookId}`;
/** The storage key of the draft, for a storage event from another tab (REV5-03). */
export const gatherDraftKey = gatherKey;

function gatherQuote(raw: unknown): GatherDraftQuote | null {
  if (!raw || typeof raw !== "object") return null;
  const q = raw as Record<string, unknown>;
  if (typeof q.documentId !== "string" || typeof q.text !== "string") return null;
  return {
    documentId: q.documentId,
    text: q.text,
    ...(typeof q.blockId === "string" ? { blockId: q.blockId } : {}),
    ...(q.whole === true ? { whole: true } : {}),
    ...(typeof q.linkId === "string" ? { linkId: q.linkId } : {}),
  };
}

export function readGatherDraft(account: string, notebookId: string): GatherDraft | null {
  const draft = read<GatherDraft>(gatherKey(account, notebookId));
  if (!draft) return null;
  const quotes = Array.isArray(draft.quotes) ? draft.quotes.flatMap((q) => gatherQuote(q) ?? []) : [];
  const content = typeof draft.content === "string" ? draft.content : "";
  if (!content && quotes.length === 0) return null;
  return { content, sectionId: typeof draft.sectionId === "string" ? draft.sectionId : null, quotes, savedAt: draft.savedAt };
}

/** An empty draft (no words, no quotes) clears the key. */
export function writeGatherDraft(account: string, notebookId: string, draft: Omit<GatherDraft, "savedAt">) {
  if (draft.content || draft.quotes.length > 0) write(gatherKey(account, notebookId), { ...draft, savedAt: Date.now() } satisfies GatherDraft);
  else remove(gatherKey(account, notebookId));
}

/** Drop note and compose drafts older than MAX_AGE_MS: those are replayed on
    every load, so one nobody replayed in that long has no note or section
    left. Runs once per load (use-outline.ts). Reply, Note on this link, and
    the graph's new note (Add to note) drafts are never dropped by age:
    nothing replays them, they show only when the reader opens that box
    again, so their words stay until a confirmed send or the reader's
    Cancel or Discard clears them (rule zero item 6). */
export function sweepStaleDrafts() {
  try {
    const now = Date.now();
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || ![NOTE_PREFIX, COMPOSE_PREFIX].some((p) => key.startsWith(p))) continue;
      const draft = read<{ savedAt: number }>(key);
      if (!draft || now - draft.savedAt > MAX_AGE_MS) stale.push(key);
    }
    for (const key of stale) remove(key);
  } catch {
    // Storage blocked: nothing to sweep.
  }
}

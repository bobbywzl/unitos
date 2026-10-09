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

// A relative path: the QA checks import this module straight, outside the
// app's path alias (scripts/qa/reply-drafts-check.ts).
import { addNotSaved } from "./offline/not-saved";

const NOTE_PREFIX = "unitos-note-draft:";
const COMPOSE_PREFIX = "unitos-note-compose:";
// A draft nobody replayed in this long is stale: the note was deleted, or the
// section is gone.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type NoteDraft = { content: string; savedAt: number };
export type ComposeDraft = { content: string; noteId: string | null; savedAt: number };

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
  return draft && typeof draft.content === "string" ? draft : null;
}

export function writeNoteDraft(noteId: string, content: string) {
  write(NOTE_PREFIX + noteId, { content, savedAt: Date.now() } satisfies NoteDraft);
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
  return { ...draft, noteId: typeof draft.noteId === "string" ? draft.noteId : null };
}

export function writeComposeDraft(sectionId: string, content: string, noteId: string | null) {
  write(COMPOSE_PREFIX + sectionId, { content, noteId, savedAt: Date.now() } satisfies ComposeDraft);
}

export function clearComposeDraft(sectionId: string) {
  remove(COMPOSE_PREFIX + sectionId);
}

// A reply draft belongs to the reply box under one note, one edit, or one
// link (ReplyThread), and to the account that typed it: what is typed there
// is kept until the server has the reply, or the offline queue holds it
// (SPEC.md §12). The key names the account, so on a browser two accounts
// share, one account's draft never opens in the other's reply box. Sign out
// keeps the draft for its account (rule zero item 6).
//
// A Note on this link draft (LinkNoteComposer) is keyed the same way.
//
// Keys from before drafts named their account (unitos-reply-draft:<target>,
// graph-link-note:<linkId>) are moved to the signed-in account: on Sign out
// (claimLegacyDrafts), or when that account opens the box first.
const REPLY_PREFIX = "unitos-reply-draft:";
const LINK_NOTE_PREFIX = "graph-link-note:";

export type ReplyDraft = { content: string; savedAt: number };
export type LinkNoteDraft = { content: string; sectionId: string | null; savedAt: number };

// The account part of a key: the signed-in id, or "local" with sign-in off.
const accountPart = (account: string) => account || "local";
/** The storage key of a reply box's draft: the account and the target. */
export const replyDraftKey = (account: string, target: string) => `${REPLY_PREFIX}${accountPart(account)}:${target}`;
/** The storage key of a Note on this link draft: the account and the link. */
export const linkNoteDraftKey = (account: string, linkId: string) => `${LINK_NOTE_PREFIX}${accountPart(account)}:${linkId}`;

/** Fired on window when the queue puts a dropped write's words back into a
    draft (keepDroppedWords); detail.key is the draft's storage key. An open
    box on that draft takes the words at once, so its next keystroke does not
    write over them (REV9-02). */
export const DRAFT_KEPT_EVENT = "unitos:draft-kept";

/** Subscribe to DRAFT_KEPT_EVENT (useSyncExternalStore): a box reads its
    draft again on every kept draft. */
export function subscribeDraftKept(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(DRAFT_KEPT_EVENT, onChange);
  return () => window.removeEventListener(DRAFT_KEPT_EVENT, onChange);
}

function announceKept(key: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(DRAFT_KEPT_EVENT, { detail: { key } }));
}

/** A key from before drafts named their account. */
function legacyKey(key: string): boolean {
  if (key.startsWith(REPLY_PREFIX)) return /^(note|edit|link):/.test(key.slice(REPLY_PREFIX.length));
  if (key.startsWith(LINK_NOTE_PREFIX)) return !key.slice(LINK_NOTE_PREFIX.length).includes(":");
  return false;
}

/** The key one account's copy of a legacy key moves to. */
function claimedKey(key: string, account: string): string {
  return key.startsWith(REPLY_PREFIX)
    ? replyDraftKey(account, key.slice(REPLY_PREFIX.length))
    : linkNoteDraftKey(account, key.slice(LINK_NOTE_PREFIX.length));
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
    const to = claimedKey(key, account);
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

/** The reply box's draft. target: "note:<id>", "edit:<id>", or "link:<id>". */
export function readReplyDraft(account: string, target: string): string | null {
  claim(REPLY_PREFIX + target, account);
  const draft = read<ReplyDraft>(replyDraftKey(account, target));
  return draft && typeof draft.content === "string" && draft.content ? draft.content : null;
}

export function writeReplyDraft(account: string, target: string, content: string) {
  if (content) write(replyDraftKey(account, target), { content, savedAt: Date.now() } satisfies ReplyDraft);
  else remove(replyDraftKey(account, target));
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

/** A queued write that the server refused on replay (a 4xx: the note, the
    edit, the section, or the link left the project, the words left the
    block, or the role changed): the reader's words are kept. A reply goes
    back into its box's draft, after any words typed there since, so the
    box opens on them (REV8-01, rule zero 6); a Note on this link's words go
    into the link's draft, which the new note takes up, with the link's
    ends, when the link opens again, or at once while the link is open
    ([lists9] WALK9-10, link-note-composer.tsx; REV9-02). Every other write
    with words — a comment, a note's edit, a gathered note, a block's edit —
    goes to the account's not-saved list with its quotes, which the offline
    pill offers to copy (lib/offline/not-saved.ts, REV9-03). A write without
    words (a delete, an order) has nothing to keep. */
export function keepDroppedWords(
  account: string | null,
  path: string,
  body: unknown,
  method: "POST" | "PATCH" | "DELETE" = "POST",
  queuedAt: number = Date.now(),
) {
  if (!body || typeof body !== "object") return;
  const b = body as Record<string, unknown>;
  const words = typeof b.content === "string" ? b.content.trim() : "";
  const id = account ?? "";
  const join = (kept?: string) => (!kept?.trim() ? words : kept.includes(words) ? kept : `${kept.trimEnd()}\n\n${words}`);
  if (words && path === "/api/replies") {
    const target =
      typeof b.noteId === "string" ? `note:${b.noteId}` : typeof b.blockEditId === "string" ? `edit:${b.blockEditId}` : typeof b.docLinkId === "string" ? `link:${b.docLinkId}` : null;
    if (!target) return;
    writeReplyDraft(id, target, join(readReplyDraft(id, target) ?? undefined));
    announceKept(replyDraftKey(id, target));
    return;
  }
  if (words && path === "/api/notes" && typeof b.fromLinkId === "string") {
    const kept = readLinkNoteDraft(id, b.fromLinkId);
    writeLinkNoteDraft(id, b.fromLinkId, join(kept?.content), kept?.sectionId ?? (typeof b.sectionId === "string" ? b.sectionId : null));
    announceKept(linkNoteDraftKey(id, b.fromLinkId));
    return;
  }
  const text = droppedWords(b);
  if (text) addNotSaved(account, { at: queuedAt, path, method, words: text });
}

/** The reader's words in a dropped write's body — `content` (a note), `comment`
    (a comment), `text` (a block's edit), or `title` (a section) — with its
    quotes under them as quote lines: the comment's anchor, a gathered
    note's quotes. */
function droppedWords(b: Record<string, unknown>): string {
  const own = [b.content, b.comment, b.text, b.title].find((v): v is string => typeof v === "string" && v.trim() !== "")?.trim() ?? "";
  const quotes: string[] = [];
  const anchor = b.anchor;
  if (anchor && typeof anchor === "object" && typeof (anchor as Record<string, unknown>).quotedText === "string") {
    quotes.push((anchor as Record<string, string>).quotedText);
  }
  if (Array.isArray(b.quotes)) {
    for (const q of b.quotes) {
      if (!q || typeof q !== "object") continue;
      const v = q as Record<string, unknown>;
      const quote = typeof v.quotedText === "string" ? v.quotedText : typeof v.text === "string" ? v.text : null;
      if (quote) quotes.push(quote);
    }
  }
  const lines = quotes.filter((q) => q.trim()).map((q) => q.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n"));
  return [own, ...lines].filter(Boolean).join("\n\n");
}

// [ui5] WALK5-13: whether this browser holds unsent words on a link for the
// account: a reply draft or a Note on this link draft (legacy keys too).
// Read only: nothing is claimed or moved.
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
    hasContent(replyDraftKey(account, `link:${linkId}`)) ||
    hasContent(LINK_NOTE_PREFIX + linkId) ||
    hasContent(`${REPLY_PREFIX}link:${linkId}`)
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

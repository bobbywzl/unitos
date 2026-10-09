"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

// Toolbar drafts (SPEC.md §6): the words typed in the toolbar for a selection
// — the comment under Add to notes, a Comment, a question to the Assistant —
// written to localStorage with each keystroke, the way a note's editor keeps
// its draft (lib/note-drafts.ts). A reload, a crash, a deploy, Escape, a click
// in the article, or a new selection never throws them away: opening the same
// tool on the same words again shows them, and they are cleared only when the
// server confirms the save.
//
// One list per document, under `unitos-toolbar-drafts:<documentId>`. A draft
// belongs to its tool and its words: a block and the offsets in it. A
// selection a little longer or shorter over the same words finds it too.
// Kept in memory as well, so typing works when storage is blocked.

export type ToolbarDraftKind = "add" | "comment" | "assistant";

/** The selection a draft belongs to: its first block and the offsets in it. */
export type DraftAnchor = { blockId: string; startOffset: number; endOffset: number };

type Entry = { kind: ToolbarDraftKind; blockId: string; start: number; end: number; text: string; savedAt: number };

const PREFIX = "unitos-toolbar-drafts:";
// A draft nobody came back to in this long is stale.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const memory = new Map<string, Entry[]>();
// False once a write to storage failed: memory holds the newer drafts then.
let storageWorks = true;
let version = 0;
const listeners = new Set<() => void>();

function isEntry(value: unknown): value is Entry {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return (
    (e.kind === "add" || e.kind === "comment" || e.kind === "assistant") &&
    typeof e.blockId === "string" &&
    typeof e.start === "number" &&
    typeof e.end === "number" &&
    typeof e.text === "string" &&
    typeof e.savedAt === "number"
  );
}

// What storage holds for the document now, or null when storage is blocked.
function readStored(documentId: string): Entry[] | null {
  try {
    const raw = localStorage.getItem(PREFIX + documentId);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const now = Date.now();
    return Array.isArray(parsed) ? parsed.filter(isEntry).filter((e) => now - e.savedAt < MAX_AGE_MS) : [];
  } catch {
    return null;
  }
}

function load(documentId: string): Entry[] {
  const held = memory.get(documentId);
  if (held) return held;
  // Storage blocked or unreadable: memory alone holds the drafts.
  const entries = readStored(documentId) ?? [];
  memory.set(documentId, entries);
  return entries;
}

// Every write starts from what storage holds now, not from this tab's copy:
// another tab on the same document may have written since (SPEC.md §6). The
// write then changes its own entry and keeps every other one.
function loadFresh(documentId: string): Entry[] {
  const stored = storageWorks ? readStored(documentId) : null;
  if (stored === null) return load(documentId);
  memory.set(documentId, stored);
  return stored;
}

function store(documentId: string, entries: Entry[]) {
  memory.set(documentId, entries);
  try {
    if (entries.length > 0) localStorage.setItem(PREFIX + documentId, JSON.stringify(entries));
    else localStorage.removeItem(PREFIX + documentId);
  } catch {
    // Storage blocked or full: memory holds the drafts for this tab, and
    // the next write starts from memory, not from storage.
    storageWorks = false;
  }
  changed();
}

function changed() {
  version++;
  for (const l of listeners) l();
}

// Another tab wrote: this tab reads storage again the next time it looks.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.storageArea !== localStorage) return;
    if (e.key === null) memory.clear();
    else if (e.key.startsWith(PREFIX)) memory.delete(e.key.slice(PREFIX.length));
    else return;
    changed();
  });
}

// The draft a selection shows: the one on the same words, else the newest one
// over some of the same words of the block.
function find(entries: Entry[], kind: ToolbarDraftKind, anchor: DraftAnchor): Entry | null {
  const own = entries.filter((e) => e.kind === kind && e.blockId === anchor.blockId);
  const exact = own.find((e) => e.start === anchor.startOffset && e.end === anchor.endOffset);
  if (exact) return exact;
  const overlapping = own.filter((e) => e.start < anchor.endOffset && anchor.startOffset < e.end);
  return overlapping.sort((a, b) => b.savedAt - a.savedAt)[0] ?? null;
}

/** The words typed in this tool for this selection, or null. */
export function readToolbarDraft(kind: ToolbarDraftKind, documentId: string, anchor: DraftAnchor): string | null {
  return find(load(documentId), kind, anchor)?.text ?? null;
}

/** Keep `text` as the draft of this tool on this selection; empty text drops it. */
export function writeToolbarDraft(kind: ToolbarDraftKind, documentId: string, anchor: DraftAnchor, text: string) {
  const entries = loadFresh(documentId);
  // The draft the selection showed moves to the selection's own words.
  const shown = find(entries, kind, anchor);
  const rest = entries.filter((e) => e !== shown);
  if (text) {
    rest.push({
      kind,
      blockId: anchor.blockId,
      start: anchor.startOffset,
      end: anchor.endOffset,
      text,
      savedAt: Date.now(),
    });
  }
  store(documentId, rest);
}

/** The save landed: the draft of this tool on this selection is done, and
    so is every draft of the tool in the document holding the words `sent`
    (a question typed on one selection and sent on another). */
export function clearToolbarDraft(kind: ToolbarDraftKind, documentId: string, anchor: DraftAnchor, sent?: string) {
  const entries = loadFresh(documentId);
  const shown = find(entries, kind, anchor);
  const left = entries.filter((e) => e !== shown && !(sent !== undefined && e.kind === kind && e.text.trim() === sent.trim()));
  if (left.length !== entries.length) store(documentId, left);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A tool's field on the open selection, kept as a toolbar draft: the words
    typed for these words before, and a setter that keeps each keystroke. */
export function useToolbarDraft(
  kind: ToolbarDraftKind,
  documentId: string | null,
  anchor: DraftAnchor | null,
): [string, (text: string) => void] {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
  const blockId = anchor?.blockId ?? null;
  const start = anchor?.startOffset ?? 0;
  const end = anchor?.endOffset ?? 0;
  const text = documentId && blockId ? readToolbarDraft(kind, documentId, { blockId, startOffset: start, endOffset: end }) ?? "" : "";
  const setText = useCallback(
    (next: string) => {
      if (documentId && blockId) writeToolbarDraft(kind, documentId, { blockId, startOffset: start, endOffset: end }, next);
    },
    [kind, documentId, blockId, start, end],
  );
  return [text, setText];
}

/** A field that keeps its own text (the Assistant's box): when the tool opens
    on a selection while the field is empty, the draft typed for these words
    fills it. */
export function useToolbarDraftRestore(
  open: boolean,
  kind: ToolbarDraftKind,
  documentId: string | null,
  anchor: DraftAnchor | null,
  current: string,
  fill: (text: string) => void,
) {
  const blockId = anchor?.blockId ?? null;
  const start = anchor?.startOffset ?? 0;
  const end = anchor?.endOffset ?? 0;
  useEffect(() => {
    if (!open || !documentId || !blockId || current) return;
    const text = readToolbarDraft(kind, documentId, { blockId, startOffset: start, endOffset: end });
    if (text) fill(text);
    // Once per opening on a selection: the field's own text wins after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind, documentId, blockId, start, end]);
}

/** A field showing a kept draft takes the caret after its words, so the
    next keystroke adds to them. */
export function caretToEnd(e: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) {
  const end = e.currentTarget.value.length;
  e.currentTarget.setSelectionRange(end, end);
}

// Card drafts (SPEC.md §6): the words typed in a card's box over the
// article — a comment card, a highlight's comment, a tool card's follow-up
// and the messages queued under it, the assistant chat's next question, a
// comment on an answer — by the card's note id (a comment on an answer: its
// own key, cardCommentKey). The reader keeps them in memory and here, so a
// reload or a crash keeps them. Cleared by the reader once the box is sent
// or holds the saved text again.
//
// Beside each draft of a comment, the text the card opened on: its base
// (unitos-card-draft-bases). A card that reopens after the comment changed
// elsewhere puts the draft together with the stored text, as a note's
// editor does (SPEC.md §6), so a stale draft never writes over the change.
//
// Two tabs share the one key: each write reads storage again and changes
// only the entries the tab changed (writeCardDrafts), and a tab hears the
// other's writes through the storage event (onCardDraftsChange).
const CARD_DRAFTS_KEY = "unitos-card-drafts";
const CARD_DRAFT_BASES_KEY = "unitos-card-draft-bases";
const MAX_CARD_DRAFTS = 50;

function readMap(key: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"),
    );
  } catch {
    return {};
  }
}

// Read, change only these entries, write. A changed entry moves to the end:
// the newest entries win when there are too many (an object keeps its keys
// in the order they were added).
function writeMap(key: string, changes: ReadonlyMap<string, string | null>) {
  if (typeof window === "undefined" || changes.size === 0) return;
  const stored = readMap(key);
  for (const [k, v] of changes) {
    delete stored[k];
    if (v !== null) stored[k] = v;
  }
  const entries = Object.entries(stored).slice(-MAX_CARD_DRAFTS);
  try {
    if (entries.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Storage full or blocked: the drafts stay in memory for this visit.
  }
}

export function loadCardDrafts(): Record<string, string> {
  return readMap(CARD_DRAFTS_KEY);
}

export function loadCardDraftBases(): Record<string, string> {
  return readMap(CARD_DRAFT_BASES_KEY);
}

/** Write these drafts (null: the draft is gone) over what storage holds now,
    and their bases; every other tab's entries stay. */
export function writeCardDrafts(drafts: ReadonlyMap<string, string | null>, bases: ReadonlyMap<string, string | null>) {
  writeMap(CARD_DRAFTS_KEY, drafts);
  writeMap(CARD_DRAFT_BASES_KEY, bases);
}

/** Another tab changed the card drafts. */
export function onCardDraftsChange(listener: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === CARD_DRAFTS_KEY || e.key === CARD_DRAFT_BASES_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

/** The key of a comment on an answer's draft: the conversation and the quote. */
export function cardCommentKey(noteId: string, quote: string): string {
  let hash = 0;
  for (let i = 0; i < quote.length; i++) hash = (Math.imul(hash, 31) + quote.charCodeAt(i)) | 0;
  return `comment:${noteId}:${(hash >>> 0).toString(36)}`;
}

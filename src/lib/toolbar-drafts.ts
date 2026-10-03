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

function load(documentId: string): Entry[] {
  const held = memory.get(documentId);
  if (held) return held;
  let entries: Entry[] = [];
  try {
    const raw = localStorage.getItem(PREFIX + documentId);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const now = Date.now();
    if (Array.isArray(parsed)) entries = parsed.filter(isEntry).filter((e) => now - e.savedAt < MAX_AGE_MS);
  } catch {
    // Storage blocked or unreadable: memory alone holds the drafts.
  }
  memory.set(documentId, entries);
  return entries;
}

function store(documentId: string, entries: Entry[]) {
  memory.set(documentId, entries);
  try {
    if (entries.length > 0) localStorage.setItem(PREFIX + documentId, JSON.stringify(entries));
    else localStorage.removeItem(PREFIX + documentId);
  } catch {
    // Storage blocked: memory holds the drafts for this tab.
  }
  version++;
  for (const l of listeners) l();
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
  const entries = load(documentId);
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
  const entries = load(documentId);
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

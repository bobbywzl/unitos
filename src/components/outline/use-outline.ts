"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import { api } from "@/lib/api";
import { ACCOUNT_HEADER } from "@/lib/constants";
import { tabAccount } from "@/lib/tab-account";
import { isOffline, NOTE_KEPT_EVENT, refreshWhenOnline, SOURCE_LOST_EVENT } from "@/lib/offline/queue";
import { overlayQueuedNotes, useQueuedNoteWrites } from "@/lib/offline/queued-notes";
import type { MergeMode } from "@/lib/card-drag";
import {
  clearNoteDraft,
  confirmNoteDraft,
  draftHoldsWords,
  listNoteDrafts,
  NOTE_DRAFT_CLEARED_EVENT,
  noteDraftBase,
  readNoteDraft,
  sweepStaleDrafts,
  writeNoteDraft,
} from "@/lib/note-drafts";
import { announceKept, saveNoteText } from "@/lib/notes/save-text";
import { joinNoteContents } from "@/lib/notes/join";
import { isEditingNote } from "@/components/outline/editing-notes";
import { NOTE_BACK_EVENT, usePostedUndo, type NoteBack, type UndoPillPost } from "@/lib/notes/undo-pill";
import type { QuoteDrag } from "@/lib/quote-drag";
import { appendToBody } from "@/lib/note-title";
import type { NotebookView, NoteView, SectionView } from "@/lib/types";
import { useT } from "@/components/lang-provider";
import { useCollapsedView, type CollapsedView } from "@/components/use-collapsed-view";
import { flushNoteDrafts, handOffNoteDraft, openDraftSave, replaceNoteDraft } from "@/components/outline/use-note-draft";

// The floating card: one note taken out of the tray, over the article
// (floating-note-editor.tsx). It opens in its draggable mode; the pencil
// opens its editor.
export type FloatingEdit = {
  id: string;
  /** The draft the floating card's editor opens with. */
  draft: string;
  /** The content before the edit began: what Cancel restores. */
  original: string;
  /** Where the card lands. Unset: beside the tray. */
  left?: number;
  top?: number;
  /** Open in the editor at once: the tray's editor was moved out here. */
  editing?: boolean;
};

/** What a merge answered: the merged text, and the id that undoes the merge. */
export type MergeResult = { content: string; undoId: string | null };

/** A note taken out of its section, and where it stood: Undo puts it back
    there. */
type Placed = { note: NoteView; sectionId: string; index: number };

/** The last merge, while it can be undone (SPEC.md §6): the pill under the
    notes offers Undo for MERGE_UNDO_MS. before: the notes as they stood, so
    Undo puts them back on screen before the server answers. */
export type LastMerge = {
  undoId: string;
  targetId: string;
  count: number;
  /** The text the merge wrote: Undo runs only while the note holds it. */
  content: string;
  before?: { target: NoteView; sources: Placed[] };
};
const MERGE_UNDO_MS = 12_000;

/** The last delete, while it can be undone (SPEC.md §6): the notes leave the
    list at once, and the server deletes them only when the Undo pill goes
    (DELETE_UNDO_MS, the next delete, ✕, or the page closing). Undo before
    then puts them back with no server call. */
export type LastDelete = { ids: string[] };
const DELETE_UNDO_MS = MERGE_UNDO_MS;

/** The section deleted last (SPEC.md §6): the server deleted it at once and
    kept it whole in its History event (lib/notes/removed.ts), so the pill's
    Undo is History's Restore of that event. */
/** The section deleted last: the pill names it and its notes, and Undo puts
    it back where it stood. eventId: the delete's history event, once the
    server answered (`request` resolves to it; null when it failed). */
export type LastSectionDelete = {
  eventId: string | null;
  request: Promise<string | null>;
  title: string;
  count: number;
  placed: PlacedSection | null;
};

/** A section as it stood: its parent and its place among its siblings. */
type PlacedSection = { section: SectionView; parentId: string | null; index: number };

/** The target of a merge took the other notes in: its card blooms
    (note-card.tsx listens). */
export const NOTE_ABSORBED_EVENT = "dissect:note-absorbed";

export type OutlineActions = {
  notebookId: string;
  /** The React key of a note's card: a note kept as a new note keeps its
      card's key, so its open editor stays as it is, caret and all. */
  noteKey: (id: string) => string;
  /** The open document (SPEC.md §6): the tray's notes are its, and a note
      written in the tray is its. Null on the notes full page. */
  documentId: string | null;
  addSection: (parentId: string | null, title: string) => Promise<void>;
  /** The answer says whether the rename waits in the offline queue
      (queued), after the server answered with an error (serverError). A
      refusal throws. */
  renameSection: (id: string, title: string) => Promise<{ queued?: boolean; serverError?: boolean }>;
  deleteSection: (id: string) => Promise<void>;
  reorderSection: (parentId: string | null, id: string, toIndex: number) => void;
  /** id: the id the note's create carries (lib/notes/client-id.ts), so a
      create sent twice makes one note. */
  addNote: (sectionId: string, content: string, id?: string) => Promise<void>;
  /** A quote or an annotation let go on a section in the tray (SPEC.md §6):
      a new note with the dropped text, at the top of the section (top) or
      at its end. A quote's anchor becomes the note's source; an
      annotation's anchors are copied in. The tray then shows the note. */
  addDroppedNote: (
    sectionId: string,
    content: string,
    from: { top: boolean; quote?: QuoteDrag; annotationId?: string },
  ) => Promise<void>;
  /** base: the note's text the save was made from (lib/notes/save-text.ts);
      unset, the open editor's, else the text on screen. */
  saveNote: (id: string, content: string, base?: string) => Promise<void>;
  /** A quote dropped into the note (lib/quote-drag.ts): its anchor becomes
      a source of the note, so the quote points back to the reader. */
  attachSource: (id: string, drag: QuoteDrag) => Promise<string[]>;
  /** A quote dropped on a note that is not open: the quote's words added at
      the end of the note and its source, in one write. */
  appendQuote: (id: string, markdown: string, drag: QuoteDrag) => Promise<void>;
  /** An annotation dropped into the note (lib/annotation-reference.ts):
      copies of its anchors become sources of the note, so the quote it
      landed points back to the reader. */
  attachAnnotationSources: (id: string, annotationId: string) => Promise<void>;
  /** An annotation dropped on a note that is not open: the annotation
      reference added at the end of the note and copies of the annotation's
      anchors, in one write. */
  appendAnnotation: (id: string, markdown: string, annotationId: string) => Promise<void>;
  /** Give up sources a quote dropped into the open editor attached: the
      editor's Cancel took the quote's words back out. */
  dropSources: (id: string, sourceIds: string[]) => Promise<void>;
  /** Delete at once, no Undo: the composer's Cancel, for the note it made. */
  deleteNote: (id: string) => Promise<void>;
  /** Delete with Undo (SPEC.md §6): the notes leave the list at once, and
      the Undo pill offers them back until it goes; only then does the
      server delete them. */
  removeNotes: (ids: string[], composed?: boolean) => void;
  lastDelete: LastDelete | null;
  undoDelete: () => void;
  /** The section deleted last, while the pill offers Undo (SPEC.md §6). */
  lastSectionDelete: LastSectionDelete | null;
  /** Put the deleted section back with its notes: History's Restore. */
  undoSectionDelete: () => Promise<void>;
  /** A delete posted from outside the notes (lib/notes/undo-pill.ts): an
      annotation, a comment, a conversation. The pill offers its Undo. */
  posted: UndoPillPost | null;
  undoPosted: () => void;
  /** A line for the pill under the notes: a change that did not reach the
      server and was put back, or news (words kept as a new note, a quote
      without its source). Null when there is nothing to say. */
  notice: string | null;
  /** The notice is a failure: it alone is drawn in red. */
  noticeFailed: boolean;
  dismissNotice: () => void;
  /** The composer of this section is letting its note go (Save, Escape):
      the note joins the section's list the moment the server has it. */
  expectComposed: (sectionId: string) => void;
  /** Done or Escape closed the composer: its note shows at the top of its
      section at once, with the words typed, while their save is on its way. */
  placeComposed: (sectionId: string, id: string, content: string) => void;
  reorderNote: (sectionId: string, id: string, toIndex: number) => void;
  moveNoteToSection: (id: string, sectionId: string, toIndex?: number) => Promise<void>;
  /** Alt+↑ and Alt+↓ on a note: one place up or down in its section, and
      past the section's first or last place into the section above or below. */
  nudgeNote: (id: string, delta: -1 | 1) => void;
  /** Merge notes into the target (SPEC.md §6). join, the default: the notes'
      text lands in the target as it is, in the order the notes stand in. ai:
      the model writes the one note that takes their place. An annotation
      source is copied, never consumed. Returns the merged text and the id
      that undoes the merge, or null when the merge did not run. */
  mergeNotes: (targetId: string, sourceIds: string[], mode?: MergeMode) => Promise<MergeResult | null>;
  /** Notes the AI is merging right now: their cards say so while it runs. */
  merging: ReadonlySet<string>;
  /** Stop the AI merge into the target: nothing merges, and the notes come
      back as they were. */
  stopMerge: (targetId: string) => void;
  /** The last merge, while Undo is offered. */
  lastMerge: LastMerge | null;
  /** False once the merged note changed since the merge: Undo cannot run. */
  mergeUndoable: boolean;
  /** Undo the last merge. Resolves to the reason when it could not run. */
  undoMerge: () => Promise<string | null>;
  /** The pill's ✕: the merge stays, a canceled edit and a reject stay, and
      a delete waiting on Undo runs now. */
  dismissMerge: () => void;
  /** An editor's Cancel put a note back to its text when the editor opened:
      the pill offers the typed words back (SPEC.md §6). */
  editCanceled: (noteId: string, typed: string) => void;
  lastCancel: { noteId: string; content: string } | null;
  undoCancel: () => void;
  setPinned: (id: string, pinned: boolean) => Promise<void>;
  acceptNote: (id: string) => Promise<void>;
  rejectNote: (id: string) => Promise<void>;
  sectionChoices: { id: string; label: string }[];
  focusedPendingId: string | null;
  /** Open a note's editor: the keyboard queue's `e`, or the floating card docking with its draft. */
  editRequest: { id: string; draft?: string } | null;
  // The ticker: accepted notes selected for a bulk delete, merge, or pin.
  selected: ReadonlySet<string>;
  toggleSelect: (id: string) => void;
  clearSelection: () => void;
  // The notes view (use-collapsed-view.ts): collapsed, the default, folds every
  // accepted note to one line — its id and a summary of its content; expanded
  // shows every note whole. A note's chevron makes it the exception.
  notesView: CollapsedView;
  isCollapsed: (id: string) => boolean;
  toggleCollapsed: (id: string) => void;
  setNotesView: (view: CollapsedView) => void;
  floating: FloatingEdit | null;
  floatNote: (edit: FloatingEdit) => void;
  /** The floating card's draft as it is typed, so docking can carry it. */
  floatingDraftChanged: (draft: string) => void;
  /** Close the floating card. reopen: the note's tray card opens its editor on the draft. */
  dockNote: (reopen: boolean) => void;
};

// The notes view persists per browser and per project, so the tray and the
// notes full page show the same.
const NOTES_VIEW_STORE = "unitos-notes-view";

function updateSection(
  sections: SectionView[],
  id: string,
  fn: (s: SectionView) => SectionView,
): SectionView[] {
  return sections.map((s) =>
    s.id === id ? fn(s) : { ...s, children: updateSection(s.children, id, fn) },
  );
}

// Every section in the tree through the same change.
function mapSections(
  sections: SectionView[],
  fn: (s: SectionView) => SectionView,
): SectionView[] {
  return sections.map((s) => fn({ ...s, children: mapSections(s.children, fn) }));
}

/** Where the note stands: its section and its place there; null when it is
    in no section. */
function placeOf(sections: SectionView[], id: string): Placed | null {
  for (const s of sections) {
    const index = s.notes.findIndex((n) => n.id === id);
    if (index !== -1) return { note: s.notes[index], sectionId: s.id, index };
    const child = placeOf(s.children, id);
    if (child) return child;
  }
  return null;
}

/** The tree with the note back where it stood, unless it is there already. */
function putBack(sections: SectionView[], placed: Placed): SectionView[] {
  if (placeOf(sections, placed.note.id)) return sections;
  return updateSection(sections, placed.sectionId, (s) => {
    const at = Math.max(0, Math.min(placed.index, s.notes.length));
    return { ...s, notes: [...s.notes.slice(0, at), placed.note, ...s.notes.slice(at)] };
  });
}

/** The tree without these notes. */
function withoutNotes(sections: SectionView[], ids: ReadonlySet<string>): SectionView[] {
  return mapSections(sections, (s) =>
    s.notes.some((n) => ids.has(n.id)) ? { ...s, notes: s.notes.filter((n) => !ids.has(n.id)) } : s,
  );
}

/** The tree with the words this tab holds drawn over the server's copy
    (useOutline's localTexts). */
function overlayLocalTexts(
  sections: SectionView[],
  texts: ReadonlyMap<string, { content: string; unsaved: boolean }>,
): SectionView[] {
  if (texts.size === 0) return sections;
  return mapSections(sections, (s) =>
    s.notes.some((n) => texts.has(n.id))
      ? {
          ...s,
          notes: s.notes.map((n) => {
            const local = texts.get(n.id);
            if (!local) return n;
            if (!local.unsaved && local.content.trim() === n.content.trim()) return n;
            // The gist was written for the server's text: the row shows the
            // first words of these until a save lands.
            return { ...n, content: local.content, gist: null, ...(local.unsaved ? { unsaved: true } : {}) };
          }),
        }
      : s,
  );
}

/** A note made in this tab, as the list shows it until the refresh brings
    the server's own row. */
function localNote(id: string, content: string, documentId: string | null, row?: Partial<NoteView>): NoteView {
  const now = new Date().toISOString();
  return {
    id,
    content,
    gist: null,
    status: "ACCEPTED",
    derivationType: null,
    pinned: false,
    order: 0,
    createdById: typeof row?.createdById === "string" ? row.createdById : null,
    updatedAt: typeof row?.updatedAt === "string" ? row.updatedAt : now,
    createdAt: typeof row?.createdAt === "string" ? row.createdAt : now,
    documentId: typeof row?.documentId === "string" ? row.documentId : documentId,
    sources: [],
    replies: [],
  };
}

/** The section with this id, anywhere in the tree; null when there is none. */
/** The tree without the section, as the server leaves it: the sections
    nested in it move to the top level, where it stood. */
function withoutSection(sections: SectionView[], id: string): { tree: SectionView[]; placed: PlacedSection | null } {
  const at = sections.findIndex((s) => s.id === id);
  if (at !== -1) {
    const section = sections[at];
    const lifted = section.children.map((c) => ({ ...c, parentId: null }));
    return {
      tree: [...sections.slice(0, at), ...lifted, ...sections.slice(at + 1)],
      placed: { section, parentId: null, index: at },
    };
  }
  for (const parent of sections) {
    const index = parent.children.findIndex((c) => c.id === id);
    if (index === -1) continue;
    return {
      tree: updateSection(sections, parent.id, (p) => ({ ...p, children: p.children.filter((c) => c.id !== id) })),
      placed: { section: parent.children[index], parentId: parent.id, index },
    };
  }
  return { tree: sections, placed: null };
}

function withId(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  return set.has(id) ? set : new Set([...set, id]);
}

function withoutId(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (!set.has(id)) return set;
  const next = new Set(set);
  next.delete(id);
  return next;
}

function withoutKeys<V>(map: ReadonlyMap<string, V>, keys: string[]): ReadonlyMap<string, V> {
  if (!keys.some((k) => map.has(k))) return map;
  const next = new Map(map);
  for (const k of keys) next.delete(k);
  return next;
}

/** The section back where it stood, with the sections nested in it back under it. */
function withSection(sections: SectionView[], placed: PlacedSection): SectionView[] {
  if (findSection(sections, placed.section.id)) return sections;
  const childIds = new Set(placed.section.children.map((c) => c.id));
  const kept = sections.filter((s) => !childIds.has(s.id));
  const insert = (list: SectionView[]) => {
    const at = Math.max(0, Math.min(placed.index, list.length));
    return [...list.slice(0, at), placed.section, ...list.slice(at)];
  };
  if (placed.parentId === null || !findSection(kept, placed.parentId)) return insert(kept);
  return updateSection(kept, placed.parentId, (p) => ({ ...p, children: insert(p.children) }));
}

export function findSection(sections: SectionView[], id: string): SectionView | null {
  for (const s of sections) {
    if (s.id === id) return s;
    const child = findSection(s.children, id);
    if (child) return child;
  }
  return null;
}

export function flattenNotes(sections: SectionView[]): NoteView[] {
  return sections.flatMap((s) => [...s.notes, ...flattenNotes(s.children)]);
}

/** True when the note matches the query: its content, or — for a query
    starting with "#" — its id, so the id shown on every card finds the note. */
export function noteMatches(note: NoteView, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  // The note being edited stays, marked by its open editor, until the
  // editor closes (editing-notes.ts).
  if (isEditingNote(note.id)) return true;
  if (needle.startsWith("#")) return note.id.toLowerCase().includes(needle.slice(1));
  return note.content.toLowerCase().includes(needle) || note.id.toLowerCase() === needle;
}

/** True when the note is the document's (SPEC.md §6): written in it, or
    quoting it — a source of the note is in it. */
export function noteInDocument(note: NoteView, documentId: string): boolean {
  return note.documentId === documentId || note.sources.some((s) => s.documentId === documentId);
}

/** The sections with the document's notes alone (noteInDocument): every
    section stays, so a note can be added to it. */
export function scopeSections(sections: SectionView[], documentId: string): SectionView[] {
  return sections.map((s) => ({
    ...s,
    notes: s.notes.filter((n) => noteInDocument(n, documentId)),
    children: scopeSections(s.children, documentId),
  }));
}

/** Notes that match the query (noteMatches), with sections that end up empty dropped. */
export function filterSections(sections: SectionView[], query: string): SectionView[] {
  if (!query.trim()) return sections;
  return sections
    .map((s) => ({
      ...s,
      notes: s.notes.filter((n) => noteMatches(n, query)),
      children: filterSections(s.children, query),
    }))
    .filter((s) => s.notes.length > 0 || s.children.length > 0);
}

// The notes model shared by the tray (design 1a) and the notes full page (design 2b):
// one optimistic tree, one pending queue, one set of keyboard bindings (SPEC.md §6).
// canEdit false (a viewer on a shared corpus): keys still navigate, never write.
// documentId: the open document — the tree and the pending queue returned
// are its notes alone (scopeSections), and a note added lands in it; null,
// the notes full page, returns the whole project. Every write reads the
// whole tree, so a merge or a selection never loses a note the scope hides.
// scopeToDocument false (the tray's All notes): the tree and the queue are
// the whole project, and a note added still lands in the open document.
export function useOutline(notebook: NotebookView, canEdit = true, documentId: string | null = null, scopeToDocument = true) {
  const t = useT();
  const router = useRouter();
  const [rawTree, setTree] = useState(notebook.sections);
  const [prevSections, setPrevSections] = useState(notebook.sections);
  // Notes deleted in this tab (removeNotes): out of the list at once, while
  // the Undo pill shows and after, so a refresh that lands before the server
  // deletes them never brings them back.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  // Sections deleted in this tab (deleteSection), the same way: a refresh
  // before the server deletes one never brings it back; Undo takes it out.
  const [goneSections, setGoneSections] = useState<ReadonlySet<string>>(new Set());
  // Sections brought back by Undo (undoSectionDelete): on screen where they
  // stood until the server's tree holds them again, so a refresh that lands
  // before the restore never takes one away.
  const [backSections, setBackSections] = useState<ReadonlyMap<string, PlacedSection>>(new Map());
  // Notes History's Restore put back (NOTE_BACK_EVENT with the note): in
  // their section at once, until the server's tree holds them.
  const [backNotes, setBackNotes] = useState<ReadonlyMap<string, Placed>>(new Map());
  const tree = useMemo(() => {
    let shown = hidden.size > 0 ? withoutNotes(rawTree, hidden) : rawTree;
    for (const placed of backNotes.values()) shown = putBack(shown, placed);
    for (const placed of backSections.values()) shown = withSection(shown, placed);
    for (const id of goneSections) shown = withoutSection(shown, id).tree;
    return shown;
  }, [rawTree, hidden, goneSections, backSections, backNotes]);
  // The tree as it is now, for the writes that read it from an event.
  const treeRef = useRef(tree);
  useLayoutEffect(() => {
    treeRef.current = tree;
  });
  // The pill's line (merge-undo.tsx): news, or a failure, which alone is
  // drawn in red.
  const [shownNotice, setShownNotice] = useState<{ text: string; failed: boolean } | null>(null);
  const setNotice = useCallback(
    (text: string | null, failed = false) => setShownNotice(text === null ? null : { text, failed }),
    [],
  );
  useEffect(() => {
    if (!shownNotice) return;
    const timer = setTimeout(() => setShownNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [shownNotice]);
  const failure = useCallback(
    (err: unknown) => setNotice(err instanceof Error && err.message ? err.message : t("common.requestFailed"), true),
    [setNotice, t],
  );
  // Words this tab holds for a note that the server's copy may not show
  // yet: a save on its way (a document switch brings the server's copy
  // before the save lands), or a local draft whose save failed (`unsaved`:
  // drawn marked Not saved until a save lands). Drawn over the tree.
  const [localTexts, setLocalTexts] = useState<ReadonlyMap<string, { content: string; unsaved: boolean }>>(new Map());
  const setLocalText = useCallback((id: string, entry: { content: string; unsaved: boolean } | null) => {
    setLocalTexts((prev) => {
      if (entry === null && !prev.has(id)) return prev;
      const next = new Map(prev);
      if (entry === null) next.delete(id);
      else next.set(id, entry);
      return next;
    });
  }, []);
  // A draft cleared (its save landed, or Cancel): its kept words are no
  // longer the reader's only copy.
  useEffect(() => {
    const onCleared = (e: Event) => {
      const id = (e as CustomEvent<{ noteId?: unknown }>).detail?.noteId;
      if (typeof id !== "string") return;
      setLocalTexts((prev) => {
        const entry = prev.get(id);
        if (!entry?.unsaved) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    };
    window.addEventListener(NOTE_DRAFT_CLEARED_EVENT, onCleared);
    return () => window.removeEventListener(NOTE_DRAFT_CLEARED_EVENT, onCleared);
  }, []);
  // The composer letting its note go (expectComposed), by section.
  const composedSection = useRef<string | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [editRequest, setEditRequest] = useState<{ id: string; draft?: string } | null>(null);
  // The floating card, and its draft as typed — a ref, so a keystroke in the
  // card never re-renders the workspace.
  const [floating, setFloating] = useState<FloatingEdit | null>(null);
  const floatingDraft = useRef("");
  if (prevSections !== notebook.sections) {
    setPrevSections(notebook.sections);
    setTree(notebook.sections);
    const restored = [...backSections.keys()].filter((id) => findSection(notebook.sections, id));
    if (restored.length > 0) setBackSections((prev) => withoutKeys(prev, restored));
    const notesIn = [...backNotes.keys()].filter((id) => placeOf(notebook.sections, id));
    if (notesIn.length > 0) setBackNotes((prev) => withoutKeys(prev, notesIn));
  }

  // Offline, the refresh waits for the network (SPEC.md §17, lib/offline/queue.ts).
  const refresh = useCallback(() => refreshWhenOnline(router), [router]);

  // Local drafts (SPEC.md §6, lib/note-drafts.ts): a note's editor writes every
  // keystroke to localStorage, and the server save may not have landed before
  // the tab, the page, or the computer went away. On load, each draft is
  // checked against the note: the same content clears it; anything else is
  // the user's unsaved words, written to the note now, made from the text the
  // draft was made from — a note changed elsewhere since keeps both sides'
  // words (lib/notes/save-text.ts). A draft written before drafts kept their
  // base is cleared when the note changed elsewhere since, as it always was.
  useEffect(() => {
    sweepStaleDrafts();
    if (!canEdit) return;
    const replay: { id: string; content: string; base: string }[] = [];
    const inTree = new Set<string>();
    for (const note of flattenNotes(tree)) {
      inTree.add(note.id);
      const draft = readNoteDraft(note.id);
      if (!draft) continue;
      const content = draft.content.trim();
      const base = noteDraftBase(draft, note.content);
      if (!content || content === note.content.trim() || (base === undefined && Date.parse(note.updatedAt) > draft.savedAt)) {
        clearNoteDraft(note.id);
        continue;
      }
      replay.push({ id: note.id, content, base: base ?? note.content });
    }
    // A draft with words whose note is not in the project's notes: the note
    // was deleted or merged away elsewhere while the words waited, or it is
    // another project's. A gone note's words become a new note in its place
    // (lib/notes/gone.ts); a note that still exists refuses the save
    // (onlyIfGone), and its own project's load saves the draft. Online only:
    // the draft stays until the server answers.
    const orphans = isOffline()
      ? []
      : listNoteDrafts().filter(({ noteId, draft }) => !inTree.has(noteId) && draftHoldsWords(draft));
    if (replay.length === 0 && orphans.length === 0) return;
    // The words show at once, and stay on the card, marked Not saved, when
    // the save fails: a refresh never puts the old text over them.
    setLocalTexts((prev) => {
      const next = new Map(prev);
      for (const r of replay) next.set(r.id, { content: r.content, unsaved: false });
      return next;
    });
    void Promise.all([
      ...replay.map((r) =>
        saveNoteText(r.id, r.content, r.base)
          .then((saved) => {
            confirmNoteDraft(r.id, r.content);
            confirmNoteDraft(r.id, saved.content);
            setLocalText(r.id, null);
          })
          .catch(() => {
            // Still unsaved: the draft stays for the editor and the next load.
            setLocalText(r.id, { content: r.content, unsaved: true });
          }),
      ),
      ...orphans.map(({ noteId, draft }) => {
        const base = noteDraftBase(draft, draft.base ?? "") ?? draft.base ?? "";
        return saveNoteText(noteId, draft.content, base, { onlyIfGone: true })
          .then((saved) => {
            if (!saved.queued) clearNoteDraft(noteId);
          })
          .catch(() => {});
      }),
    ]).then(refresh);
    // Once per load: the tree at mount is the server's state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A note save that failed is tried again while the page stays open: when
  // the network comes back, when the tab is shown again, and every 20
  // seconds — the same save the load's replay runs, for every local draft
  // that holds words its note lacks. A note open in an editor is its
  // editor's to save, and a draft younger than 5 seconds may still have its
  // save on the way. The Not saved mark clears with the save.
  // The server's tree as the page last drew it: a retry's save is made from
  // the server's text, never from a card that draws the queued or local
  // words over it.
  const serverTree = useRef(notebook.sections);
  useLayoutEffect(() => {
    serverTree.current = notebook.sections;
  });
  useEffect(() => {
    if (!canEdit) return;
    let running = false;
    const retry = () => {
      if (running || isOffline() || document.visibilityState === "hidden") return;
      const now = Date.now();
      const due: { id: string; content: string; base: string }[] = [];
      for (const { noteId, draft } of listNoteDrafts()) {
        // The card may already draw the draft's words: the draft, cleared
        // only when the server confirms its words, says what is unsaved.
        const note = placeOf(treeRef.current, noteId)?.note;
        if (!note || !draftHoldsWords(draft) || openDraftSave(noteId) !== null || now - draft.savedAt < 5000) continue;
        const server = placeOf(serverTree.current, noteId)?.note.content ?? note.content;
        due.push({ id: noteId, content: draft.content.trim(), base: noteDraftBase(draft, server) ?? server });
      }
      if (due.length === 0) return;
      running = true;
      void Promise.all(
        due.map(async ({ id, content, base }) => {
          try {
            const saved = await saveNoteText(id, content, base);
            confirmNoteDraft(id, content);
            confirmNoteDraft(id, saved.content);
            setLocalText(id, null);
          } catch {
            // Still not saved: the next try, or the next load.
          }
        }),
      ).finally(() => {
        running = false;
        refresh();
      });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") retry();
    };
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(retry, 20_000);
    return () => {
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [canEdit, refresh, setLocalText]);

  // Words written to a note that went elsewhere were kept as a new note in
  // its place (lib/notes/gone.ts): the new note takes the old one's place
  // in the list, its local draft and its open editor follow it, and the
  // pill says so. The new note's text is the text the server answered for
  // it, and its next save is made from that text — never from the gone
  // note's, which the new note never held: a save made from it is refused
  // as changed elsewhere, and the words came back two and three times
  // under marker lines.
  const [noteKeys, setNoteKeys] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    const seen = new Set<string>();
    const onKept = (e: Event) => {
      const detail = (e as CustomEvent<{ from?: unknown; to?: unknown; content?: unknown }>).detail;
      const from = detail?.from;
      const to = detail?.to;
      const kept = typeof detail?.content === "string" ? detail.content : null;
      if (typeof from !== "string" || typeof to !== "string" || seen.has(from)) return;
      seen.add(from);
      // The new note's card is the gone note's card: the editor in it stays
      // open with every key typed in it, and saves to the new note.
      setNoteKeys((prev) => new Map(prev).set(to, prev.get(from) ?? from));
      const draft = readNoteDraft(from);
      const open = openDraftSave(from) !== null;
      // The open editor gives way to the new note's, carrying what is typed
      // until it closes (use-note-draft.ts).
      if (open) handOffNoteDraft(from, to);
      if (draft) {
        if (kept !== null) writeNoteDraft(to, draft.content, kept);
        else writeNoteDraft(to, draft.content, draft.base, draft.sent);
        clearNoteDraft(from);
      }
      setTree((prev) =>
        mapSections(prev, (s) =>
          s.notes.some((n) => n.id === from)
            ? {
                ...s,
                notes: s.notes.map((n) =>
                  n.id === from ? { ...n, id: to, ...(kept !== null ? { content: kept } : {}) } : n,
                ),
              }
            : s,
        ),
      );
      if (open) setEditRequest({ id: to, ...(draft ? { draft: draft.content } : {}) });
      setNotice(t("outline.keptAsNewNote"));
      refresh();
    };
    // A quote landed without its source: its passage changed in the document.
    const onSourceLost = () => setNotice(t("outline.quoteSourceLost"));
    window.addEventListener(NOTE_KEPT_EVENT, onKept);
    window.addEventListener(SOURCE_LOST_EVENT, onSourceLost);
    return () => {
      window.removeEventListener(NOTE_KEPT_EVENT, onKept);
      window.removeEventListener(SOURCE_LOST_EVENT, onSourceLost);
    };
  }, [refresh, setNotice, t]);

  // The notes the AI is merging right now: their cards say so while it runs.
  const [merging, setMergingIds] = useState<ReadonlySet<string>>(new Set());
  // Each AI merge on its way, by target: the card's Stop ends it.
  const mergeAborts = useRef(new Map<string, AbortController>());

  // The last merge, while it can be undone: one pill offers Undo for a while
  // after each merge, and the next merge takes the pill.
  const [lastMerge, setLastMerge] = useState<LastMerge | null>(null);
  useEffect(() => {
    if (!lastMerge) return;
    const timer = setTimeout(() => setLastMerge(null), MERGE_UNDO_MS);
    return () => clearTimeout(timer);
  }, [lastMerge]);
  // Undo puts the notes back on screen at once, as they stood before the
  // merge; the server's answer follows. A failed undo brings the merged
  // note back with the refresh, and the pill says why.
  const undoMerge = useCallback(async (): Promise<string | null> => {
    if (!lastMerge) return null;
    const { undoId, targetId, before, content } = lastMerge;
    // The merged note open in its editor: what it holds is saved first, so
    // the route reads the note as it is.
    await flushNoteDrafts([targetId]).catch(() => {});
    const now = placeOf(treeRef.current, targetId)?.note.content;
    // The notes come back on screen before the answer only when the undo
    // will run: the merged note still holds what the merge wrote, and no
    // editor is open on it. Else the answer decides, and nothing flickers.
    const sure = openDraftSave(targetId) === null && now !== undefined && now.trim() === content.trim();
    if (!sure && now !== undefined && now.trim() !== content.trim()) {
      setLastMerge(null);
      return t("outline.mergeEditedSince");
    }
    setLastMerge(null);
    const putBackNow = () => {
      if (!before) return;
      setTree((prev) => {
        let next = mapSections(prev, (s) =>
          s.notes.some((n) => n.id === targetId)
            ? { ...s, notes: s.notes.map((n) => (n.id === targetId ? before.target : n)) }
            : s,
        );
        for (const placed of [...before.sources].sort((a, b) => a.index - b.index)) next = putBack(next, placed);
        return next;
      });
    };
    if (sure) putBackNow();
    try {
      // A refused undo is an answer, not a failed save: the header stays.
      await api("/api/notes/merge/undo", "POST", { undoId }, { refusalIsAnswer: true });
    } catch (err) {
      refresh();
      return err instanceof Error ? err.message : String(err);
    }
    if (!sure) putBackNow();
    refresh();
    return null;
  }, [lastMerge, refresh, t]);

  // Delete with Undo (SPEC.md §6). The notes leave the list at once; the
  // server deletes them when the pill goes. Until then nothing is deleted,
  // so Undo needs no server call, and a failed delete puts the notes back
  // and says so: a note is never gone from the screen while it is still
  // on the server, nor gone from the server while Undo is on the screen.
  const [lastDelete, setLastDelete] = useState<LastDelete | null>(null);
  const [lastSectionDelete, setLastSectionDelete] = useState<LastSectionDelete | null>(null);
  useEffect(() => {
    if (!lastSectionDelete) return;
    const timer = setTimeout(() => setLastSectionDelete(null), DELETE_UNDO_MS);
    return () => clearTimeout(timer);
  }, [lastSectionDelete]);
  // The words an editor's Cancel took out of a note, while Undo can put them back.
  const [lastCancel, setLastCancel] = useState<{ noteId: string; content: string } | null>(null);
  useEffect(() => {
    if (!lastCancel) return;
    const timer = setTimeout(() => setLastCancel(null), MERGE_UNDO_MS);
    return () => clearTimeout(timer);
  }, [lastCancel]);
  const waitingDelete = useRef<{ ids: string[]; timer: ReturnType<typeof setTimeout> } | null>(null);
  // A note History's Restore put back (lib/notes/removed.ts,
  // tellNoteBack): if this tab deleted it, it is in hidden still. With the
  // note in the event, it shows in its section at once, at its order; a
  // refresh confirms in the background.
  useEffect(() => {
    const onBack = (e: Event) => {
      const back = (e as CustomEvent<Partial<NoteBack> | null>).detail;
      const id = back?.noteId;
      if (typeof id !== "string") return;
      setHidden((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      const { note, sectionId } = back ?? {};
      if (note && sectionId) {
        // A section the outline does not list (the annotations') takes
        // nothing: the refresh brings what shows.
        const section = findSection(treeRef.current, sectionId);
        if (section) {
          const index = section.notes.filter((n) => n.order < note.order).length;
          setBackNotes((prev) => new Map(prev).set(id, { note, sectionId, index }));
        }
      }
      refresh();
    };
    window.addEventListener(NOTE_BACK_EVENT, onBack);
    return () => window.removeEventListener(NOTE_BACK_EVENT, onBack);
  }, [refresh]);
  const restoreNotes = useCallback((ids: string[]) => {
    setHidden((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
    for (const id of ids) window.dispatchEvent(new CustomEvent("dissect:note-restored", { detail: { noteId: id } }));
  }, []);
  // The delete runs: the pill went. keepalive: the page is closing, and the
  // request must outlive it.
  const commitDelete = useCallback(
    (keepalive = false) => {
      const waiting = waitingDelete.current;
      if (!waiting) return;
      waitingDelete.current = null;
      clearTimeout(waiting.timer);
      setLastDelete(null);
      if (keepalive) {
        const account = tabAccount();
        for (const id of waiting.ids) {
          void fetch(`/api/notes/${id}`, {
            method: "DELETE",
            keepalive: true,
            headers: account ? { [ACCOUNT_HEADER]: account } : {},
          }).catch(() => {});
        }
        return;
      }
      void Promise.allSettled(waiting.ids.map((id) => api(`/api/notes/${id}`, "DELETE"))).then((results) => {
        const failed = waiting.ids.filter((_, i) => results[i].status === "rejected");
        // The reader deleted these notes: a draft left of one is not words
        // to keep as a new note on the next load.
        waiting.ids.forEach((id, i) => {
          if (results[i].status === "fulfilled") clearNoteDraft(id);
        });
        const reason = results.find((r): r is PromiseRejectedResult => r.status === "rejected")?.reason;
        if (failed.length > 0) {
          restoreNotes(failed);
          setNotice(t("outline.deleteFailed", { reason: reason instanceof Error ? reason.message : String(reason) }), true);
        }
        refresh();
      });
    },
    [refresh, restoreNotes, setNotice, t],
  );
  const commitDeleteRef = useRef(commitDelete);
  useLayoutEffect(() => {
    commitDeleteRef.current = commitDelete;
  });
  // The page closing, or the tray going away (another page): a delete
  // waiting on Undo runs now.
  useEffect(() => {
    const onHide = () => commitDeleteRef.current(true);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      commitDeleteRef.current();
    };
  }, []);
  // A delete posted from outside the notes takes the pill: the notes' own
  // waiting delete runs, and the other pills give way, as for a note's delete.
  const { posted, undoPosted, settlePosted } = usePostedUndo(() => {
    commitDeleteRef.current();
    setLastMerge(null);
    setLastCancel(null);
    setLastSectionDelete(null);
  });
  const removeNotes = useCallback(
    (ids: string[], composed = false) => {
      // composed: the composer's own note, which the list may not hold yet.
      const present = composed ? ids : ids.filter((id) => placeOf(treeRef.current, id));
      if (present.length === 0) return;
      commitDelete();
      settlePosted();
      setLastMerge(null);
      setHidden((prev) => new Set([...prev, ...present]));
      // The reader fades the notes' marks at once (reader-interactions.tsx),
      // and puts them back on Undo or a failed delete.
      for (const id of present) window.dispatchEvent(new CustomEvent("dissect:note-removed", { detail: { noteId: id } }));
      waitingDelete.current = { ids: present, timer: setTimeout(() => commitDeleteRef.current(), DELETE_UNDO_MS) };
      setLastDelete({ ids: present });
    },
    [commitDelete, settlePosted],
  );
  const undoDelete = useCallback(() => {
    const waiting = waitingDelete.current;
    if (!waiting) return;
    waitingDelete.current = null;
    clearTimeout(waiting.timer);
    setLastDelete(null);
    restoreNotes(waiting.ids);
  }, [restoreNotes]);

  // Ticker selection, pruned against the tree so deleted or merged notes drop out.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const selected = useMemo(() => {
    const accepted = new Set(
      flattenNotes(tree)
        .filter((n) => n.status === "ACCEPTED")
        .map((n) => n.id),
    );
    const pruned = new Set([...selectedIds].filter((id) => accepted.has(id)));
    return pruned.size === selectedIds.size ? selectedIds : pruned;
  }, [tree, selectedIds]);

  useEffect(() => {
    if (selected.size === 0) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.key === "Escape") setSelectedIds(new Set());
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected.size]);

  const notesView = useCollapsedView(`${NOTES_VIEW_STORE}:${notebook.id}`);

  // The tree on screen: the open document's notes, or the whole project —
  // with the notes saved offline drawn in, marked, until the queue syncs.
  const queued = useQueuedNoteWrites();
  const shownTree = useMemo(
    () => overlayLocalTexts(overlayQueuedNotes(tree, queued.writes, queued.landed), localTexts),
    [tree, queued, localTexts],
  );
  const scopedTree = useMemo(
    () => (documentId && scopeToDocument ? scopeSections(shownTree, documentId) : shownTree),
    [shownTree, documentId, scopeToDocument],
  );
  // Pending queue in outline order (SPEC.md §6 keyboard flow): the notes on
  // screen. pendingElsewhere: pending notes the scope hides — other
  // documents' and the project's — which the notes full page shows.
  const pending = useMemo(() => flattenNotes(scopedTree).filter((n) => n.status === "PENDING"), [scopedTree]);
  const pendingElsewhere = useMemo(
    () => flattenNotes(shownTree).filter((n) => n.status === "PENDING").length - pending.length,
    [shownTree, pending.length],
  );
  const focused = pending.length > 0 ? pending[Math.min(focusIndex, pending.length - 1)] : null;

  const acceptNote = useCallback(
    async (id: string) => {
      // Optimistic: accepting must feel instant (SPEC.md §10).
      setTree((prev) =>
        prev.map(function walk(s): SectionView {
          return {
            ...s,
            notes: s.notes.map((n) => (n.id === id ? { ...n, status: "ACCEPTED" as const } : n)),
            children: s.children.map(walk),
          };
        }),
      );
      await api(`/api/notes/${id}`, "PATCH", { status: "ACCEPTED" });
      refresh();
    },
    [refresh],
  );

  // Rejecting is one keystroke, so it gets one keystroke back: an Undo window
  // that returns the note to the pending queue.
  const [lastRejected, setLastRejected] = useState<string | null>(null);
  useEffect(() => {
    if (!lastRejected) return;
    // The same 12 seconds as every other pill's Undo.
    const timer = setTimeout(() => setLastRejected(null), MERGE_UNDO_MS);
    return () => clearTimeout(timer);
  }, [lastRejected]);

  // Each reject, by note: where the note stood, and the request, so Undo
  // puts the note back at once and sends its own request after the reject's
  // has landed — never before it, or the note would end rejected.
  const rejects = useRef(new Map<string, { placed: Placed | null; request: Promise<unknown>; undone: boolean }>());

  const rejectNote = useCallback(
    async (id: string) => {
      const placed = placeOf(treeRef.current, id);
      setTree((prev) => withoutNotes(prev, new Set([id])));
      setLastRejected(id);
      const request = api(`/api/notes/${id}`, "PATCH", { status: "REJECTED" });
      const entry = { placed, request, undone: false };
      rejects.current.set(id, entry);
      try {
        await request;
      } catch (err) {
        // Not rejected: the note comes back to the queue, and the pill says why.
        if (rejects.current.get(id) === entry) rejects.current.delete(id);
        if (placed) setTree((prev) => putBack(prev, placed));
        setLastRejected((current) => (current === id ? null : current));
        failure(err);
        return;
      }
      // Undo ran meanwhile: its own refresh follows its own request.
      if (!entry.undone) refresh();
    },
    [refresh, failure],
  );

  const undoReject = useCallback(async () => {
    if (!lastRejected) return;
    const id = lastRejected;
    setLastRejected(null);
    const entry = rejects.current.get(id);
    rejects.current.delete(id);
    const placed = entry?.placed ? { ...entry.placed, note: { ...entry.placed.note, status: "PENDING" as const } } : null;
    if (entry) entry.undone = true;
    if (placed) setTree((prev) => putBack(prev, placed));
    try {
      await entry?.request.catch(() => {});
      await api(`/api/notes/${id}`, "PATCH", { status: "PENDING" });
    } catch (err) {
      if (placed) setTree((prev) => withoutNotes(prev, new Set([id])));
      failure(err);
      return;
    }
    refresh();
  }, [lastRejected, refresh, failure]);

  // The pending queue's keys act only while the reader works the queue
  // (SPEC.md §6): the last press or focus was inside the pending queue or on
  // a pending card. A key pressed after a click in the article, the graph,
  // or anywhere else never accepts or rejects a note.
  const workingQueue = useRef(false);
  const pendingRef = useRef(pending);
  useLayoutEffect(() => {
    pendingRef.current = pending;
  });
  useEffect(() => {
    const inQueue = (e: Event) => {
      const el = e.target instanceof Element ? e.target : null;
      workingQueue.current = Boolean(el?.closest('[data-pending-queue], [data-note-status="PENDING"]'));
      // A pending card pressed becomes the one the keys act on.
      const card = el?.closest<HTMLElement>('[data-note-status="PENDING"]');
      const index = card ? pendingRef.current.findIndex((n) => n.id === card.dataset.noteId) : -1;
      if (index !== -1) setFocusIndex(index);
    };
    window.addEventListener("pointerdown", inQueue, true);
    window.addEventListener("focusin", inQueue, true);
    return () => {
      window.removeEventListener("pointerdown", inQueue, true);
      window.removeEventListener("focusin", inQueue, true);
    };
  }, []);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (pending.length === 0 || !workingQueue.current) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable ||
          // Enter on a focused button must activate the button, not the queue.
          target.closest("button, a, [role='button']"))
      ) {
        return;
      }
      const current = pending[Math.min(focusIndex, pending.length - 1)];
      switch (e.key) {
        case "j":
          setFocusIndex((i) => Math.min(i + 1, pending.length - 1));
          break;
        case "k":
          setFocusIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (current && canEdit) void acceptNote(current.id);
          break;
        case "Backspace":
          e.preventDefault();
          if (current && canEdit) void rejectNote(current.id);
          break;
        case "e":
          e.preventDefault();
          if (current && canEdit) setEditRequest({ id: current.id });
          break;
        case "g": {
          e.preventDefault();
          const source = current?.sources[0];
          if (source && !source.orphaned) {
            router.push(`/n/${notebook.id}?doc=${source.documentId}&src=${source.id}`);
          }
          break;
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending, focusIndex, notebook.id, router, acceptNote, rejectNote, canEdit]);

  // Words added at the end of a note that is not open, with what rides
  // along (a quote's source, an annotation's anchors), in one write. The
  // route adds the words to the note's stored text.
  async function appendWords(id: string, markdown: string, extra: Record<string, unknown>) {
    const before = placeOf(treeRef.current, id)?.note.content;
    const setContent = (text: string) =>
      setTree((prev) =>
        mapSections(prev, (s) =>
          s.notes.some((n) => n.id === id)
            ? { ...s, notes: s.notes.map((n) => (n.id === id ? { ...n, content: text } : n)) }
            : s,
        ),
      );
    if (before !== undefined) setContent(appendToBody(before, markdown));
    try {
      const answer = await api<{ sourceDropped?: unknown; keptAs?: unknown }>(`/api/notes/${id}`, "PATCH", {
        append: markdown,
        ...extra,
      });
      if (answer?.sourceDropped === true) setNotice(t("outline.quoteSourceLost"));
      announceKept(id, answer);
      // The card blooms as the words land in it: the drop shows it landed.
      window.dispatchEvent(new CustomEvent(NOTE_ABSORBED_EVENT, { detail: { noteId: id } }));
    } catch (err) {
      if (before !== undefined) setContent(before);
      throw err;
    }
    refresh();
  }

  const actions: OutlineActions = {
    notebookId: notebook.id,
    noteKey: (id) => noteKeys.get(id) ?? id,
    documentId,
    async addSection(parentId, title) {
      await api("/api/sections", "POST", { notebookId: notebook.id, title, parentId });
      refresh();
    },
    async renameSection(id, title) {
      const answer = await api<{ queued?: boolean; serverError?: boolean } | null>(`/api/sections/${id}`, "PATCH", { title });
      refresh();
      return { queued: answer?.queued === true, serverError: answer?.serverError === true };
    },
    async deleteSection(id) {
      // The section leaves the screen at once and the pill shows; the
      // server follows. A delete that fails puts the section back and says so.
      const found = findSection(treeRef.current, id);
      const { placed } = withoutSection(treeRef.current, id);
      setGoneSections((prev) => withId(prev, id));
      setBackSections((prev) => withoutKeys(prev, [id]));
      const request = api<{ eventId?: unknown }>(`/api/sections/${id}`, "DELETE").then(
        (answer) => (typeof answer?.eventId === "string" ? answer.eventId : null),
        (err: unknown) => {
          setGoneSections((prev) => withoutId(prev, id));
          setLastSectionDelete((last) => (last?.request === request ? null : last));
          failure(err);
          return null;
        },
      );
      settlePosted();
      setLastMerge(null);
      setLastCancel(null);
      setLastSectionDelete({
        eventId: null,
        request,
        title: found?.title ?? "",
        count: found?.notes.length ?? 0,
        placed,
      });
      const eventId = await request;
      setLastSectionDelete((last) => (last?.request === request ? { ...last, eventId } : last));
      refresh();
    },
    reorderSection(parentId, id, toIndex) {
      setTree((prev) => {
        if (parentId === null) {
          const from = prev.findIndex((s) => s.id === id);
          return from === -1 ? prev : arrayMove(prev, from, toIndex);
        }
        return updateSection(prev, parentId, (parent) => {
          const from = parent.children.findIndex((s) => s.id === id);
          return from === -1
            ? parent
            : { ...parent, children: arrayMove(parent.children, from, toIndex) };
        });
      });
      void api(`/api/sections/${id}`, "PATCH", { order: toIndex }).then(refresh);
    },
    async addNote(sectionId, content, id) {
      // A note from the composer lands at the top of its section, and in
      // the open document (SPEC.md §6). It joins the list the moment the
      // server has it, not when the refresh lands: the composer closes in
      // the same frame, so the note is never in neither place.
      const row = await api<Partial<NoteView> & { id?: unknown; queued?: unknown }>("/api/notes", "POST", {
        ...(id ? { id } : {}),
        sectionId,
        content,
        top: true,
        documentId: documentId ?? undefined,
      });
      if (composedSection.current === sectionId) composedSection.current = null;
      // Offline the answer is the queue's ({queued, id}), not the note: the
      // notes draw a queued note from the queue, marked Waiting to sync
      // (lib/offline/queued-notes.ts), so it stays out of the tree.
      if (row && typeof row.id === "string" && row.queued !== true) {
        const note = localNote(row.id, content, documentId, row);
        setTree((prev) => putBack(prev, { note, sectionId, index: 0 }));
      }
      refresh();
    },
    async addDroppedNote(sectionId, content, from) {
      const row = await api<Partial<NoteView> & { id?: unknown; queued?: unknown }>("/api/notes", "POST", {
        sectionId,
        content,
        top: from.top,
        ...(from.quote
          ? {
              source: from.quote.source,
              ...(from.quote.segments ? { segments: from.quote.segments } : {}),
              // A quote whose place the document no longer has still makes
              // its note, without the source; the pill says why.
              onSourceLost: "keep",
            }
          : { documentId: documentId ?? undefined }),
      });
      if ((row as { sourceDropped?: unknown } | null)?.sourceDropped === true) setNotice(t("outline.quoteSourceLost"));
      if (!row || typeof row.id !== "string") {
        refresh();
        return;
      }
      const id = row.id;
      if (row.queued === true) {
        // Offline: the queue draws the note (lib/offline/queued-notes.ts).
        if (from.annotationId) {
          await api(`/api/notes/${id}`, "PATCH", { copySourcesFrom: from.annotationId }).catch(() => {});
        }
        refresh();
        return;
      }
      setTree((prev) =>
        updateSection(prev, sectionId, (s) => {
          if (s.notes.some((n) => n.id === id)) return s;
          const note = localNote(id, content, documentId, row);
          return { ...s, notes: from.top ? [note, ...s.notes] : [...s.notes, note] };
        }),
      );
      if (from.annotationId) {
        await api(`/api/notes/${id}`, "PATCH", { copySourcesFrom: from.annotationId }).catch(() => {});
      }
      refresh();
      window.dispatchEvent(new CustomEvent("dissect:show-note", { detail: { noteId: id } }));
    },
    async saveNote(id, content, base) {
      // The card shows the words at once; a failed save puts the old words
      // back and the caller hears why. The save is made from the text the
      // note's open editor opened on, else the text on screen: a note
      // changed elsewhere meanwhile keeps both sides' words.
      const before = placeOf(treeRef.current, id)?.note.content;
      const setContent = (text: string) =>
        setTree((prev) =>
          mapSections(prev, (s) =>
            s.notes.some((n) => n.id === id)
              ? { ...s, notes: s.notes.map((n) => (n.id === id ? { ...n, content: text } : n)) }
              : s,
          ),
        );
      if (before !== undefined && before !== content) setContent(content);
      // Drawn over the server's copy while the save is on its way: a
      // refresh that lands first (another document opened) never shows the
      // old text.
      setLocalText(id, { content, unsaved: false });
      try {
        const save = openDraftSave(id);
        if (base !== undefined) await saveNoteText(id, content, base);
        else if (save) await save(content);
        else await saveNoteText(id, content, before ?? null);
      } catch (err) {
        // Words the local draft holds stay on the card, marked Not saved;
        // anything else goes back to what the note held.
        if (readNoteDraft(id)?.content.trim() === content.trim()) setLocalText(id, { content, unsaved: true });
        else {
          setLocalText(id, null);
          if (before !== undefined && before !== content) setContent(before);
        }
        throw err;
      }
      setLocalText(id, null);
      // The composer's own note, let go by Save or Escape: it joins the top
      // of its section now, as the composer closes.
      const composed = composedSection.current;
      composedSection.current = null;
      if (before === undefined && composed) {
        setTree((prev) => putBack(prev, { note: localNote(id, content, documentId), sectionId: composed, index: 0 }));
      }
      refresh();
    },
    expectComposed(sectionId) {
      composedSection.current = sectionId;
    },
    placeComposed(sectionId, id, content) {
      setLocalText(id, { content, unsaved: false });
      setTree((prev) => putBack(prev, { note: localNote(id, content, documentId), sectionId, index: 0 }));
    },
    async attachSource(id, drag) {
      const answer = await api<{ addedSourceIds?: unknown; sourceDropped?: unknown }>(`/api/notes/${id}`, "PATCH", {
        addSource: { source: drag.source, ...(drag.segments ? { segments: drag.segments } : {}) },
        onSourceLost: "keep",
      });
      if (answer?.sourceDropped === true) setNotice(t("outline.quoteSourceLost"));
      refresh();
      return Array.isArray(answer?.addedSourceIds)
        ? answer.addedSourceIds.filter((s): s is string => typeof s === "string")
        : [];
    },
    async dropSources(id, sourceIds) {
      if (sourceIds.length === 0) return;
      await api(`/api/notes/${id}`, "PATCH", { removeSources: sourceIds });
      refresh();
    },
    async appendQuote(id, markdown, drag) {
      // The words and the source go in one write: with two, a tab closed
      // between them keeps the quote with no source to point back. A note
      // open in an editor saves through the editor, then takes the source.
      const before = placeOf(treeRef.current, id)?.note.content;
      if (before !== undefined && openDraftSave(id)) {
        await actions.saveNote(id, appendToBody(before, markdown));
        await actions.attachSource(id, drag);
        return;
      }
      await appendWords(id, markdown, {
        addSource: { source: drag.source, ...(drag.segments ? { segments: drag.segments } : {}) },
        // A quote whose place the document no longer has: its words still
        // land, without the source, and the pill says why.
        onSourceLost: "keep",
      });
    },
    async appendAnnotation(id, markdown, annotationId) {
      // The annotation reference and copies of the annotation's anchors in
      // one write, as a quote's words and its source go (SPEC.md §6).
      const before = placeOf(treeRef.current, id)?.note.content;
      if (before !== undefined && openDraftSave(id)) {
        await actions.saveNote(id, appendToBody(before, markdown));
        await actions.attachAnnotationSources(id, annotationId);
        return;
      }
      await appendWords(id, markdown, { copySourcesFrom: annotationId });
    },
    async attachAnnotationSources(id, annotationId) {
      await api(`/api/notes/${id}`, "PATCH", { copySourcesFrom: annotationId });
      refresh();
    },
    async deleteNote(id) {
      // The reader fades the note's marks at once (reader-interactions.tsx),
      // and puts them back if the delete fails.
      window.dispatchEvent(new CustomEvent("dissect:note-removed", { detail: { noteId: id } }));
      try {
        await api(`/api/notes/${id}`, "DELETE");
      } catch (err) {
        window.dispatchEvent(new CustomEvent("dissect:note-restored", { detail: { noteId: id } }));
        throw err;
      }
      refresh();
    },
    removeNotes,
    lastDelete,
    undoDelete,
    lastSectionDelete,
    posted,
    undoPosted,
    async undoSectionDelete() {
      const last = lastSectionDelete;
      if (!last) return;
      setLastSectionDelete(null);
      // The section is back on screen at once, where it stood; the restore follows.
      const { placed } = last;
      if (placed) {
        setGoneSections((prev) => withoutId(prev, placed.section.id));
        setBackSections((prev) => new Map(prev).set(placed.section.id, placed));
      }
      const eventId = last.eventId ?? (await last.request);
      // The delete did not run: the section is back already.
      if (!eventId) return;
      try {
        await api(`/api/notebooks/${notebook.id}/history/${eventId}`, "POST");
      } catch (err) {
        // History keeps the section: its row's Restore is the way back still.
        if (placed) {
          setBackSections((prev) => withoutKeys(prev, [placed.section.id]));
          setGoneSections((prev) => withId(prev, placed.section.id));
        }
        setNotice(t("outline.sectionUndoFailed", { reason: err instanceof Error ? err.message : String(err) }), true);
      }
      refresh();
    },
    notice: shownNotice?.text ?? null,
    noticeFailed: shownNotice?.failed ?? false,
    dismissNotice() {
      setNotice(null);
    },
    reorderNote(sectionId, id, toIndex) {
      setTree((prev) =>
        updateSection(prev, sectionId, (s) => {
          const from = s.notes.findIndex((n) => n.id === id);
          return from === -1 ? s : { ...s, notes: arrayMove(s.notes, from, toIndex) };
        }),
      );
      void api(`/api/notes/${id}`, "PATCH", { order: toIndex }).then(refresh);
    },
    async moveNoteToSection(id, sectionId, toIndex) {
      // The card lands where it was dropped before the server answers: the
      // note leaves its section and takes its place in the new one.
      setTree((prev) => {
        let moved: NoteView | null = null;
        const taken = mapSections(prev, (s) => {
          const note = s.notes.find((n) => n.id === id);
          if (!note) return s;
          moved = note;
          return { ...s, notes: s.notes.filter((n) => n.id !== id) };
        });
        if (!moved) return prev;
        const note: NoteView = moved;
        return updateSection(taken, sectionId, (s) => {
          const at = toIndex === undefined ? s.notes.length : Math.max(0, Math.min(toIndex, s.notes.length));
          return { ...s, notes: [...s.notes.slice(0, at), note, ...s.notes.slice(at)] };
        });
      });
      await api(`/api/notes/${id}`, "PATCH", { sectionId, ...(toIndex === undefined ? {} : { order: toIndex }) });
      refresh();
      // The tray shows where the note went: a folded section unfolds on it,
      // and the note flashes.
      window.dispatchEvent(new CustomEvent("dissect:show-note", { detail: { noteId: id } }));
    },
    nudgeNote(id, delta) {
      const place = placeOf(treeRef.current, id);
      if (!place) return;
      const section = findSection(treeRef.current, place.sectionId);
      if (!section) return;
      const index = place.index + delta;
      if (index >= 0 && index < section.notes.length) {
        actions.reorderNote(section.id, id, index);
        return;
      }
      // The sections in page order: each root, then the sections nested in it.
      const order = treeRef.current.flatMap((s) => [s, ...s.children]);
      const next = order[order.findIndex((s) => s.id === section.id) + delta];
      if (!next) return;
      void actions.moveNoteToSection(id, next.id, delta < 0 ? next.notes.length : 0);
    },
    async mergeNotes(targetId, sourceIds, mode = "join") {
      const all = flattenNotes(tree);
      const byId = new Map(all.map((n) => [n.id, n]));
      const target = byId.get(targetId);
      if (!target || target.status !== "ACCEPTED") return null;
      // A source in the tree is a note of a section; a source that is not is an
      // annotation, which lives in the hidden Annotations section and is copied
      // into the note rather than consumed. Accepted notes only — pending notes
      // go through Accept/Reject first.
      const notes = sourceIds
        .map((id) => byId.get(id))
        .filter((n): n is NoteView => n !== undefined && n.id !== targetId);
      if (notes.some((n) => n.status !== "ACCEPTED")) return null;
      const ids = sourceIds.filter((id) => id !== targetId);
      if (ids.length === 0) return null;
      // A note open in its editor — the target or a source — saves its draft
      // first, so the merge reads what is on screen (use-note-draft.ts).
      await flushNoteDrafts([targetId, ...ids]);
      // A delete waiting on Undo runs now: the merge takes the pill.
      commitDelete();
      // Where the notes stood, so Undo puts them back on screen at once.
      const before = {
        target,
        sources: ids.map((id) => placeOf(treeRef.current, id)).filter((p): p is Placed => p !== null),
      };
      // Optimistic: the notes fold into the target instantly. Join text puts
      // the notes in the order they stand in — the note on top first
      // (lib/notes/join.ts); an annotation's text lands with the answer. The
      // AI merge writes text the client cannot know, so the target says it is
      // merging until the answer lands.
      const gone = new Set(notes.map((n) => n.id));
      const ordered = all.filter((n) => n.id === targetId || gone.has(n.id));
      const joined = joinNoteContents(ordered.map((n) => n.content), t("outline.mergedNote"));
      setTree((prev) =>
        prev.map(function walk(s): SectionView {
          return {
            ...s,
            notes: s.notes
              .filter((n) => !gone.has(n.id))
              .map((n) =>
                n.id === targetId && mode === "join"
                  ? { ...n, content: joined, sources: [...n.sources, ...notes.flatMap((x) => x.sources)] }
                  : n,
              ),
            children: s.children.map(walk),
          };
        }),
      );
      setSelectedIds(new Set());
      window.dispatchEvent(new CustomEvent(NOTE_ABSORBED_EVENT, { detail: { noteId: targetId } }));
      if (mode === "ai") setMergingIds((prev) => new Set(prev).add(targetId));
      const controller = mode === "ai" ? new AbortController() : null;
      if (controller) mergeAborts.current.set(targetId, controller);
      try {
        const merged = await api<{ content?: string; undoId?: string }>(
          "/api/notes/merge",
          "POST",
          { targetId, sourceIds: ids, mode },
          controller ? { signal: controller.signal } : undefined,
        );
        refresh();
        const undoId = typeof merged?.undoId === "string" ? merged.undoId : null;
        const content = merged?.content ?? joined;
        // The merged note shows the text the merge wrote, which Undo checks against.
        setTree((prev) =>
          mapSections(prev, (s) =>
            s.notes.some((n) => n.id === targetId)
              ? { ...s, notes: s.notes.map((n) => (n.id === targetId ? { ...n, content } : n)) }
              : s,
          ),
        );
        if (undoId) {
          settlePosted();
          setLastMerge({ undoId, targetId, count: ids.length + 1, content, before });
        }
        // The target open in its editor: the merged text takes the draft's
        // place, saved and ready to keep editing.
        if (mode === "join") replaceNoteDraft(targetId, content);
        return { content, undoId };
      } catch (err) {
        // Stopped (SPEC.md §6): the route merges nothing, and the refresh
        // brings back the notes the optimistic fold took away.
        if (controller?.signal.aborted) {
          refresh();
          return null;
        }
        throw err;
      } finally {
        if (controller && mergeAborts.current.get(targetId) === controller) mergeAborts.current.delete(targetId);
        if (mode === "ai") {
          setMergingIds((prev) => {
            const next = new Set(prev);
            next.delete(targetId);
            return next;
          });
        }
      }
    },
    merging,
    stopMerge(targetId) {
      mergeAborts.current.get(targetId)?.abort();
    },
    lastMerge,
    mergeUndoable:
      lastMerge !== null &&
      (placeOf(tree, lastMerge.targetId)?.note.content.trim() ?? lastMerge.content.trim()) === lastMerge.content.trim(),
    undoMerge,
    dismissMerge() {
      setLastMerge(null);
      setLastCancel(null);
      setLastSectionDelete(null);
      setLastRejected(null);
      commitDelete();
      settlePosted();
    },
    editCanceled(noteId, typed) {
      setLastCancel({ noteId, content: typed });
    },
    lastCancel,
    undoCancel() {
      const canceled = lastCancel;
      if (!canceled) return;
      setLastCancel(null);
      // The typed words go back into the note. The local draft holds them
      // until the server has them, as for any save.
      const before = placeOf(treeRef.current, canceled.noteId)?.note.content;
      writeNoteDraft(canceled.noteId, canceled.content, before ?? canceled.content);
      void actions
        .saveNote(canceled.noteId, canceled.content)
        .then(() => confirmNoteDraft(canceled.noteId, canceled.content), failure);
    },
    async setPinned(id, pinned) {
      // Optimistic: pinning also moves the note to the top of its section.
      setTree((prev) =>
        prev.map(function walk(s): SectionView {
          const index = s.notes.findIndex((n) => n.id === id);
          let notes = s.notes;
          if (index !== -1) {
            notes = s.notes.map((n) => (n.id === id ? { ...n, pinned } : n));
            if (pinned) notes = arrayMove(notes, index, 0);
          }
          return { ...s, notes, children: s.children.map(walk) };
        }),
      );
      await api(`/api/notes/${id}`, "PATCH", { pinned });
      refresh();
    },
    acceptNote,
    rejectNote,
    sectionChoices: tree.flatMap((s) => [
      { id: s.id, label: s.title },
      ...s.children.map((c) => ({ id: c.id, label: `${s.title} / ${c.title}` })),
    ]),
    focusedPendingId: focused?.id ?? null,
    editRequest,
    selected,
    toggleSelect(id) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    clearSelection() {
      setSelectedIds(new Set());
    },
    notesView: notesView.view,
    isCollapsed: notesView.isCollapsed,
    toggleCollapsed: notesView.toggle,
    setNotesView: notesView.setView,
    floating,
    floatNote(edit) {
      floatingDraft.current = edit.draft;
      setFloating(edit);
    },
    floatingDraftChanged(draft) {
      floatingDraft.current = draft;
    },
    dockNote(reopen) {
      if (floating && reopen) setEditRequest({ id: floating.id, draft: floatingDraft.current });
      setFloating(null);
    },
  };

  return { tree: scopedTree, pending, pendingElsewhere, focused, actions, lastRejected, undoReject };
}

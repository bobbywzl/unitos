"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import { api } from "@/lib/api";
import { ACCOUNT_HEADER } from "@/lib/constants";
import { tabAccount } from "@/lib/tab-account";
import { refreshWhenOnline } from "@/lib/offline/queue";
import type { MergeMode } from "@/lib/card-drag";
import { clearNoteDraft, confirmNoteDraft, readNoteDraft, sweepStaleDrafts } from "@/lib/note-drafts";
import { joinNoteContents } from "@/lib/notes/join";
import type { QuoteDrag } from "@/lib/quote-drag";
import type { NotebookView, NoteView, SectionView } from "@/lib/types";
import { useT } from "@/components/lang-provider";
import { useCollapsedView, type CollapsedView } from "@/components/use-collapsed-view";
import { flushNoteDrafts, replaceNoteDraft } from "@/components/outline/use-note-draft";

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
  before?: { target: NoteView; sources: Placed[] };
};
const MERGE_UNDO_MS = 12_000;

/** The last delete, while it can be undone (SPEC.md §6): the notes leave the
    list at once, and the server deletes them only when the Undo pill goes
    (DELETE_UNDO_MS, the next delete, ✕, or the page closing). Undo before
    then puts them back with no server call. */
export type LastDelete = { ids: string[] };
const DELETE_UNDO_MS = MERGE_UNDO_MS;

/** The target of a merge took the other notes in: its card blooms
    (note-card.tsx listens). */
export const NOTE_ABSORBED_EVENT = "dissect:note-absorbed";

export type OutlineActions = {
  notebookId: string;
  /** The open document (SPEC.md §6): the tray's notes are its, and a note
      written in the tray is its. Null on the notes full page. */
  documentId: string | null;
  addSection: (parentId: string | null, title: string) => Promise<void>;
  renameSection: (id: string, title: string) => Promise<void>;
  deleteSection: (id: string) => Promise<void>;
  reorderSection: (parentId: string | null, id: string, toIndex: number) => void;
  addNote: (sectionId: string, content: string) => Promise<void>;
  /** A quote or an annotation let go on a section in the tray (SPEC.md §6):
      a new note with the dropped text, at the top of the section (top) or
      at its end. A quote's anchor becomes the note's source; an
      annotation's anchors are copied in. The tray then shows the note. */
  addDroppedNote: (
    sectionId: string,
    content: string,
    from: { top: boolean; quote?: QuoteDrag; annotationId?: string },
  ) => Promise<void>;
  saveNote: (id: string, content: string) => Promise<void>;
  /** A quote dropped into the note (lib/quote-drag.ts): its anchor becomes
      a source of the note, so the quote points back to the reader. */
  attachSource: (id: string, drag: QuoteDrag) => Promise<void>;
  /** An annotation dropped into the note (lib/annotation-reference.ts):
      copies of its anchors become sources of the note, so the quote it
      landed points back to the reader. */
  attachAnnotationSources: (id: string, annotationId: string) => Promise<void>;
  /** Delete at once, no Undo: the composer's Cancel, for the note it made. */
  deleteNote: (id: string) => Promise<void>;
  /** Delete with Undo (SPEC.md §6): the notes leave the list at once, and
      the Undo pill offers them back until it goes; only then does the
      server delete them. */
  removeNotes: (ids: string[]) => void;
  lastDelete: LastDelete | null;
  undoDelete: () => void;
  /** A change that did not reach the server and was put back: the pill under
      the notes says so. Null when there is nothing to say. */
  notice: string | null;
  dismissNotice: () => void;
  /** The composer of this section is letting its note go (Save, Escape):
      the note joins the section's list the moment the server has it. */
  expectComposed: (sectionId: string) => void;
  reorderNote: (sectionId: string, id: string, toIndex: number) => void;
  moveNoteToSection: (id: string, sectionId: string, toIndex?: number) => Promise<void>;
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
  /** Undo the last merge. Resolves to the reason when it could not run. */
  undoMerge: () => Promise<string | null>;
  /** The pill's ✕: the merge stays, and a delete waiting on Undo runs now. */
  dismissMerge: () => void;
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
  const tree = useMemo(() => (hidden.size > 0 ? withoutNotes(rawTree, hidden) : rawTree), [rawTree, hidden]);
  // The tree as it is now, for the writes that read it from an event.
  const treeRef = useRef(tree);
  useLayoutEffect(() => {
    treeRef.current = tree;
  });
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [notice]);
  const failure = useCallback(
    (err: unknown) => setNotice(err instanceof Error && err.message ? err.message : t("common.requestFailed")),
    [t],
  );
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
  }

  // Offline, the refresh waits for the network (SPEC.md §17, lib/offline/queue.ts).
  const refresh = useCallback(() => refreshWhenOnline(router), [router]);

  // Local drafts (SPEC.md §6, lib/note-drafts.ts): a note's editor writes every
  // keystroke to localStorage, and the server save may not have landed before
  // the tab, the page, or the computer went away. On load, each draft is
  // checked against the note: the same content, or a note changed elsewhere
  // since, clears it; anything else is the user's unsaved words, written to the
  // note now.
  useEffect(() => {
    sweepStaleDrafts();
    if (!canEdit) return;
    const replay: { id: string; content: string }[] = [];
    for (const note of flattenNotes(tree)) {
      const draft = readNoteDraft(note.id);
      if (!draft) continue;
      const content = draft.content.trim();
      if (!content || content === note.content || Date.parse(note.updatedAt) > draft.savedAt) {
        clearNoteDraft(note.id);
        continue;
      }
      replay.push({ id: note.id, content });
    }
    if (replay.length === 0) return;
    const byId = new Map(replay.map((r) => [r.id, r.content]));
    setTree((prev) =>
      prev.map(function walk(s): SectionView {
        return {
          ...s,
          notes: s.notes.map((n) => (byId.has(n.id) ? { ...n, content: byId.get(n.id)! } : n)),
          children: s.children.map(walk),
        };
      }),
    );
    void Promise.all(
      replay.map((r) =>
        api(`/api/notes/${r.id}`, "PATCH", { content: r.content })
          .then(() => confirmNoteDraft(r.id, r.content))
          .catch(() => {
            // Still unsaved: the draft stays for the next load.
          }),
      ),
    ).then(refresh);
    // Once per load: the tree at mount is the server's state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const { undoId, targetId, before } = lastMerge;
    setLastMerge(null);
    if (before) {
      setTree((prev) => {
        let next = mapSections(prev, (s) =>
          s.notes.some((n) => n.id === targetId)
            ? { ...s, notes: s.notes.map((n) => (n.id === targetId ? before.target : n)) }
            : s,
        );
        for (const placed of [...before.sources].sort((a, b) => a.index - b.index)) next = putBack(next, placed);
        return next;
      });
    }
    try {
      await api("/api/notes/merge/undo", "POST", { undoId });
    } catch (err) {
      refresh();
      return err instanceof Error ? err.message : String(err);
    }
    refresh();
    return null;
  }, [lastMerge, refresh]);

  // Delete with Undo (SPEC.md §6). The notes leave the list at once; the
  // server deletes them when the pill goes. Until then nothing is deleted,
  // so Undo needs no server call, and a failed delete puts the notes back
  // and says so: a note is never gone from the screen while it is still
  // on the server, nor gone from the server while Undo is on the screen.
  const [lastDelete, setLastDelete] = useState<LastDelete | null>(null);
  const waitingDelete = useRef<{ ids: string[]; timer: ReturnType<typeof setTimeout> } | null>(null);
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
        const reason = results.find((r): r is PromiseRejectedResult => r.status === "rejected")?.reason;
        if (failed.length > 0) {
          restoreNotes(failed);
          setNotice(t("outline.deleteFailed", { reason: reason instanceof Error ? reason.message : String(reason) }));
        }
        refresh();
      });
    },
    [refresh, restoreNotes, t],
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
  const removeNotes = useCallback(
    (ids: string[]) => {
      const present = ids.filter((id) => placeOf(treeRef.current, id));
      if (present.length === 0) return;
      commitDelete();
      setLastMerge(null);
      setHidden((prev) => new Set([...prev, ...present]));
      // The reader fades the notes' marks at once (reader-interactions.tsx),
      // and puts them back on Undo or a failed delete.
      for (const id of present) window.dispatchEvent(new CustomEvent("dissect:note-removed", { detail: { noteId: id } }));
      waitingDelete.current = { ids: present, timer: setTimeout(() => commitDeleteRef.current(), DELETE_UNDO_MS) };
      setLastDelete({ ids: present });
    },
    [commitDelete],
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

  // The tree on screen: the open document's notes, or the whole project.
  const scopedTree = useMemo(
    () => (documentId && scopeToDocument ? scopeSections(tree, documentId) : tree),
    [tree, documentId, scopeToDocument],
  );
  // Pending queue in outline order (SPEC.md §6 keyboard flow): the notes on
  // screen. pendingElsewhere: pending notes the scope hides — other
  // documents' and the project's — which the notes full page shows.
  const pending = useMemo(() => flattenNotes(scopedTree).filter((n) => n.status === "PENDING"), [scopedTree]);
  const pendingElsewhere = useMemo(
    () => flattenNotes(tree).filter((n) => n.status === "PENDING").length - pending.length,
    [tree, pending.length],
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
    const timer = setTimeout(() => setLastRejected(null), 8000);
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

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (pending.length === 0) return;
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

  const actions: OutlineActions = {
    notebookId: notebook.id,
    documentId,
    async addSection(parentId, title) {
      await api("/api/sections", "POST", { notebookId: notebook.id, title, parentId });
      refresh();
    },
    async renameSection(id, title) {
      await api(`/api/sections/${id}`, "PATCH", { title });
      refresh();
    },
    async deleteSection(id) {
      await api(`/api/sections/${id}`, "DELETE");
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
    async addNote(sectionId, content) {
      // A note from the composer lands at the top of its section, and in
      // the open document (SPEC.md §6). It joins the list the moment the
      // server has it, not when the refresh lands: the composer closes in
      // the same frame, so the note is never in neither place.
      const row = await api<Partial<NoteView> & { id?: unknown }>("/api/notes", "POST", {
        sectionId,
        content,
        top: true,
        documentId: documentId ?? undefined,
      });
      if (composedSection.current === sectionId) composedSection.current = null;
      if (row && typeof row.id === "string") {
        const note = localNote(row.id, content, documentId, row);
        setTree((prev) => putBack(prev, { note, sectionId, index: 0 }));
      }
      refresh();
    },
    async addDroppedNote(sectionId, content, from) {
      const row = await api<Partial<NoteView> & { id?: unknown }>("/api/notes", "POST", {
        sectionId,
        content,
        top: from.top,
        ...(from.quote
          ? { source: from.quote.source, ...(from.quote.segments ? { segments: from.quote.segments } : {}) }
          : { documentId: documentId ?? undefined }),
      });
      if (!row || typeof row.id !== "string") {
        refresh();
        return;
      }
      const id = row.id;
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
    async saveNote(id, content) {
      // The card shows the words at once; a failed save puts the old words
      // back and the caller hears why.
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
      try {
        await api(`/api/notes/${id}`, "PATCH", { content });
      } catch (err) {
        if (before !== undefined && before !== content) setContent(before);
        throw err;
      }
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
    async attachSource(id, drag) {
      await api(`/api/notes/${id}`, "PATCH", {
        addSource: { source: drag.source, ...(drag.segments ? { segments: drag.segments } : {}) },
      });
      refresh();
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
    notice,
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
        if (undoId) setLastMerge({ undoId, targetId, count: ids.length + 1, before });
        const content = merged?.content ?? joined;
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
    undoMerge,
    dismissMerge() {
      setLastMerge(null);
      commitDelete();
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

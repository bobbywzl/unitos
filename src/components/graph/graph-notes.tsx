"use client";

import { SECTION_HEAD, TEXT_BODY, TEXT_META } from "./graph-ui";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { EdgeLabelRenderer, type Edge as FlowEdge, type EdgeProps } from "reactflow";
import type { GraphEdge, GraphEdgeLink, SectionView } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { CommentIcon, NotesIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { readGraphKeep, writeGraphKeep } from "@/components/graph/graph-keep";
import { withoutGraphParams } from "@/components/graph/graph-content";
import { useLinkPassages } from "@/components/graph/link-passages";
import { noteLine, notesOnGraph, notesOnLink, pairKey, type GraphNote, type NotesOnGraph } from "@/lib/graph/notes";
import type { Point } from "@/lib/graph/curve-place";
import { useAnyNewReplies } from "@/components/graph/link-replies"; // [layer5]

// The project's notes on the graph (SPEC.md §13). The document stays the
// node; a note shows where it is: a chip on each node it belongs to, its
// lines in the node's card (node-card.tsx), a sage pill on a curve whose two documents
// one note quotes, and a sage dotted curve where only a note joins two
// documents. The Notes list beside the canvas (graph-notes-list.tsx) is a
// lens on the same data: a hovered row lights the documents it quotes, and
// the section filter narrows the chips, the note curves, and the list.
// Everything here reads the workspace's notes; nothing is edited on the graph
// that the tray edits, except a new note on a link (link-note-composer.tsx).

export type GraphNotesInput = {
  sections: SectionView[];
  sectionChoices: { id: string; label: string }[];
  acceptNote: (id: string) => Promise<void>;
  rejectNote: (id: string) => Promise<void>;
};

type GraphNotesValue = {
  notebookId: string;
  /** The notes of the section filter (every section when none). */
  view: NotesOnGraph;
  /** Every note on the graph, whatever the section filter: the note Show on
      graph opened the Notes list on is found even outside the filter. */
  every: NotesOnGraph;
  sectionId: string | null;
  setSectionId: (id: string | null) => void;
  sectionChoices: { id: string; label: string }[];
  /** The section the reader last wrote a note in, else the first. */
  defaultSectionId: string | null;
  /** Light the documents of a hovered or focused note on the canvas; null = none
      (the lit set itself: useGraphNotesLit). */
  setRowLit: (ids: Set<string> | null) => void;
  /** Light the documents of the note Show on graph opened the list on, while
      no row is hovered; null = none. */
  setFocusLit: (ids: Set<string> | null) => void;
  /** The canvas reports its pinned curve ("a|b"); useGraphNotesLit reads it. */
  setPinnedPair: (pair: string | null) => void;
  titleOf: Map<string, string>;
  /** Close the graph, open the reader on the note's first source, and the tray on the note. */
  showNote: (noteId: string) => void;
  /** [ui5] VIEW5-10: Show on a note just saved on the graph (Add to note,
      Note on this link, Save as note): the graph shows it, in the Notes list
      with its documents lit. Without a graph to show it, showNote. */
  showSaved: (noteId: string) => void;
  /** Close the graph and open the reader at a source of a note. */
  openSource: (documentId: string, sourceId: string) => void;
  acceptNote: (id: string) => Promise<void>;
  rejectNote: (id: string) => Promise<void>;
  /** Undo for a Reject: the note goes back to pending (PATCH status PENDING). */
  restoreNote: (id: string) => Promise<void>;
  /** The newest note of a section whose text is this text, made since
      `since` (ms; five minutes of clock slack): a note the offline queue
      saved, once it lands. */
  findNote: (sectionId: string, content: string, since: number) => string | null;
};

const GraphNotesContext = createContext<GraphNotesValue | null>(null);
// What a hovered or focused row lights and the pinned curve change on every
// hover: they ride a context of their own, so the nodes and curves that read
// the notes do not render again for them (REV2-09).
const GraphNotesLitContext = createContext<{ rowLit: Set<string> | null; pinnedPair: string | null }>({
  rowLit: null,
  pinnedPair: null,
});

export function useGraphNotes(): GraphNotesValue | null {
  return useContext(GraphNotesContext);
}

/** The documents a hovered or focused note lights, and the pinned curve's pair. */
export function useGraphNotesLit(): { rowLit: Set<string> | null; pinnedPair: string | null } {
  return useContext(GraphNotesLitContext);
}

export function GraphNotesProvider({
  notebookId,
  nodes,
  input,
  onClose,
  onNavigate,
  onShowHere,
  children,
}: {
  notebookId: string;
  nodes: { id: string; title: string }[];
  input: GraphNotesInput | undefined;
  onClose: () => void;
  /** The graph closes because the URL moved to a document. Default: onClose. */
  onNavigate?: () => void;
  /** [ui5] VIEW5-10: open the Notes list on a note (graph-overlay.tsx). */
  onShowHere?: (noteId: string) => void;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { myId } = useCollab();
  // The section filter survives a trip to a document and Back (WALK2-07).
  const [sectionId, setSectionIdState] = useState<string | null>(() => readGraphKeep(notebookId).sectionId ?? null);
  const setSectionId = useCallback(
    (id: string | null) => {
      setSectionIdState(id);
      writeGraphKeep(notebookId, { sectionId: id });
    },
    [notebookId],
  );
  const [rowLit, setRowLit] = useState<Set<string> | null>(null);
  const [focusLit, setFocusLit] = useState<Set<string> | null>(null);
  const [pinnedPair, setPinnedPair] = useState<string | null>(null);
  const sections = input?.sections;
  const nodeIds = useMemo(() => nodes.map((n) => n.id), [nodes]);
  const titleOf = useMemo(() => new Map(nodes.map((n) => [n.id, n.title])), [nodes]);
  // A section removed elsewhere leaves the filter: every section again.
  const liveSectionId =
    sectionId && input?.sectionChoices.some((c) => c.id === sectionId) ? sectionId : null;
  const every = useMemo(() => notesOnGraph(sections ?? [], nodeIds, null), [sections, nodeIds]);
  const view = useMemo(
    () => (liveSectionId ? notesOnGraph(sections ?? [], nodeIds, liveSectionId) : every),
    [sections, nodeIds, liveSectionId, every],
  );
  const defaultSectionId = useMemo(() => {
    if (!input || input.sectionChoices.length === 0) return null;
    const choices = new Set(input.sectionChoices.map((c) => c.id));
    let best: { id: string; at: number } | null = null;
    const walk = (list: SectionView[]) => {
      for (const s of list) {
        for (const n of s.notes) {
          if (n.createdById !== myId || !choices.has(s.id)) continue;
          const at = Date.parse(n.updatedAt);
          if (!best || at > best.at) best = { id: s.id, at };
        }
        walk(s.children);
      }
    };
    walk(input.sections);
    return (best as { id: string } | null)?.id ?? input.sectionChoices[0].id;
  }, [input, myId]);

  const allNotes = useMemo(() => {
    const byId = new Map<string, GraphNote["note"]>();
    const walk = (list: SectionView[]) => {
      for (const s of list) {
        for (const n of s.notes) byId.set(n.id, n);
        walk(s.children);
      }
    };
    walk(sections ?? []);
    return byId;
  }, [sections]);

  const findNote = useCallback(
    (sectionId: string, content: string, since: number) => {
      const text = content.trim();
      let found: { id: string; at: number } | null = null;
      const walk = (list: SectionView[]) => {
        for (const s of list) {
          if (s.id === sectionId) {
            for (const n of s.notes) {
              const at = n.createdAt ? Date.parse(n.createdAt) : 0;
              if (n.content.trim() !== text || at < since - 5 * 60_000) continue;
              if (!found || at > found.at) found = { id: n.id, at };
            }
          }
          walk(s.children);
        }
      };
      walk(sections ?? []);
      return (found as { id: string } | null)?.id ?? null;
    },
    [sections],
  );
  const restoreNote = useCallback(
    async (id: string) => {
      await api(`/api/notes/${id}`, "PATCH", { status: "PENDING" });
      router.refresh();
    },
    [router],
  );

  const openSource = useCallback(
    (documentId: string, sourceId: string) => {
      router.push(`/n/${notebookId}?doc=${documentId}&src=${sourceId}`);
      (onNavigate ?? onClose)();
    },
    [router, notebookId, onClose, onNavigate],
  );
  const showNote = useCallback(
    (noteId: string) => {
      const note = allNotes.get(noteId);
      const first = note?.sources.find((s) => s.documentId && !s.orphaned && titleOf.has(s.documentId));
      // A document needs the server's render: the router's push (a native
      // push here leaves Back on a URL the reader does not draw).
      if (first) router.push(`/n/${notebookId}?doc=${first.documentId}&src=${first.id}`);
      else if (note?.documentId && titleOf.has(note.documentId)) router.push(`/n/${notebookId}?doc=${note.documentId}`);
      else {
        // A note with no document (WALK3-05): the page stays, a new entry
        // without the graph is pushed, and Back opens the graph again, as
        // after a note with a source.
        const url = withoutGraphParams(new URL(window.location.href));
        url.searchParams.delete("graph");
        // [ui5] WALK5-05: only the graph's parameters leave the URL, so the
        // URL moves now, with no server round trip (Next syncs a native push).
        window.history.pushState(null, "", `${url.pathname}${url.search}`);
      }
      (onNavigate ?? onClose)();
      // The tray sits under the graph: it opens on the note once the graph is gone.
      window.setTimeout(
        () => window.dispatchEvent(new CustomEvent("dissect:show-note", { detail: { noteId } })),
        60,
      );
    },
    [allNotes, titleOf, router, notebookId, onClose, onNavigate],
  );
  // [ui5] VIEW5-10
  const showSaved = useCallback(
    (noteId: string) => (onShowHere ? onShowHere(noteId) : showNote(noteId)),
    [onShowHere, showNote],
  );

  const value = useMemo<GraphNotesValue | null>(
    () =>
      input
        ? {
            notebookId,
            view,
            every,
            sectionId: liveSectionId,
            setSectionId,
            sectionChoices: input.sectionChoices,
            defaultSectionId,
            setRowLit,
            setFocusLit,
            setPinnedPair,
            titleOf,
            showNote,
            showSaved,
            openSource,
            acceptNote: input.acceptNote,
            rejectNote: input.rejectNote,
            restoreNote,
            findNote,
          }
        : null,
    [input, notebookId, view, every, liveSectionId, setSectionId, defaultSectionId, titleOf, showNote, showSaved, openSource, restoreNote, findNote],
  );
  const lit = useMemo(() => ({ rowLit: rowLit ?? focusLit, pinnedPair }), [rowLit, focusLit, pinnedPair]);
  return (
    <GraphNotesContext.Provider value={value}>
      <GraphNotesLitContext.Provider value={lit}>{children}</GraphNotesLitContext.Provider>
    </GraphNotesContext.Provider>
  );
}

// ── Hooks the canvas reads (graph-view.tsx) ────────────────────────────────

/** The documents a hovered note lights; null = no note hovered. */
export function useNotesLit(): Set<string> | null {
  return useContext(GraphNotesLitContext).rowLit;
}

/** True when the section filter is on and no note of the section belongs to the document. */
export function useNodeSectionDim(documentId: string): boolean {
  const ctx = useGraphNotes();
  return Boolean(ctx?.sectionId) && !ctx?.view.byDocument.has(documentId);
}

/** The canvas reports its pinned curve, so the Notes list can show its notes. */
export function useSyncPinnedPair(pinnedEdgeId: string | null): void {
  const setPinnedPair = useGraphNotes()?.setPinnedPair;
  useEffect(() => {
    setPinnedPair?.(pinnedEdgeId);
  }, [pinnedEdgeId, setPinnedPair]);
}

export type NoteEdgeData = { notes: number };

/** A sage dotted curve for every pair of documents that a note joins and no
    link does. Its id is the pair's, as a link curve's is. */
export function useNoteOnlyEdges(edges: GraphEdge[]): FlowEdge<NoteEdgeData>[] {
  const ctx = useGraphNotes();
  const view = ctx?.view;
  const titleOf = ctx?.titleOf;
  const t = useT();
  return useMemo(() => {
    if (!view) return [];
    const linked = new Set(edges.map((e) => pairKey(e.a, e.b)));
    return [...view.byPair.entries()]
      .filter(([key]) => !linked.has(key))
      .map(([key, notes]) => {
        const [a, b] = key.split("|");
        const ariaLabel = t(notes.length === 1 ? "graphNotes.noteCurveLabelOne" : "graphNotes.noteCurveLabel", {
          n: notes.length,
          a: titleOf?.get(a) ?? "",
          b: titleOf?.get(b) ?? "",
        });
        return { id: key, source: a, target: b, type: "note", ariaLabel, data: { notes: notes.length } };
      });
  }, [view, edges, titleOf, t]);
}

// ── Node chip ──────────────────────────────────────────────────────────────

const CARD_ROWS = 5;

/** Right of a node's dot: the number of accepted notes that belong to the
    document, a dot for pending ones; with only pending notes, "1 pending"
    (WALK4-13: never "0"). The notes themselves list in the node's card
    (NodeNotesRows), so a node shows one card (VIEW2-01). */
export function NodeNotes({ documentId }: { documentId: string }) {
  const ctx = useGraphNotes();
  const t = useT();
  const entry = ctx?.view.byDocument.get(documentId);
  if (!ctx || !entry) return null;
  return (
    <span
      data-graph-node-notes={documentId}
      data-tip={t("graphNotes.nodeNotesTitle")}
      className={`flex shrink-0 items-center gap-1 rounded-full bg-sage-100 px-1.5 py-px ${TEXT_META} font-semibold whitespace-nowrap tabular-nums text-sage-800`} /* [ui5] WALK5-15: never wraps */
    >
      <NotesIcon size={10} />
      {entry.accepted === 0 && entry.pending > 0 ? (
        <span data-pending>{t("graphNotes.nodeNotesPending", { n: entry.pending })}</span>
      ) : (
        entry.accepted
      )}
      {entry.accepted > 0 && entry.pending > 0 && (
        <span
          aria-label={t("graphNotes.nodeNotesPending", { n: entry.pending })}
          className="size-1.5 rounded-full bg-clay"
        />
      )}
    </span>
  );
}

/** The node card's notes (graph-view.tsx NodeCard): the newest five notes
    that belong to the document, each a row that shows it in the tray. */
export function NodeNotesRows({ documentId }: { documentId: string }) {
  const ctx = useGraphNotes();
  const t = useT();
  const notes = ctx?.view.byDocument.get(documentId)?.notes;
  if (!ctx || !notes || notes.length === 0) return null;
  const shown = notes.slice(0, CARD_ROWS);
  return (
    <div data-track-surface="graph-node-notes" data-graph-hover-notes className="-mx-1.5 mt-1 flex flex-col gap-0.5 border-t border-line pt-1.5">
      <p className={`px-2 pb-0.5 ${SECTION_HEAD}`}>
        {notes.length === 1 ? t("graphNotes.nodeNotesOne") : t("graphNotes.nodeNotesMany", { n: notes.length })}
      </p>
      {shown.map((g) => (
        <GraphNoteRow key={g.note.id} note={g} hereId={documentId} />
      ))}
      {notes.length > CARD_ROWS && (
        <p className={`px-2 pt-0.5 ${TEXT_META} text-sand-500`}>
          {t("graphNotes.nodeNotesMore", { n: notes.length - CARD_ROWS })}
        </p>
      )}
    </div>
  );
}

/** One note in a list on the graph: its line, its section, and the other
    documents it quotes as chips. A click shows it in the tray; hovering a
    chip lights that document too. */
export function GraphNoteRow({ note: g, hereId }: { note: GraphNote; hereId: string | null }) {
  const ctx = useGraphNotes();
  const t = useT();
  if (!ctx) return null;
  const others = g.documentIds.filter((id) => id !== hereId);
  const lightWith = (id: string | null) =>
    ctx.setRowLit(new Set([...(hereId ? [hereId] : []), ...(id ? [id] : g.documentIds)]));
  return (
    <div
      data-graph-note-row={g.note.id}
      onMouseEnter={() => lightWith(null)}
      onMouseLeave={() => ctx.setRowLit(null)}
      onFocus={() => lightWith(null)}
      onBlur={() => ctx.setRowLit(null)}
      className="flex flex-col gap-1 rounded-xl px-2 py-1.5 hover:bg-sage-100/60"
    >
      <button
        onClick={() => ctx.showNote(g.note.id)}
        data-track="graph-note-show"
        data-tip={t("graphNotes.showNote")}
        className="flex min-h-6 items-start gap-1.5 text-left pointer-coarse:min-h-10"
      >
        <span className={`min-w-0 flex-1 ${TEXT_BODY} leading-snug font-semibold text-ink`}>{noteLine(g.note)}</span>
        {g.note.status === "PENDING" && (
          <span className={`shrink-0 rounded-full border border-dashed border-clay-300 px-1.5 ${TEXT_META} font-semibold text-clay-700`}>
            {t("common.pending")}
          </span>
        )}
      </button>
      <span className="flex flex-wrap items-center gap-1">
        <span className={`${TEXT_META} text-sand-500`}>{g.sectionTitle}</span>
        {others.map((id) => (
          <span
            key={id}
            onMouseEnter={() => lightWith(id)}
            onMouseLeave={() => lightWith(null)}
            className={`max-w-40 truncate rounded-full bg-sand-200 px-2 py-px ${TEXT_META} font-semibold text-sand-700`}
          >
            {ctx.titleOf.get(id) ?? ""}
          </span>
        ))}
      </span>
    </div>
  );
}

/** The notes on a link, in its side panel (WALK3-03): the notes that quote
    both of its passages, each a row that shows it in the tray. Nothing when
    there are none. */
export function LinkNotes({ link }: { link: GraphEdgeLink }) {
  const ctx = useGraphNotes();
  const t = useT();
  const view = ctx?.view;
  const { notebookId } = useParams<{ notebookId?: string }>();
  // The ends' blocks load with the link (COST3-03); until they land, a note
  // matches on the quotes alone.
  const passages = useLinkPassages(notebookId, link);
  const notes = useMemo(() => {
    if (!view) return [];
    const near =
      link.fromDocumentId === link.toDocumentId
        ? (view.byDocument.get(link.fromDocumentId)?.notes ?? [])
        : (view.byPair.get(pairKey(link.fromDocumentId, link.toDocumentId)) ?? []);
    return notesOnLink(near, { ...link, fromBlockText: passages?.from ?? null, toBlockText: passages?.to ?? null });
  }, [view, link, passages]);
  if (!ctx || notes.length === 0) return null;
  return (
    <div data-graph-link-notes={link.id} className="-mx-1.5 flex flex-col gap-0.5 border-t border-line pt-2">
      <p className={`px-2 pb-0.5 ${SECTION_HEAD}`}>
        {notes.length === 1 ? t("graphNotes.linkNotesOne") : t("graphNotes.linkNotesMany", { n: notes.length })}
      </p>
      {notes.map((g) => (
        <GraphNoteRow key={g.note.id} note={g} hereId={null} />
      ))}
    </div>
  );
}

// ── Curves ─────────────────────────────────────────────────────────────────

/** "Notes quoting both" in a curve's list: the notes that join its pair. */
export function PairNotes({ pair }: { pair: string }) {
  const ctx = useGraphNotes();
  const t = useT();
  const notes = ctx?.view.byPair.get(pair);
  if (!notes || notes.length === 0) return null;
  return (
    <div data-graph-pair-notes={pair} className="mt-1 border-t border-line pt-1">
      <p className={`px-2 pt-0.5 pb-0.5 ${SECTION_HEAD}`}>
        {t("graphNotes.pairNotes")}
      </p>
      <div className="max-h-56 overflow-y-auto">
        {notes.map((g) => (
          <GraphNoteRow key={g.note.id} note={g} hereId={null} />
        ))}
      </div>
    </div>
  );
}

/** Where each curve's marks sit, by curve id: the canvas places them all
    at once, so they keep off the nodes and off each other (curve-place.ts). */
export const MarkPlacesContext = createContext<Map<string, Point>>(new Map());

/** The open replies on a curve's links. */
export function openReplies(links: GraphEdgeLink[]): number {
  return links.reduce((n, l) => n + (l.replies ?? []).filter((r) => r.resolvedById === null).length, 0);
}

/** The marks' row width on screen at scale 1: the count pill (more than
    one link), the replies mark, the notes pill, 4 px apart. */
export function marksWidth(count: number, open: number, notes: number): number {
  const parts = [
    count > 1 ? 14 + String(count).length * 7 : 0,
    open > 0 ? 32 + String(open).length * 6 : 0,
    notes > 1 ? 32 + String(notes).length * 6 : notes > 0 ? 24 : 0,
  ].filter((w) => w > 0);
  return parts.reduce((a, b) => a + b, 0) + Math.max(0, parts.length - 1) * 4;
}

/** On a curve, above the nodes (the HTML label layer; VIEW3-01): the link
    count when the pair has more than one, the open replies on the pair's
    links (the comment glyph and the number, in the comment kind color), and
    the notes that quote both documents (a sage pill). They ride the curve's
    middle, or slide along it to the first point no node's room covers
    (curve-place.ts; the canvas places them, MarkPlacesContext); a loop's
    sit at its top. Hovering them lights the curve, and a click pins its
    list, as on the curve itself. */
export function CurveMarks({
  pair,
  links,
  count,
  at,
  waits = false,
  onEnter,
  onLeave,
  onClick,
}: {
  pair: string;
  links: GraphEdgeLink[];
  /** The pair's link count: a pill when more than one. */
  count: number;
  /** Where the marks sit until the canvas has placed them. */
  at: Point;
  /** [style9] VIEW9-01: one of the pair's links waits on this account
      (useWaitsForReply, the rule the head and the Links list keep): the
      replies mark ends with "?", as a node's comments chip does. */
  waits?: boolean;
  onEnter?: () => void;
  onLeave?: () => void;
  onClick?: () => void;
}) {
  const ctx = useGraphNotes();
  const t = useT();
  const places = useContext(MarkPlacesContext);
  const open = openReplies(links);
  const fresh = useAnyNewReplies(links); // [layer5] WALK5-07
  const notes = ctx?.view.byPair.get(pair)?.length ?? 0;
  const showCount = count > 1;
  if (!showCount && open === 0 && notes === 0) return null;
  const p = places.get(pair) ?? at;
  const pill = `flex h-[18px] items-center gap-1 rounded-full px-1.5 ${TEXT_META} font-semibold tabular-nums`;
  return (
    <EdgeLabelRenderer>
      <div
        data-curve-marks={pair}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
        }}
        className="graph-curve-marks nodrag nopan absolute cursor-pointer"
        style={{ transform: `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)` }}
      >
        <div className="graph-edge-pill flex items-center gap-1">
          {showCount && (
            <span data-graph-curve-mark="count" className={`${pill} justify-center border border-line bg-card text-sand-700`}>
              {count}
            </span>
          )}
          {open > 0 && (
            <span
              data-graph-curve-mark="replies"
              data-tip={t("graphNotes.openRepliesTitle")}
              aria-label={`${t("graphNotes.openRepliesTitle")}: ${open}`}
              className={`${pill} border-[1.5px] border-[var(--kind-comment)] bg-card font-bold text-[var(--kind-comment)]`}
            >
              <CommentIcon size={11} />
              <span data-n>{open}</span>
              {waits && (
                <span data-graph-curve-waits aria-label={t("graphCover.commentWaitsTitle")} className="-ml-0.5">
                  ?
                </span>
              )}
              {/* [layer5] A reply another person wrote since this account last opened the link. */}
              {fresh && (
                <span data-graph-curve-new aria-label={t("graphCover.newRepliesTitle")} className="size-1.5 rounded-full bg-[var(--kind-comment)]" />
              )}
            </span>
          )}
          {notes > 0 && (
            <span
              data-graph-curve-mark="notes"
              data-tip={t("graphNotes.pairNotesTitle")}
              aria-label={`${t("graphNotes.pairNotesTitle")}: ${notes}`}
              className={`${pill} border border-dashed border-sage-500 bg-sage-100 text-sage-800`}
            >
              <NotesIcon size={11} />
              {/* One note: the mark alone, as the link count shows from two (VIEW3-08). */}
              {notes > 1 && <span data-n>{notes}</span>}
            </span>
          )}
        </div>
      </div>
    </EdgeLabelRenderer>
  );
}

// The same pseudo-random bow a link curve takes (graph-view.tsx's seeded).
function seededBow(id: string): number {
  let h = 3;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 999) * 2 - 1;
}

/** A note curve's control point: it bows sideways from the middle. */
export function noteControl(id: string, s: Point, e: Point): Point {
  return { x: (s.x + e.x) / 2 + seededBow(id) * 46 + (e.x - s.x) * 0.14, y: (s.y + e.y) / 2 };
}

/** The sage dotted curve of a pair that only notes join: no gradient, no
    marching. Hovered or pinned (listOpen), it lists the notes quoting both.
    Its spotlight (lit, dim) is the canvas's CSS, never a render. */
export function NoteEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  listOpen,
  renderList,
  marks,
}: EdgeProps<NoteEdgeData> & {
  listOpen: boolean;
  /** The marks' hover and click: those of the curve (graph-view.tsx). */
  marks?: { onEnter: () => void; onLeave: () => void; onClick: () => void };
  /** Draws the list where the canvas puts a curve's list (graph-view.tsx). */
  renderList: (anchor: { x: number; y: number }, children: React.ReactNode) => React.ReactNode;
}) {
  const t = useT();
  const c = noteControl(id, { x: sourceX, y: sourceY }, { x: targetX, y: targetY });
  const bow = c.x - (sourceX + targetX) / 2;
  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2;
  const path = `M ${sourceX} ${sourceY} Q ${midX + bow} ${midY} ${targetX} ${targetY}`;
  return (
    <g data-graph-note-curve={id} className="graph-note-curve">
      <title>{t("graphNotes.noteCurveHint")}</title>
      <path d={path} fill="none" stroke="var(--sage-500)" strokeLinecap="round" strokeDasharray="1.5 6" className="graph-note-stroke" />
      <path d={path} fill="none" stroke="transparent" strokeWidth={16} className="react-flow__edge-interaction graph-edge-hit" />
      <CurveMarks
        pair={id}
        links={[]}
        count={0}
        at={{ x: midX + bow / 2, y: midY }}
        {...marks}
      />
      {listOpen &&
        renderList(
          { x: midX + bow / 2, y: midY },
          <>
            <p className={`px-2 pt-0.5 ${TEXT_META} text-sand-500`}>{t("graphNotes.noteCurveHint")}</p>
            <PairNotes pair={id} />
          </>,
        )}
    </g>
  );
}

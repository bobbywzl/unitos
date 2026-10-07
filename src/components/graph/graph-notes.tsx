"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { type Edge as FlowEdge, type EdgeProps } from "reactflow";
import type { GraphEdge, GraphEdgeLink, SectionView } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { CommentIcon, NotesIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { readGraphKeep, writeGraphKeep } from "@/components/graph/graph-keep";
import { noteLine, notesOnGraph, pairKey, type GraphNote, type NotesOnGraph } from "@/lib/graph/notes";

// The project's notes on the graph (SPEC.md §13). The document stays the
// node; a note shows where it is: a chip on each node it belongs to, a card
// of its notes on a node's hover, a sage pill on a curve whose two documents
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
  sectionId: string | null;
  setSectionId: (id: string | null) => void;
  sectionChoices: { id: string; label: string }[];
  /** The section the reader last wrote a note in, else the first. */
  defaultSectionId: string | null;
  /** Light the documents of a hovered or focused note on the canvas; null = none
      (the lit set itself: useGraphNotesLit). */
  setRowLit: (ids: Set<string> | null) => void;
  /** The canvas reports its pinned curve ("a|b"); useGraphNotesLit reads it. */
  setPinnedPair: (pair: string | null) => void;
  titleOf: Map<string, string>;
  /** Close the graph, open the reader on the note's first source, and the tray on the note. */
  showNote: (noteId: string) => void;
  /** Close the graph and open the reader at a source of a note. */
  openSource: (documentId: string, sourceId: string) => void;
  acceptNote: (id: string) => Promise<void>;
  rejectNote: (id: string) => Promise<void>;
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
  children,
}: {
  notebookId: string;
  nodes: { id: string; title: string }[];
  input: GraphNotesInput | undefined;
  onClose: () => void;
  /** The graph closes because the URL moved to a document. Default: onClose. */
  onNavigate?: () => void;
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
  const [pinnedPair, setPinnedPair] = useState<string | null>(null);
  const sections = input?.sections;
  const nodeIds = useMemo(() => nodes.map((n) => n.id), [nodes]);
  const titleOf = useMemo(() => new Map(nodes.map((n) => [n.id, n.title])), [nodes]);
  // A section removed elsewhere leaves the filter: every section again.
  const liveSectionId =
    sectionId && input?.sectionChoices.some((c) => c.id === sectionId) ? sectionId : null;
  const view = useMemo(
    () => notesOnGraph(sections ?? [], nodeIds, liveSectionId),
    [sections, nodeIds, liveSectionId],
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
      if (first) router.push(`/n/${notebookId}?doc=${first.documentId}&src=${first.id}`);
      else if (note?.documentId && titleOf.has(note.documentId)) router.push(`/n/${notebookId}?doc=${note.documentId}`);
      if (first || (note?.documentId && titleOf.has(note.documentId))) (onNavigate ?? onClose)();
      else onClose();
      // The tray sits under the graph: it opens on the note once the graph is gone.
      window.setTimeout(
        () => window.dispatchEvent(new CustomEvent("dissect:show-note", { detail: { noteId } })),
        60,
      );
    },
    [allNotes, titleOf, router, notebookId, onClose, onNavigate],
  );

  const value = useMemo<GraphNotesValue | null>(
    () =>
      input
        ? {
            notebookId,
            view,
            sectionId: liveSectionId,
            setSectionId,
            sectionChoices: input.sectionChoices,
            defaultSectionId,
            setRowLit,
            setPinnedPair,
            titleOf,
            showNote,
            openSource,
            acceptNote: input.acceptNote,
            rejectNote: input.rejectNote,
          }
        : null,
    [input, notebookId, view, liveSectionId, setSectionId, defaultSectionId, titleOf, showNote, openSource],
  );
  const lit = useMemo(() => ({ rowLit, pinnedPair }), [rowLit, pinnedPair]);
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

// ── Node chip and hover card ───────────────────────────────────────────────

const CARD_ROWS = 5;

/** Right of a node's dot: the number of accepted notes that belong to the
    document, a dot for pending ones. The notes themselves list in the node's
    card (NodeNotesRows), so a node shows one card (VIEW2-01). */
export function NodeNotes({ documentId }: { documentId: string }) {
  const ctx = useGraphNotes();
  const t = useT();
  const entry = ctx?.view.byDocument.get(documentId);
  if (!ctx || !entry) return null;
  return (
    <span
      data-graph-node-notes={documentId}
      data-tip={t("graphNotes.nodeNotesTitle")}
      className="flex items-center gap-1 rounded-full bg-sage-100 px-1.5 py-px text-[10px] font-semibold tabular-nums text-sage-800"
    >
      <NotesIcon size={10} />
      {entry.accepted}
      {entry.pending > 0 && (
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
    <div data-track-surface="graph-node-notes" className="-mx-1.5 mt-1 flex flex-col gap-0.5 border-t border-line pt-1.5">
      <p className="px-2 pb-0.5 text-[11px] font-bold tracking-[0.06em] text-sage-700 uppercase">
        {notes.length === 1 ? t("graphNotes.nodeNotesOne") : t("graphNotes.nodeNotesMany", { n: notes.length })}
      </p>
      {shown.map((g) => (
        <GraphNoteRow key={g.note.id} note={g} hereId={documentId} />
      ))}
      {notes.length > CARD_ROWS && (
        <p className="px-2 pt-0.5 text-[11px] text-sand-500">
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
        className="flex items-start gap-1.5 text-left"
      >
        <span className="min-w-0 flex-1 text-[12.5px] leading-snug font-semibold text-ink">{noteLine(g.note)}</span>
        {g.note.status === "PENDING" && (
          <span className="shrink-0 rounded-full border border-dashed border-clay-300 px-1.5 text-[10px] font-semibold text-clay-700">
            {t("common.pending")}
          </span>
        )}
      </button>
      <span className="flex flex-wrap items-center gap-1">
        <span className="text-[10.5px] text-sand-500">{g.sectionTitle}</span>
        {others.map((id) => (
          <span
            key={id}
            onMouseEnter={() => lightWith(id)}
            onMouseLeave={() => lightWith(null)}
            className="max-w-40 truncate rounded-full bg-sand-200 px-2 py-px text-[10.5px] font-semibold text-sand-700"
          >
            {ctx.titleOf.get(id) ?? ""}
          </span>
        ))}
      </span>
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
      <p className="px-2 pt-0.5 pb-0.5 text-[11px] font-bold tracking-[0.06em] text-sage-700 uppercase">
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

/** Beside a curve's count pill: the open replies on the pair's links (the
    comment glyph and the number), then the notes that quote both documents
    (a sage pill). x, y: the count pill's center; offset: half its width, 0
    when there is none. */
export function CurveMarks({
  pair,
  links,
  x,
  y,
  offset,
}: {
  pair: string;
  links: GraphEdgeLink[];
  x: number;
  y: number;
  offset: number;
}) {
  const ctx = useGraphNotes();
  const t = useT();
  const open = links.reduce((n, l) => n + (l.replies ?? []).filter((r) => r.resolvedById === null).length, 0);
  const notes = ctx?.view.byPair.get(pair)?.length ?? 0;
  if (open === 0 && notes === 0) return null;
  const marks: { kind: "replies" | "notes"; n: number }[] = [
    ...(open > 0 ? [{ kind: "replies" as const, n: open }] : []),
    ...(notes > 0 ? [{ kind: "notes" as const, n: notes }] : []),
  ];
  let at = x + (offset > 0 ? offset + 4 : -((marks.length - 1) * 38) / 2 - 17);
  return (
    <g>
      {marks.map((m) => {
        const w = 30 + String(m.n).length * 6;
        const left = at;
        at += w + 4;
        const replies = m.kind === "replies";
        return (
          <g key={m.kind} transform={`translate(${left}, ${y - 9})`} data-graph-curve-mark={m.kind}>
            <title>{replies ? t("graphNotes.openRepliesTitle") : t("graphNotes.pairNotesTitle")}</title>
            <rect
              width={w}
              height={18}
              rx={9}
              fill={replies ? "var(--card)" : "var(--sage-100)"}
              stroke={replies ? "var(--sand-400)" : "var(--sage-300)"}
            />
            <g transform="translate(6, 3)" className={replies ? "text-sand-700" : "text-sage-700"}>
              {replies ? <CommentIcon size={12} /> : <NotesIcon size={12} />}
            </g>
            <text
              x={21}
              y={9}
              dominantBaseline="central"
              fontSize={10}
              fontWeight={600}
              fill={replies ? "var(--sand-700)" : "var(--sage-800)"}
            >
              {m.n}
            </text>
          </g>
        );
      })}
    </g>
  );
}

// The same pseudo-random bow a link curve takes (graph-view.tsx's seeded).
function seededBow(id: string): number {
  let h = 3;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 999) * 2 - 1;
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
}: EdgeProps<NoteEdgeData> & {
  listOpen: boolean;
  /** Draws the list where the canvas puts a curve's list (graph-view.tsx). */
  renderList: (anchor: { x: number; y: number }, children: React.ReactNode) => React.ReactNode;
}) {
  const t = useT();
  const bow = seededBow(id) * 46 + (targetX - sourceX) * 0.14;
  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2;
  const path = `M ${sourceX} ${sourceY} Q ${midX + bow} ${midY} ${targetX} ${targetY}`;
  return (
    <g data-graph-note-curve={id} className="graph-note-curve">
      <title>{t("graphNotes.noteCurveHint")}</title>
      <path d={path} fill="none" stroke="var(--sage-500)" strokeLinecap="round" strokeDasharray="1.5 6" className="graph-note-stroke" />
      <path d={path} fill="none" stroke="transparent" strokeWidth={16} className="react-flow__edge-interaction graph-edge-hit" />
      <CurveMarks pair={id} links={[]} x={midX + bow / 2} y={midY} offset={0} />
      {listOpen &&
        renderList(
          { x: midX + bow / 2, y: midY },
          <>
            <p className="px-2 pt-0.5 text-[11px] text-sand-500">{t("graphNotes.noteCurveHint")}</p>
            <PairNotes pair={id} />
          </>,
        )}
    </g>
  );
}

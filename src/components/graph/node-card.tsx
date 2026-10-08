"use client";

// [view2] The node card (SPEC.md §13): a click on a node selects it, and its
// card pins beside the canvas — a sheet at the foot on a phone. It says what
// the document is about (the skeleton's gist and part summaries, written by
// AI and marked so), its contents with a jump to each part, its links
// grouped by the other document with each link's reason, the part it sits
// in, and its replies, and its notes. It counts and lists what the canvas
// draws: the provenance of generated documents only while the provenance
// switch is on (WALK3-02). Open in reader and Pick for Stitch act on it; a
// click on another document's chip moves the card there, a click on a link
// opens it in the side panel, whose Back returns here (VIEW3-03), and ← →
// walk the links. Everything is read from what is stored (GET .../outline):
// the card never calls a model.

import { CLOSE, DOC_CHIP, HEAD_PLAIN, LEAD, LEAD_PRIMARY, SECTION_HEAD } from "./graph-ui";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { GraphEdge, GraphEdgeLink, GraphNode } from "@/lib/types";
import type { DocumentOutline } from "@/lib/graph/outline";
import { useCollab } from "@/components/collab/collab-context";
import { useT } from "@/components/lang-provider";
import { clipWords } from "@/lib/markdown-preview";
import { GraphNoteRow, useGraphNotes } from "@/components/graph/graph-notes";
import { noteLine } from "@/lib/graph/notes";
import { useCoarsePointer, useGraphContent } from "@/components/graph/graph-content";
import { LinkReplyCount } from "@/components/graph/link-replies";
import { LinkDraftTag } from "@/components/graph/link-draft-tag"; // [ui5]
import { useWantProvenance } from "@/components/graph/provenance-want";
import { PartDot } from "@/components/graph/coverage"; // [cover4]
import { AddToNote } from "@/components/graph/note-gather"; // [cover4]
import { NodeCommentsLine } from "@/components/graph/coverage"; // [layer5]

const outlines = new Map<string, DocumentOutline>();
const NOTE_ROWS = 6;
const GROUP_ROWS = 2;

/** One document's outline, from the tab's cache at once, then fresh. */
function useOutline(notebookId: string, documentId: string, version: unknown): DocumentOutline | null {
  const key = `${notebookId}:${documentId}`;
  const [state, setState] = useState<{ key: string; outline: DocumentOutline | null }>(() => ({
    key,
    outline: outlines.get(key) ?? null,
  }));
  if (state.key !== key) setState({ key, outline: outlines.get(key) ?? null });
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/notebooks/${notebookId}/outline?documentId=${encodeURIComponent(documentId)}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? (r.json() as Promise<DocumentOutline>) : null))
      .then((o) => {
        if (!o) return;
        outlines.set(key, o);
        setState({ key, outline: o });
      })
      .catch(() => undefined);
    return () => controller.abort();
    // version: the graph's data refetched (a link accepted, a page written):
    // the card's link parts follow (REV3-10).
  }, [notebookId, documentId, key, version]);
  return state.key === key ? state.outline : null;
}

type Group = { other: string; links: GraphEdgeLink[]; accepted: number; recommended: number };

/** The node's links grouped by the other document, most links first; a
    loop (links inside the document) last. A generated document's
    provenance links only with the provenance switch on, as the canvas
    draws them (WALK3-02). */
export function linkGroups(edges: GraphEdge[], id: string, showProvenance = false): Group[] {
  const out: Group[] = [];
  for (const e of edges) {
    if (e.a !== id && e.b !== id) continue;
    const links = showProvenance ? e.links : e.links.filter((l) => !l.provenance);
    if (links.length === 0) continue;
    out.push({ other: e.a === id ? e.b : e.a, links, accepted: e.accepted, recommended: e.recommended });
  }
  return out.sort((x, y) => Number(x.other === id) - Number(y.other === id) || y.links.length - x.links.length);
}

/** "3 links · 1 recommended": accepted links, then the recommended ones,
    the same count the hover card and the node's name give (WALK3-08). */
export function linkLine(t: ReturnType<typeof useT>, accepted: number, recommended: number): string {
  const head = t("panes.graphCardLinks", { n: accepted, s: accepted === 1 ? "" : "s" });
  const rec = t("panes.graphCardRecommended", { n: recommended });
  return recommended === 0 ? head : accepted === 0 ? rec : `${head} · ${rec}`;
}

export function NodeCardPanel({
  notebookId,
  node,
  nodes,
  edges,
  picked,
  onPick,
  onOpenDocument,
  onClose,
  sheet,
  onSheetHeight,
}: {
  notebookId: string;
  node: GraphNode;
  nodes: GraphNode[];
  edges: GraphEdge[];
  picked: boolean;
  onPick?: () => void;
  onOpenDocument: () => void;
  onClose: () => void;
  /** A phone: the card is a sheet at the foot of the canvas. */
  sheet: boolean;
  onSheetHeight: (height: number) => void;
}) {
  const t = useT();
  const router = useRouter();
  const { canEdit } = useCollab();
  const notesCtx = useGraphNotes();
  const { select, proposedLinkIds, showProvenance, generatedCommands, openLinkFromCard } = useGraphContent();
  const coarse = useCoarsePointer();
  const outline = useOutline(notebookId, node.id, edges);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  const [showAllNotes, setShowAllNotes] = useState(false);
  // The card stays mounted while the selection walks (its trail with it);
  // what was unfolded for one document folds for the next.
  const [shownId, setShownId] = useState(node.id);
  if (shownId !== node.id) {
    setShownId(node.id);
    setOpenGroups(new Set());
    setShowAllNotes(false);
  }
  const titleOf = useMemo(() => new Map(nodes.map((n) => [n.id, n.title])), [nodes]);
  const groups = useMemo(() => linkGroups(edges, node.id, showProvenance), [edges, node.id, showProvenance]);
  // COST3-03: a card lists its document's provenance links only while the
  // switch shows them; they load then.
  useWantProvenance(showProvenance && edges.some((e) => (e.a === node.id || e.b === node.id) && (e.provenance ?? 0) > 0), "card");
  const notes = notesCtx?.view.byDocument.get(node.id)?.notes ?? [];
  const acceptedCount = groups.reduce((s, g) => s + g.accepted, 0);
  const recommendedCount = groups.reduce((s, g) => s + g.recommended, 0);
  const generated = node.kind === "generated";
  const command = generatedCommands.get(node.id) ?? null;

  // ← → walk the links: → goes to the most linked document not just come
  // from, ← goes back the way the walk came.
  // A key that cannot walk says why (REV3-09); Alt+← and the other
  // modified arrows stay the browser's.
  const trail = useRef<string[]>([]);
  const [walkNote, setWalkNote] = useState<string | null>(null);
  if (shownId !== node.id && walkNote) setWalkNote(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)
      )
        return;
      const others = groups.filter((g) => g.other !== node.id);
      if (e.key === "ArrowLeft") {
        const back = trail.current.pop();
        e.preventDefault();
        if (!back) {
          setWalkNote(t(others.length === 0 ? "graphView.cardWalkNone" : "graphView.cardWalkStart"));
          return;
        }
        setWalkNote(null);
        select(back);
        return;
      }
      const came = trail.current[trail.current.length - 1];
      const next = others.find((g) => g.other !== came)?.other ?? others[0]?.other;
      e.preventDefault();
      if (!next) {
        setWalkNote(t("graphView.cardWalkNone"));
        return;
      }
      setWalkNote(null);
      trail.current.push(node.id);
      select(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [groups, node.id, select, t]);

  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !sheet) {
      onSheetHeight(0);
      return;
    }
    const observer = new ResizeObserver(() => onSheetHeight(Math.round(el.getBoundingClientRect().height)));
    observer.observe(el);
    return () => {
      observer.disconnect();
      onSheetHeight(0);
    };
  }, [sheet, onSheetHeight]);

  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [node.id]);

  function go(href: string) {
    router.push(href);
    onOpenDocument();
  }
  const facts = [
    node.blockCount !== undefined ? t("panes.graphCardBlocks", { n: node.blockCount, s: node.blockCount === 1 ? "" : "s" }) : null,
    linkLine(t, acceptedCount, recommendedCount),
    t("graphView.cardNotes", { n: notes.length, s: notes.length === 1 ? "" : "s" }),
  ].filter(Boolean);
  // [style7] Figtree like every other panel head (an h3 takes Caprasimo by default).
  const head = `mb-1.5 ${SECTION_HEAD}`;

  return (
    <aside
      ref={ref}
      data-track-surface="sidebar"
      data-graph-node-card={node.id}
      data-graph-sheet={sheet ? "" : undefined}
      aria-label={node.title}
      onClick={(e) => e.stopPropagation()}
      className={`menu-in absolute z-10 flex flex-col gap-3 overflow-y-auto overscroll-contain border border-line bg-card/95 p-4 shadow-float backdrop-blur-md ${
        sheet
          ? "inset-x-3 bottom-16 max-h-[60%] rounded-[20px]" // [lists7] VIEW7-09: above the Stitch pill
          : // [panel6] The card is as tall as what it holds (WALK6-08), at most the
            // canvas less its margins (Feedback hides while the graph is open).
            "top-3 right-3 max-h-[calc(100%-24px)] w-[400px] max-w-[calc(100vw-24px)] rounded-[20px] max-[999px]:max-h-[calc(100%-76px)]"
      }`}
    >
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 text-[16px] leading-snug font-semibold text-ink">{node.title}</h2>
        <button
          onClick={onClose}
          aria-label={t("common.close")}
          data-tip={t("common.close")}
          className={CLOSE}
        >
          ✕
        </button>
      </div>
      <p className="-mt-2 text-[11.5px] text-sand-600">{facts.join(" · ")}</p>
      {/* [layer5] The reader's comments: one line that opens into them (VIEW5-01). */}
      {node.kind !== "generated" && <NodeCommentsLine notebookId={notebookId} documentId={node.id} onOpenDocument={onOpenDocument} />}
      {/* A generated document says so, and which command wrote it (WALK3-09). */}
      {generated && (
        <p data-graph-card-generated className="-mt-1.5 rounded-xl bg-sand-100 px-3 py-2 text-[12px] leading-snug text-sand-700">
          {command ? t("graphView.cardGeneratedFrom", { command }) : t("graphView.cardGenerated")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => go(`/n/${notebookId}?doc=${node.id}`)}
          data-track="graph-card-open"
          data-tip={t("graphView.cardOpenTitle")}
          className={LEAD_PRIMARY}
        >
          {t("graphView.cardOpen")}
        </button>
        {canEdit && onPick && (
          <button
            onClick={onPick}
            data-track="graph-card-pick"
            aria-pressed={picked}
            className={`${LEAD} hover:bg-clay-100 hover:text-clay-800 ${
              picked ? "border-clay bg-clay-100 text-clay-800" : "border-line text-sand-700"
            }`}
          >
            {picked ? `${t("graphView.cardPicked")} ✓` : t("graphView.cardPick")}
          </button>
        )}
      </div>

      {outline === null ? (
        <p className="text-[12.5px] text-sand-500">{t("graphView.cardLoading")}</p>
      ) : (
        <>
          {outline.gist ? (
            <p data-graph-gist className="rounded-xl bg-sand-100 px-3 py-2 text-[13px] leading-relaxed text-ink">
              {outline.gist}
            </p>
          ) : (
            <p data-graph-no-summary className="text-[12px] leading-snug text-sand-500">
              {t("graphView.cardNoSummary")}
            </p>
          )}
          {outline.parts.length > 0 && (
            <section>
              <h3 style={HEAD_PLAIN} className={head}>{t("graphView.cardContents")}</h3>
              <ol className="flex flex-col gap-0.5">
                {outline.parts.map((p) => (
                  <li key={p.blockId} className={`flex items-start gap-1 ${p.level === 2 ? "pl-3" : ""}`}>
                    <button
                      onClick={() => go(`/n/${notebookId}?doc=${node.id}&block=${p.blockId}`)}
                      data-track="graph-card-part"
                      data-graph-part={p.blockId}
                      data-tip={t("graphView.cardPartTitle")}
                      className="block min-w-0 flex-1 rounded-lg px-1.5 py-1 text-left hover:bg-clay-100/60"
                    >
                      <span className="block text-[12.5px] leading-snug font-semibold text-ink">
                        <PartDot documentId={node.id} blockId={p.blockId} /* [cover4] */ />
                        {p.title}
                      </span>
                      {p.summary && <span className="mt-0.5 block text-[12px] leading-snug text-sand-600">{p.summary}</span>}
                    </button>
                    {/* [cover4] The part's opening words as a quote (VIEW4-03). */}
                    <AddToNote quote={{ documentId: node.id, blockId: p.blockId, text: p.title, whole: true }} className="mt-1" />
                  </li>
                ))}
              </ol>
            </section>
          )}
          {(outline.gist || outline.parts.some((p) => p.summary)) && (
            <p className="-mt-1.5 text-[11px] text-sand-500">{t("graphView.cardAiLine")}</p>
          )}
        </>
      )}

      {groups.length > 0 && (
        <section>
          <h3 style={HEAD_PLAIN} className={head}>{t("graphView.cardLinks")}</h3>
          <div className="flex flex-col gap-2">
            {groups.map((g) => {
              const loop = g.other === node.id;
              const open = openGroups.has(g.other);
              // The answer's links first, then the rest in their order.
              const ordered = [...g.links].sort((x, y) => Number(proposedLinkIds.has(y.id)) - Number(proposedLinkIds.has(x.id)));
              return (
                <div key={g.other} data-graph-card-group={g.other} className="rounded-xl border border-line p-2.5">
                  <div className="flex items-center gap-2">
                    {loop ? (
                      <span className="text-[12.5px] font-semibold text-sand-700">{t("graphView.cardWithin")}</span>
                    ) : (
                      <button
                        onClick={() => {
                          trail.current.push(node.id);
                          select(g.other);
                        }}
                        data-track="graph-card-neighbour"
                        data-tip={t("graphView.cardNeighbourTitle")}
                        className={DOC_CHIP}
                      >
                        {titleOf.get(g.other) ?? ""}
                      </button>
                    )}
                    <span className="ml-auto shrink-0 text-[11px] text-sand-500">{linkLine(t, g.accepted, g.recommended)}</span>
                  </div>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {(open ? ordered : ordered.slice(0, GROUP_ROWS)).map((l) => {
                      const partIndex = outline?.linkParts[l.id];
                      const part = partIndex !== undefined ? outline?.parts[partIndex] : undefined;
                      const proposed = proposedLinkIds.has(l.id);
                      return (
                        <li key={l.id}>
                          <button
                            onClick={() => openLinkFromCard(l.id)}
                            data-track="graph-card-link"
                            data-graph-card-link={l.id}
                            data-tip={t("panes.linkExpand")}
                            className={`block w-full rounded-lg px-1.5 py-1 text-left hover:bg-clay-100/60 ${
                              l.recommended ? "border-l-2 border-dashed border-clay-300" : ""
                            }`}
                          >
                            {proposed && (
                              <span className="mb-0.5 block text-[10.5px] font-semibold text-[var(--kind-assistant)]">
                                {t("graphView.fromLastAnswer")}
                              </span>
                            )}
                            <span className="block text-[12px] leading-snug text-ink">
                              {l.reason ?? clipWords(l.quotedText, 60)}
                              <LinkDraftTag linkId={l.id} className="ml-1.5" /* [ui5] WALK5-13 */ />
                            </span>
                            {part && (
                              <span className="mt-0.5 block text-[11px] text-sand-500">
                                {t("graphView.cardInPart", { part: part.title })}
                              </span>
                            )}
                            {l.provenance && (
                              <span className="mt-0.5 inline-block rounded-full bg-sand-200/80 px-1.5 text-[10px] font-semibold text-sand-700">
                                {t("panes.graphProvenanceTag")}
                              </span>
                            )}
                            <LinkReplyCount link={l} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {g.links.length > GROUP_ROWS && !open && (
                    <button
                      onClick={() => setOpenGroups((prev) => new Set(prev).add(g.other))}
                      className="mt-1 min-h-6 px-1.5 text-[11.5px] text-clay-700 hover:underline pointer-coarse:min-h-10"
                    >
                      {t("graphView.cardMore", { n: g.links.length - GROUP_ROWS })}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {notes.length > 0 && (
        <section>
          <h3 style={HEAD_PLAIN} className={head}>{t("graphView.cardNotesHead")}</h3>
          <div className="flex flex-col gap-0.5">
            {(showAllNotes ? notes : notes.slice(0, NOTE_ROWS)).map((n) => (
              <GraphNoteRow key={n.note.id} note={n} hereId={node.id} />
            ))}
          </div>
          {notes.length > NOTE_ROWS && !showAllNotes && (
            <button onClick={() => setShowAllNotes(true)} className="mt-1 min-h-6 px-2 text-[11.5px] text-clay-700 hover:underline pointer-coarse:min-h-10">
              {t("graphView.cardMore", { n: notes.length - NOTE_ROWS })}
            </button>
          )}
        </section>
      )}
      <p role="status" data-graph-card-walk className="text-[12px] text-clay-800 empty:hidden">
        {walkNote}
      </p>
      {!sheet && !coarse && <p className="text-[11px] text-sand-500">{t("graphView.cardKeys")}</p>}
    </aside>
  );
}

/** The hover card's content lines (graph-view.tsx NodeCard): the gist's
    first words and the node's notes, one card per node (VIEW2-01). */
export function NodeCardExtras({ documentId, notes: withNotes = true }: { documentId: string; notes?: boolean }) {
  const t = useT();
  const { gists } = useGraphContent();
  const notes = useGraphNotes()?.view.byDocument.get(documentId)?.notes ?? [];
  const gist = gists[documentId];
  return (
    <>
      {gist && (
        <p data-graph-hover-gist className="mt-0.5 text-[12px] leading-snug text-ink">
          {gist.length > 140 ? `${gist.slice(0, 140).replace(/\s+\S*$/, "")}…` : gist}
        </p>
      )}
      {withNotes && notes.length > 0 && (
        <div data-graph-hover-notes className="mt-1 flex flex-col gap-0.5 border-t border-line pt-1.5">
          <p className={SECTION_HEAD}>
            {notes.length === 1 ? t("graphNotes.nodeNotesOne") : t("graphNotes.nodeNotesMany", { n: notes.length })}
          </p>
          {notes.slice(0, 3).map((g) => (
            <p key={g.note.id} className="truncate text-[11.5px] text-sand-700">
              {noteLine(g.note)}
            </p>
          ))}
          {notes.length > 3 && <p className="text-[11px] text-sand-500">{t("graphNotes.nodeNotesMore", { n: notes.length - 3 })}</p>}
        </div>
      )}
    </>
  );
}

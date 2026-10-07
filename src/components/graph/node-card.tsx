"use client";

// [view2] The node card (SPEC.md §13): a click on a node selects it, and its
// card pins beside the canvas — a sheet at the foot on a phone. It says what
// the document is about (the skeleton's gist and part summaries, written by
// AI and marked so), its contents with a jump to each part, its links
// grouped by the other document with each link's reason and the part it
// sits in, and its notes. Open in reader and Pick for Stitch act on it; a
// click on another document's chip moves the card there, and ← → walk the
// links. Everything is read from what is stored (GET .../outline): the card
// never calls a model.

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { GraphEdge, GraphEdgeLink, GraphNode } from "@/lib/types";
import type { DocumentOutline } from "@/lib/graph/outline";
import { useCollab } from "@/components/collab/collab-context";
import { useT } from "@/components/lang-provider";
import { clipWords } from "@/lib/markdown-preview";
import { GraphNoteRow, useGraphNotes } from "@/components/graph/graph-notes";
import { noteLine } from "@/lib/graph/notes";
import { useGraphContent } from "@/components/graph/graph-content";
import { useWantProvenance } from "@/components/graph/provenance-want";

const outlines = new Map<string, DocumentOutline>();
const NOTE_ROWS = 6;
const GROUP_ROWS = 2;

/** One document's outline, from the tab's cache at once, then fresh. */
function useOutline(notebookId: string, documentId: string): DocumentOutline | null {
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
  }, [notebookId, documentId, key]);
  return state.key === key ? state.outline : null;
}

type Group = { other: string; links: GraphEdgeLink[]; recommended: number };

/** The node's links grouped by the other document, most links first; a
    loop (links inside the document) last. */
export function linkGroups(edges: GraphEdge[], id: string): Group[] {
  const out: Group[] = [];
  for (const e of edges) {
    if ((e.a !== id && e.b !== id) || e.links.length === 0) continue;
    out.push({ other: e.a === id ? e.b : e.a, links: e.links, recommended: e.recommended });
  }
  return out.sort((x, y) => Number(x.other === id) - Number(y.other === id) || y.links.length - x.links.length);
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
  const { select, proposedLinkIds } = useGraphContent();
  const outline = useOutline(notebookId, node.id);
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
  const groups = useMemo(() => linkGroups(edges, node.id), [edges, node.id]);
  // COST3-03: a card whose document has provenance links lists them; they load now.
  useWantProvenance(edges.some((e) => (e.a === node.id || e.b === node.id) && (e.provenance ?? 0) > 0), "card");
  const notes = notesCtx?.view.byDocument.get(node.id)?.notes ?? [];
  const linkCount = groups.reduce((s, g) => s + g.links.length, 0);

  // ← → walk the links: → goes to the most linked document not just come
  // from, ← goes back the way the walk came.
  const trail = useRef<string[]>([]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.key === "ArrowLeft") {
        const back = trail.current.pop();
        if (!back) return;
        e.preventDefault();
        select(back);
        return;
      }
      const came = trail.current[trail.current.length - 1];
      const next = groups.find((g) => g.other !== node.id && g.other !== came)?.other ?? groups.find((g) => g.other !== node.id)?.other;
      if (!next) return;
      e.preventDefault();
      trail.current.push(node.id);
      select(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [groups, node.id, select]);

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
    t("panes.graphCardLinks", { n: linkCount, s: linkCount === 1 ? "" : "s" }),
    t("graphView.cardNotes", { n: notes.length, s: notes.length === 1 ? "" : "s" }),
  ].filter(Boolean);
  const head = "mb-1.5 text-[11px] font-bold tracking-[0.06em] text-sand-600 uppercase";

  return (
    <aside
      ref={ref}
      data-track-surface="sidebar"
      data-graph-node-card={node.id}
      aria-label={node.title}
      onClick={(e) => e.stopPropagation()}
      className={`menu-in absolute z-10 flex flex-col gap-3 overflow-y-auto overscroll-contain border border-line bg-card/95 p-4 shadow-float backdrop-blur-md ${
        sheet
          ? "inset-x-0 bottom-0 h-[60%] rounded-t-[20px] border-b-0 pb-16"
          : "top-3 right-3 bottom-3 w-[400px] max-w-[calc(100vw-24px)] rounded-[20px] max-[999px]:bottom-16"
      }`}
    >
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 text-[16px] leading-snug font-semibold text-ink">{node.title}</h2>
        <button
          onClick={onClose}
          aria-label={t("common.close")}
          data-tip={t("common.close")}
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
        >
          ✕
        </button>
      </div>
      <p className="-mt-2 text-[11.5px] text-sand-600">{facts.join(" · ")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => go(`/n/${notebookId}?doc=${node.id}`)}
          data-track="graph-card-open"
          data-tip={t("graphView.cardOpenTitle")}
          className="rounded-full bg-clay px-3.5 py-1.5 text-[12px] font-semibold text-clay-fg hover:bg-clay-600"
        >
          {t("graphView.cardOpen")}
        </button>
        {canEdit && onPick && (
          <button
            onClick={onPick}
            data-track="graph-card-pick"
            aria-pressed={picked}
            className={`rounded-full border px-3 py-1.5 text-[12px] hover:bg-clay-100 hover:text-clay-800 ${
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
              <h3 className={head}>{t("graphView.cardContents")}</h3>
              <ol className="flex flex-col gap-0.5">
                {outline.parts.map((p) => (
                  <li key={p.blockId} className={p.level === 2 ? "pl-3" : ""}>
                    <button
                      onClick={() => go(`/n/${notebookId}?doc=${node.id}&block=${p.blockId}`)}
                      data-track="graph-card-part"
                      data-graph-part={p.blockId}
                      data-tip={t("graphView.cardPartTitle")}
                      className="block w-full rounded-lg px-1.5 py-1 text-left hover:bg-clay-100/60"
                    >
                      <span className="block text-[12.5px] leading-snug font-semibold text-ink">{p.title}</span>
                      {p.summary && <span className="mt-0.5 block text-[12px] leading-snug text-sand-600">{p.summary}</span>}
                    </button>
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
          <h3 className={head}>{t("graphView.cardLinks")}</h3>
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
                        className="min-w-0 truncate rounded-full bg-sand-200 px-2.5 py-0.5 text-[12px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                      >
                        {titleOf.get(g.other) ?? ""}
                      </button>
                    )}
                    <span className="ml-auto shrink-0 text-[11px] text-sand-500">
                      {t("panes.graphCardLinks", { n: g.links.length, s: g.links.length === 1 ? "" : "s" })}
                      {g.recommended > 0 ? ` · ${t("panes.graphCardRecommended", { n: g.recommended })}` : ""}
                    </span>
                  </div>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {(open ? ordered : ordered.slice(0, GROUP_ROWS)).map((l) => {
                      const partIndex = outline?.linkParts[l.id];
                      const part = partIndex !== undefined ? outline?.parts[partIndex] : undefined;
                      const proposed = proposedLinkIds.has(l.id);
                      return (
                        <li key={l.id}>
                          <button
                            onClick={() => go(`/n/${notebookId}?doc=${node.id}&link=${l.id}`)}
                            data-track="graph-card-link"
                            data-graph-card-link={l.id}
                            data-tip={t("panes.graphOpenLink")}
                            className={`block w-full rounded-lg px-1.5 py-1 text-left hover:bg-clay-100/60 ${
                              l.recommended ? "border-l-2 border-dashed border-clay-300" : ""
                            }`}
                          >
                            {proposed && (
                              <span className="mb-0.5 block text-[10.5px] font-semibold text-[var(--kind-assistant)]">
                                {t("graphView.fromLastAnswer")}
                              </span>
                            )}
                            <span className="block text-[12px] leading-snug text-ink">{l.reason ?? clipWords(l.quotedText, 60)}</span>
                            {part && (
                              <span className="mt-0.5 block text-[11px] text-sand-500">
                                {t("graphView.cardInPart", { part: part.title })}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {g.links.length > GROUP_ROWS && !open && (
                    <button
                      onClick={() => setOpenGroups((prev) => new Set(prev).add(g.other))}
                      className="mt-1 px-1.5 text-[11.5px] text-clay-700 hover:underline"
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
          <h3 className={head}>{t("graphView.cardNotesHead")}</h3>
          <div className="flex flex-col gap-0.5">
            {(showAllNotes ? notes : notes.slice(0, NOTE_ROWS)).map((n) => (
              <GraphNoteRow key={n.note.id} note={n} hereId={node.id} />
            ))}
          </div>
          {notes.length > NOTE_ROWS && !showAllNotes && (
            <button onClick={() => setShowAllNotes(true)} className="mt-1 px-2 text-[11.5px] text-clay-700 hover:underline">
              {t("graphView.cardMore", { n: notes.length - NOTE_ROWS })}
            </button>
          )}
        </section>
      )}
      {!sheet && <p className="mt-auto pt-1 text-[11px] text-sand-500">{t("graphView.cardKeys")}</p>}
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
          <p className="text-[10.5px] font-bold tracking-[0.06em] text-sage-700 uppercase">
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

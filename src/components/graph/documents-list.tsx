"use client";

// Documents, a list beside the canvas (SPEC.md §13; VIEW3-06): every
// document of the project in one scroll, in the graph's order (linked
// documents next to each other, graph-layout.ts layoutOrder). Each row reads
// the document's gist, its parts (each a jump into the reader), one line per
// link to a neighbour with its reason and replies (a click opens the link in
// the side panel, whose Back returns here), and its notes. Hovering or
// focusing a row lights its node. The header counts open it. Generated
// documents come last, and only while the provenance switch shows them.
//
// No model call and no write: the gists come with the graph's data, the
// part titles from GET .../outline?parts=titles once per tab (the offline
// copy keeps that call), the links and the notes are on the page already.

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { GraphEdge, GraphEdgeLink, GraphNode } from "@/lib/types";
import type { ProjectPartTitles } from "@/lib/graph/outline-titles";
import { clipWords } from "@/lib/markdown-preview";
import { useT } from "@/components/lang-provider";
import { layoutOrder } from "@/components/graph/graph-layout";
import { useGraphContent } from "@/components/graph/graph-content";
import { GraphNoteRow, useGraphNotes } from "@/components/graph/graph-notes";
import { LinkReplyCount } from "@/components/graph/link-replies";
import { useProvenanceShown } from "@/components/graph/provenance-want";

const titlesKept = new Map<string, ProjectPartTitles>();
// Where the list was scrolled, per project, for Back from a document.
const scrollKept = new Map<string, number>();

function usePartTitles(notebookId: string): ProjectPartTitles | null {
  const [titles, setTitles] = useState<ProjectPartTitles | null>(() => titlesKept.get(notebookId) ?? null);
  useEffect(() => {
    if (titlesKept.has(notebookId)) return;
    const controller = new AbortController();
    fetch(`/api/notebooks/${notebookId}/outline?parts=titles`, { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<ProjectPartTitles>) : null))
      .then((data) => {
        if (!data) return;
        titlesKept.set(notebookId, data);
        setTitles(data);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [notebookId]);
  return titles;
}

const PARTS_CAP = 8;

export function DocumentsList({
  notebookId,
  nodes,
  edges,
  openLinkId,
  onOpenLink,
  onOpenDocument,
  onClose,
  sheet,
  onSheetHeight,
}: {
  notebookId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  openLinkId: string | null;
  onOpenLink: (linkId: string) => void;
  /** The reader opened a document from the list (the URL already moved). */
  onOpenDocument: () => void;
  onClose: () => void;
  /** A phone: the list is a sheet at the foot of the canvas. */
  sheet: boolean;
  onSheetHeight: (height: number) => void;
}) {
  const t = useT();
  const router = useRouter();
  const { gists, select } = useGraphContent();
  const notesCtx = useGraphNotes();
  const showGenerated = useProvenanceShown();
  const titles = usePartTitles(notebookId);
  const [openGists, setOpenGists] = useState<Set<string>>(() => new Set());
  // A long parts line shows its first PARTS_CAP parts and a count; a click shows them all (P4).
  const [openParts, setOpenParts] = useState<Set<string>>(() => new Set());

  const titleOf = useMemo(() => new Map(nodes.map((n) => [n.id, n.title])), [nodes]);
  // The links of each document, by the other document, accepted first; a
  // loop's links once. Recommended links draw dashed, as on the canvas and
  // the card; provenance links are not listed (the Links list's rule).
  const linksOf = useMemo(() => {
    const out = new Map<string, { other: string; links: GraphEdgeLink[] }[]>();
    for (const e of edges) {
      const links = e.links.filter((l) => !l.provenance).sort((x, y) => Number(x.recommended) - Number(y.recommended));
      if (links.length === 0) continue;
      for (const [id, other] of e.a === e.b ? [[e.a, e.a]] : [[e.a, e.b], [e.b, e.a]]) {
        out.set(id, [...(out.get(id) ?? []), { other, links }]);
      }
    }
    for (const groups of out.values()) groups.sort((x, y) => y.links.length - x.links.length);
    return out;
  }, [edges]);
  const ordered = useMemo(() => {
    const generated = new Set(nodes.filter((n) => n.kind === "generated").map((n) => n.id));
    const order = layoutOrder(
      nodes.map((n) => n.id),
      edges.filter((e) => e.accepted + e.recommended > 0).map((e) => ({ a: e.a, b: e.b, weight: e.accepted + e.recommended })),
      generated,
    );
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return order.flatMap((id) => {
      const n = byId.get(id);
      return n && (showGenerated || !generated.has(id)) ? [n] : [];
    });
  }, [nodes, edges, showGenerated]);

  const linkTotal = edges.reduce((sum, e) => sum + e.links.filter((l) => !l.recommended && !l.provenance).length, 0);
  const noteTotal = useMemo(() => {
    const ids = new Set<string>();
    for (const n of ordered) for (const g of notesCtx?.view.byDocument.get(n.id)?.notes ?? []) ids.add(g.note.id);
    return ids.size;
  }, [ordered, notesCtx]);
  const setRowLit = notesCtx?.setRowLit;
  const light = (id: string | null) => setRowLit?.(id ? new Set([id]) : null);

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
  // Back from a document finds the list where it was.
  useLayoutEffect(() => {
    const el = ref.current;
    const top = scrollKept.get(notebookId);
    if (el && top) el.scrollTop = top;
  }, [notebookId]);
  // The light goes out with the list.
  useEffect(() => () => setRowLit?.(null), [setRowLit]);

  function go(href: string) {
    router.push(href);
    onOpenDocument();
  }
  const s = (n: number) => (n === 1 ? "" : "s");

  return (
    <aside
      ref={ref}
      data-track-surface="graph-documents-list"
      id="graph-list-documents"
      tabIndex={-1}
      data-graph-side-list="documents"
      data-graph-documents-list
      aria-label={t("panes.graphDocumentsToggleTitle")}
      onScroll={(e) => scrollKept.set(notebookId, e.currentTarget.scrollTop)}
      className={`menu-in absolute z-10 flex flex-col gap-2.5 overflow-y-auto overscroll-contain border border-line bg-card/95 p-4 shadow-float outline-none backdrop-blur-md ${
        sheet
          ? "inset-x-0 bottom-0 h-[60%] rounded-t-[20px] border-b-0 pb-16"
          : "top-3 right-3 bottom-3 w-[400px] max-w-[calc(100vw-24px)] rounded-[20px] pb-24 max-[999px]:bottom-16 max-[999px]:pb-4"
      }`}
    >
      <div className="flex items-start gap-2">
        <p className="flex-1 text-[11.5px] text-sand-600">
          {t("panes.graphDocumentsHead", {
            docs: ordered.length,
            ds: s(ordered.length),
            links: linkTotal,
            ls: s(linkTotal),
            notes: noteTotal,
            ns: s(noteTotal),
          })}
        </p>
        <button
          onClick={onClose}
          data-track="graph-documents-close"
          aria-label={t("common.close")}
          data-tip={t("common.close")}
          className="-mt-1 -mr-1 flex size-7 shrink-0 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
        >
          ✕
        </button>
      </div>
      {ordered.length === 0 && <p className="text-[13px] text-sand-600">{t("panes.graphDocumentsEmpty")}</p>}
      {ordered.map((n) => {
        const gist = gists[n.id];
        const gistOpen = openGists.has(n.id);
        const allParts = titles?.documents[n.id] ?? [];
        const partsHidden = openParts.has(n.id) || allParts.length <= PARTS_CAP + 1 ? 0 : allParts.length - PARTS_CAP;
        const parts = partsHidden > 0 ? allParts.slice(0, PARTS_CAP) : allParts;
        const groups = linksOf.get(n.id) ?? [];
        const notes = notesCtx?.view.byDocument.get(n.id)?.notes ?? [];
        return (
          <section
            key={n.id}
            data-graph-documents-row={n.id}
            aria-label={n.title}
            onMouseEnter={() => light(n.id)}
            onMouseLeave={() => light(null)}
            onFocus={() => light(n.id)}
            onBlur={() => light(null)}
            className={`flex flex-col gap-1.5 rounded-2xl border border-line p-3 hover:border-clay-300 hover:bg-clay-100/40 focus-within:border-clay-300 ${
              n.kind === "generated" ? "opacity-80" : ""
            }`}
          >
            <button
              onClick={() => select(n.id)}
              data-track="graph-documents-card"
              data-tip={t("graphView.cardNeighbourTitle")}
              className="text-left text-[13.5px] leading-snug font-semibold text-ink hover:text-clay-800"
            >
              {n.title}
            </button>
            {gist ? (
              <button
                onClick={() =>
                  setOpenGists((prev) => {
                    const next = new Set(prev);
                    if (next.has(n.id)) next.delete(n.id);
                    else next.add(n.id);
                    return next;
                  })
                }
                data-graph-documents-gist
                aria-expanded={gistOpen}
                data-tip={t(gistOpen ? "panes.graphDocumentsGistLess" : "panes.graphDocumentsGistMore")}
                className={`text-left text-[12.5px] leading-snug text-ink ${gistOpen ? "" : "line-clamp-3"}`}
              >
                {gist}
              </button>
            ) : (
              <p data-graph-no-summary className="text-[12px] leading-snug text-sand-500">
                {t("graphView.cardNoSummary")}
              </p>
            )}
            {parts.length > 0 && (
              <p className="text-[11.5px] leading-relaxed text-sand-600">
                {parts.map((p, i) => (
                  <span key={p.blockId}>
                    {i > 0 && <span className="text-sand-400"> · </span>}
                    <button
                      onClick={() => go(`/n/${notebookId}?doc=${n.id}&block=${p.blockId}`)}
                      data-track="graph-documents-part"
                      data-graph-part={p.blockId}
                      data-tip={t("graphView.cardPartTitle")}
                      className="text-left underline decoration-sand-400 decoration-dotted underline-offset-2 hover:text-clay-800"
                    >
                      {p.title}
                    </button>
                  </span>
                ))}
                {partsHidden > 0 && (
                  <>
                    <span className="text-sand-400"> · </span>
                    <button
                      onClick={() => setOpenParts((prev) => new Set(prev).add(n.id))}
                      data-track="graph-documents-parts-more"
                      data-graph-parts-more={partsHidden}
                      className="font-semibold text-sand-700 hover:text-clay-800"
                    >
                      {partsHidden === 1 ? t("graphView.partsMoreOne") : t("graphView.partsMore", { n: partsHidden })}
                    </button>
                  </>
                )}
              </p>
            )}
            {groups.flatMap((g) =>
              g.links.map((l) => (
                <button
                  key={`${g.other}|${l.id}`}
                  onClick={() => onOpenLink(l.id)}
                  data-track="graph-documents-link"
                  data-graph-documents-link={l.id}
                  aria-expanded={openLinkId === l.id}
                  data-tip={t("panes.graphDocumentsLinkTitle")}
                  className={`flex flex-col items-start gap-0.5 border-l-2 border-clay-300 py-0.5 pl-2 text-left text-[12px] leading-snug text-sand-700 hover:bg-clay-100/60 ${
                    l.recommended ? "border-dashed" : ""
                  }`}
                >
                  <span>
                    <span className="font-semibold text-clay-700">
                      {g.other === n.id ? t("graphView.cardWithin") : `⇄ ${titleOf.get(g.other) ?? ""}`}
                    </span>{" "}
                    {l.reason ?? clipWords(l.quotedText, 40)}
                  </span>
                  {l.recommended && (
                    <span className="rounded-full border border-dashed border-clay-300 px-1.5 text-[10px] font-semibold text-clay-700">
                      {t("panes.graphLinkRecommended")}
                    </span>
                  )}
                  <LinkReplyCount link={l} />
                </button>
              )),
            )}
            {notes.length > 0 && (
              <div className="flex flex-col">
                {notes.map((g) => (
                  <GraphNoteRow key={g.note.id} note={g} hereId={n.id} />
                ))}
              </div>
            )}
          </section>
        );
      })}
      {ordered.length > 0 && <p className="pt-1 text-[11px] text-sand-500">{t("panes.graphDocumentsAiLine")}</p>}
    </aside>
  );
}

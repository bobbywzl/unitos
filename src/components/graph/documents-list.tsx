"use client";

// Documents, a list beside the canvas (SPEC.md §13; VIEW3-06): every
// document of the project in one scroll, in the graph's order (linked
// documents next to each other, graph-layout.ts layoutOrder). Each row reads
// the document's gist, its parts (each a jump into the reader; the first 8,
// then "N more parts"), one line per link to a neighbour with its reason and
// replies (the first 3, then "N more links"; a click opens the link in the
// side panel, whose Back returns here), and its notes. Hovering or focusing
// a row lights its node. The header counts open it. Generated documents come
// last, marked, while the provenance switch is on; otherwise one line says
// how many are not listed (VIEW4-07).
//
// Scale (VIEW4-04, WALK4-11): a filter matches the title, the gist, and the
// part titles. [chrome6] VIEW6-04: each row is one line (the title and its
// counts) at every size, and a click opens it in place; the row's card is
// one more click. Past 20 rows [layer5] the documents holding the reader's
// own words (notes, open comments) come first, in the graph's order among
// them (VIEW5-08); below, the graph's order.
//
// Keyboard (WALK4-09): the list is a list, each title a heading. Each row
// is one Tab stop (its title); the arrows move through the row's controls
// and on to the next row's title (useRowKeys).
//
// No model call and no write: the gists come with the graph's data, the
// part titles from GET .../outline?parts=titles, again after each rev move
// (the offline copy keeps that call), the links and the notes are on the page already.

import { ACTION, CLOSE, TEXT_HIT } from "./graph-ui";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import type { GraphEdge, GraphEdgeLink, GraphNode } from "@/lib/types";
import type { PartTitle, ProjectPartTitles } from "@/lib/graph/outline-titles";
import { clipWords } from "@/lib/markdown-preview";
import { useT } from "@/components/lang-provider";
import { layoutOrder } from "@/components/graph/graph-layout";
import { useGraphContent } from "@/components/graph/graph-content";
import type { GraphNote } from "@/lib/graph/notes";
import { GraphNoteRow, useGraphNotes } from "@/components/graph/graph-notes";
import { LinkReplyCount } from "@/components/graph/link-replies";
import { useProvenanceShown } from "@/components/graph/provenance-want";
import { useGraphGeneration } from "@/components/graph/graph-generation";
import { CoverageHead, DocumentCoverageLine, PartDot, useCoverageGaps, useDocumentCoverage } from "@/components/graph/coverage"; // [cover4]
// [layer5] The reader's layer: comments, gap reasons, the reader's documents first.
import { DocumentComments, GapReasons, gapReasonLines, useProjectCoverage } from "@/components/graph/coverage";
import { openComments } from "@/lib/graph/coverage-view";

/** Each project's part titles with the graph generation they were read at. */
const titlesKept = new Map<string, { titles: ProjectPartTitles; gen: number }>();
// Where the list was scrolled, and its filter, per project, for Back from a document.
const scrollKept = new Map<string, number>();
const filterKept = new Map<string, string>();
// [chrome6] The rows opened, per project: Back from a link or a document
// finds them open, and the focus finds its row (VIEW6-04).
const openKept = new Map<string, Set<string>>();

/** [chrome6] Past this many rows, the reader's documents come first (each
    row is one line until opened at every size, VIEW6-04). */
export const COMPACT_ROWS = 20;
/** The parts and the links a row shows before "N more". */
const PARTS_SHOWN = 8;
const LINKS_SHOWN = 3;


// Read again once the graph's generation moved (a rev move: a skeleton
// built, a document added; REV4-02). The kept titles show until then.
function usePartTitles(notebookId: string): ProjectPartTitles | null {
  const gen = useGraphGeneration(notebookId);
  const [titles, setTitles] = useState<ProjectPartTitles | null>(() => titlesKept.get(notebookId)?.titles ?? null);
  useEffect(() => {
    const kept = titlesKept.get(notebookId);
    if (kept && kept.gen >= gen) return;
    const controller = new AbortController();
    fetch(`/api/notebooks/${notebookId}/outline?parts=titles`, { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<ProjectPartTitles>) : null))
      .then((data) => {
        if (!data) return;
        titlesKept.set(notebookId, { titles: data, gen });
        setTitles(data);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [notebookId, gen]);
  return titles;
}

// A row's title is a heading for a screen reader (WALK4-09) and keeps the
// row's type: the global heading face is for page headings.
const HEADING_PLAIN = { fontFamily: "inherit", fontWeight: "inherit", letterSpacing: "inherit", lineHeight: "inherit" } as const;

type LinkGroup = { other: string; links: GraphEdgeLink[] };

// The row's controls in order, for the arrows: buttons, links, fields.
const ROW_CONTROLS = "button:not([disabled]), a[href], select, input";

/** One Tab stop per row (WALK4-09): every control of a row but its head
    (`data-row-head`) leaves the Tab order; the arrows reach them. Kept on
    as rows open, fold, and filter. */
function useRowTabStops(listRef: RefObject<HTMLUListElement | null>) {
  useEffect(() => {
    const ul = listRef.current;
    if (!ul) return;
    const apply = () => {
      for (const el of ul.querySelectorAll<HTMLElement>(ROW_CONTROLS)) {
        if (!el.hasAttribute("data-row-head") && el.getAttribute("tabindex") !== "-1") el.setAttribute("tabindex", "-1");
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(ul, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [listRef]);
}

/** ↓ and → go to the next control of the row, then the next row's title;
    ↑ and ← go back; Home and End go to the first and the last row. */
function onRowKeys(e: ReactKeyboardEvent<HTMLUListElement>) {
  const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
  if (!step && e.key !== "Home" && e.key !== "End") return;
  const target = e.target as HTMLElement;
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
  const all = [...e.currentTarget.querySelectorAll<HTMLElement>(ROW_CONTROLS)].filter((el) => el.getClientRects().length > 0);
  let next: HTMLElement | undefined;
  if (e.key === "Home") next = all.find((el) => el.hasAttribute("data-row-head"));
  else if (e.key === "End") next = [...all].reverse().find((el) => el.hasAttribute("data-row-head"));
  else next = all[all.indexOf(target) + step];
  if (!next) return;
  e.preventDefault();
  next.focus();
  next.scrollIntoView({ block: "nearest" });
}

function matches(words: string, title: string, gist: string | undefined, parts: PartTitle[], comments: string[] = []): boolean {
  if (!words) return true;
  return (
    title.toLowerCase().includes(words) ||
    (gist ?? "").toLowerCase().includes(words) ||
    parts.some((p) => p.title.toLowerCase().includes(words)) ||
    // [layer5] the words of its open comments: "?" finds the ones that ask (VIEW5-02)
    comments.some((c) => c.toLowerCase().includes(words))
  );
}

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
  const { gists, setShowProvenance } = useGraphContent();
  const notesCtx = useGraphNotes();
  const showGenerated = useProvenanceShown();
  const titles = usePartTitles(notebookId);
  const [filter, setFilterState] = useState(() => filterKept.get(notebookId) ?? "");
  const setFilter = (value: string) => {
    filterKept.set(notebookId, value);
    setFilterState(value);
  };
  const words = filter.trim().toLowerCase();
  const gaps = useCoverageGaps(); // [cover4]

  const titleOf = useMemo(() => new Map(nodes.map((n) => [n.id, n.title])), [nodes]);
  // The links of each document, by the other document, accepted first; a
  // loop's links once. Recommended links draw dashed, as on the canvas and
  // the card; provenance links are not listed (the Links list's rule).
  const linksOf = useMemo(() => {
    const out = new Map<string, LinkGroup[]>();
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
  const generatedIds = useMemo(() => new Set(nodes.filter((n) => n.kind === "generated").map((n) => n.id)), [nodes]);
  const ordered = useMemo(() => {
    const order = layoutOrder(
      nodes.map((n) => n.id),
      edges.filter((e) => e.accepted + e.recommended > 0).map((e) => ({ a: e.a, b: e.b, weight: e.accepted + e.recommended })),
      generatedIds,
    );
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return order.flatMap((id) => {
      const n = byId.get(id);
      return n && (showGenerated || !generatedIds.has(id)) ? [n] : [];
    });
  }, [nodes, edges, generatedIds, showGenerated]);
  const hiddenGenerated = showGenerated ? 0 : generatedIds.size;
  const projectCoverage = useProjectCoverage(); // [layer5]
  const matched = useMemo(
    () =>
      ordered.filter((n) =>
        matches(words, n.title, gists[n.id], titles?.documents[n.id] ?? [], openComments(projectCoverage?.documents[n.id]).map((c) => c.text)),
      ),
    [ordered, words, gists, titles, projectCoverage],
  );
  // [cover4] Gaps only keeps the rows with a gap.
  const kept = useMemo(() => matched.filter((n) => gaps.keepRow(n.id)), [matched, gaps]);
  // [chrome6] VIEW6-04: one-line rows at every size; past COMPACT_ROWS the
  // reader's documents first: those with notes or open comments, in the
  // graph's order (VIEW5-08). A small project keeps the graph's order.
  const compact = true;
  const mineFirst = kept.length > COMPACT_ROWS;
  const byDocument = notesCtx?.view.byDocument;
  const shown = useMemo(() => {
    if (!mineFirst) return kept;
    const mine = (id: string) =>
      (byDocument?.get(id)?.notes.length ?? 0) > 0 || openComments(projectCoverage?.documents[id]).length > 0;
    return [...kept.filter((n) => mine(n.id)), ...kept.filter((n) => !mine(n.id))];
  }, [mineFirst, kept, byDocument, projectCoverage]);

  const linkTotal = edges.reduce((sum, e) => sum + e.links.filter((l) => !l.recommended && !l.provenance).length, 0);
  const noteTotal = useMemo(() => {
    const ids = new Set<string>();
    for (const n of ordered) for (const g of notesCtx?.view.byDocument.get(n.id)?.notes ?? []) ids.add(g.note.id);
    return ids.size;
  }, [ordered, notesCtx]);
  const setRowLit = notesCtx?.setRowLit;
  const openTotal = ordered.reduce((sum, n) => sum + openComments(projectCoverage?.documents[n.id]).length, 0); // [layer5]

  const ref = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useRowTabStops(listRef);
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

  const s = (n: number) => (n === 1 ? "" : "s");

  return (
    <aside
      ref={ref}
      data-track-surface="graph-documents-list"
      id="graph-list-documents"
      tabIndex={-1}
      data-graph-side-list="documents"
      data-graph-documents-list
      data-compact=""
      data-mine-first={mineFirst ? "" : undefined}
      aria-label={t("panes.graphDocuments")}
      onScroll={(e) => scrollKept.set(notebookId, e.currentTarget.scrollTop)}
      className={`menu-in absolute z-10 flex flex-col gap-2.5 overflow-y-auto overscroll-contain border border-line bg-card/95 p-4 shadow-float outline-none backdrop-blur-md ${
        sheet
          ? "inset-x-0 bottom-0 h-[60%] rounded-t-[20px] border-b-0 pb-24"
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
            // [layer5] the open comments, and the reader's documents first at scale
            comments:
              openTotal === 0
                ? ""
                : ` · ${openTotal === 1 ? t("graphCover.commentsOpenOne") : t("graphCover.commentsOpenMany", { n: openTotal })}`,
            order: t(mineFirst ? "panes.graphDocumentsOrderMine" : "panes.graphDocumentsOrder"),
          })}
        </p>
        <button
          onClick={onClose}
          data-track="graph-documents-close"
          aria-label={t("common.close")}
          data-tip={t("common.close")}
          className={`-mt-1 -mr-1 ${CLOSE}`}
        >
          ✕
        </button>
      </div>
      {ordered.length > 1 && (
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("panes.graphDocumentsFilter")}
          aria-label={t("panes.graphDocumentsFilter")}
          data-track="graph-documents-filter"
          data-graph-documents-filter
          maxLength={100}
          className="shrink-0 rounded-full border border-line bg-card px-3 py-1.5 text-[12.5px] text-ink placeholder:text-sand-500 focus:border-clay-400"
        />
      )}
      {/* [cover4] What the notes cover, and Gaps only (VIEW4-01). */}
      <CoverageHead documentIds={ordered.map((n) => n.id)} links={edges.flatMap((e) => e.links)} />
      {ordered.length === 0 && <p className="text-[13px] text-sand-600">{t("panes.graphDocumentsEmpty")}</p>}
      {gaps.on && matched.length > 0 && shown.length === 0 && <p className="text-[13px] text-sand-600">{t("graphCover.gapsNone")}</p>}
      {ordered.length > 0 && matched.length === 0 && (
        <p className="text-[13px] text-sand-600">{t("panes.graphDocumentsFilterNone")}</p>
      )}
      {words && matched.length > 0 && (
        <p role="status" className="text-[11.5px] text-sand-600" data-graph-documents-found>
          {t("panes.graphDocumentsFound", { n: matched.length, total: ordered.length, ts: s(ordered.length) })}
        </p>
      )}
      <ul
        ref={listRef}
        role="list"
        aria-label={t("panes.graphDocuments")}
        onKeyDown={onRowKeys}
        className={`flex flex-col ${compact ? "gap-1" : "gap-2.5"}`}
      >
        {shown.map((n) => (
          <DocumentRow
            key={n.id}
            notebookId={notebookId}
            node={n}
            generated={generatedIds.has(n.id)}
            compact={compact}
            gist={gists[n.id]}
            gapsOn={gaps.on}
            parts={(titles?.documents[n.id] ?? []).filter((p) => gaps.keepPart(n.id, p.blockId))}
            groups={(linksOf.get(n.id) ?? []).map((g) => ({ ...g, links: g.links.filter(gaps.keepLink) })).filter((g) => g.links.length > 0)}
            notes={gaps.keepNotes ? (notesCtx?.view.byDocument.get(n.id)?.notes ?? []) : []}
            titleOf={titleOf}
            openLinkId={openLinkId}
            onOpenLink={onOpenLink}
            onLeave={onOpenDocument}
            onGo={(href) => {
              router.push(href);
              onOpenDocument();
            }}
            onLight={(id) => setRowLit?.(id ? new Set([id]) : null)}
          />
        ))}
      </ul>
      {hiddenGenerated > 0 && !words && (
        <p data-graph-documents-generated-hidden className="text-[11.5px] leading-snug text-sand-600">
          {t("panes.graphDocumentsGeneratedHidden", { n: hiddenGenerated, s: s(hiddenGenerated) })}{" "}
          <button
            onClick={() => setShowProvenance(true)}
            data-track="graph-documents-show-generated"
            className={`${TEXT_HIT} font-semibold text-clay-700 underline decoration-dotted underline-offset-2 hover:text-clay-800`}
          >
            {t("panes.graphDocumentsGeneratedShow")}
          </button>
        </p>
      )}
      {ordered.length > 0 && <p className="pt-1 text-[11px] text-sand-500">{t("panes.graphDocumentsAiLine")}</p>}
    </aside>
  );
}

/** One document's row. Its lines, in order: the gist, the parts, the links,
    the notes; a new line goes into `lines` below, and a new count into
    `counts` (the one-line row's summary). Every control but the head stays
    out of the Tab order (useRowTabStops), so a new control needs nothing. */
function DocumentRow({
  notebookId,
  node: n,
  generated,
  compact,
  gapsOn,
  gist,
  parts,
  groups,
  notes,
  titleOf,
  openLinkId,
  onOpenLink,
  onGo,
  onLeave,
  onLight,
}: {
  notebookId: string;
  node: GraphNode;
  generated: boolean;
  /** One line until opened (past COMPACT_ROWS rows). */
  compact: boolean;
  /** [layer5] Gaps only is on: the row says why it is listed. */
  gapsOn: boolean;
  gist: string | undefined;
  parts: PartTitle[];
  groups: LinkGroup[];
  notes: GraphNote[];
  titleOf: Map<string, string>;
  openLinkId: string | null;
  onOpenLink: (linkId: string) => void;
  onGo: (href: string) => void;
  /** [layer5] The reader opened a document from the row (the URL already moved). */
  onLeave: () => void;
  onLight: (id: string | null) => void;
}) {
  const t = useT();
  const { select } = useGraphContent();
  const [open, setOpenState] = useState(() => openKept.get(notebookId)?.has(n.id) ?? false);
  const setOpen = (next: (v: boolean) => boolean) =>
    setOpenState((v) => {
      const value = next(v);
      const kept = openKept.get(notebookId) ?? new Set<string>();
      if (value) kept.add(n.id);
      else kept.delete(n.id);
      openKept.set(notebookId, kept);
      return value;
    });
  const [gistOpen, setGistOpen] = useState(false);
  const [allParts, setAllParts] = useState(false);
  const [allLinks, setAllLinks] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false); // [layer5]
  const links = groups.flatMap((g) => g.links.map((l) => ({ other: g.other, link: l })));
  const s = (k: number) => (k === 1 ? "" : "s");
  const shownParts = allParts ? parts : parts.slice(0, PARTS_SHOWN);
  const shownLinks = allLinks ? links : links.slice(0, LINKS_SHOWN);
  const opened = !compact || open;

  // [cover4] What the notes cover: "N of M parts noted" and Not opened.
  const coverage = useDocumentCoverage(n.id);
  const notedParts = coverage ? coverage.parts.filter((p) => p.noted > 0).length : 0;

  // The one-line row's summary: what the row holds; [layer5] under Gaps
  // only, why it is listed (WALK5-06).
  const whole = coverage?.parts.length === 1 && coverage.parts[0].whole;
  const openList = openComments(coverage);
  const counts = (
    gapsOn
      ? gapReasonLines(t, coverage)
      : [
          coverage && coverage.parts.length > 0 && !whole
            ? t("graphCover.partsNoted", { n: notedParts, m: coverage.parts.length })
            : parts.length > 0
              ? t("panes.graphDocumentsParts", { n: parts.length, s: s(parts.length) })
              : null,
          coverage && !coverage.opened ? t("graphCover.notOpened") : null,
          // [layer5] the open comments, with a "?" when one asks
          openList.length === 0
            ? null
            : `${openList.length === 1 ? t("graphCover.commentsOpenOne") : t("graphCover.commentsOpenMany", { n: openList.length })}${openList.some((c) => c.asks) ? " ?" : ""}`,
          links.length > 0 ? t("panes.graphDocumentsLinks", { n: links.length, s: s(links.length) }) : null,
          notes.length > 0 ? t("panes.graphDocumentsNotes", { n: notes.length, s: s(notes.length) }) : null,
        ]
  ).filter((c): c is string => c !== null);

  const lines: ReactNode[] = [
    // [layer5] Under Gaps only, why the row is listed first (WALK5-06).
    gapsOn ? (
      <GapReasons key="gap-why" documentId={n.id} />
    ) : (
      <DocumentCoverageLine
        key="coverage"
        documentId={n.id} /* [cover4] */
        commentsOpen={commentsOpen}
        onToggleComments={() => setCommentsOpen((v) => !v)}
      />
    ),
    // [layer5] A press on the open comments' count lists them here (VIEW5-02).
    commentsOpen ? <DocumentComments key="comments" notebookId={notebookId} documentId={n.id} onOpenDocument={onLeave} /> : null,
    gist ? (
      <button
        key="gist"
        onClick={() => setGistOpen((v) => !v)}
        data-graph-documents-gist
        aria-expanded={gistOpen}
        data-tip={t(gistOpen ? "panes.graphDocumentsGistLess" : "panes.graphDocumentsGistMore")}
        className={`text-left text-[12.5px] leading-snug text-ink ${gistOpen ? "" : "line-clamp-3"}`}
      >
        {gist}
      </button>
    ) : (
      <p key="gist" data-graph-no-summary className="text-[12px] leading-snug text-sand-500">
        {t("graphView.cardNoSummary")}
      </p>
    ),
    parts.length > 0 ? (
      <p key="parts" className="text-[11.5px] leading-relaxed text-sand-600">
        {shownParts.map((p, i) => (
          <span key={p.blockId}>
            {i > 0 && <span className="text-sand-400"> · </span>}
            <PartDot documentId={n.id} blockId={p.blockId} /* [cover4] */ />
            <button
              onClick={() => onGo(`/n/${notebookId}?doc=${n.id}&block=${p.blockId}`)}
              data-track="graph-documents-part"
              data-graph-part={p.blockId}
              data-tip={t("graphView.cardPartTitle")}
              className="text-left underline decoration-sand-400 decoration-dotted underline-offset-2 hover:text-clay-800"
            >
              {p.title}
            </button>
          </span>
        ))}
        {parts.length > PARTS_SHOWN && (
          <>
            <span className="text-sand-400"> · </span>
            <button
              onClick={() => setAllParts((v) => !v)}
              data-graph-documents-parts-more
              data-graph-parts-more={allParts ? undefined : parts.length - PARTS_SHOWN}
              aria-expanded={allParts}
              className="font-semibold text-clay-700 hover:text-clay-800"
            >
              {allParts
                ? t("panes.graphDocumentsFewer")
                : t("panes.graphDocumentsPartsMore", { n: parts.length - PARTS_SHOWN, s: s(parts.length - PARTS_SHOWN) })}
            </button>
          </>
        )}
      </p>
    ) : null,
    ...shownLinks.map(({ other, link: l }) => (
      <button
        key={`${other}|${l.id}`}
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
            {other === n.id ? t("graphView.cardWithin") : `⇄ ${titleOf.get(other) ?? ""}`}
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
    links.length > LINKS_SHOWN ? (
      <button
        key="links-more"
        onClick={() => setAllLinks((v) => !v)}
        data-graph-documents-links-more
        aria-expanded={allLinks}
        className={`${TEXT_HIT} self-start pl-2.5 text-[11.5px] font-semibold text-clay-700 hover:text-clay-800`}
      >
        {allLinks
          ? t("panes.graphDocumentsFewer")
          : t("panes.graphDocumentsLinksMore", { n: links.length - LINKS_SHOWN, s: s(links.length - LINKS_SHOWN) })}
      </button>
    ) : null,
    notes.length > 0 ? (
      <div key="notes" className="flex flex-col">
        {notes.map((g) => (
          <GraphNoteRow key={g.note.id} note={g} hereId={n.id} />
        ))}
      </div>
    ) : null,
  ];

  const generatedMark = generated && (
    <span
      data-graph-documents-generated
      className={`shrink-0 rounded-full bg-sand-200 px-1.5 text-[10px] font-semibold text-sand-700 ${compact && !open ? "mt-2 mr-3" : ""}`}
    >
      {t("panes.documentKindGenerated")}
    </span>
  );

  return (
    <li
      data-graph-documents-row={n.id}
      data-open={opened ? "" : undefined}
      onMouseEnter={() => onLight(n.id)}
      onMouseLeave={() => onLight(null)}
      onFocus={() => onLight(n.id)}
      onBlur={() => onLight(null)}
      className={`flex flex-col rounded-2xl border border-line hover:border-clay-300 hover:bg-clay-100/40 focus-within:border-clay-300 ${
        /* [style7] VIEW7-07: a shut row's padding is its button's, so the whole row takes the click. */
        compact && !open ? "" : "gap-1.5 p-3"
      } ${generated ? "opacity-80" : ""}`}
    >
      <h3 style={HEADING_PLAIN} className="flex items-start gap-2 text-[13.5px] text-ink">
        {compact ? (
          // One line: the title and its counts; a click opens the row.
          <button
            data-row-head
            onClick={() => setOpen((v) => !v)}
            data-track="graph-documents-row-open"
            aria-expanded={open}
            className={`flex min-h-6 min-w-0 flex-1 items-baseline gap-2 text-left leading-snug font-semibold hover:text-clay-800 max-[639px]:flex-wrap max-[639px]:gap-y-0 ${open ? "" : "px-3 py-1.5 max-[639px]:py-1"}`}
          >
            <span className={`min-w-0 ${open ? "" : "truncate"} max-[639px]:basis-full`}>{n.title}</span>
            {/* [chrome6] VIEW6-04: below 640 px the counts go under the title. */}
            {!open && counts.length > 0 && (
              <span
                data-graph-gap-why={gapsOn ? n.id : undefined}
                className={`ml-auto shrink-0 text-[11px] max-[639px]:ml-0 max-[639px]:shrink max-[639px]:leading-tight ${gapsOn ? "font-semibold text-clay-800" : "font-normal text-sand-500"}`}
              >
                {counts.join(" · ")}
              </span>
            )}
          </button>
        ) : (
          <button
            data-row-head
            onClick={() => select(n.id)}
            data-track="graph-documents-card"
            data-tip={t("graphView.cardNeighbourTitle")}
            className="min-w-0 flex-1 text-left leading-snug font-semibold hover:text-clay-800"
          >
            {n.title}
          </button>
        )}
        {generatedMark}
      </h3>
      {opened && compact && (
        <button
          onClick={() => select(n.id)}
          data-track="graph-documents-card"
          className={`${ACTION} self-start`}
        >
          {t("graphView.cardNeighbourTitle")}
        </button>
      )}
      {opened && lines}
    </li>
  );
}

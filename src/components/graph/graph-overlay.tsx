"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { GeneratedDocumentView, GraphEdge, GraphNode, RecommendedLinkView } from "@/lib/types";
import { api } from "@/lib/api";
import { linkPath } from "@/lib/link-scope";
import { useCollab } from "@/components/collab/collab-context";
import { AuthorChip } from "@/components/collab/person-badge";
import { ReplyThread } from "@/components/collab/reply-thread";
import { LinkIcon, PageIcon, SparkleIcon, UnlinkIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Presence } from "@/components/presence";
import { StopPill } from "@/components/thinking";
import { GeneratedList } from "@/components/graph/generated-list";
import { clearGraphKeep, readGraphKeep, writeGraphKeep } from "@/components/graph/graph-keep";
import { LinkPanel } from "@/components/graph/link-panel";
import { LinksList } from "@/components/graph/links-list";
import type { GraphInsets } from "@/components/graph/graph-view";
import { LinkDetail } from "@/components/graph/link-detail";
import { StitchBox } from "@/components/graph/stitch-box";
// [graph-notes] The project's notes on the graph and the Notes list.
import { GraphNotesProvider, type GraphNotesInput } from "@/components/graph/graph-notes";
import { GraphNotesList, NotesListToggle } from "@/components/graph/graph-notes-list";
import { LinkNoteComposer } from "@/components/graph/link-note-composer";
// [/graph-notes]
// [view2] The node card, Find, and the last Stitch answer on the graph.
import { GraphContentProvider, useGraphContentState } from "@/components/graph/graph-content";
import { FindBox, FindList } from "@/components/graph/graph-find";
import { NodeCardPanel } from "@/components/graph/node-card";
const NO_GISTS: Record<string, string> = {};
// [/view2]

// reactflow loads only when the graph opens — the workspace bundle stays lean.
const GraphView = dynamic(() => import("@/components/graph/graph-view"), {
  ssr: false,
  loading: () => null,
});

// Narrow: the Stitch box starts folded so the canvas gets the screen; below
// WIDE, an open side list folds it, since both cannot fit beside each other.
const NARROW = 640;
const WIDE = 1000;
const LIST_ROOM = 412; // a side list's width and its margin

// [view2] The node card ("document") and the Find list ("find") are side lists too.
type SideList = "recommended" | "generated" | "notes" | "links" | "link" | "document" | "find" | null;
const SIDE_LISTS: SideList[] = ["recommended", "generated", "notes", "links", "link", "document", "find"];
function sideList(value: string | null | undefined): SideList {
  return SIDE_LISTS.find((l) => l === value) ?? null;
}

function useWindowWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 1440 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

// A text box: Escape there never closes anything, and never clears it.
function isTextBox(target: EventTarget | null): target is HTMLElement {
  return (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && !["button", "checkbox", "radio", "submit"].includes(target.type)) ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

// Full-screen overlay over the workspace: the corpus as a connected whole.
// Recommended links live here too (SPEC.md §13): a folded list beside the
// canvas holds every recommended link of the project — the reason, both
// quotes, Accept and Dismiss — since the dashed curves are theirs. So does
// Stitch (SPEC.md §22): the box at the foot of the canvas runs a command
// across the project's documents — the nodes picked, or every one — and
// Generated content, a second folded list, holds every page it wrote. The
// overlay places the box: centered at the foot, beside an open list on a
// wide screen, folded under a list on a narrow one; the canvas fits its
// nodes in the space the box and the list leave free.
export function GraphOverlay({
  notebookId,
  activeDocumentId,
  nodes,
  edges,
  recommended,
  generated,
  linkScansLeft,
  notes,
  onClose,
  onNavigate,
  gists,
  loading = false,
  loadFailed,
}: {
  notebookId: string;
  activeDocumentId: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  recommended: RecommendedLinkView[];
  generated: GeneratedDocumentView[];
  /** Runs of Recommend links this account has left this month. */
  linkScansLeft: number;
  /** The project's notes, for the notes on the graph and the Notes list. */
  notes?: GraphNotesInput;
  /** Close the graph: ✕, Escape, or Back. */
  onClose: () => void;
  /** The graph closes because the reader opened a document from it (the
      URL already moved there). Default: onClose. */
  onNavigate?: () => void;
  // [view2] GR-18: the graph's data arrives after the open (graph-data.tsx):
  // each document's gist, and the load's state (loadFailed: Try again).
  gists?: Record<string, string>;
  loading?: boolean;
  loadFailed?: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const { canEdit } = useCollab();
  const leave = onNavigate ?? onClose;
  // ✕ and Escape close the graph for good: Back no longer restores the view
  // (WALK2-07). Leaving for a document keeps it.
  const close = useCallback(() => {
    clearGraphKeep(notebookId);
    onClose();
  }, [notebookId, onClose]);
  const windowWidth = useWindowWidth();
  // One folded list at a time beside the canvas: the recommended links, the
  // generated content, the notes, the links, or one link expanded (WALK2-05).
  // The open list and link come back on Back from a document (WALK2-07).
  const [list, setListState] = useState<SideList>(() => sideList(readGraphKeep(notebookId).list));
  const [openLinkId, setOpenLinkId] = useState<string | null>(() => readGraphKeep(notebookId).linkId ?? null);
  // The link panel's Back: to the Links list when it was opened there.
  const [linkFromList, setLinkFromList] = useState(false);
  const setList = useCallback(
    (next: SideList | ((prev: SideList) => SideList)) => {
      setListState((prev) => {
        const value = typeof next === "function" ? next(prev) : next;
        writeGraphKeep(notebookId, { list: value });
        return value;
      });
    },
    [notebookId],
  );
  const openLink = useCallback(
    (linkId: string, fromList: boolean) => {
      setOpenLinkId(linkId);
      setLinkFromList(fromList);
      setList("link");
      writeGraphKeep(notebookId, { linkId });
    },
    [notebookId, setList],
  );
  const linkById = useMemo(() => new Map(edges.flatMap((e) => e.links.map((l) => [l.id, l] as const))), [edges]);
  const openLinkView = list === "link" && openLinkId ? (linkById.get(openLinkId) ?? null) : null;
  const titleOf = useMemo(() => new Map(nodes.map((n) => [n.id, n.title])), [nodes]);
  const listOpen = list === "recommended";
  // [view2] The node card ("document") and the Find list ("find") are side lists too.
  const nodeIdList = useMemo(() => nodes.map((n) => n.id), [nodes]);
  const view2 = useGraphContentState({ notebookId, nodeIds: nodeIdList, gists: gists ?? NO_GISTS, list, setList });
  const { onProposed } = view2;
  const focusNode = view2.focusedId ? (nodes.find((n) => n.id === view2.focusedId) ?? null) : null;
  const [sheetHeight, setSheetHeight] = useState(0);
  // [/view2]
  // A link gone since (dismissed, removed), or a card whose document is
  // gone: no panel, no list.
  const shownList: SideList =
    (list === "link" && !openLinkView) || (list === "document" && !focusNode) ? null : list;
  // The Stitch box's fold: open on a wide screen, folded on a phone; an open
  // list folds it under WIDE, and opening the box there closes the list.
  const [boxOpen, setBoxOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= NARROW);
  const listBesideBox = shownList !== null && windowWidth >= WIDE;
  const boxShown = boxOpen && (shownList === null || listBesideBox);
  const onBoxOpenChange = useCallback(
    (open: boolean) => {
      setBoxOpen(open);
      if (open && window.innerWidth < WIDE) setList(null);
    },
    [setList],
  );
  // The box's height, for the fit: nodes never sit under it.
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxHeight, setBoxHeight] = useState(0);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setBoxHeight(Math.round(el.getBoundingClientRect().height)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [nodes.length]);
  // The documents the last Stitch answer cites, lit on the canvas until the
  // next command or a click on the canvas.
  const [citedIds, setCitedIds] = useState<Set<string>>(() => new Set());
  const onCited = useCallback((ids: string[]) => setCitedIds(new Set(ids)), []);
  const clearCited = useCallback(() => {
    setCitedIds((prev) => (prev.size ? new Set() : prev));
    onProposed([]); // [view2] the answer's proposed links go dark with its cited documents
  }, [onProposed]);
  // The documents picked for Stitch (SPEC.md §22): a ⇧-click on a node, or
  // any click while picking. Empty = every document. A node that leaves
  // the graph leaves the pick: the pick the canvas and the box read is the
  // stored one cut to the nodes.
  const [pickedIds, setPickedIds] = useState<Set<string>>(() => new Set());
  const [picking, setPicking] = useState(false);
  const toggleSelect = useCallback((documentId: string) => {
    setPickedIds((prev) => {
      const next = new Set(prev);
      if (next.has(documentId)) next.delete(documentId);
      else next.add(documentId);
      return next;
    });
  }, []);
  const selectedIds = useMemo(() => {
    const ids = new Set(nodes.map((n) => n.id));
    return new Set([...pickedIds].filter((id) => ids.has(id)));
  }, [nodes, pickedIds]);
  // Recommend links (SPEC.md §13): the scan the reader asks for. It reads
  // every document of the project whole against the others, so it runs only
  // here and only a few times a month; the button says how many are left.
  // While it runs the button reads Stop: a press ends the scan, the links it
  // already proposed stay, and the run still counts (it was recorded before
  // the scan started). Closing the graph lets the scan finish.
  const [scanning, setScanning] = useState(false);
  const [scanLeft, setScanLeft] = useState(linkScansLeft);
  // [view2] The count arrives with the graph's data, after the open.
  const [scanFrom, setScanFrom] = useState(linkScansLeft);
  if (scanFrom !== linkScansLeft) {
    setScanFrom(linkScansLeft);
    setScanLeft(linkScansLeft);
  }
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const scanAbort = useRef<AbortController | null>(null);

  async function scan() {
    if (scanning) {
      scanAbort.current?.abort();
      return;
    }
    if (scanLeft <= 0) return;
    setScanning(true);
    setScanNotice(null);
    const controller = new AbortController();
    scanAbort.current = controller;
    try {
      const result = await api<{ linkCount: number; documentsLeft: number; runsLeft: number }>(
        `/api/notebooks/${notebookId}/connect`,
        "POST",
        {},
        { signal: controller.signal },
      );
      setScanLeft(result.runsLeft);
      const s = result.linkCount === 1 ? "" : "s";
      setScanNotice(
        result.linkCount === 0
          ? t("panes.recommendScanNone")
          : result.documentsLeft > 0
            ? t("panes.recommendScanPartial", {
                n: result.linkCount,
                s,
                left: result.documentsLeft,
                ds: result.documentsLeft === 1 ? "" : "s",
              })
            : t("panes.recommendScanDone", { n: result.linkCount, s }),
      );
      if (result.linkCount > 0) {
        setList("recommended");
        router.refresh();
      }
    } catch (err) {
      if (controller.signal.aborted) {
        // Stopped: the run counts, and the links it proposed before the
        // stop are on the page after a refresh.
        setScanLeft((n) => Math.max(0, n - 1));
        router.refresh();
      } else {
        setScanNotice(err instanceof Error ? err.message : t("common.requestFailed"));
      }
    } finally {
      if (scanAbort.current === controller) scanAbort.current = null;
      setScanning(false);
    }
  }

  // Escape (GR-11) closes the innermost thing first and never throws away
  // typed words: in a text box it only leaves the box (the words stay);
  // then picking ends; then an open list closes; only then the graph. The
  // canvas (a pinned link list, the key) and the Stitch box handle their
  // own first, in the capture phase, and mark the event handled; this
  // listener runs in the bubble phase, after them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.stopPropagation();
      if (isTextBox(e.target)) {
        e.target.blur();
        return;
      }
      if (picking) setPicking(false);
      else if (list) setList(null);
      else close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, picking, list, setList]);

  // The skip links (REV2-10): to the Stitch text box (the box opens first
  // when it is folded), or to the first control of the open side list.
  const skipToStitch = useCallback(() => {
    onBoxOpenChange(true);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const slot = boxRef.current;
        (slot?.querySelector<HTMLElement>("textarea") ?? slot?.querySelector<HTMLElement>("button"))?.focus();
      }),
    );
  }, [onBoxOpenChange]);
  const skipToList = useCallback(() => {
    dialogRef.current
      ?.querySelector<HTMLElement>("[data-graph-side-list] button, [data-graph-side-list] select, aside button")
      ?.focus();
  }, []);

  // A dialog (GR-16): focus moves into it on open, stays in it on Tab, and
  // goes back where it was on close.
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    titleRef.current?.focus({ preventScroll: true });
    return () => {
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);
  function trapTab(e: ReactKeyboardEvent) {
    if (e.key !== "Tab" || !dialogRef.current) return;
    const focusable = [
      ...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((el) => el.getClientRects().length > 0);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // The header counts the reader's map: documents and links, with generated
  // documents counted apart and their provenance links not at all (WALK2-02).
  const acceptedLinks = edges.reduce((sum, e) => sum + e.accepted, 0);
  const generatedCount = nodes.filter((n) => n.kind === "generated").length;
  const ownDocs = nodes.length - generatedCount;
  const allLinks = edges.reduce((sum, e) => sum + e.links.filter((l) => !l.recommended && !l.provenance).length, 0);
  const anyLink = edges.some((e) => e.accepted + e.recommended > 0);
  const emptyCard = loading
    ? null
    : nodes.length === 1
      ? t("panes.graphOneDocument")
      : nodes.length >= 2 && !anyLink
        ? t("panes.graphNoLinks")
        : null;
  // [view2] The node card is a sheet at the foot on a phone, and beside the
  // canvas from NARROW up; the fit keeps the nodes clear of it.
  const cardSheet = list === "document" && windowWidth < NARROW;
  const cardBeside = (list === "document" || list === "find") && windowWidth >= NARROW;
  const insets = useMemo<GraphInsets>(
    () => ({
      top: emptyCard ? 96 : 0,
      right: listBesideBox || cardBeside ? LIST_ROOM : 0,
      bottom: cardSheet && sheetHeight > 0 ? sheetHeight + 8 : boxHeight > 0 ? boxHeight + 16 : 0,
      left: 0,
    }),
    [emptyCard, listBesideBox, cardBeside, cardSheet, sheetHeight, boxHeight],
  );

  return (
    <GraphNotesProvider notebookId={notebookId} nodes={nodes} input={notes} onClose={close} onNavigate={leave}>
    <GraphContentProvider value={view2.content}>
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("panes.graph")}
      onKeyDown={trapTab}
      data-track-surface="sidebar"
      className="graph-overlay graph-overlay-in fixed inset-0 z-50 flex flex-col bg-paper"
    >
      {/* Below md the pills scroll sideways in one row under the title, so
          the header stays two short rows and the close button stays in
          view. */}
      <div className="flex items-center gap-3 border-b border-line px-5 py-3 max-[900px]:flex-wrap max-[900px]:gap-x-3 max-[900px]:gap-y-2 max-md:px-3 max-md:py-2">
        <span ref={titleRef} tabIndex={-1} data-graph-title className="font-display text-[18px] outline-none">
          {t("panes.graph")}
        </span>
        {/* Skip links (REV2-10): the first controls in the dialog, shown on
            focus, straight to the Stitch box or the open side list. */}
        {nodes.length >= 2 && (
          <button onClick={skipToStitch} data-track="graph-skip-stitch" className="sr-only focus:not-sr-only focus:rounded-full focus:bg-clay-100 focus:px-3 focus:py-1 focus:text-[12px] focus:text-clay-800">
            {t("panes.graphSkipStitch")}
          </button>
        )}
        {shownList !== null && (
          <button onClick={skipToList} data-track="graph-skip-list" className="sr-only focus:not-sr-only focus:rounded-full focus:bg-clay-100 focus:px-3 focus:py-1 focus:text-[12px] focus:text-clay-800">
            {t("panes.graphSkipList")}
          </button>
        )}
        <span className="mr-auto text-[13px] whitespace-nowrap text-sand-600">
          {t("panes.graphCounts", {
            docs: ownDocs,
            ds: ownDocs === 1 ? "" : "s",
            links: acceptedLinks,
            ls: acceptedLinks === 1 ? "" : "s",
          })}
          {/* On a phone the header keeps one short line: Generated content counts them. */}
          {generatedCount > 0 && (
            <span className="max-md:hidden">
              {t("panes.graphCountsGenerated", { n: generatedCount, s: generatedCount === 1 ? "" : "s" })}
            </span>
          )}
        </span>
        {/* On md+ the pills stand in the row itself (contents); below md
            they take a line of their own under the title and the counts,
            one row that scrolls sideways. A pill never wraps its label. */}
        <div className="contents max-[900px]:order-1 max-[900px]:-mx-5 max-md:-mx-3 max-[900px]:flex max-[900px]:w-[calc(100%+40px)] max-md:w-[calc(100%+24px)] max-[900px]:items-center max-[900px]:gap-2 max-[900px]:overflow-x-auto max-[900px]:px-5 max-md:px-3 max-[900px]:pb-0.5 [&>button]:shrink-0 [&>button]:whitespace-nowrap">
          {nodes.length >= 2 && <FindBox find={view2.find} /> /* [view2] */}
          {canEdit && nodes.length >= 2 && (
            <button
              onClick={() => void scan()}
              data-track={scanning ? "graph-recommend-links-stop" : "graph-recommend-links"}
              disabled={!scanning && scanLeft <= 0}
              data-tip={
                scanning
                  ? t("panes.recommendScanStopTitle")
                  : scanLeft > 0
                    ? t("panes.recommendScanTitle", { left: scanLeft })
                    : t("panes.recommendScanSpentTitle")
              }
              className="ml-auto flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-[13px] text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40 max-[900px]:ml-0"
            >
              <SparkleIcon size={13} />
              {scanning ? t("panes.recommendScanRunning") : t("panes.recommendScan")}
              {/* The runs left this month: plain text, never a count chip,
                  so it does not read as a number of links (GR-07). */}
              {scanning ? (
                <StopPill />
              ) : (
                <span className="text-[11.5px] tabular-nums text-sand-500">
                  · {t("panes.recommendScanLeft", { left: scanLeft })}
                </span>
              )}
            </button>
          )}
          <button
            onClick={() => setList((v) => (v === "recommended" ? null : "recommended"))}
            data-track="graph-recommended-links"
            aria-expanded={listOpen}
            data-tip={t("panes.recommendedLinksToggleTitle")}
            className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] hover:bg-clay-100 hover:text-clay-800 ${
              listOpen
                ? "border-line bg-clay-100 text-clay-800"
                : recommended.length > 0
                  ? "border-dashed border-clay-400 text-clay-800"
                  : "border-line text-sand-600"
            }`}
          >
            <UnlinkIcon size={13} />
            {t("panes.recommendedLinks")}
            <span className="rounded-full bg-sand-200 px-1.5 text-[11px] font-semibold tabular-nums text-sand-700">
              {recommended.length}
            </span>
          </button>
          <button
            onClick={() => setList((v) => (v === "generated" ? null : "generated"))}
            data-track="graph-generated"
            aria-expanded={list === "generated"}
            data-tip={t("stitch.generatedToggleTitle")}
            className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] hover:bg-clay-100 hover:text-clay-800 ${
              list === "generated" ? "border-line bg-clay-100 text-clay-800" : "border-line text-sand-600"
            }`}
          >
            <PageIcon size={13} />
            {t("stitch.generated")}
            <span className="rounded-full bg-sand-200 px-1.5 text-[11px] font-semibold tabular-nums text-sand-700">
              {generated.length}
            </span>
          </button>
          <NotesListToggle open={list === "notes"} onToggle={() => setList((v) => (v === "notes" ? null : "notes"))} />
          <button
            onClick={() => setList((v) => (v === "links" ? null : "links"))}
            data-track="graph-links"
            aria-expanded={list === "links" || list === "link"}
            data-tip={t("panes.graphLinksToggleTitle")}
            className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] hover:bg-clay-100 hover:text-clay-800 ${
              list === "links" || list === "link" ? "border-line bg-clay-100 text-clay-800" : "border-line text-sand-600"
            }`}
          >
            <LinkIcon size={13} />
            {t("panes.graphLinks")}
            <span className="rounded-full bg-sand-200 px-1.5 text-[11px] font-semibold tabular-nums text-sand-700">
              {allLinks}
            </span>
          </button>
        </div>
        <button
          onClick={close}
          data-track="graph-close"
          aria-label={t("common.close")}
          data-tip={t("common.close")}
          className="flex size-8 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
        >
          ✕
        </button>
      </div>
      {scanNotice && (
        <p className="border-b border-line px-5 py-2 text-xs text-sand-600">{scanNotice}</p>
      )}
      <div className="relative min-h-0 flex-1">
        {loading ? null : loadFailed ? (
          // [view2] The graph's data did not arrive (offline with no copy, or a failed call).
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-sm text-sand-600">
            <p>{t("graphView.loadFailed")}</p>
            <button
              onClick={loadFailed}
              className="rounded-full border border-line px-3.5 py-1.5 text-[13px] text-sand-700 hover:bg-clay-100 hover:text-clay-800"
            >
              {t("graphView.loadRetry")}
            </button>
          </div>
        ) : nodes.length === 0 ? (
          <p className="flex h-full items-center justify-center px-8 text-center text-sm text-sand-600">
            {t("panes.graphEmpty")}
          </p>
        ) : (
          <GraphView
            notebookId={notebookId}
            activeDocumentId={activeDocumentId}
            nodes={nodes}
            edges={edges}
            onOpenDocument={leave}
            selectedIds={selectedIds}
            picking={picking}
            onToggleSelect={canEdit ? toggleSelect : undefined}
            insets={insets}
            citedIds={citedIds}
            onClearCited={clearCited}
            expandedLinkId={openLinkView?.id ?? null}
            onExpandLink={(linkId) => openLink(linkId, false)}
          />
        )}
        {/* One document, or no link yet: what to do next (GR-08). */}
        {emptyCard && (
          <div className="absolute top-3 left-1/2 z-10 flex w-[560px] max-w-[calc(100%-120px)] -translate-x-1/2 flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-line bg-card/95 px-4 py-3 text-[13px] text-sand-700 shadow-soft backdrop-blur-md max-sm:left-14 max-sm:max-w-[calc(100%-68px)] max-sm:translate-x-0">
            <p className="min-w-0 flex-1 basis-60">{emptyCard}</p>
            {nodes.length >= 2 && canEdit && scanLeft > 0 && (
              <button
                onClick={() => void scan()}
                disabled={scanning}
                data-track="graph-empty-recommend-links"
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-clay px-3.5 py-1.5 text-[12px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-50"
              >
                <SparkleIcon size={12} />
                {scanning ? t("panes.recommendScanRunning") : t("panes.recommendScan")}
              </button>
            )}
          </div>
        )}
        <Presence show={listOpen} exit="menu">
        {listOpen && (
          <RecommendedLinkList
            notebookId={notebookId}
            links={recommended}
            onOpenDocument={leave}
            proposedLinkIds={view2.proposedLinkIds /* [view2] */}
          />
        )}
        </Presence>
        <Presence show={list === "generated"} exit="menu">
        {list === "generated" && (
          <GeneratedList notebookId={notebookId} generated={generated} onOpenDocument={leave} />
        )}
        </Presence>
        <Presence show={list === "notes"} exit="menu">
        {list === "notes" && <GraphNotesList pickedIds={selectedIds} onClose={() => setList(null)} />}
        </Presence>
        <Presence show={list === "links"} exit="menu">
        {list === "links" && (
          <LinksList
            edges={edges}
            titleOf={titleOf}
            openLinkId={openLinkId}
            onOpen={(l) => openLink(l.id, true)}
            onClose={() => setList(null)}
          />
        )}
        </Presence>
        <Presence show={openLinkView !== null} exit="menu">
        {openLinkView && (
          <LinkPanel
            key={openLinkView.id}
            link={openLinkView}
            onBack={linkFromList ? () => setList("links") : undefined}
            onClose={() => setList(null)}
            onOpenDocument={leave}
          />
        )}
        </Presence>
        {/* [view2] The node card, and the Find list. */}
        {list === "document" && focusNode && (
          <NodeCardPanel
            notebookId={notebookId}
            node={focusNode}
            nodes={nodes}
            edges={edges}
            picked={selectedIds.has(focusNode.id)}
            onPick={canEdit ? () => toggleSelect(focusNode.id) : undefined}
            onOpenDocument={leave}
            onClose={() => setList(null)}
            sheet={cardSheet}
            onSheetHeight={setSheetHeight}
          />
        )}
        {list === "find" && (
          <FindList
            notebookId={notebookId}
            find={view2.find}
            nodes={nodes}
            canPick={canEdit}
            onPickAll={(ids) => setPickedIds(new Set(ids))}
            onAsk={(text) => {
              view2.askStitch(text);
              if (window.innerWidth < WIDE) {
                setList(null);
                setBoxOpen(true);
              }
            }}
            onOpenDocument={leave}
            onClose={() => setList(null)}
          />
        )}
        {/* [/view2] */}
        {nodes.length >= 2 && (
          // Where the box sits (BOX-03..06, BOX-19): centered at the foot;
          // left of an open list on a wide screen; clear of the Feedback
          // button at the bottom right between md and 1100px. The box draws
          // itself; this wrapper places it and measures it for the fit.
          // The box never takes more than 45% of the canvas: the conversation
          // scrolls inside it, and the graph keeps the rest (WALK2-04).
          <div
            ref={boxRef}
            data-stitch-slot
            className={`pointer-events-none absolute bottom-4 z-20 flex max-h-[45%] flex-col items-center [&>*]:pointer-events-auto ${
              listBesideBox
                ? "left-[max(16px,calc((100%-412px-680px)/2))] w-[min(680px,calc(100%-412px-32px))]"
                : "left-1/2 w-[680px] max-w-[calc(100%-32px)] -translate-x-1/2 md:max-[1099px]:max-w-[calc(100%-272px)]"
            }`}
          >
            <StitchBox
              notebookId={notebookId}
              nodes={nodes}
              generatedIds={generated.map((g) => g.id)}
              selectedIds={selectedIds}
              picking={picking}
              onPickingChange={setPicking}
              onUnpick={toggleSelect}
              onClearPick={() => setPickedIds(new Set())}
              onOpenDocument={leave}
              open={boxShown}
              onOpenChange={onBoxOpenChange}
              onShowRecommended={() => setList("recommended")}
              onCited={onCited}
              onProposed={onProposed /* [view2] */}
              prefill={view2.prefill /* [view2] */}
            />
          </div>
        )}
      </div>
    </div>
    </GraphContentProvider>
    </GraphNotesProvider>
  );
}

// The folded list: every recommended link of the project, newest first. A
// click on a link expands it: why the AI made it, and the passage at each
// end, with a button that opens the reader there. A link becomes real on
// Accept; Dismiss deletes it without a history entry — it never was one.
// Both refresh the page, so the curves redraw.
export function RecommendedLinkList({
  notebookId,
  links,
  onOpenDocument,
  proposedLinkIds,
}: {
  notebookId: string;
  links: RecommendedLinkView[];
  onOpenDocument: () => void;
  // [view2] The links the last Stitch answer proposed: first, and marked.
  proposedLinkIds?: Set<string>;
}) {
  const t = useT();
  const router = useRouter();
  const { canEdit } = useCollab();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // Accepted or dismissed here: the card leaves at once, before the server
  // answers, and comes back if the server refuses (SPEC.md §13).
  const [gone, setGone] = useState<Set<string>>(() => new Set());

  async function mutate(id: string, run: () => Promise<unknown>) {
    if (busyId) return;
    setBusyId(id);
    setErrorText(null);
    setGone((prev) => new Set(prev).add(id));
    try {
      await run();
      router.refresh();
    } catch (err) {
      setGone((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setErrorText(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setBusyId(null);
    }
  }
  const shown = links.filter((l) => !gone.has(l.id));
  const ordered = proposedLinkIds?.size
    ? [...shown].sort((a, b) => Number(proposedLinkIds.has(b.id)) - Number(proposedLinkIds.has(a.id)))
    : shown;

  function openDocument(documentId: string, linkId: string) {
    router.push(`/n/${notebookId}?doc=${documentId}&link=${linkId}`);
    onOpenDocument();
  }

  const quoteChip =
    "max-w-full truncate rounded-full bg-sand-200 px-2.5 py-0.5 text-left text-[11px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800";

  return (
    <aside
      data-track-surface="sidebar"
      className="menu-in absolute top-3 right-3 bottom-3 z-10 flex w-[400px] max-w-[calc(100vw-24px)] flex-col gap-2.5 overflow-y-auto rounded-[20px] border border-line bg-card/95 p-4 shadow-float backdrop-blur-md max-[999px]:bottom-16"
    >
      {shown.length > 0 && <p className="text-[11px] text-sand-500">{t("panes.recommendedLinksDesc")}</p>}
      {errorText && <p className="text-[13px] text-red-600">{errorText}</p>}
      {shown.length === 0 && (
        <p className="text-[13px] text-sand-600">{t("panes.recommendedLinksEmpty")}</p>
      )}
      {ordered.map((l) => {
        const open = openId === l.id;
        return (
        <div key={l.id} data-graph-recommended={l.id} className="rounded-2xl border border-dashed border-clay-300 bg-card p-3.5 shadow-soft">
          {proposedLinkIds?.has(l.id) && (
            <p className="mb-1 text-[10.5px] font-semibold text-[var(--kind-assistant)]">{t("graphView.fromLastAnswer")}</p>
          )}
          <button
            onClick={() => setOpenId(open ? null : l.id)}
            data-track="graph-link-expand"
            data-tip={t(open ? "panes.linkCollapse" : "panes.linkExpand")}
            aria-expanded={open}
            className="block w-full rounded-lg text-left hover:bg-clay-100/60"
          >
            <p className="text-[12.5px] leading-snug font-semibold">{l.reason ?? t("panes.linkNoReason")}</p>
            {!open && (
              <p className="mt-1.5 line-clamp-2 border-l-2 border-clay-300 pl-2 text-xs text-sand-600">
                {l.quotedText}
              </p>
            )}
            {!open && l.toQuotedText && (
              <p className="mt-1 line-clamp-2 border-l-2 border-sand-300 pl-2 text-xs text-sand-500">
                {l.toQuotedText}
              </p>
            )}
          </button>
          {open && (
            <div className="mt-2">
              <LinkDetail link={l} onOpen={(documentId) => openDocument(documentId, l.id)} />
              <LinkNoteComposer linkId={l.id} />
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {!open && (
              <>
                <button
                  onClick={() => openDocument(l.fromDocumentId, l.id)}
                  data-track="graph-link-open"
                  data-tip={t("panes.openLinkEnd", { title: l.fromTitle })}
                  className={quoteChip}
                >
                  {l.fromTitle}
                </button>
                <span className="text-[11px] text-sand-500">⇄</span>
                <button
                  onClick={() => openDocument(l.toDocumentId, l.id)}
                  data-track="graph-link-open"
                  data-tip={t("panes.openLinkEnd", { title: l.toTitle })}
                  className={quoteChip}
                >
                  {l.toTitle}
                </button>
              </>
            )}
            <AuthorChip createdById={l.createdById} nameless />
            {canEdit && !l.crossAccount?.outside && (
              <span className="ml-auto flex items-center gap-2">
                <button
                  onClick={() =>
                    void mutate(l.id, () => api(linkPath(l.id, notebookId), "PATCH", { accept: true }))
                  }
                  data-track="link-accept"
                  disabled={busyId !== null}
                  data-tip={t("panes.acceptLinkTitle")}
                  className="rounded-full bg-sage-600 px-3 py-1 text-[11px] font-semibold text-sage-fg hover:bg-sage-700 disabled:opacity-40"
                >
                  {t("panes.acceptLink")}
                </button>
                <button
                  onClick={() => void mutate(l.id, () => api(linkPath(l.id, notebookId), "DELETE"))}
                  data-track="link-dismiss"
                  disabled={busyId !== null}
                  data-tip={t("panes.dismissLinkTitle")}
                  className="rounded-full border border-line px-2.5 py-1 text-[11px] text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
                >
                  {t("panes.dismissLink")}
                </button>
              </span>
            )}
          </div>
          <ReplyThread target={{ docLinkId: l.id, notebookId }} replies={l.replies} crossAccount={l.crossAccount} />
        </div>
        );
      })}
    </aside>
  );
}

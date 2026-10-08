"use client";

import { ACTION, ACTION_ACCEPT, CLOSE, DOC_CHIP } from "./graph-ui";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { GeneratedDocumentView, GraphEdge, GraphEdgeLink, GraphNode, RecommendedLinkView } from "@/lib/types";
import { api } from "@/lib/api";
import { linkPath } from "@/lib/link-scope";
import { useCollab } from "@/components/collab/collab-context";
import { AuthorChip } from "@/components/collab/person-badge";
import { confirmLinkRemoval, linkRemovable } from "@/components/collab/confirm-link-removal";
import { ReplyThread } from "@/components/collab/reply-thread";
import { LinkIcon, PageIcon, SparkleIcon, UnlinkIcon } from "@/components/icons";
import { useLang, useT } from "@/components/lang-provider";
import { Presence } from "@/components/presence";
import { StopPill } from "@/components/thinking";
import { GeneratedList } from "@/components/graph/generated-list";
import { markAccepted, unmarkAccepted, useAcceptedNow } from "@/components/graph/accepted-now";
import { clearGraphKeep, readGraphKeep, writeGraphKeep, type GraphFocus } from "@/components/graph/graph-keep";
import { LinkPanel } from "@/components/graph/link-panel";
import { ListName } from "@/components/graph/list-name"; // [lists7]
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
import { DocumentsList } from "@/components/graph/documents-list"; // [docs3]
import { GraphCoverageProvider } from "@/components/graph/coverage"; // [cover4]
import { NoteGatherDock, NoteGatherProvider } from "@/components/graph/note-gather"; // [cover4]
const NO_GISTS: Record<string, string> = {};
// [/view2]

// reactflow loads only when the graph opens — the workspace bundle stays lean.
// The workspace starts the load on a hover or focus of the Graph button, on
// M, and on every open (preloadGraphView), so the chunk comes beside the
// graph's data instead of after it (COST4-06).
const loadGraphView = () => import("@/components/graph/graph-view");
export function preloadGraphView(): void {
  void loadGraphView().catch(() => {});
}
const GraphView = dynamic(loadGraphView, {
  ssr: false,
  loading: () => null,
});

// Narrow: the Stitch box starts folded so the canvas gets the screen; below
// WIDE, an open side list folds it, since both cannot fit beside each other.
const NARROW = 640;
const WIDE = 1000;
const LIST_ROOM = 412; // a side list's width and its margin

// [view2] The node card ("document") and the Find list ("find") are side lists too.
// [docs3] So is the Documents list ("documents").
type SideList = "recommended" | "generated" | "notes" | "links" | "link" | "document" | "find" | "documents" | null;
/** Where a link panel was opened from, for its Back. */
type LinkFrom = "links" | "notes" | "document" | "documents" | null;
const SIDE_LISTS: SideList[] = ["recommended", "generated", "notes", "links", "link", "document", "find", "documents"];
function sideList(value: string | null | undefined): SideList {
  return SIDE_LISTS.find((l) => l === value) ?? null;
}
// [ui5] WALK5-04
const LINK_FROMS: LinkFrom[] = ["links", "notes", "document", "documents"];
function linkFromValue(value: string | null | undefined): LinkFrom {
  return LINK_FROMS.find((l) => l === value) ?? null;
}
// [/ui5]

const NO_WRITTEN: Set<string> = new Set();

/** The id of a side list, for its pill's aria-controls. */
function sideListId(list: Exclude<SideList, null>): string {
  return `graph-list-${list}`;
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
  focus,
  onClose,
  onNavigate,
  gists,
  loading = false,
  loadFailed,
  stale = null,
}: {
  notebookId: string;
  activeDocumentId: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  recommended: RecommendedLinkView[];
  generated: GeneratedDocumentView[];
  /** Runs of Scan for links this account has left this month. */
  linkScansLeft: number;
  /** The project's notes, for the notes on the graph and the Notes list. */
  notes?: GraphNotesInput;
  /** What the graph opens on (workspace.tsx): a note's Notes list, or a
      link's panel. Null: where the reader was (graph-keep.ts). */
  focus?: GraphFocus | null;
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
  /** The last refetch failed: the graph shows the data as of `at` (REV3-10). */
  stale?: { at: number; retry: () => void } | null;
}) {
  const t = useT();
  const lang = useLang();
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
  // A focus wins over the kept view: Show on graph opens the Notes list on
  // its note, a link card's Show on graph or the rail from a reader at a
  // link opens that link's panel (VIEW3-04, VIEW3-09).
  const [list, setListState] = useState<SideList>(() =>
    focus?.noteId ? "notes" : focus?.linkId ? "link" : sideList(readGraphKeep(notebookId).list),
  );
  const [openLinkId, setOpenLinkId] = useState<string | null>(
    () => focus?.linkId ?? readGraphKeep(notebookId).linkId ?? null,
  );
  // The note Show on graph opened the Notes list on; it stays while the list is open.
  const [shownNoteId, setShownNoteIdState] = useState<string | null>(() =>
    focus ? (focus.noteId ?? null) : (readGraphKeep(notebookId).shownId ?? null),
  );
  const setShownNoteId = useCallback(
    (id: string | null) => {
      setShownNoteIdState(id);
      writeGraphKeep(notebookId, { shownId: id });
    },
    [notebookId],
  );
  useEffect(() => {
    if (!focus) return;
    writeGraphKeep(notebookId, {
      list: focus.noteId ? "notes" : "link",
      ...(focus.noteId ? { noteId: focus.noteId, shownId: focus.noteId } : { linkId: focus.linkId, linkFrom: null, shownId: null }),
    });
    // The focus is read once, when the graph opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The link panel's Back: to the list it was opened from — Links, the
  // Notes list's links between a note's documents, or the node card
  // (VIEW3-03).
  // [ui5] WALK5-04: the kept view carries it, so after a document and Back
  // the panel still has Back to Links and the Links pill still reads open.
  const [linkFrom, setLinkFrom] = useState<LinkFrom>(() => {
    if (focus) return null;
    const keep = readGraphKeep(notebookId);
    return keep.linkId && keep.linkId === openLinkId ? linkFromValue(keep.linkFrom) : null;
  });
  // [/ui5]
  const setList = useCallback(
    (next: SideList | ((prev: SideList) => SideList)) => {
      setListState((prev) => {
        const value = typeof next === "function" ? next(prev) : next;
        // The shown note lasts while the Notes list, or a link opened from
        // it, is open.
        const keepShown = value === "notes" || value === "link";
        if (!keepShown) setShownNoteIdState(null);
        writeGraphKeep(notebookId, { list: value, ...(keepShown ? {} : { shownId: null }) });
        return value;
      });
    },
    [notebookId],
  );
  // Focus (WALK3-06): a list opened from a pill or a row takes the focus,
  // and gives it back to that pill or row when it closes.
  const opener = useRef<HTMLElement | null>(null);
  const linkOpener = useRef<HTMLElement | null>(null);
  const focusList = useRef<SideList>(null);
  const openLink = useCallback(
    (linkId: string, from: LinkFrom) => {
      if (from && document.activeElement instanceof HTMLElement) linkOpener.current = document.activeElement;
      setOpenLinkId(linkId);
      setLinkFrom(from);
      setList("link");
      focusList.current = "link";
      writeGraphKeep(notebookId, { linkId, linkFrom: from }); // [ui5] WALK5-04
    },
    [notebookId, setList],
  );
  // The Links list opened while a card is pinned shows that document's
  // links (WALK3-15).
  const [linksFilter, setLinksFilter] = useState("");
  const linksOpen = list === "links" || (list === "link" && linkFrom === "links");
  const togglePill = (name: Exclude<SideList, null>, e: { currentTarget: HTMLElement }) => {
    opener.current = e.currentTarget;
    focusList.current = name;
    if (name === "links") setLinksFilter(list === "document" && focusNode ? focusNode.title : "");
    // A link opened from the Links list counts as that list: its pill closes
    // it. A link opened elsewhere (a curve, a card) gives way to the list.
    setList((v) => (v === name || (name === "links" && v === "link" && linkFrom === "links") ? null : name));
  };
  // The pill row scrolls sideways when the pills do not fit: a fade at its
  // right edge says more pills are there (WALK3-07).
  const pillRow = useRef<HTMLDivElement>(null);
  const [pillMore, setPillMore] = useState(false);
  const updatePillFade = useCallback(() => {
    const el = pillRow.current;
    if (el) setPillMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);
  useEffect(() => {
    const el = pillRow.current;
    if (!el) return;
    const observer = new ResizeObserver(updatePillFade);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => observer.disconnect();
  }, [updatePillFade]);
  // The provenance of generated documents: drawn, counted, and listed on
  // request, and kept with the view for Back (WALK3-13).
  const [showProvenance, setShowProvenanceState] = useState(() => readGraphKeep(notebookId).provenance === true);
  const setShowProvenance = useCallback(
    (show: boolean) => {
      setShowProvenanceState(show);
      writeGraphKeep(notebookId, { provenance: show });
    },
    [notebookId],
  );
  const linkById = useMemo(() => new Map(edges.flatMap((e) => e.links.map((l) => [l.id, l] as const))), [edges]);
  // [panel6] A link removed from its panel keeps the panel up on its last
  // copy, for the Undo line (WALK6-03).
  const [removedLink, setRemovedLink] = useState<GraphEdgeLink | null>(null);
  const openLinkView =
    list === "link" && openLinkId
      ? (linkById.get(openLinkId) ?? (removedLink?.id === openLinkId ? removedLink : null))
      : null;
  const titleOf = useMemo(() => new Map(nodes.map((n) => [n.id, n.title])), [nodes]);
  const listOpen = list === "recommended";
  // [view2] The node card ("document") and the Find list ("find") are side lists too.
  const nodeIdList = useMemo(() => nodes.map((n) => n.id), [nodes]);
  const view2 = useGraphContentState({ notebookId, nodeIds: nodeIdList, gists: gists ?? NO_GISTS, list, setList });
  const { onProposed } = view2;
  const clearFind = view2.find.clear;
  const generatedCommands = useMemo(() => new Map(generated.map((g) => [g.id, g.command ?? null])), [generated]);
  const recommendedLinkIds = useMemo(() => new Set(recommended.map((l) => l.id)), [recommended]);
  const openLinkFromCard = useCallback((linkId: string) => openLink(linkId, "document"), [openLink]);
  const content = useMemo(
    () => ({ ...view2.content, recommendedLinkIds, showProvenance, setShowProvenance, generatedCommands, openLinkFromCard }),
    [view2.content, recommendedLinkIds, showProvenance, setShowProvenance, generatedCommands, openLinkFromCard],
  );
  const focusNode = view2.focusedId ? (nodes.find((n) => n.id === view2.focusedId) ?? null) : null;
  const [sheetHeight, setSheetHeight] = useState(0);
  // [/view2]
  // A link gone since (dismissed, removed), or a card whose document is
  // gone: no panel, no list.
  const shownList: SideList =
    (list === "link" && !openLinkView) || (list === "document" && !focusNode) ? null : list;
  // Into the list that opened, back to its opener when it closes.
  const lastShown = useRef<SideList>(shownList);
  useEffect(() => {
    const prev = lastShown.current;
    lastShown.current = shownList;
    if (shownList && focusList.current === shownList) {
      focusList.current = null;
      requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>(`[data-graph-side-list="${shownList}"]`)?.focus());
      return;
    }
    if (prev && prev !== "document" && prev !== "find" && !shownList) {
      const active = document.activeElement;
      const lost = !active || active === document.body || (active instanceof Element && active.closest("[data-graph-side-list]"));
      const back = [prev === "link" ? linkOpener.current : null, opener.current].find((el) => el?.isConnected);
      if (lost && back) back.focus();
    }
  }, [shownList]);
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
  // Scan for links (SPEC.md §13): the scan the reader asks for. It reads
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

  // [ui5] VIEW5-10: Show on a note saved on the graph opens the Notes list
  // on it, its documents lit; the list mounts again so it opens on the note.
  const [showTurn, setShowTurn] = useState(0);
  const showHere = useCallback(
    (noteId: string) => {
      setShownNoteId(noteId);
      writeGraphKeep(notebookId, { noteId });
      setShowTurn((n) => n + 1);
      focusList.current = "notes";
      setList("notes");
    },
    [notebookId, setShownNoteId, setList],
  );
  // [/ui5]
  // [ui5] WALK5-09: a pinned card and a pick are said in the graph's status
  // line, so a screen reader hears what a click, Enter, or Space did.
  const [said, setSaid] = useState("");
  const cardShownId = list === "document" && focusNode ? focusNode.id : null;
  // What was last said of: compared during the render, as React advises
  // for state that follows props.
  const [saidOf, setSaidOf] = useState({ card: cardShownId, picked: selectedIds });
  if (saidOf.card !== cardShownId || saidOf.picked !== selectedIds) {
    setSaidOf({ card: cardShownId, picked: selectedIds });
    const prev = saidOf.picked;
    const added = [...selectedIds].filter((id) => !prev.has(id));
    const removed = [...prev].filter((id) => !selectedIds.has(id));
    const n = selectedIds.size;
    const s = n === 1 ? "" : "s";
    const one = added.length + removed.length === 1 ? titleOf.get(added[0] ?? removed[0]) : undefined;
    const cardTitle = cardShownId && saidOf.card !== cardShownId ? titleOf.get(cardShownId) : undefined;
    if (added.length + removed.length > 0) {
      if (n === 0) setSaid(t("graphView.pickClearedStatus"));
      else if (one) setSaid(t(added.length ? "graphView.pickedStatus" : "graphView.unpickedStatus", { title: one, n, s }));
      else setSaid(t("graphView.pickedManyStatus", { n, s }));
    } else if (cardTitle) setSaid(t("graphView.cardShownStatus", { title: cardTitle }));
  }
  // [/ui5]

  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  // Leaving a text box with Escape (WALK4-07): the focus goes to the box's
  // region — the side list it sits in, else the graph's title — never to the
  // page, so a screen reader and the next Tab start from there. A search
  // box holding words keeps the focus: Escape clears it (the browser's own).
  const leaveTextBox = useCallback((box: HTMLElement) => {
    if (box instanceof HTMLInputElement && box.type === "search" && box.value !== "") return;
    const home = box.closest<HTMLElement>("[data-graph-side-list][tabindex]") ?? titleRef.current;
    if (home) home.focus({ preventScroll: true });
    else box.blur();
  }, []);
  // A link opened from a list goes back to that list, with the focus on its
  // row: the panel's Back, and the first Escape (WALK4-07).
  const backFromLink = useCallback(() => {
    if (!linkFrom || !openLinkId) return;
    const from = linkFrom;
    setList(from);
    const row =
      from === "links"
        ? `[data-graph-links-row="${openLinkId}"]`
        : from === "notes"
          ? `[data-graph-notes-link="${openLinkId}"]`
          : from === "documents"
            ? `[data-graph-documents-link="${openLinkId}"]`
            : `[data-graph-card-link="${openLinkId}"]`;
    requestAnimationFrame(() => requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>(row)?.focus()));
  }, [linkFrom, openLinkId, setList]);

  // Escape (GR-11) closes the innermost thing first and never throws away
  // typed words: in a text box it only leaves the box (the words stay);
  // then picking ends; then a link opened from a list goes back to the
  // list; then an open list closes; only then the graph. The
  // canvas (a pinned link list, the key) and the Stitch box handle their
  // own first, in the capture phase, and mark the event handled; this
  // listener runs in the bubble phase, after them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.stopPropagation();
      if (isTextBox(e.target)) {
        leaveTextBox(e.target);
        return;
      }
      if (picking) setPicking(false);
      else if (list === "link" && linkFrom && openLinkView) backFromLink();
      else if (list === "find") clearFind(); // [lists7] WALK7-08
      else if (list) setList(null);
      else close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, picking, list, setList, linkFrom, openLinkView, backFromLink, leaveTextBox, clearFind]);

  // The skip links (REV2-10): to the Stitch text box (the box opens first
  // when it is folded), or to the first control of the open side list.
  const skipToStitch = useCallback(() => {
    onBoxOpenChange(true);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const slot = boxRef.current;
        const box = slot?.querySelector<HTMLTextAreaElement>("textarea");
        if (box) {
          // The caret after the kept words, so new words follow them (WALK4-08).
          box.focus();
          box.setSelectionRange(box.value.length, box.value.length);
        } else slot?.querySelector<HTMLElement>("button")?.focus();
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
  // Links accepted here count at once, before the refetch shows them (WALK4-15).
  const acceptedNow = useAcceptedNow();
  const acceptedHere = acceptedNow.size === 0 ? 0 : edges.reduce((sum, e) => sum + e.links.filter((l) => l.recommended && acceptedNow.has(l.id)).length, 0);
  const acceptedLinks = edges.reduce((sum, e) => sum + e.accepted, 0) + acceptedHere;
  const generatedCount = nodes.filter((n) => n.kind === "generated").length;
  const ownDocs = nodes.length - generatedCount;
  const generatedNodeIds = useMemo(() => nodes.filter((n) => n.kind === "generated").map((n) => n.id), [nodes]);
  // [chrome6] VIEW6-03: the generated documents the graph opened with. One
  // that appears later is a page Stitch wrote in this visit: the canvas
  // keeps it drawn and lit until the graph closes, switch off or on.
  const [generatedAtOpen] = useState(() => new Set(nodes.filter((n) => n.kind === "generated").map((n) => n.id)));
  const writtenIds = useMemo(() => {
    const fresh = generatedNodeIds.filter((id) => !generatedAtOpen.has(id));
    return fresh.length === 0 ? NO_WRITTEN : new Set(fresh);
  }, [generatedNodeIds, generatedAtOpen]);
  const allLinks = edges.reduce((sum, e) => sum + e.links.filter((l) => !l.recommended && !l.provenance).length, 0) + acceptedHere;
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
  const cardSheet = (list === "document" || list === "documents") && windowWidth < NARROW;
  const cardBeside = (list === "document" || list === "find" || list === "documents") && windowWidth >= NARROW;
  const insets = useMemo<GraphInsets>(
    () => ({
      top: emptyCard ? 96 : 0,
      right: listBesideBox || cardBeside ? LIST_ROOM : 0,
      // [lists7] VIEW7-09: the sheet stands 64 px above the canvas's foot.
      bottom: cardSheet && sheetHeight > 0 ? sheetHeight + 72 : boxHeight > 0 ? boxHeight + 16 : 0,
      left: 0,
    }),
    [emptyCard, listBesideBox, cardBeside, cardSheet, sheetHeight, boxHeight],
  );

  return (
    <GraphNotesProvider notebookId={notebookId} nodes={nodes} input={notes} onClose={close} onNavigate={leave} onShowHere={showHere /* [ui5] */}>
    <GraphCoverageProvider notebookId={notebookId /* [cover4] */}>
    <NoteGatherProvider notebookId={notebookId /* [cover4] */}>
    <GraphContentProvider value={content}>
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
        {/* [docs3] The counts open the Documents list. */}
        <button
          onClick={(e) => togglePill("documents", e)}
          disabled={nodes.length === 0}
          data-track="graph-documents"
          aria-expanded={list === "documents"}
          aria-controls={sideListId("documents")}
          data-tip={t("panes.graphDocumentsToggleTitle")}
          className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] whitespace-nowrap hover:bg-clay-100 hover:text-clay-800 disabled:pointer-events-none max-md:px-2.5 ${
            /* [style7] VIEW7-06: drawn as the pill it is, like Notes and Links beside it. */
            list === "documents" ? "border-line bg-clay-100 text-clay-800" : "border-line text-sand-600"
          }`}
        >
          {t("panes.graphCounts", {
            docs: ownDocs,
            ds: ownDocs === 1 ? "" : "s",
            links: acceptedLinks,
            ls: acceptedLinks === 1 ? "" : "s",
          })}
          {/* Below 1500px the header keeps one short line, so the pills fit
              beside it: Generated content counts them. */}
          {generatedCount > 0 && (
            <span className="max-[1500px]:hidden">
              {t("panes.graphCountsGenerated", { n: generatedCount, s: generatedCount === 1 ? "" : "s" })}
            </span>
          )}
        </button>
        {/* Above 900px the pills fill the rest of the row, right-aligned,
            and scroll sideways when they do not fit, so the close button
            stays in view; below they take a line of their own under the
            title and the counts, one row that scrolls sideways. A pill
            never wraps its label. */}
        <div
          ref={pillRow}
          onScroll={updatePillFade}
          data-more={pillMore ? "" : undefined}
          className="graph-pill-row flex min-w-0 items-center gap-3 overflow-x-auto py-0.5 [scrollbar-width:thin] min-[901px]:flex-1 min-[901px]:[&>*:first-child]:ml-auto max-[900px]:order-1 max-[900px]:-mx-5 max-md:-mx-3 max-[900px]:flex max-[900px]:w-[calc(100%+40px)] max-md:w-[calc(100%+24px)] max-[900px]:items-center max-[900px]:gap-2 max-[900px]:overflow-x-auto max-[900px]:px-5 max-md:px-3 max-[900px]:pb-0.5 [&>button]:shrink-0 [&>button]:whitespace-nowrap"
        >
          {nodes.length >= 2 && <FindBox find={view2.find} /> /* [view2] */}
          {/* The lists by use: Notes and Links first (WALK3-07). Below
              1400px the less used pills show their mark, a short name, and
              their count; the full name is in the tooltip and read by a
              screen reader (WALK4-12). */}
          <NotesListToggle open={list === "notes"} onToggle={(e) => togglePill("notes", e)} controls={sideListId("notes")} />
          <button
            onClick={(e) => togglePill("links", e)}
            data-track="graph-links"
            aria-expanded={linksOpen}
            aria-controls={sideListId("links")}
            data-tip={t("panes.graphLinksDesc") /* [chrome6] WALK6-08: the list's intro, here */}
            className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] hover:bg-clay-100 hover:text-clay-800 max-md:gap-1 max-md:px-2 ${
              linksOpen ? "border-line bg-clay-100 text-clay-800" : "border-line text-sand-600"
            }`}
          >
            <LinkIcon size={13} />
            {/* [chrome6] VIEW6-08: on a phone, the mark and the count. */}
            <span className="max-md:sr-only">{t("panes.graphLinks")}</span>
            <span className="rounded-full bg-sand-200 px-1.5 text-[11px] font-semibold tabular-nums text-sand-700">
              {allLinks}
            </span>
          </button>
          <button
            onClick={(e) => togglePill("recommended", e)}
            data-track="graph-recommended-links"
            aria-expanded={listOpen}
            aria-controls={sideListId("recommended")}
            data-tip={`${t("panes.recommendedLinks")}: ${t("panes.recommendedLinksDesc")}${canEdit && nodes.length >= 2 ? ` ${t("panes.recommendedLinksScanHere")}` : ""}`}
            className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] hover:bg-clay-100 hover:text-clay-800 max-[1399px]:px-2.5 max-md:gap-1 max-md:px-2 ${
              listOpen
                ? "border-line bg-clay-100 text-clay-800"
                : recommended.length > 0
                  ? "border-dashed border-clay-400 text-clay-800"
                  : "border-line text-sand-600"
            }`}
          >
            <UnlinkIcon size={13} />
            <span className="max-[1399px]:sr-only">{t("panes.recommendedLinks")}</span>
            <span aria-hidden className="max-md:hidden min-[1400px]:hidden">{t("panes.recommendedLinksShort")}</span>
            <span className="rounded-full bg-sand-200 px-1.5 text-[11px] font-semibold tabular-nums text-sand-700">
              {recommended.length}
            </span>
          </button>
          {/* [chrome6] VIEW6-03: no pill for an empty list. */}
          {generated.length > 0 && (
          <button
            onClick={(e) => togglePill("generated", e)}
            data-track="graph-generated"
            aria-expanded={list === "generated"}
            aria-controls={sideListId("generated")}
            data-tip={`${t("stitch.generated")}: ${t("stitch.generatedDesc")}`}
            className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] hover:bg-clay-100 hover:text-clay-800 max-[1399px]:px-2.5 max-md:gap-1 max-md:px-2 ${
              list === "generated" ? "border-line bg-clay-100 text-clay-800" : "border-line text-sand-600"
            }`}
          >
            <PageIcon size={13} />
            <span className="max-[1399px]:sr-only">{t("stitch.generated")}</span>
            <span aria-hidden className="max-md:hidden min-[1400px]:hidden">{t("stitch.generatedShort")}</span>
            <span className="rounded-full bg-sand-200 px-1.5 text-[11px] font-semibold tabular-nums text-sand-700">
              {generated.length}
            </span>
          </button>
          )}
        </div>
        <button
          onClick={close}
          data-track="graph-close"
          aria-label={t("common.close")}
          data-tip={t("common.close")}
          className="flex size-8 shrink-0 items-center max-[900px]:ml-auto justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
        >
          ✕
        </button>
      </div>
      {/* [ui5] WALK5-09 */}
      <p role="status" data-graph-status className="sr-only">{said}</p>
      {scanNotice && (
        <p className="border-b border-line px-5 py-2 text-xs text-sand-600">{scanNotice}</p>
      )}
      {stale && (
        // A refetch failed: the graph shows what it had, and says so (REV3-10).
        <p role="status" data-graph-stale className="flex items-center gap-3 border-b border-line px-5 py-2 text-xs text-sand-600">
          {t("graphView.staleNotice", {
            time: new Date(stale.at).toLocaleTimeString(lang === "zh" ? "zh-CN" : "en-US", { hour: "numeric", minute: "2-digit" }),
          })}
          <button
            onClick={stale.retry}
            className="rounded-full border border-line px-2.5 py-0.5 text-[11.5px] text-sand-700 hover:bg-clay-100 hover:text-clay-800"
          >
            {t("graphView.loadRetry")}
          </button>
        </p>
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
            onExpandLink={(linkId) => openLink(linkId, null)}
            writtenIds={writtenIds /* [chrome6] */}
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
            onClose={() => setList(null)}
            scan={
              canEdit && nodes.length >= 2 ? (main: boolean) => (
                // [chrome6] VIEW6-02, WALK6-08: Scan for links in the list it fills.
                // [lists7] WALK7-02: at the head row's right end, short, beside ✕;
                // the main action only under an empty list's line.
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
                  aria-label={main || scanning ? undefined : t("panes.recommendScan")}
                  className={`${ACTION} min-w-0 self-start`}
                >
                  <SparkleIcon size={11} />
                  {scanning ? t("panes.recommendScanRunning") : t(main ? "panes.recommendScan" : "panes.recommendScanShort")}
                  {/* The runs left this month: plain text, never a count chip,
                      so it does not read as a number of links (GR-07). */}
                  {scanning ? (
                    <StopPill />
                  ) : (
                    <span className="font-normal tabular-nums text-sand-500">· {t("panes.recommendScanLeft", { left: scanLeft })}</span>
                  )}
                </button>
              ) : undefined
            }
          />
        )}
        </Presence>
        <Presence show={list === "generated"} exit="menu">
        {list === "generated" && (
          <GeneratedList notebookId={notebookId} generated={generated} onOpenDocument={leave} onClose={() => setList(null)} />
        )}
        </Presence>
        <Presence show={list === "notes"} exit="menu">
        {list === "notes" && (
          <GraphNotesList
            key={showTurn /* [ui5] VIEW5-10 */}
            pickedIds={selectedIds}
            shownId={shownNoteId}
            onClearShown={() => setShownNoteId(null)}
            edges={edges}
            onOpenLink={(linkId) => openLink(linkId, "notes")}
            onClose={() => setList(null)}
          />
        )}
        </Presence>
        <Presence show={list === "links"} exit="menu">
        {list === "links" && (
          <LinksList
            edges={edges}
            titleOf={titleOf}
            openLinkId={openLinkId}
            onOpen={(l) => openLink(l.id, "links")}
            initialFilter={linksFilter}
            onClose={() => setList(null)}
          />
        )}
        </Presence>
        <Presence show={openLinkView !== null} exit="menu">
        {openLinkView && (
          <LinkPanel
            key={openLinkView.id}
            link={openLinkView}
            onBack={linkFrom ? backFromLink : undefined}
            backLabel={
              linkFrom === "document"
                ? t("graphView.cardBack")
                : linkFrom === "notes"
                  ? t("graphNotes.notesBack")
                  : linkFrom === "documents"
                    ? t("panes.graphDocumentsBack")
                    : undefined
            }
            onClose={() => setList(null)}
            onOpenDocument={leave}
            onRemoved={setRemovedLink}
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
            picked={selectedIds}
            onPickAll={(ids) => setPickedIds((prev) => new Set([...prev, ...ids]))}
            onAsk={(text) => {
              view2.askStitch(text);
              if (window.innerWidth < WIDE) {
                setList(null);
                setBoxOpen(true);
              }
            }}
            onOpenDocument={leave}
            onClose={view2.find.clear /* [lists7] WALK7-08: ✕ clears the find, as the field's ✕ does */}
          />
        )}
        {/* [/view2] */}
        {list === "documents" && (
          <DocumentsList
            notebookId={notebookId}
            nodes={nodes}
            edges={edges}
            openLinkId={openLinkId}
            onOpenLink={(linkId) => openLink(linkId, "documents")}
            onOpenDocument={leave}
            onClose={() => setList(null)}
            sheet={cardSheet}
            onSheetHeight={setSheetHeight}
          />
        )}
        {/* [cover4] Add to note's new note, at the foot of the side list (VIEW4-03). */}
        <NoteGatherDock
          notebookId={notebookId}
          onOpenDocument={leave}
          onWritePage={
            canEdit
              ? (ids, command) => {
                  // Write a page from these (VIEW5-05): the quotes' documents
                  // join the pick, the command goes in the box, nothing is sent.
                  setPickedIds((prev) => new Set([...prev, ...ids]));
                  view2.askStitch(command);
                  if (window.innerWidth < WIDE) {
                    setList(null);
                    setBoxOpen(true);
                  }
                }
              : undefined
          }
          boxOpen={boxShown}
          onFoldBox={() => setBoxOpen(false)}
        />
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
              generatedIds={generatedNodeIds}
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
    </NoteGatherProvider>
    </GraphCoverageProvider>
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
  scan,
  onClose,
}: {
  notebookId: string;
  links: RecommendedLinkView[];
  onOpenDocument: () => void;
  // [view2] The links the last Stitch answer proposed: first, and marked.
  proposedLinkIds?: Set<string>;
  /** [chrome6] Scan for links (VIEW6-02). [lists7] WALK7-02: main = the
      empty list's one action; else the head row's short pill. */
  scan?: (main: boolean) => ReactNode;
  /** [chrome6] The ✕ the other side lists have (VIEW6-11). */
  onClose?: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const { canEdit } = useCollab();
  const [errorText, setErrorText] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // Accepted or dismissed here: the card leaves at once, before the server
  // answers, and comes back if the server refuses (SPEC.md §13). Each card
  // is decided on its own: the next card's Accept works while one is in
  // flight.
  const [gone, setGone] = useState<Set<string>>(() => new Set());

  async function mutate(id: string, run: () => Promise<unknown>) {
    if (gone.has(id)) return;
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

  // [chrome6] VIEW6-11: the two ends on one line, each at most 45%.
  const quoteChip =
    `${DOC_CHIP} max-w-[45%] text-left`;

  return (
    <aside
      data-track-surface="sidebar"
      data-graph-side-list="recommended"
      id="graph-list-recommended"
      tabIndex={-1}
      aria-label={t("panes.recommendedLinks")}
      className="menu-in absolute top-3 right-3 z-10 max-h-[calc(100%-24px)] flex w-[400px] max-w-[calc(100vw-24px)] flex-col gap-2.5 overflow-y-auto rounded-[20px] border border-line bg-card/95 p-4 shadow-float outline-none backdrop-blur-md max-[999px]:max-h-[calc(100%-76px)]"
    >
      {/* [chrome6] VIEW6-02, VIEW6-11: one head row. [lists7] WALK7-01/02:
          the list's name, then Scan for links and ✕ at the right end. The
          list's intro is the pill's tooltip (WALK6-08). */}
      <div className="flex items-center gap-2">
        <ListName grow>{t("panes.recommendedLinks")}</ListName>
        {shown.length > 0 && scan?.(false)}
        {onClose && (
          <button
            onClick={onClose}
            data-track="graph-recommended-close"
            aria-label={t("common.close")}
            data-tip={t("common.close")}
            className={`-mr-1 ${CLOSE}`}
          >
            ✕
          </button>
        )}
      </div>
      {errorText && <p className="text-[13px] text-red-600">{errorText}</p>}
      {shown.length === 0 && (
        <>
          <p className="text-[13px] text-sand-600">{t(scan ? "panes.recommendedLinksEmpty" : "panes.recommendedLinksNone")}</p>
          {scan?.(true)}
        </>
      )}
      {ordered.map((l) => {
        const open = openId === l.id;
        return (
        <div key={l.id} data-graph-recommended={l.id} className="rounded-2xl border border-dashed border-clay-300 bg-card p-3.5 shadow-soft">
          {proposedLinkIds?.has(l.id) && (
            <p className="mb-1 text-[10.5px] font-semibold text-[var(--kind-assistant)]">{t("graphView.fromLastAnswer")}</p>
          )}
          {/* [chrome6] VIEW6-11: Accept and Dismiss on the reason's line,
              each passage one line until the card opens, the two ends on
              one line: about 120 px a card. */}
          <div className="flex items-start gap-2">
            <button
              onClick={() => setOpenId(open ? null : l.id)}
              data-track="graph-link-expand"
              data-tip={t(open ? "panes.linkCollapse" : "panes.linkExpand")}
              aria-expanded={open}
              className="block min-w-0 flex-1 rounded-lg text-left hover:bg-clay-100/60"
            >
              <span className="block text-[12.5px] leading-snug font-semibold">{l.reason ?? t("panes.linkNoReason")}</span>
            </button>
            {canEdit && !l.crossAccount?.outside && (
              <span className="flex shrink-0 items-center gap-1.5">
                <button
                  onClick={() =>
                    void mutate(l.id, async () => {
                      // The header counts it at once (WALK4-15).
                      markAccepted(l.id);
                      try {
                        await api(linkPath(l.id, notebookId), "PATCH", { accept: true });
                      } catch (err) {
                        unmarkAccepted(l.id);
                        throw err;
                      }
                    })
                  }
                  data-track="link-accept"
                  data-tip={t("panes.acceptLinkTitle")}
                  className={ACTION_ACCEPT}
                >
                  {t("panes.acceptLink")}
                </button>
                {linkRemovable(l.crossAccount) && (
                  <button
                    onClick={() => {
                      if (!confirmLinkRemoval(t, l.replies.length, "dismiss")) return;
                      void mutate(l.id, () => api(linkPath(l.id, notebookId), "DELETE"));
                    }}
                    data-track="link-dismiss"
                    data-tip={t("panes.dismissLinkTitle")}
                    className={ACTION}
                  >
                    {t("panes.dismissLink")}
                  </button>
                )}
              </span>
            )}
          </div>
          {!open && (
            // The passages open the card too; the reason is its Tab stop.
            <button
              onClick={() => setOpenId(l.id)}
              tabIndex={-1}
              aria-hidden
              className="mt-1 block w-full rounded-lg text-left hover:bg-clay-100/60"
            >
              <span className="block truncate border-l-2 border-clay-300 pl-2 text-xs text-sand-600">{l.quotedText}</span>
              {l.toQuotedText && (
                <span className="mt-0.5 block truncate border-l-2 border-sand-300 pl-2 text-xs text-sand-500">{l.toQuotedText}</span>
              )}
            </button>
          )}
          {open && (
            <div className="mt-2">
              <LinkDetail link={l} onOpen={(documentId) => openDocument(documentId, l.id)} />
              <LinkNoteComposer linkId={l.id} />
            </div>
          )}
          <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
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
                <span className="shrink-0 text-[11px] text-sand-500">⇄</span>
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
            <span className="ml-auto shrink-0">
              <AuthorChip createdById={l.createdById} nameless />
            </span>
          </div>
          <ReplyThread target={{ docLinkId: l.id, notebookId }} replies={l.replies} crossAccount={l.crossAccount} />
        </div>
        );
      })}
    </aside>
  );
}

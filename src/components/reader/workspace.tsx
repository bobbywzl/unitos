"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  CorpusDistillationView,
  GraphEdge,
  GraphNode,
  HistoryEntry,
  NotebookView,
  RecommendedLinkView,
} from "@/lib/types";
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CommentIcon,
  DistillIcon,
  EditsIcon,
  ExpandIcon,
  GraphIcon,
  MoreIcon,
  NotesIcon,
  QuestionIcon,
  SparkleIcon,
} from "@/components/icons";
import { ClickTracker } from "@/components/click-tracker";
import { CollabProvider, type CollabState } from "@/components/collab/collab-context";
import { HistoryControl } from "@/components/collab/history-control";
import { ShareControl } from "@/components/collab/share-control";
import { OfflineStatus } from "@/components/offline-status";
import { useNotebookSync } from "@/components/collab/use-sync";
import { GraphOverlay } from "@/components/graph/graph-overlay";
import { CorpusDistillPage } from "@/components/reader/corpus-distill-page";
import { ContextTab, type ContextValues } from "@/components/context-tab";
import { GuideDialog } from "@/components/guide-dialog";
import { useT } from "@/components/lang-provider";
import { NotebookTitle } from "@/components/notebook-title";
import { FloatingNoteEditor } from "@/components/outline/floating-note-editor";
import { NotesTray } from "@/components/outline/notes-tray";
import { Presence } from "@/components/presence";
import { useOutline } from "@/components/outline/use-outline";
import { DocumentBar, type AttachedDocument } from "@/components/reader/document-bar";
import type { ReaderViewKind } from "@/components/reader/reader-panes";
import type { DriveConfig } from "@/lib/drive/config";
import type { TKey } from "@/lib/i18n/dictionaries";
import { RESTORE_STYLE_ID, RESTORE_STYLE_MS, restoreScript, trayStateKey } from "@/lib/reading-position";

type Tab = "notes" | "assistant" | "distill" | "annotations" | "edits";

const TAB_TITLES: Record<Tab, TKey> = {
  notes: "panes.notes",
  assistant: "panes.assistant",
  distill: "panes.distill",
  annotations: "panes.annotations",
  edits: "panes.edits",
};

const RAIL_BUTTON =
  "relative flex size-[38px] items-center justify-center rounded-full text-sand-600 hover:bg-clay-100 hover:text-clay-800";
const RAIL_BUTTON_ON = "relative flex size-[38px] items-center justify-center rounded-full bg-clay-200 text-clay-800";
// The strip's edge buttons (a split view): one scrolls to the tray, one back
// to the documents. md+ only — below md the tray is a sheet, never a screen.
const STRIP_BUTTON =
  "absolute top-1/2 z-30 hidden size-8 -translate-y-1/2 items-center justify-center rounded-full bg-card text-sand-600 shadow-float hover:text-clay-800 md:flex print:hidden";

// Tray width bounds: the bar between the reader and the tray drags within
// these, so it can never overextend — the tray keeps a readable minimum and
// the reader keeps room for the article column.
const TRAY_DEFAULT = 352;
const TRAY_MIN = 280;
const TRAY_MAX = 640;
const READER_MIN = 420;
const RAIL_WIDTH = 52;
const TRAY_WIDTH_STORE = "unitos-tray-width";

function clampTrayWidth(width: number): number {
  const window_ = typeof window !== "undefined" ? window.innerWidth : 1440;
  const max = Math.max(TRAY_MIN, Math.min(TRAY_MAX, window_ - READER_MIN - RAIL_WIDTH));
  return Math.round(Math.max(TRAY_MIN, Math.min(width, max)));
}

// The tray (design 1a): the document owns the page, notes live in a drawer on the
// right, and the drawer folds down to the icon strip. The strip never leaves, so
// notes and the assistant are always one click away.
export function Workspace({
  notebook,
  documents,
  readerView,
  activeDocumentId,
  drive,
  reader,
  assistant,
  distillPanel,
  annotationsPanel,
  editsPanel,
  annotationCount,
  distillationCount,
  context,
  collab,
  rev,
  graph,
  history,
  corpusDistillations,
}: {
  notebook: NotebookView;
  documents: AttachedDocument[];
  // The reader view (reader-panes.tsx): a split view puts the reader and the
  // tray in the strip below.
  readerView: ReaderViewKind;
  activeDocumentId: string | null;
  drive: DriveConfig | null;
  reader: React.ReactNode;
  assistant: React.ReactNode;
  distillPanel: React.ReactNode;
  annotationsPanel: React.ReactNode;
  editsPanel: React.ReactNode;
  annotationCount: number;
  distillationCount: number;
  context: { initial: ContextValues | null; hasOverride: boolean; isSet: boolean };
  collab: CollabState;
  rev: number;
  graph: { nodes: GraphNode[]; edges: GraphEdge[]; recommended: RecommendedLinkView[] };
  history: HistoryEntry[];
  corpusDistillations: CorpusDistillationView[];
}) {
  const t = useT();
  const canEdit = collab.canEdit;
  const { tree, pending, actions, lastRejected, undoReject } = useOutline(notebook, canEdit);
  // Live sync: poll the corpus's rev, refresh when another account changes it,
  // and learn who else is here (SPEC.md gained this with sharing).
  const presence = useNotebookSync({
    notebookId: notebook.id,
    documentId: activeDocumentId,
    rev,
    enabled: true,
    accountId: collab.authOn ? collab.myId : null,
  });
  const [collapsed, setCollapsed] = useState(false);
  // Set while the tray is folded for a floating note (below), so that fold is
  // neither remembered as the reader's choice nor left behind.
  const foldedForFloat = useRef(false);
  // Below md the tray is a bottom sheet over the reader, opened from the
  // bottom bar; mobileTray tracks it. On md+ the md: overrides put the same
  // aside back in the side column, so the flag is inert there.
  const [mobileTray, setMobileTray] = useState(false);
  // The tray's width on md+: dragged by the bar between the reader and the
  // tray, clamped by clampTrayWidth, remembered per browser.
  const [trayWidth, setTrayWidth] = useState(TRAY_DEFAULT);
  // While the bar is dragged the tray column follows the pointer with no
  // transition; the slide is for collapse and expand.
  const [resizing, setResizing] = useState(false);
  const [tab, setTab] = useState<Tab>("notes");
  // The tray's collapsed state and tab, per tab and per project: a full page
  // load (a new deploy turns the next refresh into one) reopened the tray on
  // notes over a reader that had folded it (reader report). The inline
  // restore script (lib/reading-position.ts) keeps a folded tray folded
  // before the first paint; this restores the state itself after hydration
  // and saves it on every change after that.
  const trayStoreKey = trayStateKey(notebook.id);
  // The restored state, until the render carrying it lands: the save below
  // must not write the defaults over it first. undefined = not read yet;
  // null = nothing stored, or already landed.
  const trayRestore = useRef<{ collapsed: boolean; tab: Tab } | null | undefined>(undefined);
  useLayoutEffect(() => {
    let saved: { collapsed: boolean; tab: Tab } | null = null;
    try {
      const raw = sessionStorage.getItem(trayStoreKey);
      const stored = raw ? (JSON.parse(raw) as { collapsed?: unknown; tab?: unknown }) : null;
      if (stored && typeof stored.collapsed === "boolean") {
        const storedTab =
          typeof stored.tab === "string" && stored.tab in TAB_TITLES && (stored.tab !== "assistant" || canEdit)
            ? (stored.tab as Tab)
            : "notes";
        saved = { collapsed: stored.collapsed, tab: storedTab };
      }
    } catch {
      // storage unavailable: the tray opens on notes
    }
    trayRestore.current = saved;
    if (saved) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setCollapsed(saved.collapsed);
      setTab(saved.tab);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [trayStoreKey, canEdit]);
  useEffect(() => {
    const pending = trayRestore.current;
    if (pending === undefined) return;
    if (foldedForFloat.current) return;
    if (pending && (pending.collapsed !== collapsed || pending.tab !== tab)) return;
    trayRestore.current = null;
    try {
      sessionStorage.setItem(trayStoreKey, JSON.stringify({ collapsed, tab }));
    } catch {
      // storage unavailable: nothing to remember
    }
  }, [trayStoreKey, collapsed, tab]);
  // The script's style rules leave once React owns the tray and the entrance
  // fades are past: the tray can then slide, and the fade cannot start late.
  useEffect(() => {
    const timer = setTimeout(() => document.getElementById(RESTORE_STYLE_ID)?.remove(), RESTORE_STYLE_MS);
    return () => clearTimeout(timer);
  }, []);
  const [menuOpen, setMenuOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  // The ? nudge for a new reader (the welcome flow points here): a pulsing
  // dot on the guide button until the guide is opened once on this browser.
  // Revealed a frame after hydration, so server and client render alike.
  const [guideNudge, setGuideNudge] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      try {
        setGuideNudge(localStorage.getItem("unitos-guide-seen") === null);
      } catch {
        // storage unavailable: no nudge
      }
    });
    return () => cancelAnimationFrame(id);
  }, []);
  function openGuide() {
    setGuideOpen(true);
    setGuideNudge(false);
    try {
      localStorage.setItem("unitos-guide-seen", "1");
    } catch {
      // storage unavailable: the nudge returns next visit
    }
  }
  const [graphOpen, setGraphOpen] = useState(false);
  // The corpus distilled page: null = closed; { shownId } open (null = ask view).
  const [corpusDistill, setCorpusDistill] = useState<{ shownId: string | null } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const noteCount = countNotes(tree);

  // The strip (SPEC.md §6). In a split view on md+ the reader keeps the width
  // it has with the tray folded — the two panes fill the browser exactly —
  // and the tray is a screen past the reader's right edge: the reader and
  // the tray column sit in a strip that scrolls sideways and snaps to one of
  // two rests, the documents or the tray. Opening a tab scrolls to the tray;
  // the edge buttons and a sideways scroll move between the two; folding the
  // tray scrolls back to the documents first, then the column closes.
  const split = readerView !== "normal";
  const stripRef = useRef<HTMLDivElement>(null);
  const trayColumnRef = useRef<HTMLDivElement>(null);
  // Which edge the strip rests at; the edge buttons show for the other one.
  const [stripEdge, setStripEdge] = useState({ start: true, end: true });
  // Scroll the strip to the tray. The column has its width the moment it
  // opens (no width transition in a split view), so the next frame reaches it.
  const revealTray = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return;
    requestAnimationFrame(() =>
      strip.scrollTo({ left: strip.scrollWidth - strip.clientWidth, behavior: "smooth" }),
    );
  }, []);
  // The strip's scroll position, read once per frame: the edge it rests at,
  // and --strip-cut for the panes — how much of the reader's left is hidden
  // behind the strip's edge (globals.css .reader-column). While the strip
  // moves, the columns follow the cut without their transition.
  useEffect(() => {
    const strip = stripRef.current;
    const column = trayColumnRef.current;
    if (!strip || !split) return;
    let raf = 0;
    let settle = 0;
    const measure = () => {
      raf = 0;
      const max = strip.scrollWidth - strip.clientWidth;
      const left = strip.scrollLeft;
      strip.style.setProperty("--strip-cut", `${Math.round(left)}px`);
      const next = { start: left <= 2, end: left >= max - 2 };
      setStripEdge((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    const onScroll = () => {
      strip.classList.add("strip-scrolling");
      window.clearTimeout(settle);
      settle = window.setTimeout(() => strip.classList.remove("strip-scrolling"), 160);
      schedule();
    };
    schedule();
    strip.addEventListener("scroll", onScroll);
    const observer = new ResizeObserver(schedule);
    observer.observe(strip);
    if (column) observer.observe(column);
    return () => {
      strip.removeEventListener("scroll", onScroll);
      observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(settle);
      strip.classList.remove("strip-scrolling");
      strip.style.removeProperty("--strip-cut");
    };
  }, [split]);
  // Folding in a split view: the column keeps its width while the strip
  // scrolls back to the documents, then closes. Opening: the strip scrolls to
  // the tray. Normal view keeps its width transition as the motion. Before
  // the paint, so the folded column never shows for a frame.
  const wasCollapsed = useRef(collapsed);
  useLayoutEffect(() => {
    const was = wasCollapsed.current;
    wasCollapsed.current = collapsed;
    const strip = stripRef.current;
    const column = trayColumnRef.current;
    if (!split || !strip || !column || was === collapsed) return;
    if (!collapsed) {
      revealTray();
      return;
    }
    if (strip.scrollLeft <= 2) return;
    column.style.width = column.style.getPropertyValue("--tray-w");
    strip.scrollTo({ left: 0, behavior: "smooth" });
    const timer = window.setTimeout(() => {
      column.style.width = "";
    }, 420);
    return () => {
      window.clearTimeout(timer);
      column.style.width = "";
    };
  }, [collapsed, split, revealTray]);

  // Issue cards jump to their note: open the tray on notes, open the note if
  // it is collapsed (the card listens for dissect:open-note), scroll, flash.
  useEffect(() => {
    const flash = (el: HTMLElement) => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("anchor-flash");
      setTimeout(() => el.classList.remove("anchor-flash"), 2000);
    };
    const onShowNote = (e: Event) => {
      const { noteId } = (e as CustomEvent<{ noteId: string }>).detail;
      setCollapsed(false);
      setTab("notes");
      revealTray();
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("dissect:open-note", { detail: { noteId } }));
        // The next frame: the opened card has its full height to center on.
        requestAnimationFrame(() => {
          const el = document.querySelector<HTMLElement>(`[data-note-id="${noteId}"]`);
          if (el) flash(el);
        });
      }, 100);
    };
    // Clicking a highlight in the text focuses its card in the Annotations
    // tab, opening the card if it is collapsed (dissect:open-annotation).
    const onFocusAnnotation = (e: Event) => {
      const { sourceId } = (e as CustomEvent<{ sourceId: string }>).detail;
      setCollapsed(false);
      setTab("annotations");
      revealTray();
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("dissect:open-annotation", { detail: { sourceId } }));
        requestAnimationFrame(() => {
          const el = document.querySelector<HTMLElement>(
            `[data-annotation-source-id="${sourceId}"]`,
          );
          if (el) flash(el);
        });
      }, 150);
    };
    // The Distill tab opens the corpus distilled page (SPEC.md §13).
    const onOpenCorpusDistillation = (e: Event) => {
      const { distillationId } = (e as CustomEvent<{ distillationId: string | null }>).detail;
      setCorpusDistill({ shownId: distillationId });
    };
    window.addEventListener("dissect:show-note", onShowNote);
    window.addEventListener("dissect:focus-annotation", onFocusAnnotation);
    window.addEventListener("dissect:open-corpus-distillation", onOpenCorpusDistillation);
    return () => {
      window.removeEventListener("dissect:show-note", onShowNote);
      window.removeEventListener("dissect:focus-annotation", onFocusAnnotation);
      window.removeEventListener("dissect:open-corpus-distillation", onOpenCorpusDistillation);
    };
  }, [revealTray]);

  // Post-hydration restore on purpose: localStorage is client-only, so the
  // SSR pass must render the default width. Window resizes re-clamp, so the
  // bar never rests past its bounds.
  useEffect(() => {
    const stored = Number(localStorage.getItem(TRAY_WIDTH_STORE));
    if (Number.isFinite(stored) && stored > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTrayWidth(clampTrayWidth(stored));
    }
    const onResize = () => setTrayWidth((w) => clampTrayWidth(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function applyTrayWidth(width: number) {
    const next = clampTrayWidth(width);
    setTrayWidth(next);
    localStorage.setItem(TRAY_WIDTH_STORE, String(next));
  }

  function startTrayResize(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    const fromX = e.clientX;
    const fromWidth = trayWidth;
    let latest = fromWidth;
    setResizing(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const onMove = (ev: PointerEvent) => {
      latest = clampTrayWidth(fromWidth + (fromX - ev.clientX));
      setTrayWidth(latest);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setResizing(false);
      localStorage.setItem(TRAY_WIDTH_STORE, String(latest));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  function show(next: Tab) {
    if (mobileTray && tab === next) {
      setMobileTray(false);
      return;
    }
    setTab(next);
    setCollapsed(false);
    setMobileTray(true);
    revealTray();
  }

  // A note floats over the article (dragged out of the tray): the tray folds
  // so the card has the room, and unfolds when the card docks or closes.
  // Docking opens the tray on notes on its own (onDock below); this undoes
  // only the fold it made, so a tray the reader had folded stays folded.
  const floatingId = actions.floating?.id ?? null;
  const collapsedRef = useRef(collapsed);
  useEffect(() => {
    collapsedRef.current = collapsed;
  }, [collapsed]);
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (floatingId) {
      setMobileTray(false);
      if (!collapsedRef.current) {
        foldedForFloat.current = true;
        setCollapsed(true);
      }
    } else if (foldedForFloat.current) {
      foldedForFloat.current = false;
      setCollapsed(false);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [floatingId]);

  return (
    // print: the shell flattens to plain flow so the whole document prints,
    // not one screen of the scroll pane; chrome and trays hide.
    <CollabProvider value={collab}>
    {/* Click telemetry (SPEC.md §7): the header, the rail, and the tray are
        the surfaces; every control in them carries data-track. */}
    <ClickTracker notebookId={notebook.id} />
    <div
      // A note floats over the article: the article column moves left (globals.css, .reader-column).
      data-note-floating={actions.floating ? "" : undefined}
      // One column that can never grow past the browser: a pane's widest
      // line stays inside its pane instead of pushing the rail off screen.
      className="content-in grid h-screen grid-cols-[minmax(0,1fr)] grid-rows-[68px_1fr] bg-paper print:block print:h-auto"
    >
      <header
        data-track-surface="topbar"
        className="flex min-w-0 items-center gap-2 border-b border-line px-3 sm:gap-3.5 sm:px-5 print:hidden"
      >

        <Link
          href="/"
          data-track="back"
          aria-label={t("panes.allCorpora")}
          data-tip={t("panes.allCorporaTitle")}
          className="flex size-[38px] shrink-0 items-center justify-center rounded-full text-sand-700 hover:bg-clay-100 hover:text-clay-800"
        >
          <ArrowLeftIcon size={18} />
        </Link>
        <NotebookTitle id={notebook.id} title={notebook.title} />
        <span aria-hidden className="hidden size-[5px] shrink-0 rounded-full bg-sand-400 sm:block" />
        {/* No overflow clipping here: the document list and the + menu drop
            below the header. The one pill truncates instead of scrolling. */}
        <div className="mr-auto flex min-w-0">
          <DocumentBar
            notebookId={notebook.id}
            documents={documents}
            activeId={activeDocumentId}
            drive={drive}
          />
        </div>
        <OfflineStatus />
        <ShareControl notebookId={notebook.id} presence={presence} />
        <div className="hidden md:block">
          <HistoryControl history={history} />
        </div>
        {canEdit && (
          <ContextTab
            notebookId={notebook.id}
            initial={context.initial}
            hasOverride={context.hasOverride}
            isSet={context.isSet}
          />
        )}
        {pending.length > 0 && (
          <span className="hidden shrink-0 rounded-full bg-clay-200 px-3.5 py-1.5 text-xs font-semibold text-clay-800 lg:inline">
            {t("panes.pendingCount", { n: pending.length })}
          </span>
        )}
        <button
          onClick={openGuide}
          data-track="guide"
          data-nudge="guide"
          aria-label={t("panes.guide")}
          data-tip={t("panes.guideTitle")}
          className="relative hidden size-[38px] shrink-0 items-center justify-center rounded-full text-sand-600 hover:bg-clay-100 hover:text-clay-800 md:flex"
        >
          <QuestionIcon size={18} />
          {guideNudge && (
            <span aria-hidden className="absolute top-1 right-1 size-2 rounded-full bg-clay">
              <span className="absolute inset-0 motion-safe:animate-ping rounded-full bg-clay" />
            </span>
          )}
        </button>
      </header>

      {/* A note's editor taken out of the tray, over the article. Docking it
          opens the tray on notes, where the note's card reopens the editor. */}
      {actions.floating && (
        <FloatingNoteEditor
          key={actions.floating.id}
          edit={actions.floating}
          actions={actions}
          onDock={() => show("notes")}
        />
      )}

      <div className="relative flex min-h-0 min-w-0 pb-[calc(54px+env(safe-area-inset-bottom))] md:pb-0 print:block">
        {/* The strip: in a split view (globals.css .reader-strip) the reader
            keeps the strip's full width and the tray column follows past its
            right edge; in Normal view it is a plain row, reader then tray. */}
        <div
          ref={stripRef}
          className={`flex min-h-0 min-w-0 flex-1 print:block ${split ? "reader-strip" : ""}`}
        >
        <div
          className={`relative min-w-0 flex-1 overflow-hidden print:overflow-visible ${
            split ? "reader-screen" : ""
          }`}
        >
          {reader}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[72px] bg-gradient-to-b from-transparent to-paper print:hidden"
          />
        </div>

        {/* The tray column: on md+ it slides shut to zero width when collapsed
            and the reader takes the room; below md the aside inside is a
            bottom sheet, shown while mobileTray is set. In a split view the
            width changes at once — the strip's scroll is the motion. */}
        <div
          ref={trayColumnRef}
          style={{ "--tray-w": `${trayWidth}px` } as React.CSSProperties}
          inert={(collapsed && !mobileTray) || undefined}
          className={`tray-column flex min-h-0 shrink-0 md:overflow-hidden ${
            resizing || split ? "tray-column-resizing" : ""
          } ${collapsed ? "md:w-0" : "md:w-[var(--tray-w)]"}`}
        >
          {/* The bar between the reader and the tray: drag to resize, arrow
              keys nudge, double-click resets. It floats over the tray's left
              border, so the layout gains no width. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("panes.resizeTray")}
            data-tip={t("panes.resizeTrayTitle")}
            tabIndex={0}
            onPointerDown={startTrayResize}
            onDoubleClick={() => applyTrayWidth(TRAY_DEFAULT)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") {
                e.preventDefault();
                applyTrayWidth(trayWidth + 16);
              }
              if (e.key === "ArrowRight") {
                e.preventDefault();
                applyTrayWidth(trayWidth - 16);
              }
            }}
            className="group relative z-10 -mr-[10px] hidden w-[10px] shrink-0 cursor-col-resize outline-none md:block print:hidden"
          >
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 w-[3px] rounded-full bg-transparent transition-colors group-hover:bg-clay-300 group-focus-visible:bg-clay-400"
            />
          </div>
          <aside
            data-track-surface="tray"
            className={`${
              mobileTray
                ? "sheet-in fixed inset-x-0 bottom-[calc(54px+env(safe-area-inset-bottom))] z-30 flex max-h-[70dvh] rounded-t-[24px] border-t shadow-float md:static md:z-auto md:max-h-none md:rounded-none md:border-t-0 md:shadow-none"
                : "hidden md:flex"
            } min-h-0 w-full min-w-0 shrink flex-col gap-3.5 border-line bg-sand-100 p-[18px] pb-4 md:w-[var(--tray-w)] md:shrink-0 md:border-l print:hidden`}
          >
            {/* The rail's chevron collapses the tray; the header stays clean. */}
            <div className="flex items-center gap-2.5">
              <span className="font-display text-[18px]">{t(TAB_TITLES[tab])}</span>
              {tab === "notes" && <span className="text-[13px] text-sand-600">{noteCount}</span>}
              {tab === "distill" && distillationCount > 0 && (
                <span className="text-[13px] text-sand-600">{distillationCount}</span>
              )}
              {tab === "annotations" && annotationCount > 0 && (
                <span className="text-[13px] text-sand-600">{annotationCount}</span>
              )}
              <button
                onClick={() => setMobileTray(false)}
                data-track="close"
                aria-label={t("common.close")}
                data-tip={t("common.close")}
                className="ml-auto rounded-full px-2 text-sand-500 hover:text-clay-800 md:hidden"
              >
                ✕
              </button>
            </div>

            {/* Keyed by tab: switching remounts the panel, and it rises in. */}
            <div key={tab} className="panel-in min-h-0 flex-1 overflow-y-auto">
              {tab === "notes" && <NotesTray tree={tree} pending={pending} actions={actions} />}
              {tab === "assistant" && assistant}
              {tab === "distill" && distillPanel}
              {tab === "annotations" && annotationsPanel}
              {tab === "edits" && editsPanel}
            </div>

            {lastRejected && (
              <div className="flex shrink-0 items-center gap-3 rounded-full bg-card px-4 py-2.5 shadow-soft">
                <span className="text-[13px] text-sand-600">{t("panes.noteRejected")}</span>
                <button
                  onClick={() => void undoReject()}
                  data-track="undo-reject"
                  data-tip={t("outline.undoRejectTitle")}
                  className="ml-auto rounded-full bg-clay px-3.5 py-1 text-xs font-semibold text-clay-fg hover:bg-clay-600"
                >
                  {t("panes.undo")}
                </button>
              </div>
            )}

            {tab === "notes" && (
              <Link
                href={`/n/${notebook.id}/notes`}
                data-track="notes-full-page"
                data-tip={t("panes.notesFullPageTitle")}
                className="flex shrink-0 items-center justify-center gap-2 rounded-full bg-card px-4 py-2.5 text-[13px] font-semibold text-sand-700 shadow-soft hover:bg-clay-100 hover:text-clay-800"
              >
                <ExpandIcon size={15} />
                {t("panes.notesFullPage")}
              </Link>
            )}
          </aside>
        </div>
        </div>

        {/* The strip's edges: a button to scroll to the tray, one to scroll
            back to the documents — for a mouse with no sideways scroll. Only
            the edge with a screen past it shows one. */}
        {split && !collapsed && !stripEdge.start && (
          <button
            onClick={() => stripRef.current?.scrollTo({ left: 0, behavior: "smooth" })}
            data-track="strip-documents"
            aria-label={t("panes.stripToDocuments")}
            data-tip={t("panes.stripToDocuments")}
            className={`${STRIP_BUTTON} left-2`}
          >
            <ChevronLeftIcon size={16} />
          </button>
        )}
        {split && !collapsed && !stripEdge.end && (
          <button
            onClick={revealTray}
            data-track="strip-tray"
            aria-label={t("panes.stripToTray")}
            data-tip={t("panes.stripToTray")}
            className={`${STRIP_BUTTON} right-[60px]`}
          >
            <ChevronRightIcon size={16} />
          </button>
        )}

        <nav
          data-track-surface="sidebar"
          data-nudge="rail"
          aria-label={t("panes.workspace")}
          className="fixed inset-x-0 bottom-0 z-30 flex h-[calc(54px+env(safe-area-inset-bottom))] flex-row items-center justify-around border-t border-line bg-sand-100 px-3 pt-1 pb-[env(safe-area-inset-bottom)] md:static md:z-auto md:h-auto md:w-[52px] md:shrink-0 md:flex-col md:justify-start md:gap-1.5 md:border-t-0 md:border-l md:px-0 md:pt-2.5 md:pb-2.5 print:hidden"
        >
          <button
            onClick={() => {
              setCollapsed(!collapsed);
              setMobileTray(false);
            }}
            data-track="collapse-tray"
            aria-label={collapsed ? t("panes.expandTray") : t("panes.collapseTray")}
            data-tip={collapsed ? t("panes.expandTray") : t("panes.collapseTray")}
            className={`max-md:hidden ${RAIL_BUTTON}`}
          >
            {collapsed ? <ChevronLeftIcon /> : <ChevronRightIcon />}
          </button>

          {canEdit && (
            <button
              onClick={() => show("assistant")}
              data-track="assistant"
              aria-label={t("panes.assistant")}
              data-tip={t("panes.assistantTabTitle")}
              aria-current={!collapsed && tab === "assistant"}
              className={!collapsed && tab === "assistant" ? RAIL_BUTTON_ON : RAIL_BUTTON}
            >
              <SparkleIcon />
            </button>
          )}

          <button
            onClick={() => setGraphOpen(true)}
            data-track="graph"
            aria-label={t("panes.graph")}
            data-tip={t("panes.graphTitle")}
            className={RAIL_BUTTON}
          >
            <GraphIcon />
          </button>

          <button
            onClick={() => show("notes")}
            data-track="notes"
            aria-label={t("panes.notes")}
            data-tip={t("panes.notesTabTitle")}
            aria-current={!collapsed && tab === "notes"}
            className={!collapsed && tab === "notes" ? RAIL_BUTTON_ON : RAIL_BUTTON}
          >
            <NotesIcon />
            {pending.length > 0 && (
              <span className="absolute -top-[3px] -right-[3px] flex size-4 items-center justify-center rounded-full bg-clay text-[10px] font-bold text-clay-fg">
                {pending.length}
              </span>
            )}
          </button>

          <button
            onClick={() => show("annotations")}
            data-track="annotations"
            aria-label={t("panes.annotations")}
            data-tip={t("panes.annotationsTabTitle")}
            aria-current={!collapsed && tab === "annotations"}
            className={!collapsed && tab === "annotations" ? RAIL_BUTTON_ON : RAIL_BUTTON}
          >
            <CommentIcon />
          </button>

          <button
            onClick={() => show("distill")}
            data-track="distill"
            aria-label={t("panes.distill")}
            data-tip={t("panes.distillTabTitle")}
            aria-current={!collapsed && tab === "distill"}
            className={!collapsed && tab === "distill" ? RAIL_BUTTON_ON : RAIL_BUTTON}
          >
            <DistillIcon />
          </button>

          <button
            onClick={() => show("edits")}
            data-track="edits"
            aria-label={t("panes.editHistory")}
            data-tip={t("panes.editsTabTitle")}
            aria-current={!collapsed && tab === "edits"}
            className={!collapsed && tab === "edits" ? RAIL_BUTTON_ON : RAIL_BUTTON}
          >
            <EditsIcon />
          </button>

          <div ref={menuRef} className="relative md:mt-auto">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              data-track="more"
              aria-label={t("panes.more")}
              data-tip={t("panes.moreTitle")}
              aria-expanded={menuOpen}
              className={RAIL_BUTTON}
            >
              <MoreIcon />
            </button>
            <Presence show={menuOpen} exit="menu">
            {menuOpen && (
              <div className="menu-in absolute right-0 bottom-full mb-2 flex w-44 flex-col overflow-hidden rounded-2xl bg-card py-1 shadow-float">
                <Link
                  href={`/n/${notebook.id}/notes`}
                  data-track="more-notes-full-page"
                  className="px-4 py-2 text-sm text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                >
                  {t("panes.notesFullPage")}
                </Link>
                <Link
                  href="/settings"
                  data-track="more-settings"
                  className="px-4 py-2 text-sm text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                >
                  {t("common.settings")}
                </Link>
              </div>
            )}
            </Presence>
          </div>
        </nav>
      </div>

      <GuideDialog open={guideOpen} onClose={() => setGuideOpen(false)} />
      <Presence show={corpusDistill !== null} exit="fade">
      {corpusDistill && (
        <CorpusDistillPage
          notebookId={notebook.id}
          activeDocumentId={activeDocumentId}
          distillations={corpusDistillations}
          shownId={corpusDistill.shownId}
          sectionChoices={actions.sectionChoices}
          onClose={() => setCorpusDistill(null)}
        />
      )}
      </Presence>
      <Presence show={graphOpen} exit="fade">
      {graphOpen && (
        <GraphOverlay
          notebookId={notebook.id}
          activeDocumentId={activeDocumentId}
          nodes={graph.nodes}
          edges={graph.edges}
          recommended={graph.recommended}
          onClose={() => setGraphOpen(false)}
        />
      )}
      </Presence>
      {/* Last in the workspace, so every pane and the tray are parsed when it
          runs: the reading position and the folded tray are back before the
          first paint of a full page load. Server render only — the browser
          does not run a script React inserts. */}
      <script dangerouslySetInnerHTML={{ __html: restoreScript(notebook.id) }} />
    </div>
    </CollabProvider>
  );
}

function countNotes(sections: NotebookView["sections"]): number {
  return sections.reduce((sum, s) => sum + s.notes.length + countNotes(s.children), 0);
}

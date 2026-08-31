"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CorpusDistillationView, GraphEdge, GraphNode, HistoryEntry, NotebookView } from "@/lib/types";
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
import { CollabProvider, type CollabState } from "@/components/collab/collab-context";
import { HistoryControl } from "@/components/collab/history-control";
import { ShareControl } from "@/components/collab/share-control";
import { useNotebookSync } from "@/components/collab/use-sync";
import { GraphOverlay } from "@/components/graph/graph-overlay";
import { CorpusDistillPage } from "@/components/reader/corpus-distill-page";
import { ProjectSearch } from "@/components/reader/project-search";
import { ContextTab, type ContextValues } from "@/components/context-tab";
import { GuideDialog } from "@/components/guide-dialog";
import { useT } from "@/components/lang-provider";
import { NotebookTitle } from "@/components/notebook-title";
import { NotesTray } from "@/components/outline/notes-tray";
import { useOutline } from "@/components/outline/use-outline";
import { DocumentBar, type AttachedDocument } from "@/components/reader/document-bar";
import type { TKey } from "@/lib/i18n/dictionaries";

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

// The tray (design 1a): the document owns the page, notes live in a drawer on the
// right, and the drawer folds down to the icon strip. The strip never leaves, so
// notes and the assistant are always one click away.
export function Workspace({
  notebook,
  documents,
  activeDocumentId,
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
  activeDocumentId: string | null;
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
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
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
  // Below md the tray is a bottom sheet over the reader, opened from the
  // bottom bar; mobileTray tracks it. On md+ the md: overrides put the same
  // aside back in the side column, so the flag is inert there.
  const [mobileTray, setMobileTray] = useState(false);
  const [tab, setTab] = useState<Tab>("notes");
  const [menuOpen, setMenuOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  // The corpus distilled page: null = closed; { shownId } open (null = ask view).
  const [corpusDistill, setCorpusDistill] = useState<{ shownId: string | null } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const noteCount = countNotes(tree);

  // Issue cards jump to their note: open the tray on notes, scroll, flash.
  useEffect(() => {
    const onShowNote = (e: Event) => {
      const { noteId } = (e as CustomEvent<{ noteId: string }>).detail;
      setCollapsed(false);
      setTab("notes");
      setTimeout(() => {
        const el = document.querySelector<HTMLElement>(`[data-note-id="${noteId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("anchor-flash");
          setTimeout(() => el.classList.remove("anchor-flash"), 2000);
        }
      }, 100);
    };
    // Clicking a highlight in the text focuses its card in the Annotations tab.
    const onFocusAnnotation = (e: Event) => {
      const { sourceId } = (e as CustomEvent<{ sourceId: string }>).detail;
      setCollapsed(false);
      setTab("annotations");
      setTimeout(() => {
        const el = document.querySelector<HTMLElement>(
          `[data-annotation-source-id="${sourceId}"]`,
        );
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("anchor-flash");
          setTimeout(() => el.classList.remove("anchor-flash"), 2000);
        }
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
  }, []);

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
  }

  return (
    // print: the shell flattens to plain flow so the whole document prints,
    // not one screen of the scroll pane; chrome and trays hide.
    <CollabProvider value={collab}>
    <div className="grid h-screen grid-rows-[68px_1fr] bg-paper print:block print:h-auto">
      <header className="flex min-w-0 items-center gap-2 border-b border-line px-3 sm:gap-3.5 sm:px-5 print:hidden">
        <Link
          href="/"
          aria-label={t("panes.allCorpora")}
          className="flex size-[38px] shrink-0 items-center justify-center rounded-full text-sand-700 hover:bg-clay-100 hover:text-clay-800"
        >
          <ArrowLeftIcon size={18} />
        </Link>
        <NotebookTitle id={notebook.id} title={notebook.title} />
        <span aria-hidden className="hidden size-[5px] shrink-0 rounded-full bg-sand-400 sm:block" />
        <div className="mr-auto flex min-w-0 overflow-x-auto">
          <DocumentBar
            notebookId={notebook.id}
            documents={documents}
            activeId={activeDocumentId}
          />
        </div>
        <ProjectSearch notebookId={notebook.id} />
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
          onClick={() => setGuideOpen(true)}
          aria-label={t("panes.guide")}
          title={t("panes.guideTitle")}
          className="hidden size-[38px] shrink-0 items-center justify-center rounded-full text-sand-600 hover:bg-clay-100 hover:text-clay-800 md:flex"
        >
          <QuestionIcon size={18} />
        </button>
      </header>

      <div className="flex min-h-0 pb-[calc(54px+env(safe-area-inset-bottom))] md:pb-0 print:block">
        <div className="relative min-w-0 flex-1 overflow-hidden print:overflow-visible">
          {reader}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[72px] bg-gradient-to-b from-transparent to-paper print:hidden"
          />
        </div>

        {(!collapsed || mobileTray) && (
          <aside
            className={`${
              mobileTray
                ? "fixed inset-x-0 bottom-[calc(54px+env(safe-area-inset-bottom))] z-30 flex max-h-[70dvh] rounded-t-[24px] border-t shadow-float md:static md:z-auto md:max-h-none md:rounded-none md:border-t-0 md:shadow-none"
                : "hidden md:flex"
            } min-h-0 w-full min-w-0 shrink flex-col gap-3.5 border-line bg-sand-100 p-[18px] pb-4 md:w-[352px] md:shrink-0 md:border-l print:hidden`}
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
                aria-label={t("common.close")}
                className="ml-auto rounded-full px-2 text-sand-500 hover:text-clay-800 md:hidden"
              >
                ✕
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
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
                  className="ml-auto rounded-full bg-clay px-3.5 py-1 text-xs font-semibold text-clay-fg hover:bg-clay-600"
                >
                  {t("panes.undo")}
                </button>
              </div>
            )}

            {tab === "notes" && (
              <Link
                href={`/n/${notebook.id}/notes`}
                title={t("panes.notesFullPageTitle")}
                className="flex shrink-0 items-center justify-center gap-2 rounded-full bg-card px-4 py-2.5 text-[13px] font-semibold text-sand-700 shadow-soft hover:bg-clay-100 hover:text-clay-800"
              >
                <ExpandIcon size={15} />
                {t("panes.notesFullPage")}
              </Link>
            )}
          </aside>
        )}

        <nav
          aria-label={t("panes.workspace")}
          className="fixed inset-x-0 bottom-0 z-30 flex h-[calc(54px+env(safe-area-inset-bottom))] flex-row items-center justify-around border-t border-line bg-sand-100 px-3 pt-1 pb-[env(safe-area-inset-bottom)] md:static md:z-auto md:h-auto md:w-[52px] md:shrink-0 md:flex-col md:justify-start md:gap-1.5 md:border-t-0 md:border-l md:px-0 md:pt-2.5 md:pb-2.5 print:hidden"
        >
          <button
            onClick={() => {
              setCollapsed(!collapsed);
              setMobileTray(false);
            }}
            aria-label={collapsed ? t("panes.expandTray") : t("panes.collapseTray")}
            className={`max-md:hidden ${RAIL_BUTTON}`}
          >
            {collapsed ? <ChevronLeftIcon /> : <ChevronRightIcon />}
          </button>

          {canEdit && (
            <button
              onClick={() => show("assistant")}
              aria-label={t("panes.assistant")}
              aria-current={!collapsed && tab === "assistant"}
              className={!collapsed && tab === "assistant" ? RAIL_BUTTON_ON : RAIL_BUTTON}
            >
              <SparkleIcon />
            </button>
          )}

          <button
            onClick={() => show("notes")}
            aria-label={t("panes.notes")}
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
            onClick={() => show("distill")}
            aria-label={t("panes.distill")}
            aria-current={!collapsed && tab === "distill"}
            className={!collapsed && tab === "distill" ? RAIL_BUTTON_ON : RAIL_BUTTON}
          >
            <DistillIcon />
          </button>

          <button
            onClick={() => setGraphOpen(true)}
            aria-label={t("panes.graph")}
            title={t("panes.graphTitle")}
            className={RAIL_BUTTON}
          >
            <GraphIcon />
          </button>

          <button
            onClick={() => show("annotations")}
            aria-label={t("panes.annotations")}
            aria-current={!collapsed && tab === "annotations"}
            className={!collapsed && tab === "annotations" ? RAIL_BUTTON_ON : RAIL_BUTTON}
          >
            <CommentIcon />
          </button>

          <button
            onClick={() => show("edits")}
            aria-label={t("panes.editHistory")}
            aria-current={!collapsed && tab === "edits"}
            className={!collapsed && tab === "edits" ? RAIL_BUTTON_ON : RAIL_BUTTON}
          >
            <EditsIcon />
          </button>

          <div ref={menuRef} className="relative md:mt-auto">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label={t("panes.more")}
              aria-expanded={menuOpen}
              className={RAIL_BUTTON}
            >
              <MoreIcon />
            </button>
            {menuOpen && (
              <div className="absolute right-0 bottom-full mb-2 flex w-44 flex-col overflow-hidden rounded-2xl bg-card py-1 shadow-float">
                <Link
                  href={`/n/${notebook.id}/notes`}
                  className="px-4 py-2 text-sm text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                >
                  {t("panes.notesFullPage")}
                </Link>
                <Link
                  href="/settings"
                  className="px-4 py-2 text-sm text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                >
                  {t("common.settings")}
                </Link>
              </div>
            )}
          </div>
        </nav>
      </div>

      <GuideDialog open={guideOpen} onClose={() => setGuideOpen(false)} />
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
      {graphOpen && (
        <GraphOverlay
          notebookId={notebook.id}
          activeDocumentId={activeDocumentId}
          nodes={graph.nodes}
          edges={graph.edges}
          onClose={() => setGraphOpen(false)}
        />
      )}
    </div>
    </CollabProvider>
  );
}

function countNotes(sections: NotebookView["sections"]): number {
  return sections.reduce((sum, s) => sum + s.notes.length + countNotes(s.children), 0);
}

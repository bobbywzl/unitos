"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { NotebookView } from "@/lib/types";
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CommentIcon,
  ExpandIcon,
  HistoryIcon,
  MoreIcon,
  NotesIcon,
  QuestionIcon,
  SparkleIcon,
  SummaryIcon,
} from "@/components/icons";
import { ContextTab, type ContextValues } from "@/components/context-tab";
import { GuideDialog } from "@/components/guide-dialog";
import { NotebookTitle } from "@/components/notebook-title";
import { NotesTray } from "@/components/outline/notes-tray";
import { useOutline } from "@/components/outline/use-outline";
import { DocumentBar, type AttachedDocument } from "@/components/reader/document-bar";

type Tab = "notes" | "assistant" | "summary" | "annotations" | "edits";

const TAB_TITLES: Record<Tab, string> = {
  notes: "Notes",
  assistant: "Assistant",
  summary: "Summary",
  annotations: "Annotations",
  edits: "Edits",
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
  summaryPanel,
  annotationsPanel,
  editsPanel,
  annotationCount,
  context,
}: {
  notebook: NotebookView;
  documents: AttachedDocument[];
  activeDocumentId: string | null;
  reader: React.ReactNode;
  assistant: React.ReactNode;
  summaryPanel: React.ReactNode;
  annotationsPanel: React.ReactNode;
  editsPanel: React.ReactNode;
  annotationCount: number;
  context: { initial: ContextValues | null; hasOverride: boolean; isSet: boolean };
}) {
  const { tree, pending, actions, lastRejected, undoReject } = useOutline(notebook);
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<Tab>("notes");
  const [menuOpen, setMenuOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
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
    window.addEventListener("dissect:show-note", onShowNote);
    window.addEventListener("dissect:focus-annotation", onFocusAnnotation);
    return () => {
      window.removeEventListener("dissect:show-note", onShowNote);
      window.removeEventListener("dissect:focus-annotation", onFocusAnnotation);
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
    setTab(next);
    setCollapsed(false);
  }

  return (
    // print: the shell flattens to plain flow so the whole document prints,
    // not one screen of the scroll pane; chrome and trays hide.
    <div className="grid h-screen grid-rows-[68px_1fr] bg-paper print:block print:h-auto">
      <header className="flex min-w-0 items-center gap-3.5 border-b border-line px-5 print:hidden">
        <Link
          href="/"
          aria-label="All works"
          className="flex size-[38px] shrink-0 items-center justify-center rounded-full text-sand-700 hover:bg-clay-100 hover:text-clay-800"
        >
          <ArrowLeftIcon size={18} />
        </Link>
        <NotebookTitle id={notebook.id} title={notebook.title} />
        <span aria-hidden className="size-[5px] shrink-0 rounded-full bg-sand-400" />
        <div className="mr-auto flex min-w-0">
          <DocumentBar
            notebookId={notebook.id}
            documents={documents}
            activeId={activeDocumentId}
          />
        </div>
        <ContextTab
          notebookId={notebook.id}
          initial={context.initial}
          hasOverride={context.hasOverride}
          isSet={context.isSet}
        />
        {pending.length > 0 && (
          <span className="shrink-0 rounded-full bg-clay-200 px-3.5 py-1.5 text-xs font-semibold text-clay-800">
            {pending.length} pending
          </span>
        )}
        <button
          onClick={() => setGuideOpen(true)}
          aria-label="Guide"
          title="What every tool does"
          className="flex size-[38px] shrink-0 items-center justify-center rounded-full text-sand-600 hover:bg-clay-100 hover:text-clay-800"
        >
          <QuestionIcon size={18} />
        </button>
      </header>

      <div className="flex min-h-0 print:block">
        <div className="relative min-w-0 flex-1 overflow-hidden print:overflow-visible">
          {reader}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[72px] bg-gradient-to-b from-transparent to-paper print:hidden"
          />
        </div>

        {!collapsed && (
          <aside className="flex min-h-0 w-[352px] shrink-0 flex-col gap-3.5 border-l border-line bg-sand-100 p-[18px] pb-4 print:hidden">
            <div className="flex items-center gap-2.5">
              <span className="font-display text-[18px]">{TAB_TITLES[tab]}</span>
              {tab === "notes" && <span className="text-[13px] text-sand-600">{noteCount}</span>}
              {tab === "annotations" && annotationCount > 0 && (
                <span className="text-[13px] text-sand-600">{annotationCount}</span>
              )}
              <button
                onClick={() => setCollapsed(true)}
                aria-label="Collapse the notes tray"
                className="ml-auto flex size-8 items-center justify-center rounded-full text-sand-600 hover:bg-clay-100 hover:text-clay-800"
              >
                <ChevronRightIcon size={16} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {tab === "notes" && <NotesTray tree={tree} pending={pending} actions={actions} />}
              {tab === "assistant" && assistant}
              {tab === "summary" && summaryPanel}
              {tab === "annotations" && annotationsPanel}
              {tab === "edits" && editsPanel}
            </div>

            {lastRejected && (
              <div className="flex shrink-0 items-center gap-3 rounded-full bg-card px-4 py-2.5 shadow-soft">
                <span className="text-[13px] text-sand-600">Note rejected</span>
                <button
                  onClick={() => void undoReject()}
                  className="ml-auto rounded-full bg-clay px-3.5 py-1 text-xs font-semibold text-clay-fg hover:bg-clay-600"
                >
                  Undo
                </button>
              </div>
            )}

            {tab === "notes" && (
              <Link
                href={`/n/${notebook.id}/notes`}
                title="Reorganize, edit, and export your notes"
                className="flex shrink-0 items-center justify-center gap-2 rounded-full bg-card px-4 py-2.5 text-[13px] font-semibold text-sand-700 shadow-soft hover:bg-clay-100 hover:text-clay-800"
              >
                <ExpandIcon size={15} />
                Notes full page
              </Link>
            )}
          </aside>
        )}

        <nav
          aria-label="Workspace"
          className="flex w-[52px] shrink-0 flex-col items-center gap-1.5 border-l border-line bg-sand-100 py-2.5 print:hidden"
        >
          <button
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Expand the notes tray" : "Collapse the notes tray"}
            className={RAIL_BUTTON}
          >
            {collapsed ? <ChevronLeftIcon /> : <ChevronRightIcon />}
          </button>

          <button
            onClick={() => show("notes")}
            aria-label="Notes"
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
            onClick={() => show("assistant")}
            aria-label="Assistant"
            aria-current={!collapsed && tab === "assistant"}
            className={!collapsed && tab === "assistant" ? RAIL_BUTTON_ON : RAIL_BUTTON}
          >
            <SparkleIcon />
          </button>

          <button
            onClick={() => show("summary")}
            aria-label="Summary"
            title="Summarize the open document"
            aria-current={!collapsed && tab === "summary"}
            className={!collapsed && tab === "summary" ? RAIL_BUTTON_ON : RAIL_BUTTON}
          >
            <SummaryIcon />
          </button>

          <button
            onClick={() => show("annotations")}
            aria-label="Annotations"
            aria-current={!collapsed && tab === "annotations"}
            className={!collapsed && tab === "annotations" ? RAIL_BUTTON_ON : RAIL_BUTTON}
          >
            <CommentIcon />
          </button>

          <button
            onClick={() => show("edits")}
            aria-label="Edit history"
            aria-current={!collapsed && tab === "edits"}
            className={!collapsed && tab === "edits" ? RAIL_BUTTON_ON : RAIL_BUTTON}
          >
            <HistoryIcon />
          </button>

          <div ref={menuRef} className="relative mt-auto">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="More"
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
                  Notes full page
                </Link>
                <Link
                  href="/settings"
                  className="px-4 py-2 text-sm text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                >
                  Settings
                </Link>
              </div>
            )}
          </div>
        </nav>
      </div>

      <GuideDialog open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
}

function countNotes(sections: NotebookView["sections"]): number {
  return sections.reduce((sum, s) => sum + s.notes.length + countNotes(s.children), 0);
}

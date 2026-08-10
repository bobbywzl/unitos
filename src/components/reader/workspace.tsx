"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { NotebookView } from "@/lib/types";
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExpandIcon,
  MoreIcon,
  NotesIcon,
  SparkleIcon,
} from "@/components/icons";
import { NotebookTitle } from "@/components/notebook-title";
import { NotesTray } from "@/components/outline/notes-tray";
import { useOutline } from "@/components/outline/use-outline";
import { ProfileDialog, type ProfileValues } from "@/components/profile-dialog";
import { DocumentBar, type AttachedDocument } from "@/components/reader/document-bar";

type Tab = "notes" | "assistant";

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
  profile,
}: {
  notebook: NotebookView;
  documents: AttachedDocument[];
  activeDocumentId: string | null;
  reader: React.ReactNode;
  assistant: React.ReactNode;
  profile: { initial: ProfileValues | null; hasOverride: boolean; autoOpen: boolean };
}) {
  const { tree, pending, actions, lastRejected, undoReject } = useOutline(notebook);
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<Tab>("notes");
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(profile.autoOpen);
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
    window.addEventListener("dissect:show-note", onShowNote);
    return () => window.removeEventListener("dissect:show-note", onShowNote);
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
    <div className="grid h-screen grid-rows-[68px_1fr] bg-paper">
      <header className="flex min-w-0 items-center gap-3.5 border-b border-line px-5">
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
        {pending.length > 0 && (
          <span className="shrink-0 rounded-full bg-clay-200 px-3.5 py-1.5 text-xs font-semibold text-clay-800">
            {pending.length} pending
          </span>
        )}
      </header>

      <div className="flex min-h-0">
        <div className="relative min-w-0 flex-1 overflow-hidden">
          {reader}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[72px] bg-gradient-to-b from-transparent to-paper"
          />
        </div>

        {!collapsed && (
          <aside className="flex min-h-0 w-[352px] shrink-0 flex-col gap-3.5 border-l border-line bg-sand-100 p-[18px] pb-4">
            <div className="flex items-center gap-2.5">
              <span className="font-display text-[18px]">
                {tab === "notes" ? "Notes" : "Assistant"}
              </span>
              {tab === "notes" && <span className="text-[13px] text-sand-600">{noteCount}</span>}
              <button
                onClick={() => setCollapsed(true)}
                aria-label="Collapse the notes tray"
                className="ml-auto flex size-8 items-center justify-center rounded-full text-sand-600 hover:bg-clay-100 hover:text-clay-800"
              >
                <ChevronRightIcon size={16} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {tab === "notes" ? (
                <NotesTray tree={tree} pending={pending} actions={actions} />
              ) : (
                assistant
              )}
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
          className="flex w-[52px] shrink-0 flex-col items-center gap-1.5 border-l border-line bg-sand-100 py-2.5"
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
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setProfileOpen(true);
                  }}
                  className="px-4 py-2 text-left text-sm text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                >
                  Reader profile
                </button>
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

      <ProfileDialog
        notebookId={notebook.id}
        initial={profile.initial}
        hasOverride={profile.hasOverride}
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
      />
    </div>
  );
}

function countNotes(sections: NotebookView["sections"]): number {
  return sections.reduce((sum, s) => sum + s.notes.length + countNotes(s.children), 0);
}

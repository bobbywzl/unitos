"use client";

import { useState } from "react";
import { isImeKey, useImeGuard } from "@/lib/ime";
import type { SectionView } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { PencilIcon, PlusIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { DragHandle, SortableGroup, SortableItem, type HandleProps } from "@/components/sortable";
import { notesList, sectionsList } from "@/components/outline/board-lists";
import { NoteCard } from "@/components/outline/note-card";
import { NoteComposer } from "@/components/outline/note-composer";
import { SECTION_ACTION, SECTION_ADD_NOTE } from "@/components/outline/section-action";
import { useNoteCompose } from "@/components/outline/use-note-compose";
import { VoiceNoteButton } from "@/components/outline/voice-note";
import { filterSections, noteMatches, type OutlineActions } from "@/components/outline/use-outline";

export function SectionItem({
  section,
  actions,
  handle,
  search = "",
  onOpenBoard,
  nested,
}: {
  section: SectionView;
  actions: OutlineActions;
  handle: HandleProps;
  /** The search the notes are found by: the section shows the notes it found
      whole, and hides itself when it found none. */
  search?: string;
  /** A click on the section's title: its board opens (section-board.tsx). */
  onOpenBoard: (sectionId: string) => void;
  nested?: boolean;
}) {
  const t = useT();
  const { canEdit } = useCollab();
  const ime = useImeGuard();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(section.title);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  // The composer auto-saves (use-note-compose.ts); the note it owns stays out of the list.
  const compose = useNoteCompose({ sectionId: section.id, notes: section.notes, actions, canEdit });
  const searching = search.trim().length > 0;
  const notes = searching ? compose.visibleNotes.filter((n) => noteMatches(n, search)) : compose.visibleNotes;
  // A search that found nothing here, and nothing in the children: the
  // section stays out of the way.
  const childrenShown = searching ? filterSections(section.children, search) : section.children;
  if (searching && notes.length === 0 && childrenShown.length === 0) return null;

  async function saveTitle() {
    const trimmed = title.trim();
    setEditing(false);
    if (!trimmed || trimmed === section.title) {
      setTitle(section.title);
      return;
    }
    await actions.renameSection(section.id, trimmed);
  }

  return (
    <section className={`group flex flex-col gap-2.5 ${nested ? "mt-4 pl-5" : ""}`}>
      <div className="flex items-baseline gap-2.5">
        <span className="self-center">
          <DragHandle handle={handle} label={t("outline.reorderSection", { title: section.title })} />
        </span>
        {editing ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void saveTitle()}
            {...ime.props}
            onKeyDown={(e) => {
              if (ime.isImeEnter(e) || isImeKey(e)) return;
              if (e.key === "Enter") void saveTitle();
              if (e.key === "Escape") {
                setTitle(section.title);
                setEditing(false);
              }
            }}
            aria-label={t("outline.sectionTitle")}
            className={`rounded-full bg-card px-4 py-1 font-display shadow-soft outline-none ${nested ? "text-lg" : "text-[22px]"}`}
          />
        ) : (
          <>
            {/* The title opens the section's board (SPEC.md §6); the pencil
                beside it renames the section. */}
            <button
              onClick={() => onOpenBoard(section.id)}
              data-track="section-board"
              className={`text-left font-display hover:text-clay-800 ${nested ? "text-lg" : "text-[22px]"}`}
              data-tip={t("outline.openBoardTitle")}
            >
              {section.title}
            </button>
            {canEdit && (
              <button
                onClick={() => setEditing(true)}
                data-track="section-rename"
                aria-label={t("outline.renameSection")}
                data-tip={t("outline.renameSection")}
                className="flex size-6 shrink-0 items-center justify-center self-center rounded-full text-sand-500 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-clay-100 hover:text-clay-800 focus-visible:opacity-100"
              >
                <PencilIcon size={13} />
              </button>
            )}
          </>
        )}
        <span className="text-[13px] text-sand-600">{notes.length || ""}</span>
        {canEdit && (
          <button
            onClick={compose.open}
            data-track="section-add-note"
            data-tip={t("outline.addNoteTitle")}
            className={`ml-auto ${SECTION_ADD_NOTE}`}
          >
            <PlusIcon size={15} />
            {t("outline.addNoteBtn")}
          </button>
        )}
        {canEdit && (
          <VoiceNoteButton sectionId={section.id} onError={setVoiceError} className={SECTION_ACTION} />
        )}
        {canEdit && (
          <button
            onClick={() => {
              if (confirm(t("outline.confirmDeleteSection"))) void actions.deleteSection(section.id);
            }}
            data-tip={t("outline.deleteSectionTitle")}
            className="text-xs text-red-500 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-red-700"
          >
            {t("common.delete")}
          </button>
        )}
      </div>

      {voiceError && <p className="mb-2 text-xs text-red-500">{voiceError}</p>}
      <div className="flex flex-col gap-2.5">
        {/* The composer sits above the notes: a new note lands at the top of
            the section (SPEC.md §6). */}
        {compose.composing && <NoteComposer compose={compose} full padding="p-4" />}

        {/* The page's one board holds every section's notes, so a note
            dragged out of this section drops into another; a note held over
            another until the ring closes joins it (SPEC.md §6). */}
        <SortableGroup
          id={notesList(section.id)}
          ids={notes.map((n) => n.id)}
          className="flex flex-col gap-2.5"
        >
          {notes.map((note) => (
            <SortableItem key={note.id} id={note.id}>
              {(noteHandle) => (
                <NoteCard note={note} actions={actions} handle={noteHandle} variant="page" search={search} />
              )}
            </SortableItem>
          ))}
        </SortableGroup>

        {!nested && (
          <SortableGroup
            id={sectionsList(section.id)}
            ids={childrenShown.map((c) => c.id)}
            className="flex flex-col gap-2.5"
          >
            {childrenShown.map((child) => (
              <SortableItem key={child.id} id={child.id}>
                {(childHandle) => (
                  <SectionItem
                    section={child}
                    actions={actions}
                    handle={childHandle}
                    search={search}
                    onOpenBoard={onOpenBoard}
                    nested
                  />
                )}
              </SortableItem>
            ))}
          </SortableGroup>
        )}
      </div>
    </section>
  );
}

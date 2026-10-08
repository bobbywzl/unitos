"use client";

import { useRef, useState } from "react";
import { isImeKey, useImeGuard } from "@/lib/ime";
import type { SectionView } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { PencilIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { DragHandle, SortableGroup, SortableItem, useDropHeader, type HandleProps } from "@/components/sortable";
import { notesList, sectionsList } from "@/components/outline/board-lists";
import { NoteCard } from "@/components/outline/note-card";
import { NoteComposer, focusComposer } from "@/components/outline/note-composer";
import { SECTION_ACTION, SECTION_ADD_NOTE } from "@/components/outline/section-action";
import { useNoteCompose } from "@/components/outline/use-note-compose";
import { VoiceNoteButton } from "@/components/outline/voice-note";
import { filterSections, noteMatches, type OutlineActions } from "@/components/outline/use-outline";
import { shownSectionTitle } from "@/lib/section-title";

// The rename button beside a section's title, and the delete button at the
// end of its title field: 24px drawn, a 36px hit area on a touch screen.
const SECTION_HEAD_TOOL =
  "flex size-6 shrink-0 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-800 pointer-coarse:size-9";

export function SectionItem({
  section,
  actions,
  handle,
  search = "",
  onOpenBoard,
  nudge,
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
  /** The onboarding nudge's target: the first section of the page. */
  nudge?: boolean;
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
  const rootRef = useRef<HTMLElement>(null);
  // A note held over the title row lands at the top of the section
  // (sortable.tsx data-drop-header).
  const headerLit = useDropHeader(notesList(section.id));
  // The bin was pressed: the row closes without a rename.
  const deleting = useRef(false);
  if (searching && notes.length === 0 && childrenShown.length === 0) return null;

  async function saveTitle() {
    const trimmed = title.trim();
    setEditing(false);
    if (deleting.current) return;
    if (!trimmed || trimmed === section.title) {
      setTitle(section.title);
      return;
    }
    await actions.renameSection(section.id, trimmed);
  }

  return (
    <section ref={rootRef} className={`group flex flex-col gap-2.5 ${nested ? "mt-4 pl-5" : ""}`}>
      <div
        data-drop-header={notesList(section.id)}
        data-drop-first={notes[0]?.id ?? ""}
        className={`group/head -mx-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 rounded-[22px] px-2 transition-colors ${
          headerLit ? "bg-clay-100 ring-2 ring-clay-400" : ""
        }`}
      >
        <span className="self-center">
          <DragHandle handle={handle} label={t("outline.reorderSection", { title: section.title })} />
        </span>
        {editing ? (
          <span
            className="flex items-center gap-2 self-center"
            // The row closes, saving the title, when the focus leaves it:
            // Tab from the field to its bin keeps it open.
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) void saveTitle();
            }}
          >
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
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
            {/* Delete sits in the rename row, never beside a resting
                control: one slip on the header never takes a section. No
                confirm: the pill under the notes offers Undo, and History
                keeps the section whole with Restore. A press keeps the
                field's focus, so its blur never closes the row first. */}
            <button
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                deleting.current = true;
                setEditing(false);
                setTitle(section.title);
                void actions.deleteSection(section.id).finally(() => {
                  deleting.current = false;
                });
              }}
              data-track="section-delete"
              aria-label={t("outline.deleteSectionTitle")}
              data-tip={t("outline.deleteSectionTitle")}
              className={`${SECTION_HEAD_TOOL} hover:!text-red-600`}
            >
              <TrashIcon size={13} />
            </button>
          </span>
        ) : (
          // The title and its pencil stay on one row: a long title wraps
          // inside its own space, never pushing the pencil to the next row.
          <span className="flex min-w-0 max-w-full items-center gap-x-1.5">
            {/* The title opens the section's board (SPEC.md §6); the pencil
                beside it opens the title's field, with the bin that deletes
                the section at its end. The pencil shows on the header's
                hover and focus, and at rest on a touch screen. */}
            <button
              onClick={() => onOpenBoard(section.id)}
              data-track="section-board"
              data-nudge={nudge ? "board" : undefined}
              className={`min-w-0 break-words text-left font-display hover:text-clay-800 ${nested ? "text-lg" : "text-[22px]"}`}
              data-tip={t("outline.openBoardTitle")}
            >
              {shownSectionTitle(section.title, t)}
            </button>
            {canEdit && (
              <span className="flex items-center gap-0.5 self-center opacity-0 transition-opacity group-hover/head:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
                <button
                  onClick={() => setEditing(true)}
                  data-track="section-rename"
                  aria-label={t("outline.renameSection")}
                  data-tip={t("outline.renameSection")}
                  className={SECTION_HEAD_TOOL}
                >
                  <PencilIcon size={13} />
                </button>
              </span>
            )}
          </span>
        )}
        {/* One count rule on every surface: the accepted notes. */}
        <span className="text-[13px] text-sand-600">{notes.filter((n) => n.status !== "PENDING").length || ""}</span>
        {canEdit && (
          <button
            onClick={() => {
              // A second press while the composer is open puts the caret back in it.
              if (compose.composing) focusComposer(rootRef.current);
              else compose.open();
            }}
            data-track="section-add-note"
            data-tip={t("outline.addNoteTitle")}
            className={`ml-auto ${SECTION_ADD_NOTE}`}
          >
            <PlusIcon size={15} />
            {t("outline.addNoteBtn")}
          </button>
        )}
        {canEdit && (
          <VoiceNoteButton sectionId={section.id} onError={setVoiceError} className={SECTION_ACTION} compact />
        )}
      </div>

      {voiceError && <p className="mb-2 text-xs text-red-500">{voiceError}</p>}
      <div className="flex flex-col gap-2.5">
        {/* The composer sits above the notes: a new note lands at the top of
            the section (SPEC.md §6). */}
        {compose.composing && <NoteComposer compose={compose} onRelease={() => actions.expectComposed(section.id)} padding="p-4" />}

        {/* The page's one board holds every section's notes, so a note
            dragged out of this section drops into another; a note held over
            another until the ring closes joins it (SPEC.md §6). */}
        <SortableGroup
          id={notesList(section.id)}
          ids={notes.map((n) => n.id)}
          className="flex flex-col gap-2.5"
        >
          {notes.map((note) => (
            <SortableItem key={actions.noteKey(note.id)} id={note.id}>
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

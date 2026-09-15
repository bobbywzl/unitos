"use client";

import { useEffect, useState } from "react";
import { isImeKey } from "@/lib/ime";
import type { SectionView } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { ChevronLeftIcon, PlusIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { SortableBoard, SortableGroup, SortableItem } from "@/components/sortable";
import { dropIndex, notesList, parseListId } from "@/components/outline/board-lists";
import { MergeUndoBar } from "@/components/outline/merge-undo";
import { NoteCard } from "@/components/outline/note-card";
import { NoteComposer } from "@/components/outline/note-composer";
import { NoteTile } from "@/components/outline/note-tile";
import { SECTION_ACTION, SECTION_ADD_NOTE } from "@/components/outline/section-action";
import { SelectionBar } from "@/components/outline/selection-bar";
import { useNoteCompose } from "@/components/outline/use-note-compose";
import { VoiceNoteButton } from "@/components/outline/voice-note";
import { findSection, type OutlineActions } from "@/components/outline/use-outline";

// A section's board (SPEC.md §6): the section's notes filling the screen as
// 3:4 tiles side by side, one grid, opened from the notes full page by a
// click on the section's title. Every tile is in the note's draggable mode: a
// hold anywhere picks it up, to reorder it or to hold it over another tile and
// merge the two. A click opens the note whole over the board — its card, with
// the pencil, the jump, the history — and Esc or ✕ closes it. The section's
// own actions — + Note, Speak — stay in the header; a nested section's board
// is one press away, and so is the section it sits in. Esc or Notes closes
// the board.

/** The parent of a section, or null for a root section. */
function parentOf(tree: SectionView[], id: string): SectionView | null {
  for (const s of tree) if (s.children.some((c) => c.id === id)) return s;
  return null;
}

export function SectionBoard({
  tree,
  sectionId,
  actions,
  onChange,
  onClose,
}: {
  tree: SectionView[];
  sectionId: string;
  actions: OutlineActions;
  /** Another section's board takes this one's place. */
  onChange: (sectionId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { canEdit } = useCollab();
  const section = findSection(tree, sectionId);
  const parent = parentOf(tree, sectionId);
  // The note open over the board; null = none.
  const [open, setOpen] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const compose = useNoteCompose({
    sectionId,
    notes: section?.notes ?? [],
    actions,
    canEdit,
  });
  const notes = compose.visibleNotes;
  const notesById = new Map(notes.map((n) => [n.id, n]));
  const opened = open ? (notesById.get(open) ?? null) : null;

  // The section is gone (deleted elsewhere): the board closes.
  const gone = section === null;
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);

  // Esc closes the open note first, then the board. Esc inside a field
  // stays the field's: the editor's Esc cancels the edit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || isImeKey(e)) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if (open) setOpen(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!section) return null;

  // A drop lands the tile where the line stood in the section's own list
  // (board-lists.ts): the board shows the notes the composer does not own.
  function onDrop(fromListId: string, toListId: string, itemId: string, beforeId: string | null) {
    if (!section) return;
    const from = parseListId(fromListId);
    const to = parseListId(toListId);
    if (from.kind !== "notes" || to.kind !== "notes" || from.parentId !== to.parentId) return;
    const index = dropIndex(section.notes, itemId, beforeId, true);
    if (index === null) return;
    actions.reorderNote(section.id, itemId, index);
  }

  const chip =
    "inline-flex shrink-0 items-center gap-1 rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800";

  return (
    <div className="content-in fixed inset-0 z-50 flex flex-col bg-paper">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <button
          onClick={onClose}
          data-track="board-close"
          className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-sand-600 hover:bg-clay-100 hover:text-clay-800"
        >
          <ChevronLeftIcon size={14} />
          {t("outline.notesLabel")}
        </button>
        {parent && (
          <button
            onClick={() => onChange(parent.id)}
            data-track="board-parent"
            data-tip={t("outline.openBoardTitle")}
            className={chip}
          >
            {parent.title}
            <span className="text-sand-400">/</span>
          </button>
        )}
        <span className="font-display text-[22px]">{section.title}</span>
        <span className="text-[13px] text-sand-600">{notes.length || ""}</span>
        {section.children.length > 0 && (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold tracking-[0.08em] text-sand-500 uppercase">
              {t("outline.boardSections")}
            </span>
            {section.children.map((child) => (
              <button
                key={child.id}
                onClick={() => onChange(child.id)}
                data-track="board-child"
                data-tip={t("outline.openBoardTitle")}
                className={chip}
              >
                {child.title}
                <span className="text-sand-500">{child.notes.length || ""}</span>
              </button>
            ))}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {canEdit && (
            <button
              onClick={compose.open}
              data-track="section-add-note"
              data-tip={t("outline.addNoteTitle")}
              className={SECTION_ADD_NOTE}
            >
              <PlusIcon size={15} />
              {t("outline.addNoteBtn")}
            </button>
          )}
          {canEdit && <VoiceNoteButton sectionId={section.id} onError={setVoiceError} className={SECTION_ACTION} />}
          <button
            onClick={onClose}
            data-track="board-close"
            aria-label={t("common.close")}
            data-tip={t("common.close")}
            className="flex size-7 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-800"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        {voiceError && <p className="mb-3 text-xs text-red-500">{voiceError}</p>}
        {/* The composer sits above the tiles: a new note lands at the top of
            the section (SPEC.md §6). */}
        {compose.composing && (
          <div className="mb-5 max-w-[760px]">
            <NoteComposer compose={compose} full padding="p-4" />
          </div>
        )}

        {/* One board, one grid (SPEC.md §6): a hold anywhere on a tile
            picks it up; the line stands between tiles; a tile held over
            another until the ring closes joins it. */}
        <SortableBoard
          id={`section-board:${section.id}`}
          onDrop={onDrop}
          onMerge={canEdit ? (id, intoId) => void actions.mergeNotes(intoId, [id], "join") : undefined}
          canMerge={(id, intoId) =>
            notesById.get(id)?.status === "ACCEPTED" && notesById.get(intoId)?.status === "ACCEPTED"
          }
          overlay={(itemId) => {
            const note = notesById.get(itemId);
            return note ? <NoteTile note={note} actions={actions} onOpen={() => {}} /> : null;
          }}
        >
          <SortableGroup id={notesList(section.id)} ids={notes.map((n) => n.id)} layout="grid" className="note-board">
            {notes.map((note) => (
              <SortableItem key={note.id} id={note.id}>
                {(handle) => <NoteTile note={note} actions={actions} handle={canEdit ? handle : undefined} onOpen={setOpen} />}
              </SortableItem>
            ))}
          </SortableGroup>
        </SortableBoard>

        {notes.length === 0 && !compose.composing && (
          <p className="text-sm text-sand-600">{t("outline.boardEmpty")}</p>
        )}
      </div>

      {/* The open note: its whole card over the board. A click beside it, ✕,
          or Esc closes it; the tile behind keeps its place. */}
      {opened && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-ink/25 p-4 pt-[6vh] md:p-8 md:pt-[8vh]">
          <button
            aria-label={t("common.close")}
            onClick={() => setOpen(null)}
            className="fixed inset-0 cursor-default"
            tabIndex={-1}
          />
          <div className="content-in relative w-full max-w-[760px]">
            <button
              onClick={() => setOpen(null)}
              data-track="board-note-close"
              aria-label={t("common.close")}
              data-tip={t("common.close")}
              className="absolute -top-9 right-0 flex size-7 items-center justify-center rounded-full bg-card text-sand-600 shadow-soft hover:bg-clay-100 hover:text-clay-800"
            >
              ✕
            </button>
            <NoteCard note={opened} actions={actions} variant="page" />
          </div>
        </div>
      )}

      <SelectionBar tree={tree} actions={actions} />
      <MergeUndoBar actions={actions} />
    </div>
  );
}

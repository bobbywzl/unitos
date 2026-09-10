"use client";

import { useState } from "react";
import { isImeKey, useImeGuard } from "@/lib/ime";
import type { SectionView } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { PlusIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { DragHandle, SortableGroup, SortableItem, type HandleProps } from "@/components/sortable";
import { notesList, sectionsList } from "@/components/outline/board-lists";
import { NoteCard } from "@/components/outline/note-card";
import { NoteEditor } from "@/components/outline/note-editor";
import { SECTION_ACTION, SECTION_ADD_NOTE } from "@/components/outline/section-action";
import { SaveStateLabel } from "@/components/outline/save-state";
import { useNoteCompose } from "@/components/outline/use-note-compose";
import { VoiceNoteButton } from "@/components/outline/voice-note";
import type { OutlineActions } from "@/components/outline/use-outline";

export function SectionItem({
  section,
  actions,
  handle,
  nested,
}: {
  section: SectionView;
  actions: OutlineActions;
  handle: HandleProps;
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
  const notes = compose.visibleNotes;

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
          <button
            onClick={() => canEdit && setEditing(true)}
            className={`text-left font-display ${nested ? "text-lg" : "text-[22px]"}`}
            data-tip={canEdit ? t("outline.renameSection") : undefined}
          >
            {section.title}
          </button>
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
        {compose.composing && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void compose.save();
            }}
          >
            {/* The save state at the top of the composer (SPEC.md §6). */}
            <div className="mb-1 flex min-h-4 justify-end">
              <SaveStateLabel state={compose.saveState} />
            </div>
            <NoteEditor
              className="rounded-2xl bg-card p-4 shadow-soft"
              value={compose.draft}
              onChange={compose.setDraft}
              onKeyDown={(e) => {
                if (isImeKey(e)) return;
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.closest("form")?.requestSubmit();
                if (e.key === "Escape") compose.escape();
              }}
              placeholder={t("outline.writeNotePlaceholder")}
              full
            />
            <div className="mt-2 flex gap-2">
              <button
                type="submit"
                className="rounded-full bg-sage-600 px-3.5 py-1 text-xs font-semibold text-sage-fg hover:bg-sage-700"
              >
                {t("common.save")}
              </button>
              <button
                type="button"
                onClick={() => void compose.cancel()}
                className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
              >
                {t("common.cancel")}
              </button>
            </div>
          </form>
        )}

        {/* The page's one board holds every section's notes, so a note
            dragged out of this section drops into another; a hold on the
            middle of a note surfaces the merge strip (SPEC.md §6). */}
        <SortableGroup
          id={notesList(section.id)}
          ids={notes.map((n) => n.id)}
          className="flex flex-col gap-2.5"
        >
          {notes.map((note) => (
            <SortableItem key={note.id} id={note.id}>
              {(noteHandle) => (
                <NoteCard note={note} actions={actions} handle={noteHandle} variant="page" />
              )}
            </SortableItem>
          ))}
        </SortableGroup>

        {!nested && (
          <SortableGroup
            id={sectionsList(section.id)}
            ids={section.children.map((c) => c.id)}
            className="flex flex-col gap-2.5"
          >
            {section.children.map((child) => (
              <SortableItem key={child.id} id={child.id}>
                {(childHandle) => (
                  <SectionItem section={child} actions={actions} handle={childHandle} nested />
                )}
              </SortableItem>
            ))}
          </SortableGroup>
        )}
      </div>
    </section>
  );
}

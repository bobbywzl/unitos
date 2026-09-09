"use client";

import Link from "next/link";
import { useState } from "react";
import { isImeKey } from "@/lib/ime";
import type { NoteView, SectionView } from "@/lib/types";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from "@/components/icons";
import { useCollab } from "@/components/collab/collab-context";
import { useT } from "@/components/lang-provider";
import { CollapsedViewToggle } from "@/components/collapsed-view-toggle";
import { SortableBoard, SortableGroup, SortableItem } from "@/components/sortable";
import { notesList, parseListId } from "@/components/outline/board-lists";
import { NoteCard } from "@/components/outline/note-card";
import { NoteEditor } from "@/components/outline/note-editor";
import { SaveStateLabel } from "@/components/outline/save-state";
import { SECTION_ACTION, SECTION_ADD_NOTE } from "@/components/outline/section-action";
import { useNoteCompose } from "@/components/outline/use-note-compose";
import { VoiceNoteButton } from "@/components/outline/voice-note";
import { Collapse } from "@/components/presence";
import { SelectionBar } from "@/components/outline/selection-bar";
import {
  filterSections,
  findSection,
  noteMatches,
  type OutlineActions,
} from "@/components/outline/use-outline";

// The tray is for triage first: pending notes hoist to the top as one queue,
// accepted notes sit under their section label (design 1a) and reorder by
// their grip, as on the notes full page. Renaming sections and composing at
// length live on the notes full page.
export function NotesTray({
  tree,
  pending,
  actions,
}: {
  tree: SectionView[];
  pending: NoteView[];
  actions: OutlineActions;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const label = "text-[11px] font-bold tracking-[0.08em] uppercase";
  const shown = filterSections(tree, query);
  const needle = query.trim().toLowerCase();
  const shownPending = pending.filter((n) => noteMatches(n, query));

  // A drop lands the note where the note under the pointer sits in the whole
  // section, pending notes included — the index reorderNote and the server
  // count with. The tray's lists show the accepted notes only, so the drop's
  // own index cannot be used.
  function onDrop(
    fromListId: string,
    toListId: string,
    itemId: string,
    _toIndex: number,
    overId: string | null,
  ) {
    const from = parseListId(fromListId);
    const to = parseListId(toListId);
    if (from.kind !== "notes" || to.kind !== "notes" || !from.parentId || !to.parentId) return;
    const target = findSection(tree, to.parentId);
    if (!target) return;
    const index = overId
      ? target.notes.findIndex((n) => n.id === overId)
      : target.notes.length;
    if (index === -1) return;
    if (from.parentId === to.parentId) actions.reorderNote(from.parentId, itemId, index);
    else void actions.moveNoteToSection(itemId, to.parentId, index);
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center gap-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && !isImeKey(e) && setQuery("")}
          placeholder={t("outline.searchNotes")}
          aria-label={t("outline.searchNotes")}
          className="min-w-0 flex-1 rounded-full bg-card px-4 py-2 text-[13px] shadow-soft outline-none placeholder:text-sand-500"
        />
        <CollapsedViewToggle view={actions.notesView} onChange={actions.setNotesView} track="notes-view" />
      </div>

      {shownPending.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <span className={`${label} text-clay-800`}>
              {t("outline.pendingHeader", { n: shownPending.length })}
            </span>
            <span className="ml-auto text-[11px] text-sand-500">{t("outline.trayKeyHint")}</span>
          </div>
          {shownPending.map((note) => (
            <NoteCard key={note.id} note={note} actions={actions} variant="tray" />
          ))}
        </div>
      )}

      {/* One drag across the tray (SPEC.md §6): a note dragged out of its
          section drops into another, the same as on the notes full page. */}
      <SortableBoard id="tray-board" onDrop={onDrop} axis="y">
        <div className="flex flex-col gap-3.5">
          {shown.map((section) => (
            <TraySection
              key={section.id}
              section={section}
              actions={actions}
              labelClass={label}
              reorderable={!needle}
            />
          ))}
        </div>
      </SortableBoard>

      {needle && shown.length === 0 && shownPending.length === 0 && (
        <p className="text-[13px] text-sand-600">
          {t("outline.noNotesMatch", { query: query.trim() })}
        </p>
      )}

      {tree.length === 0 && (
        <p className="text-[13px] text-sand-600">
          {t("outline.emptyTrayPrefix")}
          <Link href={`/n/${actions.notebookId}/notes`} data-track="notes-full-page" className="text-clay hover:text-clay-600">
            {t("outline.notesFullPage")}
          </Link>
          {t("outline.emptyTraySuffix")}
        </p>
      )}

      <SelectionBar tree={tree} actions={actions} />
    </div>
  );
}

function TraySection({
  section,
  actions,
  labelClass,
  reorderable,
  nested,
}: {
  section: SectionView;
  actions: OutlineActions;
  labelClass: string;
  // False while a search filters the list: a drop then could not land on the
  // whole section, the list the order counts in.
  reorderable: boolean;
  nested?: boolean;
}) {
  const t = useT();
  const { canEdit } = useCollab();
  const [collapsed, setCollapsed] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  // The composer auto-saves (use-note-compose.ts); the note it owns stays out of the list.
  const compose = useNoteCompose({ sectionId: section.id, notes: section.notes, actions, canEdit });
  const accepted = compose.visibleNotes.filter((n) => n.status !== "PENDING");
  const grips = reorderable && canEdit;

  return (
    <div className={`group/section flex flex-col gap-2 ${nested ? "pl-3" : ""}`}>
      <div className="flex items-baseline gap-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          data-track="section-collapse"
          aria-expanded={!collapsed}
          data-tip={t("outline.collapseSectionTitle")}
          className={`flex items-center gap-1 ${labelClass} text-sand-600 hover:text-clay-700`}
        >
          <span className="self-center text-sand-400">
            {collapsed ? <ChevronRightIcon size={11} /> : <ChevronDownIcon size={11} />}
          </span>
          {section.title}
        </button>
        {accepted.length > 0 && <span className="text-[11px] text-sand-500">{accepted.length}</span>}
        {/* The section's actions stay visible (SPEC.md §6): a pill each, the
            same on the notes full page. */}
        {!collapsed && canEdit && (
          <button
            onClick={compose.open}
            data-track="section-add-note"
            data-tip={t("outline.addNoteTitle")}
            className={`ml-auto ${SECTION_ADD_NOTE}`}
          >
            <PlusIcon size={14} />
            {t("outline.addNoteBtn")}
          </button>
        )}
        {!collapsed && canEdit && (
          <VoiceNoteButton sectionId={section.id} onError={setVoiceError} className={SECTION_ACTION} />
        )}
      </div>
      {voiceError && <p className="text-xs text-red-500">{voiceError}</p>}

      <Collapse open={!collapsed}>
      {!collapsed && (
        <div className="flex flex-col gap-2">
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
                className="rounded-2xl bg-card p-3 shadow-soft"
                value={compose.draft}
                onChange={compose.setDraft}
                onKeyDown={(e) => {
                  if (isImeKey(e)) return;
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.closest("form")?.requestSubmit();
                  if (e.key === "Escape") compose.escape();
                }}
                placeholder={t("outline.writeNotePlaceholder")}
                moreHref={`/n/${actions.notebookId}/notes`}
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="submit"
                  data-track="note-compose-save"
                  className="rounded-full bg-sage-600 px-3.5 py-1 text-xs font-semibold text-sage-fg hover:bg-sage-700"
                >
                  {t("common.save")}
                </button>
                <button
                  type="button"
                  onClick={() => void compose.cancel()}
                  data-track="note-compose-cancel"
                  className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </form>
          )}

          <SortableGroup
            id={notesList(section.id)}
            ids={accepted.map((n) => n.id)}
            className="flex flex-col gap-2"
          >
            {accepted.map((note) => (
              <SortableItem key={note.id} id={note.id}>
                {(handle) => (
                  <NoteCard
                    note={note}
                    actions={actions}
                    handle={grips ? handle : undefined}
                    variant="tray"
                  />
                )}
              </SortableItem>
            ))}
          </SortableGroup>

          {section.children.map((child) => (
            <TraySection
              key={child.id}
              section={child}
              actions={actions}
              labelClass={labelClass}
              reorderable={reorderable}
              nested
            />
          ))}
        </div>
      )}
      </Collapse>
    </div>
  );
}

"use client";

import { TOUCH_HIT } from "@/components/outline/touch-hit";
import { useMemo, useState } from "react";
import { isImeKey } from "@/lib/ime";
import type { NotebookView } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { useT } from "@/components/lang-provider";
import { CollapsedViewToggle } from "@/components/collapsed-view-toggle";
import { useNewFeature } from "@/components/new-feature";
import { Presence } from "@/components/presence";
import { SortableBoard, SortableGroup, SortableItem } from "@/components/sortable";
import { AddSection } from "@/components/outline/add-section";
import { dropIndex, parseListId, SECTIONS_LIST } from "@/components/outline/board-lists";
import { CompareView } from "@/components/outline/compare-view";
import { DocumentColumns } from "@/components/outline/document-columns";
import { MergeUndoBar } from "@/components/outline/merge-undo";
import { NoteCard } from "@/components/outline/note-card";
import { SectionBoard } from "@/components/outline/section-board";
import { SectionItem } from "@/components/outline/section-item";
import { NoteGroups, NotesViewMenu, useNoteGrouping } from "@/components/outline/note-groups";
import { SelectionBar } from "@/components/outline/selection-bar";
import {
  filterSections,
  findSection,
  flattenNotes,
  useOutline,
} from "@/components/outline/use-outline";

// The notes full page (design 2b): the reorganizing view. Sections carry drag
// grips, notes are flat cards picked up by a hold anywhere on them, and
// pending ones stay in place with Accept/Reject inline — unlike the tray,
// which hoists the whole pending queue to the top. A search shows the notes
// it found whole, with the words it found lit up, in the same sections.
// Selecting two or more notes offers Compare: the compare view opens over the
// page with one pane per note (compare-view.tsx). Document columns, the last row
// of the view menu, opens the
// project's notes as a grid over the page, one column per document and one
// row per section (document-columns.tsx): the page is the whole project,
// where the tray in the reader holds the open document's notes alone.
export function Outline({ notebook }: { notebook: NotebookView }) {
  const t = useT();
  const { canEdit } = useCollab();
  const { tree, pending, actions, lastRejected, undoReject } = useOutline(notebook, canEdit);
  const [query, setQuery] = useState("");
  const [grouping, setGrouping] = useNoteGrouping();
  const needle = query.trim();
  const found = needle ? filterSections(tree, query) : tree;
  // The notes in the compare view, in pane order; null = closed.
  const [compare, setCompare] = useState<string[] | null>(null);
  // The section whose board fills the screen (section-board.tsx); null = none.
  const [board, setBoard] = useState<string | null>(null);
  // The By document grid over the page (document-columns.tsx).
  const [byDocument, setByDocument] = useState(false);
  // The New glow (SPEC.md §18) on By document until it is pressed.
  const byDocumentNew = useNewFeature("byDocument");
  // Every note by id: the drag asks per item on every pointer move whether the
  // two can merge.
  const notesById = useMemo(() => new Map(flattenNotes(tree).map((n) => [n.id, n])), [tree]);

  // Where a drop landed. A note dropped in its own section reorders; dropped
  // in another it moves there, at the place it was dropped. A section
  // reorders among its siblings; it never lands in a notes list.
  function onDrop(fromListId: string, toListId: string, itemId: string, beforeId: string | null) {
    const from = parseListId(fromListId);
    const to = parseListId(toListId);
    if (from.kind !== to.kind) return;
    if (from.kind === "sections") {
      if (from.parentId !== to.parentId) return;
      const siblings = from.parentId ? (findSection(tree, from.parentId)?.children ?? []) : tree;
      const index = dropIndex(siblings, itemId, beforeId, true);
      if (index === null) return;
      actions.reorderSection(from.parentId, itemId, index);
      return;
    }
    if (!from.parentId || !to.parentId) return;
    // The list a composer owns a note in, or a search filters, shows fewer
    // notes than the section holds, so the place is counted in the section's
    // own list (board-lists.ts) — the index reorderNote and the server count with.
    const target = findSection(tree, to.parentId);
    if (!target) return;
    const index = dropIndex(target.notes, itemId, beforeId, from.parentId === to.parentId);
    if (index === null) return;
    if (from.parentId === to.parentId) actions.reorderNote(from.parentId, itemId, index);
    else void actions.moveNoteToSection(itemId, to.parentId, index);
  }

  // While a board covers the page, the page behind it takes no focus and no
  // key: Tab walks the board, and a composer the page draws for the same
  // section never takes the caret from the board's (section-board.tsx).
  const behind = board !== null || undefined;

  return (
    <div className="flex flex-col">
      <div inert={behind} className="mb-2 flex flex-wrap items-baseline gap-3.5">
        <h1 className="text-[38px]">{notebook.title}</h1>
        {/* The tray's queue head (SPEC.md §6): the count, and Accept all.
            The keys stay; Accept all's tooltip and each card's say them. */}
        {pending.length > 0 && (
          <span className="flex items-baseline gap-2">
            <span className="text-[11px] font-bold tracking-[0.08em] text-clay-800 uppercase">
              {t("outline.pendingHeader", { n: pending.length })}
            </span>
            {canEdit && pending.length > 1 && (
              <button
                onClick={() => {
                  for (const note of pending) void actions.acceptNote(note.id);
                }}
                data-track="notes-accept-all"
                data-tip={t("outline.acceptAllTitle")}
                className={`text-[11.5px] font-semibold text-sage-700 hover:text-sage-800 ${TOUCH_HIT}`}
              >
                {t("outline.acceptAll")}
              </button>
            )}
          </span>
        )}
      </div>

      {/* One row on a phone too: the search takes what the icons leave. */}
      <div inert={behind} className="mt-2 flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && !isImeKey(e) && setQuery("")}
          placeholder={t("outline.searchNotes")}
          aria-label={t("outline.searchNotes")}
          type="search"
          className="min-w-0 flex-1 rounded-full bg-card px-4 py-2 text-[13px] shadow-soft outline-none placeholder:text-sand-500 sm:w-72 sm:flex-none"
        />
        <CollapsedViewToggle view={actions.notesView} onChange={actions.setNotesView} track="notes-view" />
        {/* Group by and Document columns in one menu (SPEC.md §6). */}
        <NotesViewMenu
          grouping={grouping}
          onGrouping={setGrouping}
          onColumns={
            notebook.documents.length > 0
              ? () => {
                  byDocumentNew.seen();
                  setByDocument(true);
                }
              : undefined
          }
          columnsNew={notebook.documents.length > 0 && byDocumentNew.isNew}
        />
      </div>

      {grouping !== "section" ? (
        <div inert={behind} className="pt-[22px]">
          <NoteGroups
            tree={tree}
            grouping={grouping}
            documents={notebook.documents}
            actions={actions}
            variant="page"
            search={query}
            onMerge={(id, intoId) => void actions.mergeNotes(intoId, [id], "join")}
          />
          {needle && found.length === 0 && (
            <p className="text-sm text-sand-600">{t("outline.noNotesMatch", { query: needle })}</p>
          )}
        </div>
      ) : (
      <div inert={behind} className="flex flex-col gap-[30px] pt-[22px]">
        {/* One drag across the whole page (SPEC.md §6): a note dragged out
            of its section drops into any other, a note held over another
            joins it, and a section reorders among its siblings. */}
        <SortableBoard
          id="notes-board"
          onDrop={onDrop}
          canDrop={(from, to) => parseListId(from).kind === parseListId(to).kind}
          onMerge={canEdit ? (id, intoId) => void actions.mergeNotes(intoId, [id], "join") : undefined}
          canMerge={(id, intoId) =>
            notesById.get(id)?.status === "ACCEPTED" &&
            notesById.get(intoId)?.status === "ACCEPTED"
          }
          overlay={(itemId) => {
            const note = notesById.get(itemId);
            if (note) return <NoteCard note={note} actions={actions} variant="page" search={query} />;
            const section = findSection(tree, itemId);
            return section ? (
              <span className="rounded-full bg-card px-4 py-2 font-display text-[18px] shadow-float">
                {section.title}
              </span>
            ) : null;
          }}
        >
          <SortableGroup
            id={SECTIONS_LIST}
            ids={tree.map((s) => s.id)}
            className="flex flex-col gap-[30px]"
          >
            {tree.map((section, i) => (
              <SortableItem key={section.id} id={section.id}>
                {(handle) => (
                  <SectionItem
                    section={section}
                    actions={actions}
                    handle={handle}
                    search={query}
                    onOpenBoard={setBoard}
                    nudge={i === 0}
                  />
                )}
              </SortableItem>
            ))}
          </SortableGroup>
        </SortableBoard>

        {needle && found.length === 0 && (
          <p className="text-sm text-sand-600">{t("outline.noNotesMatch", { query: needle })}</p>
        )}

        {!needle && canEdit && <AddSection onAdd={(title) => actions.addSection(null, title)} />}

        {tree.length === 0 && (
          <p className="text-sm text-sand-600">{t("outline.emptySections")}</p>
        )}
      </div>
      )}

      {/* The bars are drawn on the body (merge-undo.tsx): while a board is
          open it draws both of its own, and By document its selection bar. */}
      {board === null && !byDocument && (
        <SelectionBar
          tree={tree}
          actions={actions}
          onCompare={(ids) => {
            setCompare(ids);
            actions.clearSelection();
          }}
        />
      )}
      {/* One pill on every surface: a reject's Undo too (SPEC.md §6). */}
      {board === null && (
        <MergeUndoBar actions={actions} rejected={lastRejected} onUndoReject={() => void undoReject()} />
      )}

      <Presence show={board !== null} exit="fade">
        {board && (
          <SectionBoard
            tree={tree}
            sectionId={board}
            actions={actions}
            onChange={setBoard}
            onClose={() => setBoard(null)}
            rejected={lastRejected}
            onUndoReject={() => void undoReject()}
          />
        )}
      </Presence>

      <Presence show={byDocument} exit="fade">
        {byDocument && (
          <DocumentColumns
            tree={tree}
            documents={notebook.documents}
            actions={actions}
            search={query}
            onCompare={(ids) => {
              setCompare(ids);
              actions.clearSelection();
            }}
            onClose={() => setByDocument(false)}
          />
        )}
      </Presence>

      <Presence show={compare !== null} exit="fade">
        {compare && (
          <CompareView
            tree={tree}
            ids={compare}
            actions={actions}
            onChange={setCompare}
            onClose={() => setCompare(null)}
          />
        )}
      </Presence>
    </div>
  );
}

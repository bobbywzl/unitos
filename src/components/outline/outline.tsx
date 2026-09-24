"use client";

import { useMemo, useState } from "react";
import { isImeKey } from "@/lib/ime";
import type { NotebookView } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { useT } from "@/components/lang-provider";
import { CollapsedViewToggle } from "@/components/collapsed-view-toggle";
import { NEW_GLOW_CLASS, NewPill, useNewFeature } from "@/components/new-feature";
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
// page with one pane per note (compare-view.tsx). By document opens the
// project's notes as a grid over the page, one column per document and one
// row per section (document-columns.tsx): the page is the whole project,
// where the tray in the reader holds the open document's notes alone.
export function Outline({ notebook }: { notebook: NotebookView }) {
  const t = useT();
  const { canEdit } = useCollab();
  const { tree, pending, actions, lastRejected, undoReject } = useOutline(notebook, canEdit);
  const [query, setQuery] = useState("");
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

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex flex-wrap items-baseline gap-3.5">
        <h1 className="text-[38px]">{notebook.title}</h1>
        {pending.length > 0 && (
          <span className="rounded-full bg-clay-200 px-3.5 py-1 text-xs font-semibold text-clay-800">
            {t("outline.pendingCount", { n: pending.length })}
          </span>
        )}
        <span className="text-[11px] text-sand-500">{t("outline.pageKeyHint")}</span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && !isImeKey(e) && setQuery("")}
          placeholder={t("outline.searchNotes")}
          aria-label={t("outline.searchNotes")}
          type="search"
          className="w-72 rounded-full bg-card px-4 py-2 text-[13px] shadow-soft outline-none placeholder:text-sand-500"
        />
        <CollapsedViewToggle view={actions.notesView} onChange={actions.setNotesView} track="notes-view" />
        {notebook.documents.length > 0 && (
          <button
            onClick={() => {
              byDocumentNew.seen();
              setByDocument(true);
            }}
            data-track="by-document"
            data-tip={t("outline.byDocumentTitle")}
            className={`flex items-center rounded-full bg-card px-3.5 py-1.5 text-xs font-semibold text-sand-600 shadow-soft hover:text-clay-800${
              byDocumentNew.isNew ? ` ${NEW_GLOW_CLASS}` : ""
            }`}
          >
            {t("outline.byDocument")}
            {byDocumentNew.isNew && <NewPill />}
          </button>
        )}
      </div>

      <div className="flex flex-col gap-[30px] pt-[22px]">
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

      <SelectionBar
        tree={tree}
        actions={actions}
        onCompare={(ids) => {
          setCompare(ids);
          actions.clearSelection();
        }}
      />
      <MergeUndoBar actions={actions} />

      <Presence show={board !== null} exit="fade">
        {board && (
          <SectionBoard
            tree={tree}
            sectionId={board}
            actions={actions}
            onChange={setBoard}
            onClose={() => setBoard(null)}
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

      {lastRejected && (
        <div className="fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full bg-card px-5 py-2.5 shadow-float">
          <span className="text-[13px] text-sand-600">{t("outline.noteRejected")}</span>
          <button
            onClick={() => void undoReject()}
            data-tip={t("outline.undoRejectTitle")}
            className="rounded-full bg-clay px-3.5 py-1 text-xs font-semibold text-clay-fg hover:bg-clay-600"
          >
            {t("outline.undo")}
          </button>
        </div>
      )}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { isImeKey } from "@/lib/ime";
import type { NotebookView } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { useT } from "@/components/lang-provider";
import { CollapsedViewToggle } from "@/components/collapsed-view-toggle";
import { Presence } from "@/components/presence";
import { SortableBoard, SortableGroup, SortableItem } from "@/components/sortable";
import { AddSection } from "@/components/outline/add-section";
import { dropIndex, parseListId, SECTIONS_LIST } from "@/components/outline/board-lists";
import { CompareView } from "@/components/outline/compare-view";
import { NoteCard } from "@/components/outline/note-card";
import { SectionItem } from "@/components/outline/section-item";
import { SelectionBar } from "@/components/outline/selection-bar";
import {
  filterSections,
  findSection,
  flattenNotes,
  useOutline,
} from "@/components/outline/use-outline";

// The notes full page (design 2b): the reorganizing view. Sections carry drag
// grips, notes are flat cards, and pending ones stay in place with Accept/Reject
// inline — unlike the tray, which hoists the whole pending queue to the top.
// Selecting two or more notes offers Compare: the compare view opens over the
// page with one pane per note (compare-view.tsx).
export function Outline({ notebook }: { notebook: NotebookView }) {
  const t = useT();
  const { canEdit } = useCollab();
  const { tree, pending, actions, lastRejected, undoReject } = useOutline(notebook, canEdit);
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;
  const results = searching ? filterSections(tree, query) : tree;
  // The notes in the compare view, in pane order; null = closed.
  const [compare, setCompare] = useState<string[] | null>(null);
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
    // The list a composer owns a note in shows one note fewer than the
    // section holds, so the place is counted in the section's own list
    // (board-lists.ts) — the index reorderNote and the server count with.
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
          className="w-72 rounded-full bg-card px-4 py-2 text-[13px] shadow-soft outline-none placeholder:text-sand-500"
        />
        <CollapsedViewToggle view={actions.notesView} onChange={actions.setNotesView} track="notes-view" />
      </div>

      <div className="flex flex-col gap-[30px] pt-[22px]">
        {searching ? (
          // Search results are read-only groupings: drag-reorder works on the full
          // list, so it pauses while a filter hides part of it.
          <>
            {results.map((section) => (
              <section key={section.id} className="flex flex-col gap-2.5">
                <div className="flex items-baseline gap-2.5">
                  <span className="font-display text-[22px]">{section.title}</span>
                  <span className="text-[13px] text-sand-600">{section.notes.length}</span>
                </div>
                {section.notes.map((note) => (
                  <NoteCard key={note.id} note={note} actions={actions} variant="page" />
                ))}
                {section.children.map((child) => (
                  <div key={child.id} className="flex flex-col gap-2.5 pl-5">
                    <div className="flex items-baseline gap-2.5">
                      <span className="font-display text-lg">{child.title}</span>
                      <span className="text-[13px] text-sand-600">{child.notes.length}</span>
                    </div>
                    {child.notes.map((note) => (
                      <NoteCard key={note.id} note={note} actions={actions} variant="page" />
                    ))}
                  </div>
                ))}
              </section>
            ))}
            {results.length === 0 && (
              <p className="text-sm text-sand-600">
                {t("outline.noNotesMatch", { query: query.trim() })}
              </p>
            )}
          </>
        ) : (
          <>
            {/* One drag across the whole page (SPEC.md §6): a note dragged
                out of its section drops into any other, and a section
                reorders among its siblings. */}
            <SortableBoard
              id="notes-board"
              onDrop={onDrop}
              canDrop={(from, to) => parseListId(from).kind === parseListId(to).kind}
              onMerge={
                canEdit ? (id, intoId) => void actions.mergeNotes(intoId, [id], "ai") : undefined
              }
              canMerge={(id, intoId) =>
                notesById.get(id)?.status === "ACCEPTED" &&
                notesById.get(intoId)?.status === "ACCEPTED"
              }
              overlay={(itemId) => {
                const note = notesById.get(itemId);
                if (note) return <NoteCard note={note} actions={actions} variant="page" />;
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
                {tree.map((section) => (
                  <SortableItem key={section.id} id={section.id}>
                    {(handle) => <SectionItem section={section} actions={actions} handle={handle} />}
                  </SortableItem>
                ))}
              </SortableGroup>
            </SortableBoard>

            {canEdit && <AddSection onAdd={(title) => actions.addSection(null, title)} />}

            {tree.length === 0 && (
              <p className="text-sm text-sand-600">{t("outline.emptySections")}</p>
            )}
          </>
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

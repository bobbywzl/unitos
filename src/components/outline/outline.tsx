"use client";

import { useState } from "react";
import type { NotebookView } from "@/lib/types";
import { useT } from "@/components/lang-provider";
import { SortableItem, SortableList } from "@/components/sortable";
import { AddSection } from "@/components/outline/add-section";
import { NoteCard } from "@/components/outline/note-card";
import { SectionItem } from "@/components/outline/section-item";
import { filterSections, useOutline } from "@/components/outline/use-outline";

// The notes full page (design 2b): the reorganizing view. Sections carry drag
// grips, notes are flat cards, and pending ones stay in place with Accept/Reject
// inline — unlike the tray, which hoists the whole pending queue to the top.
export function Outline({ notebook }: { notebook: NotebookView }) {
  const t = useT();
  const { tree, pending, actions, lastRejected, undoReject } = useOutline(notebook);
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;
  const results = searching ? filterSections(tree, query) : tree;

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

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setQuery("")}
        placeholder={t("outline.searchNotes")}
        aria-label={t("outline.searchNotes")}
        className="mt-2 w-72 rounded-full bg-card px-4 py-2 text-[13px] shadow-soft outline-none placeholder:text-sand-500"
      />

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
            <SortableList
              id="sections-root"
              ids={tree.map((s) => s.id)}
              onMove={(id, to) => actions.reorderSection(null, id, to)}
            >
              {tree.map((section) => (
                <SortableItem key={section.id} id={section.id}>
                  {(handle) => <SectionItem section={section} actions={actions} handle={handle} />}
                </SortableItem>
              ))}
            </SortableList>

            <AddSection onAdd={(title) => actions.addSection(null, title)} />

            {tree.length === 0 && (
              <p className="text-sm text-sand-600">{t("outline.emptySections")}</p>
            )}
          </>
        )}
      </div>

      {lastRejected && (
        <div className="fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full bg-card px-5 py-2.5 shadow-float">
          <span className="text-[13px] text-sand-600">{t("outline.noteRejected")}</span>
          <button
            onClick={() => void undoReject()}
            className="rounded-full bg-clay px-3.5 py-1 text-xs font-semibold text-clay-fg hover:bg-clay-600"
          >
            {t("outline.undo")}
          </button>
        </div>
      )}
    </div>
  );
}

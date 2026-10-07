"use client";

import { Fragment, useEffect, useState } from "react";
import { isImeKey } from "@/lib/ime";
import type { NoteView, SectionView } from "@/lib/types";
import { ChevronLeftIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { shownSectionTitle } from "@/lib/section-title";
import { NoteCard } from "@/components/outline/note-card";
import { SelectionBar } from "@/components/outline/selection-bar";
import { filterSections, type OutlineActions } from "@/components/outline/use-outline";

// By document (SPEC.md §6): the project's notes as a grid over the notes
// full page — one column per document, one row per section — so the notes
// different documents gave one section read side by side. A note sits
// under the document it was written in, else the document its first source
// is in, else Project: the notes that belong to the project as a whole. A
// document with no notes has no column. The header row and the section
// column stay in view while the grid scrolls. The cards are the page's
// cards: a note edits, pins, and selects here as on the page, and Compare
// in the selection bar opens the compare view over the grid. Esc or Notes
// closes the view.

type Row = { section: SectionView; label: string; nested: boolean };

// The grid draws its first cards with the press and the rest a few a frame:
// the 135 cards of a large project drawn at once took 170 ms before the grid
// showed. The cards come in reading order: row by row, and in a row the
// first card of each column, then the second of each, so the top of the
// grid fills first and the rest comes in under it.
const FIRST_CARDS = 24;
const CARDS_A_FRAME = 24;

/** How many cards each cell draws when the grid draws its first `budget`
    cards in reading order. `cells` holds each row's cells' card counts. */
function cardsDrawn(cells: number[][], budget: number): number[][] {
  const drawn = cells.map((row) => row.map(() => 0));
  let left = budget;
  for (let r = 0; r < cells.length && left > 0; r++) {
    const deepest = Math.max(0, ...cells[r]);
    for (let level = 0; level < deepest && left > 0; level++) {
      for (let c = 0; c < cells[r].length && left > 0; c++) {
        if (cells[r][c] > level) {
          drawn[r][c] = level + 1;
          left--;
        }
      }
    }
  }
  return drawn;
}

/** Every section as a row, in outline order: a child section under its
    parent, labelled "Parent / Child". */
function rowsOf(sections: SectionView[], t: TFunc, parent?: string): Row[] {
  return sections.flatMap((section) => {
    const title = shownSectionTitle(section.title, t);
    const label = parent ? `${parent} / ${title}` : title;
    return [{ section, label, nested: parent !== undefined }, ...rowsOf(section.children, t, label)];
  });
}

export function DocumentColumns({
  tree,
  documents,
  actions,
  search = "",
  onCompare,
  onClose,
}: {
  tree: SectionView[];
  /** The project's documents, in attach order: the columns. */
  documents: { id: string; title: string }[];
  actions: OutlineActions;
  /** The page's search: the grid shows the notes it found, in their rows. */
  search?: string;
  onCompare: (ids: string[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const attached = new Set(documents.map((d) => d.id));
  // The note's column: its document, else its first source's, else Project
  // (null). A document no longer attached is nobody's: Project.
  const columnOf = (note: NoteView): string | null => {
    const id = note.documentId ?? note.sources[0]?.documentId ?? null;
    return id && attached.has(id) ? id : null;
  };
  const shown = search.trim() ? filterSections(tree, search) : tree;
  const rows = rowsOf(shown, t).filter((row) => row.section.notes.length > 0);
  const used = new Set(rows.flatMap((row) => row.section.notes.map(columnOf)));
  const columns: { id: string | null; title: string }[] = [
    ...documents.filter((d) => used.has(d.id)),
    ...(used.has(null) ? [{ id: null, title: t("outline.projectColumn") }] : []),
  ];
  // Each cell's notes, and how many of them are drawn so far.
  const cellNotes = rows.map((row) => columns.map((column) => row.section.notes.filter((note) => columnOf(note) === column.id)));
  const [budget, setBudget] = useState(FIRST_CARDS);
  const cards = rows.reduce((n, row) => n + row.section.notes.length, 0);
  useEffect(() => {
    if (budget >= cards) return;
    const frame = requestAnimationFrame(() => setBudget((n) => n + CARDS_A_FRAME));
    return () => cancelAnimationFrame(frame);
  }, [budget, cards]);
  const drawn = cardsDrawn(
    cellNotes.map((row) => row.map((notes) => notes.length)),
    budget,
  );

  // Esc closes the view, like every overlay. Esc inside a field stays the
  // field's: the editor's Esc cancels the edit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || isImeKey(e)) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const head = "sticky top-0 z-10 border-b border-line bg-paper px-3 py-2";

  return (
    <div className="content-in fixed inset-0 z-50 flex flex-col bg-paper">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <button
          onClick={onClose}
          data-track="by-document-close"
          className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-sand-600 hover:bg-clay-100 hover:text-clay-800"
        >
          <ChevronLeftIcon size={14} />
          {t("outline.notesLabel")}
        </button>
        <span className="font-display text-[18px]">{t("outline.documentColumns")}</span>
        {columns.length > 0 && (
          <span className="text-[12px] text-sand-500">{t("outline.byDocumentCount", { n: documents.filter((d) => used.has(d.id)).length })}</span>
        )}
        <span className="ml-auto text-[12px] text-sand-500">{t("outline.byDocumentHint")}</span>
      </header>

      {columns.length === 0 ? (
        <p className="p-5 text-sm text-sand-600">{t("outline.byDocumentEmpty")}</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
          <div
            className="grid min-w-max"
            style={{ gridTemplateColumns: `180px repeat(${columns.length}, minmax(320px, 420px))` }}
          >
            {/* The header row: the corner, then one document per column. */}
            <div className={`${head} left-0 z-20`} />
            {columns.map((column) => (
              <div key={column.id ?? "project"} className={`${head} truncate font-display text-[16px]`} title={column.title}>
                {column.title}
              </div>
            ))}
            {/* One row per section: its label at the left, then its notes
                under each document. */}
            {rows.map((row, r) => drawn[r].some((n) => n > 0) && (
              <Fragment key={row.section.id}>
                <div
                  className={`sticky left-0 z-10 border-b border-line bg-paper px-3 py-3 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase ${
                    row.nested ? "pl-6" : ""
                  }`}
                >
                  {row.label}
                </div>
                {columns.map((column, c) => {
                  const notes = cellNotes[r][c].slice(0, drawn[r][c]);
                  return (
                    <div
                      key={column.id ?? "project"}
                      className="flex min-w-0 flex-col gap-2.5 border-b border-l border-line px-3 py-3"
                    >
                      {notes.map((note) => (
                        <NoteCard key={actions.noteKey(note.id)} note={note} actions={actions} variant="page" search={search} />
                      ))}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      )}

      <SelectionBar tree={tree} actions={actions} onCompare={onCompare} />
    </div>
  );
}

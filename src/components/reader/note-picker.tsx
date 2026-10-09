"use client";

import { useEffect, useRef, useState } from "react";
import { isImeKey } from "@/lib/ime";
import { clipWords, markdownPreview } from "@/lib/markdown-preview";
import { noteTitle } from "@/lib/note-title";
import type { NoteView, SectionView } from "@/lib/types";
import { useT } from "@/components/lang-provider";
import { shortNoteId } from "@/components/outline/note-id";

// The list a reader picks a note from (SPEC.md §6): the project's accepted
// notes, the most recently edited first, each with its section, searched by
// their words or their id. Arrows move through the rows and Enter picks one —
// the first match until an arrow moves. The
// annotation menu's Add to a note and the reader's Add to notes both draw it,
// so the two stay one.

/** Every section as a flat list, a child under its parent's name. */
export function flatSections(sections: SectionView[]): { id: string; label: string; notes: NoteView[] }[] {
  return sections.flatMap((s) => [
    { id: s.id, label: s.title, notes: s.notes },
    ...s.children.map((c) => ({ id: c.id, label: `${s.title} / ${c.title}`, notes: c.notes })),
  ]);
}

/** The line a note shows in the picker: its title, else its first words —
    two lines' worth, enough to tell notes that start alike apart. */
export function noteLine(note: NoteView): string {
  return noteTitle(note.content) || clipWords(markdownPreview(note.content), 110);
}

/** One row of a menu: the picker's rows and the annotation menu's items. */
export const menuRowClass =
  "flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[12.5px] text-sand-800 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40";

/** The notes the picker lists for a search: the accepted notes whose words
    or id hold it, the most recently edited first — the note the reader just
    worked on is the one most often wanted. */
export function pickerNotes(sections: SectionView[], query: string): { note: NoteView; section: string }[] {
  const needle = query.trim().toLowerCase();
  return flatSections(sections)
    .flatMap((s) => s.notes.map((note) => ({ note, section: s.label })))
    .filter(
      ({ note: n }) =>
        n.status === "ACCEPTED" &&
        (!needle || n.content.toLowerCase().includes(needle) || n.id.toLowerCase().includes(needle.replace(/^#/, ""))),
    )
    .sort((a, b) => Date.parse(b.note.updatedAt) - Date.parse(a.note.updatedAt));
}

export function NotePicker({
  sections,
  onPick,
  onEscape,
  disabled,
  track = "add-to-note-pick",
  autoFocus = true,
  listClassName = "max-h-[min(20rem,45vh)]",
}: {
  /** The project's sections with their notes: where the words can go. */
  sections: SectionView[];
  /** The note the reader picked, and the label of its section. */
  onPick: (note: NoteView, sectionLabel: string) => void;
  /** Escape in the search with nothing typed: the step before the picker.
      Unset: Escape clears the search, and with nothing typed goes on to
      whatever holds the picker. */
  onEscape?: () => void;
  disabled?: boolean;
  /** The rows' `data-track`, for the admin clicks page. */
  track?: string;
  /** False where a field above the picker takes the focus first. */
  autoFocus?: boolean;
  /** The list's height: as many rows as the room allows; it scrolls past them. */
  listClassName?: string;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  // The row Enter picks: the first match until an arrow moves it.
  const [active, setActive] = useState(0);
  const rows = pickerNotes(sections, query);
  const current = Math.min(active, rows.length - 1);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-picker-row="${current}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [current]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (isImeKey(e)) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (rows.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + rows.length) % rows.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[current];
      if (row && !disabled) onPick(row.note, row.section);
      return;
    }
    if (e.key === "Escape") {
      // One step back at a time: the search, then the step before the picker.
      if (query) {
        e.stopPropagation();
        e.preventDefault();
        setQuery("");
        setActive(0);
      } else if (onEscape) {
        e.stopPropagation();
        e.preventDefault();
        onEscape();
      }
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        autoFocus={autoFocus}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        placeholder={t("outline.searchNotes")}
        aria-label={t("outline.searchNotes")}
        aria-activedescendant={rows.length > 0 ? `note-picker-row-${current}` : undefined}
        className="w-full rounded-full bg-sand-100 px-3 py-1.5 text-[12.5px] outline-none placeholder:text-sand-500"
      />
      {/* As many rows as the room allows; the list scrolls past them. */}
      <div ref={listRef} role="menu" className={`${listClassName} overflow-y-auto`}>
        {rows.length === 0 && (
          <p className="px-2.5 py-2 text-[12px] text-sand-600">{t("panels.annotationNoNotes")}</p>
        )}
        {rows.map(({ note, section }, i) => (
          <button
            key={note.id}
            id={`note-picker-row-${i}`}
            data-picker-row={i}
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={() => onPick(note, section)}
            onMouseMove={() => i !== current && setActive(i)}
            data-track={track}
            className={`${menuRowClass} flex-col !items-stretch !gap-0.5 ${i === current ? "bg-clay-100 text-clay-800" : ""}`}
          >
            <span className="line-clamp-2 break-words">{noteLine(note)}</span>
            <span className="flex min-w-0 items-center gap-1.5 text-[10.5px] text-sand-500">
              <span className="shrink-0 font-mono">{shortNoteId(note.id)}</span>
              <span className="truncate">{section}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

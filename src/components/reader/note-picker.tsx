"use client";

import { useState } from "react";
import { clipWords, markdownPreview } from "@/lib/markdown-preview";
import { noteTitle } from "@/lib/note-title";
import type { NoteView, SectionView } from "@/lib/types";
import { useT } from "@/components/lang-provider";
import { shortNoteId } from "@/components/outline/note-id";

// Stub: replaced on merge by the note picker another worker builds. Same
// interface: the accepted notes by section, a search field over them, the
// rows of annotation-menu.tsx.

function flatSections(sections: SectionView[]): { id: string; label: string; notes: NoteView[] }[] {
  return sections.flatMap((s) => [
    { id: s.id, label: s.title, notes: s.notes },
    ...s.children.map((c) => ({ id: c.id, label: `${s.title} / ${c.title}`, notes: c.notes })),
  ]);
}

function noteLine(note: NoteView): string {
  return noteTitle(note.content) || clipWords(markdownPreview(note.content), 48);
}

export function NotePicker({
  sections,
  onPick,
  disabled,
}: {
  sections: SectionView[];
  onPick: (note: NoteView, sectionLabel: string) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const accepted = flatSections(sections)
    .map((s) => ({
      ...s,
      notes: s.notes.filter(
        (n) =>
          n.status === "ACCEPTED" &&
          (!needle ||
            n.content.toLowerCase().includes(needle) ||
            n.id.toLowerCase().includes(needle.replace(/^#/, ""))),
      ),
    }))
    .filter((s) => s.notes.length > 0);
  const item =
    "flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[12px] text-sand-800 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40";

  return (
    <div className="flex flex-col gap-1">
      <input
        autoFocus
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("outline.searchNotes")}
        aria-label={t("outline.searchNotes")}
        className="w-full rounded-full bg-sand-100 px-3 py-1.5 text-[12px] outline-none placeholder:text-sand-500"
      />
      <div className="max-h-44 overflow-y-auto">
        {accepted.length === 0 && (
          <p className="px-2.5 py-2 text-[12px] text-sand-600">{t("panels.annotationNoNotes")}</p>
        )}
        {accepted.map((s) => (
          <div key={s.id} className="py-1">
            <span className="block px-2.5 py-0.5 text-[10.5px] font-bold tracking-[0.08em] text-sand-500 uppercase">
              {s.label}
            </span>
            {s.notes.map((note) => (
              <button
                key={note.id}
                type="button"
                disabled={disabled}
                onClick={() => onPick(note, s.label)}
                data-track="note-picker-pick"
                className={item}
              >
                <span className="shrink-0 font-mono text-[10.5px] text-sand-500">{shortNoteId(note.id)}</span>
                <span className="min-w-0 flex-1 truncate">{noteLine(note)}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

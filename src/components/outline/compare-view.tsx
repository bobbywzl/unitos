"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { isImeKey } from "@/lib/ime";
import type { NoteView, SectionView } from "@/lib/types";
import { ChevronLeftIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { markdownPreview } from "@/components/markdown";
import { NoteCard } from "@/components/outline/note-card";
import { shortNoteId } from "@/components/outline/note-id";
import type { OutlineActions } from "@/components/outline/use-outline";

// The compare view (notes full page): the chosen notes in one screen, one
// pane per note, each its own scroller holding the whole note card — so two
// or more notes read, and edit, next to each other. Side by side lays the
// panes out as columns; Stacked as rows. The layout choice persists per
// browser. Add note… adds a pane; ✕ removes one; Esc or Notes closes the view.

export type CompareLayout = "columns" | "rows";
const LAYOUT_STORE = "unitos-compare-layout";

function readLayout(): CompareLayout {
  try {
    return localStorage.getItem(LAYOUT_STORE) === "rows" ? "rows" : "columns";
  } catch {
    return "columns";
  }
}

// Every note with the section it sits in, in outline order.
type Entry = { note: NoteView; sectionLabel: string };

function entries(sections: SectionView[], prefix = ""): Entry[] {
  return sections.flatMap((s) => {
    const sectionLabel = prefix ? `${prefix} / ${s.title}` : s.title;
    return [...s.notes.map((note) => ({ note, sectionLabel })), ...entries(s.children, sectionLabel)];
  });
}

export function CompareView({
  tree,
  ids,
  actions,
  onChange,
  onClose,
}: {
  tree: SectionView[];
  ids: string[]; // the notes in the view, in pane order
  actions: OutlineActions;
  onChange: (ids: string[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [layout, setLayout] = useState<CompareLayout>("columns");
  // The remembered layout, read before the first paint.
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayout(readLayout());
  }, []);
  function chooseLayout(next: CompareLayout) {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_STORE, next);
    } catch {
      // storage unavailable: the choice lasts until the page reloads
    }
  }

  // Panes read from the live tree, so an edit made in one shows at once.
  const all = entries(tree);
  const byId = new Map(all.map((e) => [e.note.id, e]));
  const panes = ids.map((id) => byId.get(id)).filter((e): e is Entry => e !== undefined);
  const others = all.filter((e) => !ids.includes(e.note.id));
  const groups: { label: string; items: Entry[] }[] = [];
  for (const entry of others) {
    const group = groups.find((g) => g.label === entry.sectionLabel);
    if (group) group.items.push(entry);
    else groups.push({ label: entry.sectionLabel, items: [entry] });
  }

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

  // A note deleted from its pane leaves the view; the last one leaving closes it.
  useEffect(() => {
    if (panes.length === 0) onClose();
  }, [panes.length, onClose]);

  return (
    <div className="content-in fixed inset-0 z-50 flex flex-col bg-paper">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <button
          onClick={onClose}
          data-track="compare-close"
          className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-sand-600 hover:bg-clay-100 hover:text-clay-800"
        >
          <ChevronLeftIcon size={14} />
          {t("outline.notesLabel")}
        </button>
        <span className="font-display text-[18px]">{t("outline.compareCount", { n: panes.length })}</span>
        <div className="ml-auto flex items-center gap-2">
          <div role="radiogroup" className="flex rounded-full bg-sand-200 p-0.5 text-xs">
            {(["columns", "rows"] as const).map((option) => (
              <button
                key={option}
                role="radio"
                aria-checked={layout === option}
                onClick={() => chooseLayout(option)}
                data-track={`compare-layout:${option}`}
                className={`rounded-full px-3 py-1 font-semibold ${
                  layout === option ? "bg-card text-clay-800 shadow-soft" : "text-sand-600 hover:text-clay-800"
                }`}
              >
                {t(option === "columns" ? "outline.layoutColumns" : "outline.layoutRows")}
              </button>
            ))}
          </div>
          {groups.length > 0 && (
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) onChange([...ids, e.target.value]);
              }}
              data-track="compare-add"
              aria-label={t("outline.addToCompare")}
              className="w-48 rounded-full border border-line bg-card px-3 py-1.5 text-xs text-sand-700 outline-none hover:bg-clay-100 hover:text-clay-800"
            >
              <option value="" disabled>
                {t("outline.addToCompare")}
              </option>
              {groups.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.items.map(({ note }) => (
                    <option key={note.id} value={note.id}>
                      {shortNoteId(note.id)} · {markdownPreview(note.content).slice(0, 70)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
        </div>
      </header>

      <div
        className={
          layout === "columns"
            ? "grid min-h-0 flex-1 auto-cols-[minmax(340px,1fr)] grid-flow-col gap-4 overflow-x-auto p-4 md:p-5"
            : "grid min-h-0 flex-1 auto-rows-[minmax(240px,1fr)] grid-flow-row gap-4 overflow-y-auto p-4 md:p-5"
        }
      >
        {panes.map(({ note, sectionLabel }) => (
          <section
            key={note.id}
            className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl bg-card shadow-soft"
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2">
              <span className="truncate text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
                {sectionLabel}
              </span>
              <button
                onClick={() => onChange(ids.filter((id) => id !== note.id))}
                data-track="compare-remove"
                aria-label={t("outline.removeFromCompare")}
                title={t("outline.removeFromCompare")}
                className="ml-auto flex size-6 shrink-0 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <NoteCard note={note} actions={actions} variant="pane" />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

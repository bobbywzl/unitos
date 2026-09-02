"use client";

import type { SectionView } from "@/lib/types";
import { useT } from "@/components/lang-provider";
import { flattenNotes, type OutlineActions } from "@/components/outline/use-outline";

// The bulk action bar for the ticker selection: delete, merge, and pin the
// selected notes. Rendered by the tray and the notes full page; shows only
// while notes are selected. Esc clears the selection.
export function SelectionBar({ tree, actions }: { tree: SectionView[]; actions: OutlineActions }) {
  const t = useT();
  const selected = flattenNotes(tree).filter((n) => actions.selected.has(n.id));
  if (selected.length === 0) return null;
  const allPinned = selected.every((n) => n.pinned);

  async function pinAll() {
    // Sequential: each pin rewrites sibling orders; parallel writes would race.
    for (const note of selected) await actions.setPinned(note.id, !allPinned);
  }

  async function deleteAll() {
    if (!confirm(t("outline.confirmDeleteSelected", { n: selected.length }))) return;
    for (const note of selected) await actions.deleteNote(note.id);
    actions.clearSelection();
  }

  return (
    <div className="fixed bottom-[calc(66px+env(safe-area-inset-bottom))] left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full bg-card px-5 py-2.5 shadow-float md:bottom-6">
      <span className="text-[13px] text-sand-600">
        {t("outline.selectedCount", { n: selected.length })}
      </span>
      {selected.length >= 2 && (
        <button
          onClick={() => void actions.mergeNotes(selected[0].id, selected.slice(1).map((n) => n.id))}
          className="rounded-full bg-sage-600 px-3.5 py-1 text-xs font-semibold text-sage-fg hover:bg-sage-700"
          data-tooltip={t("outline.mergeTitle")}
        >
          {t("outline.merge")}
        </button>
      )}
      <button
        onClick={() => void pinAll()}
        className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
      >
        {allPinned ? t("outline.unpin") : t("outline.pin")}
      </button>
      <button
        onClick={() => void deleteAll()}
        className="rounded-full border border-line px-3 py-1 text-xs text-red-500 hover:bg-red-50 hover:text-red-700"
      >
        {t("common.delete")}
      </button>
      <button
        onClick={() => actions.clearSelection()}
        aria-label={t("outline.clearSelection")}
        data-tooltip={t("outline.clearSelection")}
        className="text-sand-500 hover:text-clay-700"
      >
        ✕
      </button>
    </div>
  );
}

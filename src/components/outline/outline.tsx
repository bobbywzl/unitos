"use client";

import type { NotebookView } from "@/lib/types";
import { SortableItem, SortableList } from "@/components/sortable";
import { AddSection } from "@/components/outline/add-section";
import { SectionItem } from "@/components/outline/section-item";
import { useOutline } from "@/components/outline/use-outline";

// The notes full page (design 2b): the reorganizing view. Sections carry drag
// grips, notes are flat cards, and pending ones stay in place with Accept/Reject
// inline — unlike the tray, which hoists the whole pending queue to the top.
export function Outline({ notebook }: { notebook: NotebookView }) {
  const { tree, pending, actions } = useOutline(notebook);

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex flex-wrap items-baseline gap-3.5">
        <h1 className="text-[38px]">{notebook.title}</h1>
        {pending.length > 0 && (
          <span className="rounded-full bg-clay-200 px-3.5 py-1 text-xs font-semibold text-clay-800">
            {pending.length} pending
          </span>
        )}
        <span className="text-[11px] text-sand-500">⏎ accept · ⌫ reject · e edit · g source</span>
      </div>

      <div className="flex flex-col gap-[30px] pt-[22px]">
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
          <p className="text-sm text-sand-600">No sections yet. Add one to start taking notes.</p>
        )}
      </div>
    </div>
  );
}

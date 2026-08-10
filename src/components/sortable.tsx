"use client";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type SortableHook = ReturnType<typeof useSortable>;
export type HandleProps = {
  attributes: SortableHook["attributes"];
  listeners: SortableHook["listeners"];
};

// One vertical drag-reorder list. Nested lists each get their own SortableList.
// `id` keeps DndContext aria ids stable across server and client renders.
export function SortableList({
  id,
  ids,
  onMove,
  children,
}: {
  id: string;
  ids: string[];
  onMove: (id: string, toIndex: number) => void;
  children: React.ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const to = ids.indexOf(String(over.id));
    if (to === -1) return;
    onMove(String(active.id), to);
  }

  return (
    <DndContext id={id} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

export function SortableItem({
  id,
  children,
}: {
  id: string;
  children: (handle: HandleProps) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "opacity-50" : undefined}
    >
      {children({ attributes, listeners })}
    </div>
  );
}

export function DragHandle({ handle, label }: { handle: HandleProps; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex cursor-grab touch-none items-center rounded-full p-0.5 text-sand-400 hover:bg-clay-100 hover:text-clay-800"
      {...handle.attributes}
      {...(handle.listeners ?? {})}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="9" cy="5" r="1" />
        <circle cx="15" cy="5" r="1" />
        <circle cx="9" cy="12" r="1" />
        <circle cx="15" cy="12" r="1" />
        <circle cx="9" cy="19" r="1" />
        <circle cx="15" cy="19" r="1" />
      </svg>
    </button>
  );
}

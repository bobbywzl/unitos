"use client";

import { createContext, useContext, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
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

// The id of the item the dragged item would combine into on drop, or null.
// Cards read it to draw the combine ring.
const CombineTargetContext = createContext<string | null>(null);
export function useCombineTarget() {
  return useContext(CombineTargetContext);
}

// One vertical drag-reorder list. Nested lists each get their own SortableList.
// `id` keeps DndContext aria ids stable across server and client renders.
// With `onCombine`, dropping an item on the middle band of another combines the
// two instead of reordering; the edges still reorder. `canCombine` gates pairs.
export function SortableList({
  id,
  ids,
  onMove,
  onCombine,
  canCombine,
  children,
}: {
  id: string;
  ids: string[];
  onMove: (id: string, toIndex: number) => void;
  onCombine?: (id: string, intoId: string) => void;
  canCombine?: (id: string, intoId: string) => boolean;
  children: React.ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [combineTarget, setCombineTarget] = useState<string | null>(null);
  // The ring must match the drop: handleDragEnd reads the ref, not the state.
  const combineRef = useRef<string | null>(null);

  function setCombine(target: string | null) {
    combineRef.current = target;
    setCombineTarget((prev) => (prev === target ? prev : target));
  }

  function handleDragMove({ active, over }: DragMoveEvent) {
    if (!onCombine || !over || over.id === active.id) {
      setCombine(null);
      return;
    }
    const activeId = String(active.id);
    const overId = String(over.id);
    if (canCombine && !canCombine(activeId, overId)) {
      setCombine(null);
      return;
    }
    const rect = active.rect.current.translated;
    if (!rect) {
      setCombine(null);
      return;
    }
    // Middle band of the target: 30% margins top and bottom.
    const centerY = rect.top + rect.height / 2;
    const margin = over.rect.height * 0.3;
    const inBand = centerY > over.rect.top + margin && centerY < over.rect.top + over.rect.height - margin;
    setCombine(inBand ? overId : null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const target = combineRef.current;
    setCombine(null);
    if (!over || active.id === over.id) return;
    if (onCombine && target && target !== String(active.id)) {
      onCombine(String(active.id), target);
      return;
    }
    const to = ids.indexOf(String(over.id));
    if (to === -1) return;
    onMove(String(active.id), to);
  }

  return (
    <DndContext
      id={id}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragMove={onCombine ? handleDragMove : undefined}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setCombine(null)}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <CombineTargetContext.Provider value={combineTarget}>{children}</CombineTargetContext.Provider>
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

"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  type SortingStrategy,
} from "@dnd-kit/sortable";
import { CSS, getEventCoordinates } from "@dnd-kit/utilities";

// A combine-capable list keeps items in place while dragging: with the shift
// preview on, the drop target slides away from under the pointer just as it
// becomes the combine target.
const holdStillStrategy: SortingStrategy = () => null;

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

// One drag across many lists (SPEC.md §6). Every list is a SortableGroup
// inside a SortableBoard, and the board owns the one DndContext, so a drag
// that starts in one list ends in any of them. A list also takes a drop on its
// own space, which is how an item lands in a list holding none.
const DROP_PREFIX = "drop:";
const dropId = (listId: string) => `${DROP_PREFIX}${listId}`;

// The pointer decides: an item under it wins, then a list's own space, then
// the nearest item. Without this a long list's box beat the item the pointer
// was on, and every drop landed at the end of the list.
const boardCollision: CollisionDetection = (args) => {
  const items = args.droppableContainers.filter((c) => !String(c.id).startsWith(DROP_PREFIX));
  const lists = args.droppableContainers.filter((c) => String(c.id).startsWith(DROP_PREFIX));
  const onItem = pointerWithin({ ...args, droppableContainers: items });
  if (onItem.length > 0) return onItem;
  const onList = pointerWithin({ ...args, droppableContainers: lists });
  if (onList.length > 0) return onList;
  return closestCenter({ ...args, droppableContainers: items });
};

// The item the pointer rests on the middle of, or null: the item a drop
// combines into. Read from the items' visual rects, not dnd-kit's `over` —
// the sorting strategy shifts items live, which keeps `over` pinned to the
// dragged item itself.
function combineTargetAt(
  ids: string[],
  activeId: string,
  x: number,
  y: number,
  canCombine?: (id: string, intoId: string) => boolean,
): string | null {
  for (const itemId of ids) {
    if (itemId === activeId) continue;
    if (canCombine && !canCombine(activeId, itemId)) continue;
    const el = document.querySelector(`[data-sortable-id="${itemId}"]`);
    if (!(el instanceof HTMLElement)) continue;
    const rect = el.getBoundingClientRect();
    // Middle band of the target: 30% margins top and bottom.
    const margin = rect.height * 0.3;
    if (x >= rect.left && x <= rect.right && y > rect.top + margin && y < rect.bottom - margin) {
      return itemId;
    }
  }
  return null;
}

// The lists a board holds, by list id, as they render: a group reports its
// ids so the board can place a drop without the page repeating the tree.
type Registry = Map<string, string[]>;
const BoardContext = createContext<{ current: Registry } | null>(null);

export function SortableBoard({
  id,
  onDrop,
  onCombine,
  canCombine,
  axis,
  children,
}: {
  id: string;
  /** The item left `fromListId` and landed in `toListId` at `toIndex`, where
      `overId` is the item it landed on — null when it landed on the list's own
      space, past its last item. The same list on both sides is a reorder. */
  onDrop: (
    fromListId: string,
    toListId: string,
    itemId: string,
    toIndex: number,
    overId: string | null,
  ) => void;
  onCombine?: (id: string, intoId: string) => void;
  canCombine?: (id: string, intoId: string) => boolean;
  axis?: "y";
  children: React.ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: axis === "y" ? { distance: { y: 6 }, tolerance: { x: 12 } } : { distance: 4 },
    }),
  );
  const [combineTarget, setCombineTarget] = useState<string | null>(null);
  const combineRef = useRef<string | null>(null);
  const registry = useRef<Registry>(new Map());

  function setCombine(target: string | null) {
    combineRef.current = target;
    setCombineTarget((prev) => (prev === target ? prev : target));
  }

  function handleDragMove({ active, activatorEvent, delta }: DragMoveEvent) {
    if (!onCombine) return;
    const start = getEventCoordinates(activatorEvent);
    if (!start) {
      setCombine(null);
      return;
    }
    const allIds = [...registry.current.values()].flat();
    setCombine(combineTargetAt(allIds, String(active.id), start.x + delta.x, start.y + delta.y, canCombine));
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    const activeId = String(active.id);
    const target = combineRef.current;
    setCombine(null);
    if (onCombine && target && target !== activeId) {
      onCombine(activeId, target);
      return;
    }
    if (!over) return;
    const lists = [...registry.current.entries()];
    const from = lists.find(([, ids]) => ids.includes(activeId));
    if (!from) return;
    const overId = String(over.id);
    const onList = lists.find(([listId]) => dropId(listId) === overId);
    const to = onList ?? lists.find(([, ids]) => ids.includes(overId));
    if (!to) return;
    const toIndex = onList ? onList[1].length : to[1].indexOf(overId);
    if (to[0] === from[0] && (overId === activeId || toIndex === -1)) return;
    onDrop(from[0], to[0], activeId, toIndex, onList ? null : overId);
  }

  return (
    <DndContext
      id={id}
      sensors={sensors}
      collisionDetection={boardCollision}
      onDragMove={onCombine ? handleDragMove : undefined}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setCombine(null)}
    >
      <BoardContext.Provider value={registry}>
        <CombineTargetContext.Provider value={combineTarget}>{children}</CombineTargetContext.Provider>
      </BoardContext.Provider>
    </DndContext>
  );
}

// One list inside a board. It holds no DndContext of its own — the board's
// drag runs through every group — and takes a drop on its own space, so a
// section holding no notes is still a target.
export function SortableGroup({
  id,
  ids,
  combine,
  className,
  children,
}: {
  id: string;
  ids: string[];
  /** The board combines on a drop in the middle of an item: items hold still. */
  combine?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const registry = useContext(BoardContext);
  registry?.current.set(id, ids);
  useEffect(() => () => void registry?.current.delete(id), [registry, id]);
  const { setNodeRef, isOver } = useDroppable({ id: dropId(id) });
  const empty = ids.length === 0;
  return (
    <SortableContext items={ids} strategy={combine ? holdStillStrategy : verticalListSortingStrategy}>
      <div
        ref={setNodeRef}
        data-drop-list={id}
        className={`${className ?? ""}${
          empty
            ? ` min-h-9 rounded-2xl border-[1.5px] border-dashed ${isOver ? "border-clay bg-clay-100/60" : "border-transparent"}`
            : ""
        }`}
      >
        {children}
      </div>
    </SortableContext>
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
      data-sortable-id={id}
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
      data-tip={label}
      data-drag-handle
      className="flex cursor-grab touch-none items-center rounded-full p-0.5 text-sand-500 hover:bg-clay-100 hover:text-clay-800"
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

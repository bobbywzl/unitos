"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, type SortingStrategy } from "@dnd-kit/sortable";
import { getEventCoordinates } from "@dnd-kit/utilities";
import type { MergeMode } from "@/lib/card-drag";

// One drag across many lists (SPEC.md §6). Every list is a SortableGroup
// inside a SortableBoard, and the board owns the one DndContext, so a drag
// that starts in one list ends in any of them.
//
// Nothing in a list moves while a card is dragged. The card itself rides in a
// drag overlay under the pointer, its place in the list left dimmed, and a
// line shows where it would land. Cards that slide out from under the pointer
// are what made the old preview flicker between a reorder and a merge; a line
// over cards that hold still says the same thing and never moves the target.
//
// Merge is a hold, not a pass, and it reads the cards, not the pointer: once
// the dragged card covers more than MERGE_COVER of another card the target
// rings, and holding it there for MERGE_DWELL_MS surfaces the merge strip on
// it — Merge with AI, or Join text. Releasing on a pill runs it; releasing on
// the card runs Join text; moving on puts the line back. A drag that passes
// over a card on its way somewhere else never merges anything.
//
// The pointer is not the card. A card picked up by its grip hangs below and
// right of the pointer, so a pointer that is on a card means the dragged card
// is somewhere above it — reading the pointer merged the wrong card, or none.
// What the reader sees is one card covering another, so that is what decides.

/** How much of the smaller card the two have to share before a hold merges
    them. The smaller of the two: a one-line card dropped on a long one covers
    little of it and all of itself, and either way it is over that card. */
const MERGE_COVER = 0.8;
/** The hold that surfaces the merge strip once the cards cover. */
export const MERGE_DWELL_MS = 2000;
// The pointer may drift this far and still count as holding.
const DWELL_DRIFT_PX = 6;
// How far past the card, the strip, and where the hold began the pointer may
// go and still be on them.
const MERGE_REACH_PX = 16;

// Cards hold still: the strategy moves nothing while a drag runs.
const holdStillStrategy: SortingStrategy = () => null;

type SortableHook = ReturnType<typeof useSortable>;
export type HandleProps = {
  attributes: SortableHook["attributes"];
  listeners: SortableHook["listeners"];
};

/** The card the merge strip is open on, or null. Cards read it to draw the ring. */
const MergeTargetContext = createContext<string | null>(null);
export function useMergeTarget() {
  return useContext(MergeTargetContext);
}

/** Where the dragged card would land: before this card, or at the end of this
    list. Items and groups read it to draw the line. */
type DropLine = { listId: string; beforeId: string | null };
const DropLineContext = createContext<DropLine | null>(null);

const DROP_PREFIX = "drop:";
const dropId = (listId: string) => `${DROP_PREFIX}${listId}`;

// The lists a board holds, by list id, as they render: a group reports its
// ids so the board can place a drop without the page repeating the tree.
type Registry = Map<string, string[]>;
const BoardContext = createContext<{ current: Registry } | null>(null);

function rectOf(id: string): DOMRect | null {
  const el = document.querySelector(`[data-sortable-id="${CSS.escape(id)}"]`);
  return el instanceof HTMLElement ? el.getBoundingClientRect() : null;
}

function inRect(x: number, y: number, r: DOMRect | null): boolean {
  return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/** The box that holds both, or the first alone when there is no second. */
function union(a: DOMRect, b: DOMRect | null): DOMRect {
  if (!b || b.width === 0) return a;
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  return new DOMRect(left, top, Math.max(a.right, b.right) - left, Math.max(a.bottom, b.bottom) - top);
}

/** The box grown by `px` on every side. */
function grow(r: DOMRect, px: number): DOMRect {
  return new DOMRect(r.left - px, r.top - px, r.width + 2 * px, r.height + 2 * px);
}

/** Where the merge strip stays open: the card it is on, the strip itself, and
    where the hold began, with room around all three. Reaching a pill moves
    the dragged card off the card it covers, so the cover cannot be what keeps
    the strip open; leaving this region is what closes it. The release reads
    the same region, so the strip being open always means a release merges. */
function armReach(armed: { rect: DOMRect; anchor: DOMRect }): DOMRect {
  const strip = document.querySelector<HTMLElement>("[data-merge-strip]");
  return grow(
    union(union(armed.rect, armed.anchor), strip?.getBoundingClientRect() ?? null),
    MERGE_REACH_PX,
  );
}

/** One point as a box, so a point unions with the boxes around it. */
function pointRect(x: number, y: number): DOMRect {
  return new DOMRect(x, y, 0, 0);
}

/** How much of the smaller of the two boxes the two share, 0 to 1. */
function coverage(a: DOMRect, b: DOMRect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (w <= 0 || h <= 0) return 0;
  const smaller = Math.min(a.width * a.height, b.width * b.height);
  return smaller <= 0 ? 0 : (w * h) / smaller;
}

/** The item under the pointer, innermost first: a section's box holds its
    notes' boxes, so the smallest box that holds the pointer is the item the
    pointer is really on. Lists the drag cannot land in are left out. */
function itemAt(
  lists: [string, string[]][],
  x: number,
  y: number,
): { listId: string; ids: string[]; index: number; rect: DOMRect } | null {
  let best: { listId: string; ids: string[]; index: number; rect: DOMRect } | null = null;
  for (const [listId, ids] of lists) {
    for (let i = 0; i < ids.length; i++) {
      const rect = rectOf(ids[i]);
      if (!inRect(x, y, rect) || !rect) continue;
      const area = rect.width * rect.height;
      if (best && best.rect.width * best.rect.height <= area) continue;
      best = { listId, ids, index: i, rect };
    }
  }
  return best;
}

/** The line the pointer asks for: the card it is on decides — its top half
    lands the drag before it, its bottom half after it. Off every card, the
    list under the pointer takes it at the end, and a list holding nothing
    takes it on its own space. */
function dropLineAt(lists: [string, string[]][], x: number, y: number): DropLine | null {
  const on = itemAt(lists, x, y);
  if (on) {
    const after = y > on.rect.top + on.rect.height / 2;
    return { listId: on.listId, beforeId: after ? (on.ids[on.index + 1] ?? null) : on.ids[on.index] };
  }
  // Off every card: the innermost list whose own space holds the pointer.
  let best: { listId: string; ids: string[]; area: number } | null = null;
  for (const [listId, ids] of lists) {
    const el = document.querySelector(`[data-drop-list="${CSS.escape(listId)}"]`);
    if (!(el instanceof HTMLElement)) continue;
    const rect = el.getBoundingClientRect();
    if (!inRect(x, y, rect)) continue;
    const area = rect.width * rect.height;
    if (best && best.area <= area) continue;
    best = { listId, ids, area };
  }
  if (!best) return null;
  // Above the first card of the list: the drag lands at its top.
  const first = best.ids[0] ? rectOf(best.ids[0]) : null;
  if (first && y < first.top) return { listId: best.listId, beforeId: best.ids[0] };
  return { listId: best.listId, beforeId: null };
}

/** The card the dragged card covers, or null: the card a hold would merge
    into. The one it covers most, so a card lying over two takes the nearer. */
function mergeCandidateAt(
  lists: [string, string[]][],
  activeId: string,
  card: DOMRect,
  canMerge?: (id: string, intoId: string) => boolean,
): string | null {
  let best: { id: string; cover: number } | null = null;
  for (const [, ids] of lists) {
    for (const id of ids) {
      if (id === activeId) continue;
      if (canMerge && !canMerge(activeId, id)) continue;
      const rect = rectOf(id);
      if (!rect) continue;
      const cover = coverage(card, rect);
      if (cover < MERGE_COVER) continue;
      if (best && best.cover >= cover) continue;
      best = { id, cover };
    }
  }
  return best?.id ?? null;
}

export function SortableBoard({
  id,
  onDrop,
  onMerge,
  canMerge,
  canDrop,
  mergeLabels,
  overlay,
  axis,
  children,
}: {
  id: string;
  /** The card left `fromListId` and landed in `toListId`, before the card
      `beforeId` — null when it landed at the end of that list. The same list
      on both sides is a reorder. */
  onDrop: (fromListId: string, toListId: string, itemId: string, beforeId: string | null) => void;
  /** A hold on another card, then a release on one of the strip's pills. */
  onMerge?: (id: string, intoId: string, mode: MergeMode) => void;
  canMerge?: (id: string, intoId: string) => boolean;
  /** Whether a card of `fromListId` can land in `toListId`. Without it every
      list takes every card. A page holding lists of two kinds — a section's
      notes and a section's children — says here which take which, so a drag
      never draws a line where the drop would do nothing. */
  canDrop?: (fromListId: string, toListId: string) => boolean;
  /** The strip's two pills, in order: Merge with AI, then Join text. */
  mergeLabels?: { ai: string; aiTitle: string; join: string; joinTitle: string };
  /** The card the overlay carries under the pointer while it is dragged. */
  overlay?: (itemId: string) => React.ReactNode;
  axis?: "y";
  children: React.ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint:
        axis === "y" ? { distance: { y: 6 }, tolerance: { x: 12 } } : { distance: 4 },
    }),
  );
  // The card being dragged, and the size it had in its list: the overlay is
  // drawn in a portal on the body, out of the tray's scroll box, so it carries
  // its own size, and the merge reads where it is drawn.
  const [active, setActive] = useState<{ id: string; width: number } | null>(null);
  const [line, setLine] = useState<DropLine | null>(null);
  // The card the dragged card covers: it rings, and holding there arms it.
  const [covered, setCovered] = useState<string | null>(null);
  // Armed: the merge strip is open on this card. rect is the card's box and
  // anchor is where the pointer was when the hold finished — the strip sits
  // below the card, and the pointer reaches it through both.
  const [armed, setArmed] = useState<{ id: string; rect: DOMRect; anchor: DOMRect } | null>(null);
  const registry = useRef<Registry>(new Map());
  // The live values the release reads: state lands a render too late for it.
  const lineRef = useRef<DropLine | null>(null);
  const armedRef = useRef<{ id: string; rect: DOMRect; anchor: DOMRect } | null>(null);
  // Where the pointer sits inside the dragged card, and the card's size: the
  // card is drawn under the pointer at this offset, so this is where it is.
  const held = useRef<{ dx: number; dy: number; width: number; height: number } | null>(null);
  const dwell = useRef<{ id: string; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(
    null,
  );

  function clearDwell() {
    if (dwell.current) clearTimeout(dwell.current.timer);
    dwell.current = null;
  }

  function setArm(next: { id: string; rect: DOMRect; anchor: DOMRect } | null) {
    armedRef.current = next;
    setArmed(next);
  }

  function setDropLine(next: DropLine | null) {
    lineRef.current = next;
    setLine((prev) =>
      prev?.listId === next?.listId && prev?.beforeId === next?.beforeId ? prev : next,
    );
  }

  function reset() {
    clearDwell();
    setArm(null);
    setCovered(null);
    setDropLine(null);
    setActive(null);
    held.current = null;
  }

  function handleDragStart({ active: dragged, activatorEvent }: DragStartEvent) {
    const id = String(dragged.id);
    const rect = rectOf(id);
    const start = getEventCoordinates(activatorEvent);
    setActive({ id, width: Math.round(rect?.width ?? 0) });
    held.current =
      rect && start
        ? { dx: start.x - rect.left, dy: start.y - rect.top, width: rect.width, height: rect.height }
        : null;
  }

  function handleDragMove({ active, activatorEvent, delta }: DragMoveEvent) {
    const start = getEventCoordinates(activatorEvent);
    if (!start) return;
    const x = start.x + delta.x;
    const y = start.y + delta.y;
    const dragged = String(active.id);

    // The strip is open: it stays open while the pointer is on the card, on
    // the strip, or on the way between them — reaching a pill moves the card
    // off the one it covers, and that is not moving on. It closes when the
    // pointer leaves all three, and the line comes back.
    if (armedRef.current) {
      if (inRect(x, y, armReach(armedRef.current))) return;
      setArm(null);
    }

    // Only the lists this card can land in.
    const from = [...registry.current.entries()].find(([, ids]) => ids.includes(dragged));
    const lists = [...registry.current.entries()].filter(
      ([listId]) => !from || !canDrop || canDrop(from[0], listId),
    );
    setDropLine(dropLineAt(lists, x, y));

    if (!onMerge) return;
    // Where the dragged card is drawn: under the pointer, at the offset it was
    // picked up by.
    const grab = held.current;
    const card = grab
      ? new DOMRect(x - grab.dx, y - grab.dy, grab.width, grab.height)
      : pointRect(x, y);
    const candidate = mergeCandidateAt(lists, dragged, card, canMerge);
    setCovered(candidate);
    if (!candidate) {
      clearDwell();
      return;
    }
    const holding =
      dwell.current &&
      dwell.current.id === candidate &&
      Math.abs(x - dwell.current.x) <= DWELL_DRIFT_PX &&
      Math.abs(y - dwell.current.y) <= DWELL_DRIFT_PX;
    if (holding) return;
    clearDwell();
    dwell.current = {
      id: candidate,
      x,
      y,
      timer: setTimeout(() => {
        const rect = rectOf(candidate);
        if (!rect) return;
        dwell.current = null;
        setArm({ id: candidate, rect, anchor: pointRect(x, y) });
      }, MERGE_DWELL_MS),
    };
  }

  function handleDragEnd({ active }: DragEndEvent) {
    const itemId = String(active.id);
    const armedOn = armedRef.current;
    const landing = lineRef.current;
    // The strip is up: a release on a pill runs it, a release on the card runs
    // Join text, and a release anywhere else is not a merge — the card lands
    // where the line stood.
    const mode = armedOn ? pickedMode(armedOn) : null;
    reset();
    if (onMerge && mode && armedOn && armedOn.id !== itemId) {
      onMerge(itemId, armedOn.id, mode);
      return;
    }
    if (!landing) return;
    const lists = [...registry.current.entries()];
    const from = lists.find(([, ids]) => ids.includes(itemId));
    if (!from) return;
    if (landing.listId === from[0] && landing.beforeId === itemId) return;
    onDrop(from[0], landing.listId, itemId, landing.beforeId);
  }

  // Which pill the release landed on. The pointer is the drag's, so the pill
  // takes no click of its own: its box decides.
  const pointer = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const track = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointermove", track);
    return () => window.removeEventListener("pointermove", track);
  }, []);
  function pickedMode(armedOn: { rect: DOMRect; anchor: DOMRect }): MergeMode | null {
    const { x, y } = pointer.current;
    for (const el of document.querySelectorAll<HTMLElement>("[data-merge-choice]")) {
      if (inRect(x, y, el.getBoundingClientRect())) {
        return el.dataset.mergeChoice === "ai" ? "ai" : "join";
      }
    }
    // Anywhere else the strip is still open: Join text. Past it the strip has
    // already closed, and the release is the drop the line shows.
    return inRect(x, y, armReach(armedOn)) ? "join" : null;
  }

  useEffect(() => () => clearDwell(), []);

  // The strip sits under the card it would merge into, or over it when the
  // card is near the bottom of the window.
  const strip =
    armed && mergeLabels && typeof document !== "undefined"
      ? createPortal(
          <div
            data-merge-strip
            style={{
              left: Math.round(armed.rect.left + armed.rect.width / 2),
              top:
                armed.rect.bottom + 52 > window.innerHeight
                  ? Math.round(armed.rect.top - 44)
                  : Math.round(armed.rect.bottom + 8),
            }}
            className="pointer-events-none fixed z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-card px-1.5 py-1.5 shadow-float"
          >
            <span
              data-merge-choice="ai"
              data-tip={mergeLabels.aiTitle}
              className="rounded-full bg-sage-600 px-3 py-1 text-xs font-semibold text-sage-fg"
            >
              {mergeLabels.ai}
            </span>
            <span
              data-merge-choice="join"
              data-tip={mergeLabels.joinTitle}
              className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-sand-700"
            >
              {mergeLabels.join}
            </span>
          </div>,
          document.body,
        )
      : null;

  return (
    <DndContext
      id={id}
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={reset}
    >
      <BoardContext.Provider value={registry}>
        {/* The card rings as soon as the dragged card covers it — the reader
            sees the hold is lined up and has only to keep still. */}
        <MergeTargetContext.Provider value={armed?.id ?? covered}>
          <DropLineContext.Provider value={armed ? null : line}>
            {children}
          </DropLineContext.Provider>
        </MergeTargetContext.Provider>
      </BoardContext.Provider>
      {strip}
      {overlay &&
        typeof document !== "undefined" &&
        createPortal(
          // No drop animation: the drop is optimistic, so the card is already
          // in its new place when the overlay goes. The overlay is drawn on
          // the body: inside the tray's scroll box it would be clipped.
          <DragOverlay dropAnimation={null}>
            {active ? (
              // Over a card it would merge into, the dragged card draws back
              // a little, so the ring on the card underneath shows around it.
              <div
                className={`card-drag-overlay${covered ? " card-drag-overlay-merging" : ""}`}
                style={active.width ? { width: active.width } : undefined}
              >
                {overlay(active.id)}
              </div>
            ) : null}
          </DragOverlay>,
          document.body,
        )}
    </DndContext>
  );
}

// One list inside a board. It holds no DndContext of its own — the board's
// drag runs through every group — and takes a drop on its own space, so a
// section holding no notes is still a target.
export function SortableGroup({
  id,
  ids,
  className,
  children,
}: {
  id: string;
  ids: string[];
  className?: string;
  children: React.ReactNode;
}) {
  const registry = useContext(BoardContext);
  registry?.current.set(id, ids);
  useEffect(() => () => void registry?.current.delete(id), [registry, id]);
  const { setNodeRef, isOver } = useDroppable({ id: dropId(id) });
  const line = useContext(DropLineContext);
  const empty = ids.length === 0;
  const endLine = line?.listId === id && line.beforeId === null && !empty;
  return (
    <SortableContext items={ids} strategy={holdStillStrategy}>
      <div
        ref={setNodeRef}
        data-drop-list={id}
        className={`relative ${className ?? ""}${
          empty
            ? ` min-h-9 rounded-2xl border-[1.5px] border-dashed ${
                isOver || line?.listId === id ? "border-clay bg-clay-100/60" : "border-transparent"
              }`
            : ""
        }`}
      >
        {children}
        {endLine && <span aria-hidden className="drop-line drop-line-end" />}
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
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id });
  const line = useContext(DropLineContext);
  return (
    <div
      ref={setNodeRef}
      data-sortable-id={id}
      className={`relative${isDragging ? " opacity-40" : ""}`}
    >
      {line?.beforeId === id && <span aria-hidden className="drop-line" />}
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

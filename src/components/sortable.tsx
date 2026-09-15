"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragPendingEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, type SortingStrategy } from "@dnd-kit/sortable";
import { getEventCoordinates } from "@dnd-kit/utilities";
import { HoldSensor } from "@/components/hold-sensor";

// One drag across many lists (SPEC.md §6). Every list is a SortableGroup
// inside a SortableBoard, and the board owns the one DndContext, so a drag
// that starts in one list ends in any of them.
//
// Hold to drag (lib/hold-drag.ts, hold-sensor.ts): a hold anywhere on a card
// picks it up — the card lifts and tilts under the pointer — and from then on
// it follows the pointer. Nothing in a list moves while a card is dragged.
// The card itself rides in a drag overlay under the pointer, its place in the
// list left dimmed, and a line shows where it would land. Cards that slide
// out from under the pointer are what made the old preview flicker between a
// reorder and a merge; a line over cards that hold still says the same thing
// and never moves the target.
//
// Merge is a hold, not a pass, and it reads the cards, not the pointer: once
// the dragged card covers more than MERGE_COVER of another card, a ring draws
// itself around that card over MERGE_DWELL_MS, and at the full ring the merge
// runs — the held card falls into the other one, which takes it in. Moving on
// before the ring closes puts the line back. A drag that passes over a card
// on its way somewhere else never merges anything. The floating card over the
// article is one more card a hold can merge into.
//
// The pointer is not the card. A card picked up near its edge hangs off to
// one side of the pointer, so a pointer that is on a card does not mean the
// dragged card is. What the reader sees is one card covering another, so that
// is what decides.
//
// A card let go off every list, over the article, leaves the list: the board
// reports the drop (onDropOutside) and the tray floats the note there.

/** How much of the smaller card the two have to share before a hold merges
    them. The smaller of the two: a one-line card dropped on a long one covers
    little of it and all of itself, and either way it is over that card. */
const MERGE_COVER = 0.8;
/** How long the ring takes to draw once the cards cover. At the full ring
    the merge runs. */
export const MERGE_DWELL_MS = 1000;
// The pointer may drift this far and still count as holding.
const DWELL_DRIFT_PX = 6;
// How long the held card takes to fall into the card it merges into
// (globals.css, .merge-fall). The card it lands on blooms at the same time.
const MERGE_FALL_MS = 420;

// Cards hold still: the strategy moves nothing while a drag runs.
const holdStillStrategy: SortingStrategy = () => null;

type SortableHook = ReturnType<typeof useSortable>;
export type HandleProps = {
  attributes: SortableHook["attributes"];
  listeners: SortableHook["listeners"];
};

/** The card the dragged card covers, or null. Cards read it to draw their ring. */
const MergeTargetContext = createContext<string | null>(null);
export function useMergeTarget() {
  return useContext(MergeTargetContext);
}

/** The card a hold is on, before it lifts: it presses down a little. */
const HeldContext = createContext<string | null>(null);

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

/** The floating card over the article (floating-note-editor.tsx), when one
    is open: its note's id and its box. A hold on it merges into it. */
function floatingCard(): { id: string; rect: DOMRect } | null {
  const el = document.querySelector<HTMLElement>("[data-floating-note]");
  const id = el?.dataset.floatingNote;
  if (!el || !id) return null;
  return { id, rect: el.getBoundingClientRect() };
}

function inRect(x: number, y: number, r: DOMRect | null): boolean {
  return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
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
    into. The one it covers most, so a card lying over two takes the nearer.
    The floating card over the article counts as one more card. */
function mergeCandidateAt(
  lists: [string, string[]][],
  activeId: string,
  card: DOMRect,
  canMerge?: (id: string, intoId: string) => boolean,
): { id: string; rect: DOMRect } | null {
  let best: { id: string; rect: DOMRect; cover: number } | null = null;
  const consider = (id: string, rect: DOMRect | null) => {
    if (!rect || id === activeId) return;
    if (canMerge && !canMerge(activeId, id)) return;
    const cover = coverage(card, rect);
    if (cover < MERGE_COVER) return;
    if (best && best.cover >= cover) return;
    best = { id, rect, cover };
  };
  for (const [, ids] of lists) for (const id of ids) consider(id, rectOf(id));
  const floating = floatingCard();
  if (floating) consider(floating.id, floating.rect);
  return best;
}

/** Whether a point is over an open document: a reader pane's box. */
function overReader(x: number, y: number): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-reader-root]")).some((pane) =>
    inRect(x, y, pane.getBoundingClientRect()),
  );
}

export function SortableBoard({
  id,
  onDrop,
  onDropOutside,
  onMerge,
  canMerge,
  canDrop,
  overlay,
  children,
}: {
  id: string;
  /** The card left `fromListId` and landed in `toListId`, before the card
      `beforeId` — null when it landed at the end of that list. The same list
      on both sides is a reorder. */
  onDrop: (fromListId: string, toListId: string, itemId: string, beforeId: string | null) => void;
  /** The card was let go off every list, over the article: where the pointer
      was, and where the pointer sat inside the card, so the card can land
      where it was seen. */
  onDropOutside?: (itemId: string, at: { x: number; y: number; grab: { dx: number; dy: number } }) => void;
  /** The ring closed on another card: the two merge. */
  onMerge?: (id: string, intoId: string) => void;
  canMerge?: (id: string, intoId: string) => boolean;
  /** Whether a card of `fromListId` can land in `toListId`. Without it every
      list takes every card. A page holding lists of two kinds — a section's
      notes and a section's children — says here which take which, so a drag
      never draws a line where the drop would do nothing. */
  canDrop?: (fromListId: string, toListId: string) => boolean;
  /** The card the overlay carries under the pointer while it is dragged. */
  overlay?: (itemId: string) => React.ReactNode;
  children: React.ReactNode;
}) {
  const sensors = useSensors(useSensor(HoldSensor));
  // The card being dragged, and the size it had in its list: the overlay is
  // drawn in a portal on the body, out of the tray's scroll box, so it carries
  // its own size, and the merge reads where it is drawn.
  const [active, setActive] = useState<{ id: string; width: number } | null>(null);
  // The card a hold is on, before it lifts.
  const [held, setHeld] = useState<string | null>(null);
  const [line, setLine] = useState<DropLine | null>(null);
  // The card the dragged card covers: the ring draws around it, and at the
  // full ring the merge runs. rect is the card's box, for the ring.
  const [covered, setCovered] = useState<{ id: string; rect: DOMRect } | null>(null);
  // The held card falling into the card it merges into: where it starts and
  // where it lands. It clears itself when the fall is done.
  const [fall, setFall] = useState<{ from: DOMRect; to: DOMRect } | null>(null);
  const registry = useRef<Registry>(new Map());
  // The live values the release reads: state lands a render too late for it.
  const lineRef = useRef<DropLine | null>(null);
  // The merge already ran on the hold, so the release is not a drop.
  const mergedRef = useRef(false);
  // Where the pointer sits inside the dragged card, and the card's size: the
  // card is drawn under the pointer at this offset, so this is where it is.
  const grabbed = useRef<{ dx: number; dy: number; width: number; height: number } | null>(null);
  const dwell = useRef<{ id: string; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(
    null,
  );
  const fallTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearDwell() {
    if (dwell.current) clearTimeout(dwell.current.timer);
    dwell.current = null;
  }

  function setDropLine(next: DropLine | null) {
    lineRef.current = next;
    setLine((prev) =>
      prev?.listId === next?.listId && prev?.beforeId === next?.beforeId ? prev : next,
    );
  }

  function reset() {
    clearDwell();
    setCovered(null);
    setDropLine(null);
    setActive(null);
    setHeld(null);
    grabbed.current = null;
  }

  /** The ring closed: the merge runs, and the held card falls into the card it
      merges into. The drag is over — the release that follows is not a drop.

      The fall lands on where the card ends up, not where it was: the merge
      takes the held note out of the list at once, so the card it merges into
      moves up a row. The landing is measured after that move has painted. */
  function runMerge(itemId: string, intoId: string, card: DOMRect) {
    mergedRef.current = true;
    clearDwell();
    setCovered(null);
    setDropLine(null);
    setActive(null);
    onMerge?.(itemId, intoId);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const target = rectOf(intoId) ?? (floatingCard()?.id === intoId ? floatingCard()!.rect : null);
        if (!target) return;
        setFall({ from: card, to: target });
        if (fallTimer.current) clearTimeout(fallTimer.current);
        fallTimer.current = setTimeout(() => setFall(null), MERGE_FALL_MS);
      }),
    );
  }

  function handleDragPending({ id: pendingId }: DragPendingEvent) {
    setHeld((prev) => (prev === String(pendingId) ? prev : String(pendingId)));
  }

  function handleDragAbort() {
    setHeld(null);
  }

  function handleDragStart({ active: dragged, activatorEvent }: DragStartEvent) {
    const id = String(dragged.id);
    const rect = rectOf(id);
    const start = getEventCoordinates(activatorEvent);
    setHeld(null);
    setActive({ id, width: Math.round(rect?.width ?? 0) });
    grabbed.current =
      rect && start
        ? { dx: start.x - rect.left, dy: start.y - rect.top, width: rect.width, height: rect.height }
        : null;
  }

  function pointerAt(activatorEvent: Event | null, delta: { x: number; y: number }) {
    const start = activatorEvent ? getEventCoordinates(activatorEvent) : null;
    return start ? { x: start.x + delta.x, y: start.y + delta.y } : null;
  }

  function handleDragMove({ active, activatorEvent, delta }: DragMoveEvent) {
    const at = pointerAt(activatorEvent, delta);
    if (!at) return;
    const { x, y } = at;
    const dragged = String(active.id);

    // The merge already ran on the hold: the drag has nothing left to do.
    if (mergedRef.current) return;

    // Only the lists this card can land in.
    const from = [...registry.current.entries()].find(([, ids]) => ids.includes(dragged));
    const lists = [...registry.current.entries()].filter(
      ([listId]) => !from || !canDrop || canDrop(from[0], listId),
    );
    setDropLine(dropLineAt(lists, x, y));

    if (!onMerge) return;
    // Where the dragged card is drawn: under the pointer, at the offset it was
    // picked up by.
    const grab = grabbed.current;
    const card = grab
      ? new DOMRect(x - grab.dx, y - grab.dy, grab.width, grab.height)
      : pointRect(x, y);
    const candidate = mergeCandidateAt(lists, dragged, card, canMerge);
    if (!candidate) {
      setCovered(null);
      clearDwell();
      return;
    }
    // The ring is one drawing, from the first frame of the cover to the last.
    // A hold that stays on the same card keeps the ring it started.
    const holding =
      dwell.current &&
      dwell.current.id === candidate.id &&
      Math.abs(x - dwell.current.x) <= DWELL_DRIFT_PX &&
      Math.abs(y - dwell.current.y) <= DWELL_DRIFT_PX;
    if (holding) return;
    clearDwell();
    setCovered(candidate);
    dwell.current = {
      id: candidate.id,
      x,
      y,
      timer: setTimeout(() => {
        dwell.current = null;
        runMerge(dragged, candidate.id, card);
      }, MERGE_DWELL_MS),
    };
  }

  function handleDragEnd({ active, activatorEvent, delta }: DragEndEvent) {
    const itemId = String(active.id);
    const landing = lineRef.current;
    const merged = mergedRef.current;
    const grab = grabbed.current;
    const at = pointerAt(activatorEvent, delta);
    mergedRef.current = false;
    reset();
    // The ring closed and the merge already ran: the card is gone from the
    // list, and this release is only the hand letting go.
    if (merged) return;
    const lists = [...registry.current.entries()];
    const from = lists.find(([, ids]) => ids.includes(itemId));
    if (!from) return;
    if (!landing) {
      // Off every list, over the article: the note leaves the list.
      if (onDropOutside && at && overReader(at.x, at.y)) {
        onDropOutside(itemId, { x: at.x, y: at.y, grab: grab ? { dx: grab.dx, dy: grab.dy } : { dx: 0, dy: 0 } });
      }
      return;
    }
    if (landing.listId === from[0] && landing.beforeId === itemId) return;
    onDrop(from[0], landing.listId, itemId, landing.beforeId);
  }

  useEffect(() => {
    return () => {
      clearDwell();
      if (fallTimer.current) clearTimeout(fallTimer.current);
    };
  }, []);

  // The hold ring: it draws itself around the covered card over the hold, and
  // at the full ring the merge runs. Keyed by the card, so moving to another
  // card starts a new ring rather than carrying on with the old one's.
  const ring =
    covered && typeof document !== "undefined"
      ? createPortal(
          <svg
            key={covered.id}
            className="merge-ring"
            style={
              {
                left: Math.round(covered.rect.left) - 3,
                top: Math.round(covered.rect.top) - 3,
                width: Math.round(covered.rect.width) + 6,
                height: Math.round(covered.rect.height) + 6,
                "--merge-dwell": `${MERGE_DWELL_MS}ms`,
              } as React.CSSProperties
            }
            aria-hidden
          >
            <rect
              x="1.5"
              y="1.5"
              width={Math.round(covered.rect.width) + 3}
              height={Math.round(covered.rect.height) + 3}
              rx="17"
              pathLength={1}
            />
          </svg>,
          document.body,
        )
      : null;

  // The fall: the held card drops into the card it merges into.
  const falling =
    fall && typeof document !== "undefined"
      ? createPortal(
          <div
            className="merge-fall"
            style={
              {
                left: Math.round(fall.from.left),
                top: Math.round(fall.from.top),
                width: Math.round(fall.from.width),
                height: Math.round(fall.from.height),
                "--merge-dx": `${Math.round(
                  fall.to.left + fall.to.width / 2 - (fall.from.left + fall.from.width / 2),
                )}px`,
                "--merge-dy": `${Math.round(
                  fall.to.top + fall.to.height / 2 - (fall.from.top + fall.from.height / 2),
                )}px`,
                "--merge-scale": (fall.to.height / Math.max(1, fall.from.height)).toFixed(3),
              } as React.CSSProperties
            }
            aria-hidden
          />,
          document.body,
        )
      : null;

  return (
    <DndContext
      id={id}
      sensors={sensors}
      onDragPending={handleDragPending}
      onDragAbort={handleDragAbort}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={reset}
    >
      <BoardContext.Provider value={registry}>
        {/* The card rings as soon as the dragged card covers it — the reader
            sees the hold is lined up and has only to keep still. */}
        <MergeTargetContext.Provider value={covered?.id ?? null}>
          <HeldContext.Provider value={held}>
            <DropLineContext.Provider value={covered ? null : line}>
              {children}
            </DropLineContext.Provider>
          </HeldContext.Provider>
        </MergeTargetContext.Provider>
      </BoardContext.Provider>
      {ring}
      {falling}
      {overlay &&
        typeof document !== "undefined" &&
        createPortal(
          // No drop animation: the drop is optimistic, so the card is already
          // in its new place when the overlay goes. The overlay is drawn on
          // the body: inside the tray's scroll box it would be clipped.
          <DragOverlay dropAnimation={null}>
            {active && !fall ? (
              // The lifted card: it tilts as it is picked up (globals.css,
              // .card-drag-overlay). Over a card it would merge into it draws
              // back a little, so the ring on the card underneath shows.
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
  const held = useContext(HeldContext) === id;
  return (
    <div
      ref={setNodeRef}
      data-sortable-id={id}
      className={`relative${isDragging ? " opacity-40" : ""}${held ? " card-held" : ""}`}
    >
      {line?.beforeId === id && <span aria-hidden className="drop-line" />}
      {children({ attributes, listeners })}
    </div>
  );
}

/** The grip a section is dragged by (a note is dragged by a hold anywhere on it). */
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

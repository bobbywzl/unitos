"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { PencilIcon, UndoIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { NEW_GLOW_CLASS, NewPill, useNewFeature } from "@/components/new-feature";
import { PENCIL_TAP_EVENT } from "@/lib/app-shell";
import type { TKey } from "@/lib/i18n/dictionaries";
import { JOT_SERVER_STATE, readJot, subscribeJot, writeJot, type JotState } from "@/lib/jot-tool";
import {
  JOT_COLORS,
  JOT_COLOR_CSS,
  JOT_WIDTHS_PX,
  jottingBounds,
  jottingHit,
  jottingPathD,
  jottingShift,
  newJottingId,
  tidyPoints,
  type JotBounds,
  type JotColor,
  type JotPoint,
  type StoredJotting,
} from "@/lib/jottings";
import { flushJottings, flushJottingsNow, queueJotOps, queuedJotOps, type JotOp } from "@/lib/jottings-queue";

// The jotting layer (SPEC.md §33): handwriting drawn with a pen across the
// reader pane. With Jot on, a pen draws and a finger still scrolls and
// selects; a mouse does what it always did. A stroke is keyed to the block it
// starts on (or the nearest one, for a stroke in the margin), so it scrolls
// and moves with its words. The layer is one SVG laid over the pane's
// content, which takes no pointer: the pen is read on the pane itself, before
// the reader's own handlers, so a stroke never selects words, never opens
// the toolbar, and never starts the circle gesture.

type Shown = StoredJotting & { d: string; bounds: JotBounds };

type Slot = { x: number; y: number; s: number; aspect: number };

type Undo = { kind: "add"; id: string } | { kind: "erase"; strokes: Shown[] };

const BLOCK_SELECTOR = "[data-block-id], [data-edit-block]";

// Where a pen never draws: the controls and the cards over the article. A
// press there does what it does for a mouse.
const CONTROL =
  "button, input, textarea, select, summary, video, audio, [role=dialog], [role=menu], [data-jot-bar], " +
  "[data-selection-popover], [data-side-card], [data-log-card], [data-annotation-card], [data-floating-note], " +
  "[data-edit-toolbar], [data-layer-toolbar], [data-no-jot]";

// What a pen's tap presses: a tap here is passed on as a click and draws no
// dot; a stroke that starts here and moves is drawn like any other.
const TAPPABLE = "a[href], mark, [data-source-id], [data-anchor-skip], [role=button], label";

const TAP_MOVE_PX = 4;
const TAP_MS = 350;
const ERASER_REACH_PX = 9;
// A stroke that starts this soon after the last one, this near it, is part of
// the same word: it keeps the last stroke's block, so a word written across
// two paragraphs' edge stays in one piece when the text wraps again.
const GROUP_MS = 1500;
const GROUP_PX = 70;
const UNDO_MAX = 200;

const COLOR_KEY: Record<JotColor, TKey> = {
  ink: "reader.jotColorInk",
  clay: "reader.colorClay",
  sage: "reader.colorSage",
  gold: "reader.colorGold",
  plum: "reader.colorPlum",
};

function slotKey(blockId: string, layer: "core" | null): string {
  return layer ? `core:${blockId}` : blockId;
}

function shownOf(jotting: StoredJotting): Shown {
  return { ...jotting, d: jottingPathD(jotting.points, jotting.width), bounds: jottingBounds(jotting.points) };
}

function drawn(el: Element): boolean {
  return el.getClientRects().length > 0;
}

/** The element a stroke's block draws as now; null while it is not drawn. */
function blockElement(container: HTMLElement, stroke: { blockId: string; blockOrder: number; layer: "core" | null }) {
  const id = CSS.escape(stroke.blockId);
  const el = container.querySelector<HTMLElement>(
    stroke.layer === "core"
      ? `[data-collapsed][data-block-id="${id}"]`
      : `[data-block-id="${id}"]:not([data-collapsed]), [data-edit-block="${id}"]`,
  );
  if (el) return drawn(el) ? el : null;
  // The block is gone (the document was parsed again): the stroke takes the
  // block now at the same place in the order, so it is never left undrawn.
  const all = container.querySelectorAll<HTMLElement>(BLOCK_SELECTOR);
  if (all.length === 0) return null;
  const at = all[Math.min(stroke.blockOrder, all.length - 1)];
  return drawn(at) ? at : null;
}

function slotOf(container: HTMLElement, el: HTMLElement): Slot {
  const pane = container.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  const s = Math.max(rect.width, 1) / 100;
  return {
    x: rect.left - pane.left + container.scrollLeft - container.clientLeft,
    y: rect.top - pane.top + container.scrollTop - container.clientTop,
    s,
    aspect: rect.height / s,
  };
}

function sameSlot(a: Slot | undefined, b: Slot): boolean {
  return (
    a !== undefined &&
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.s - b.s) < 0.005 &&
    Math.abs(a.aspect - b.aspect) < 0.5
  );
}

/** The block a stroke that starts at (x, y) is keyed to: the block under the
    pen, else the block nearest in height (a stroke in the margin, between two
    paragraphs, or past the last one). */
function blockAt(container: HTMLElement, target: Element | null, y: number) {
  const all = Array.from(container.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)).filter(
    (el) => el.closest("[data-reader-root]") === container,
  );
  if (all.length === 0) return null;
  let el = target?.closest<HTMLElement>(BLOCK_SELECTOR) ?? null;
  if (el && (el.closest("[data-reader-root]") !== container || !drawn(el))) el = null;
  if (!el) {
    let best = Infinity;
    for (const candidate of all) {
      if (!drawn(candidate)) continue;
      const rect = candidate.getBoundingClientRect();
      const distance = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
      // On a tie the later block wins: a block inside another (a cell, a
      // figure's caption) is the nearer one.
      if (distance <= best) {
        best = distance;
        el = candidate;
      }
    }
  }
  if (!el) return null;
  const blockId = el.dataset.blockId ?? el.dataset.editBlock;
  if (!blockId) return null;
  return {
    el,
    blockId,
    blockOrder: Math.max(0, all.indexOf(el)),
    layer: el.hasAttribute("data-collapsed") ? ("core" as const) : null,
  };
}

/** A pen's tap on a link or a mark, passed on as the click it stands for. */
function replayTap(target: Element, x: number, y: number): void {
  const init: MouseEventInit = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0, detail: 1 };
  target.dispatchEvent(new MouseEvent("mousedown", { ...init, buttons: 1 }));
  target.dispatchEvent(new MouseEvent("mouseup", init));
  target.dispatchEvent(new MouseEvent("click", init));
}

type StylusTouch = Touch & { touchType?: string };

function EraserIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 20H9.5L4 14.5a2 2 0 0 1 0-2.8L12.7 3a2 2 0 0 1 2.8 0l5.5 5.5a2 2 0 0 1 0 2.8L12.5 20" />
      <path d="M8.5 8.5 16 16" />
    </svg>
  );
}

export function JottingLayer({
  container,
  documentId,
  notebookId,
  canEdit,
  myId,
  hidden,
}: {
  container: RefObject<HTMLDivElement | null>;
  documentId: string;
  notebookId: string;
  canEdit: boolean;
  /** The account's id: a reader erases their own jottings only. */
  myId: string;
  /** Another page covers the article (Extract, a conversation): draw nothing. */
  hidden: boolean;
}) {
  const t = useT();
  const jot = useSyncExternalStore<JotState>(subscribeJot, readJot, () => JOT_SERVER_STATE);
  const jotNew = useNewFeature("jot");

  const [strokes, setStrokes] = useState<ReadonlyMap<string, Shown>>(new Map());
  const [slots, setSlots] = useState<ReadonlyMap<string, Slot>>(new Map());
  // What the pen's handlers read: the newest state, without a new set of
  // listeners on every stroke.
  const jotRef = useRef(jot);
  const strokesRef = useRef(strokes);
  const slotsRef = useRef(slots);
  useLayoutEffect(() => {
    jotRef.current = jot;
    strokesRef.current = strokes;
    slotsRef.current = slots;
  });
  const [undo, setUndo] = useState<Undo[]>([]);
  const liveRef = useRef<SVGPathElement>(null);
  const place = useMemo(() => ({ notebookId, documentId }), [notebookId, documentId]);
  const active = canEdit && jot.on && !hidden;

  // The stored jottings, then what the queue still holds for this document:
  // a stroke drawn before a reload that the server has not yet confirmed is
  // drawn again from the queue.
  // The layer is mounted once per document (its key), so it starts empty.
  useEffect(() => {
    let gone = false;
    const load = async () => {
      if (canEdit) await flushJottings(place);
      let stored: StoredJotting[] = [];
      try {
        const res = await fetch(`/api/documents/${documentId}/jottings?notebookId=${encodeURIComponent(notebookId)}`);
        if (res.ok) stored = ((await res.json()) as { jottings: StoredJotting[] }).jottings;
      } catch {
        // No network: the queue's strokes still draw.
      }
      if (gone) return;
      const next = new Map<string, Shown>();
      for (const jotting of stored) next.set(jotting.id, shownOf(jotting));
      for (const op of queuedJotOps(place)) {
        if (op.op === "add") next.set(op.jotting.id, shownOf({ ...op.jotting, userId: myId }));
        else if (op.op === "erase") next.delete(op.id);
      }
      // Strokes drawn while the load ran stay.
      setStrokes((drawnNow) => {
        for (const [id, stroke] of drawnNow) next.set(id, stroke);
        return next;
      });
    };
    void load();
    return () => {
      gone = true;
    };
  }, [canEdit, documentId, myId, notebookId, place]);

  // The page is hidden or closed: what waits to be saved is sent now.
  useEffect(() => {
    if (!canEdit) return;
    const save = () => flushJottingsNow(place);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") save();
    };
    window.addEventListener("pagehide", save);
    window.addEventListener("online", save);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", save);
      window.removeEventListener("online", save);
      document.removeEventListener("visibilitychange", onVisibility);
      save();
    };
  }, [canEdit, place]);

  // Where each block that carries a stroke stands now. Measured again when
  // the pane or the article changes size, when the window does, and on a
  // scroll (a picture that loads late moves the blocks under it).
  useEffect(() => {
    const pane = container.current;
    if (!pane || hidden) return;
    const measure = () => {
      const next = new Map<string, Slot>();
      let changed = false;
      for (const stroke of strokesRef.current.values()) {
        const key = slotKey(stroke.blockId, stroke.layer);
        if (next.has(key)) continue;
        const el = blockElement(pane, stroke);
        if (!el) continue;
        const slot = slotOf(pane, el);
        const before = slotsRef.current.get(key);
        if (sameSlot(before, slot)) next.set(key, before!);
        else {
          next.set(key, slot);
          changed = true;
        }
      }
      if (changed || next.size !== slotsRef.current.size) setSlots(next);
    };
    let frame = 0;
    const soon = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    soon();
    const observer = new ResizeObserver(soon);
    observer.observe(pane);
    for (const child of Array.from(pane.children)) observer.observe(child);
    for (const article of Array.from(pane.querySelectorAll("article"))) observer.observe(article);
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (scrollTimer) return;
      scrollTimer = setTimeout(() => {
        scrollTimer = null;
        soon();
      }, 200);
    };
    pane.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", soon);
    // The cards beside the article and the collapsed view move blocks without
    // changing the article's size: a slow look catches those.
    const slow = setInterval(soon, 1500);
    return () => {
      observer.disconnect();
      pane.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", soon);
      clearInterval(slow);
      if (scrollTimer) clearTimeout(scrollTimer);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [container, hidden, strokes]);

  const pushUndo = useCallback((entry: Undo) => {
    setUndo((list) => [...list.slice(-(UNDO_MAX - 1)), entry]);
  }, []);

  const eraseStrokes = useCallback(
    (gone: Shown[], record: boolean) => {
      if (gone.length === 0) return;
      setStrokes((before) => {
        const next = new Map(before);
        for (const stroke of gone) next.delete(stroke.id);
        return next;
      });
      queueJotOps(place, gone.map((stroke): JotOp => ({ op: "erase", id: stroke.id })));
      if (record) pushUndo({ kind: "erase", strokes: gone });
    },
    [place, pushUndo],
  );

  const undoLast = useCallback(() => {
    const last = undo[undo.length - 1];
    if (!last) return;
    setUndo((list) => list.slice(0, -1));
    if (last.kind === "add") {
      const stroke = strokesRef.current.get(last.id);
      if (stroke) eraseStrokes([stroke], false);
      return;
    }
    setStrokes((before) => {
      const next = new Map(before);
      for (const stroke of last.strokes) next.set(stroke.id, stroke);
      return next;
    });
    queueJotOps(place, last.strokes.map((stroke): JotOp => ({ op: "restore", id: stroke.id })));
  }, [eraseStrokes, place, undo]);

  // The Apple Pencil's double tap (the app passes it on): pen, eraser, pen.
  useEffect(() => {
    if (!active) return;
    const onTap = () => writeJot({ tool: jotRef.current.tool === "pen" ? "eraser" : "pen" });
    window.addEventListener(PENCIL_TAP_EVENT, onTap);
    return () => window.removeEventListener(PENCIL_TAP_EVENT, onTap);
  }, [active]);

  // The pen. Listeners sit on the pane in the capture phase and stop the
  // event there, so the reader's own pointer handlers never see a stroke.
  useEffect(() => {
    const pane = container.current;
    if (!pane || !canEdit || hidden) return;

    type Drawing = {
      pointerId: number;
      erasing: boolean;
      target: Element;
      startX: number;
      startY: number;
      startAt: number;
      moved: boolean;
      block: NonNullable<ReturnType<typeof blockAt>>;
      rect: DOMRect;
      slot: Slot;
      points: JotPoint[];
      width: number;
      color: JotColor;
      erased: Shown[];
      frame: number;
    };
    let drawing: Drawing | null = null;
    let last: { at: number; block: Drawing["block"]; box: { left: number; top: number; right: number; bottom: number } } | null = null;

    const draws = (target: EventTarget | null): target is Element => {
      if (!jotRef.current.on || !(target instanceof Element)) return false;
      if (target.closest("[data-reader-root]") !== pane) return false;
      return !target.closest(CONTROL);
    };

    const unit = (d: Drawing, e: { clientX: number; clientY: number; pressure?: number; pointerType?: string }): JotPoint => {
      // A pen that reports no pressure (some report 0 or 0.5 for every point) draws an even line.
      const pressure = e.pressure && e.pressure > 0 ? e.pressure : 0.5;
      return [(e.clientX - d.rect.left) / d.slot.s, (e.clientY - d.rect.top) / d.slot.s, Math.min(1, pressure)];
    };

    const paintLive = (d: Drawing) => {
      if (d.frame) return;
      d.frame = requestAnimationFrame(() => {
        d.frame = 0;
        const path = liveRef.current;
        if (!path || drawing !== d) return;
        path.setAttribute("d", jottingPathD(d.points, d.width));
        path.setAttribute("transform", `translate(${d.slot.x} ${d.slot.y}) scale(${d.slot.s})`);
        path.setAttribute("fill", JOT_COLOR_CSS[d.color]);
      });
    };

    const clearLive = () => liveRef.current?.setAttribute("d", "");

    const eraseAt = (d: Drawing, clientX: number, clientY: number) => {
      const paneRect = pane.getBoundingClientRect();
      const x = clientX - paneRect.left + pane.scrollLeft - pane.clientLeft;
      const y = clientY - paneRect.top + pane.scrollTop - pane.clientTop;
      const hit: Shown[] = [];
      for (const stroke of strokesRef.current.values()) {
        if (stroke.userId !== myId || d.erased.includes(stroke)) continue;
        const slot = slotsRef.current.get(slotKey(stroke.blockId, stroke.layer));
        if (!slot) continue;
        const shift = jottingShift(stroke.bounds, stroke.aspect, slot.aspect);
        const ux = (x - slot.x) / slot.s;
        const uy = (y - slot.y) / slot.s - shift;
        const reach = ERASER_REACH_PX / slot.s + stroke.width / 2;
        const b = stroke.bounds;
        if (ux < b.minX - reach || ux > b.maxX + reach || uy < b.minY - reach || uy > b.maxY + reach) continue;
        if (jottingHit(stroke.points, ux, uy, reach)) hit.push(stroke);
      }
      if (hit.length === 0) return;
      d.erased.push(...hit);
      eraseStrokes(hit, false);
    };

    const stop = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "pen") return;
      // The first pen this browser sees: the Jot button shows from now on.
      if (!jotRef.current.penSeen) writeJot({ penSeen: true });
      if (drawing || !draws(e.target)) return;
      // The pen's eraser end (button 5) erases whatever the tool is.
      const erasing = jotRef.current.tool === "eraser" || e.button === 5 || (e.buttons & 32) !== 0;
      if (e.button !== 0 && !erasing) return;
      let block = blockAt(pane, e.target, e.clientY);
      if (!block) return;
      if (
        last &&
        e.timeStamp - last.at < GROUP_MS &&
        drawn(last.block.el) &&
        e.clientX > last.box.left - GROUP_PX &&
        e.clientX < last.box.right + GROUP_PX &&
        e.clientY > last.box.top - GROUP_PX &&
        e.clientY < last.box.bottom + GROUP_PX
      ) {
        block = last.block;
      }
      stop(e);
      const rect = block.el.getBoundingClientRect();
      const slot = slotOf(pane, block.el);
      const state = jotRef.current;
      const d: Drawing = {
        pointerId: e.pointerId,
        erasing,
        target: e.target,
        startX: e.clientX,
        startY: e.clientY,
        startAt: e.timeStamp,
        moved: false,
        block,
        rect,
        slot,
        points: [],
        width: JOT_WIDTHS_PX[state.width] / slot.s,
        color: state.color,
        erased: [],
        frame: 0,
      };
      drawing = d;
      try {
        pane.setPointerCapture(e.pointerId);
      } catch {
        // The pointer is already gone: the stroke ends on the next event.
      }
      window.getSelection()?.removeAllRanges();
      if (erasing) eraseAt(d, e.clientX, e.clientY);
      else {
        d.points.push(unit(d, e));
        paintLive(d);
      }
    };

    const onMove = (e: PointerEvent) => {
      const d = drawing;
      if (!d || e.pointerId !== d.pointerId) return;
      stop(e);
      if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > TAP_MOVE_PX) d.moved = true;
      const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      for (const point of events.length > 0 ? events : [e]) {
        if (d.erasing) eraseAt(d, point.clientX, point.clientY);
        else d.points.push(unit(d, point));
      }
      if (!d.erasing) paintLive(d);
    };

    const finish = (e: PointerEvent, cancelled: boolean) => {
      const d = drawing;
      if (!d || e.pointerId !== d.pointerId) return;
      stop(e);
      drawing = null;
      if (d.frame) cancelAnimationFrame(d.frame);
      if (pane.hasPointerCapture(e.pointerId)) pane.releasePointerCapture(e.pointerId);
      clearLive();
      if (d.erasing) {
        if (d.erased.length > 0) pushUndo({ kind: "erase", strokes: d.erased });
        return;
      }
      // A tap on a link or a mark presses it; it draws no dot. A stroke the
      // system cancelled before it moved (a palm, a gesture) draws nothing.
      const tap = !d.moved && e.timeStamp - d.startAt < TAP_MS;
      if (tap && d.target.closest(TAPPABLE)) {
        replayTap(d.target, d.startX, d.startY);
        return;
      }
      if (cancelled && !d.moved) return;
      const points = tidyPoints(d.points);
      if (points.length === 0) return;
      const stroke = shownOf({
        id: newJottingId(),
        userId: myId,
        blockId: d.block.blockId,
        blockOrder: d.block.blockOrder,
        layer: d.block.layer,
        color: d.color,
        width: Math.round(d.width * 1000) / 1000,
        aspect: Math.round(d.slot.aspect * 100) / 100,
        points,
      });
      const { userId: _mine, d: _path, bounds, ...jotting } = stroke;
      void _mine;
      void _path;
      queueJotOps(place, [{ op: "add", jotting }]);
      setSlots((before) => {
        const key = slotKey(stroke.blockId, stroke.layer);
        if (before.has(key)) return before;
        const next = new Map(before);
        next.set(key, d.slot);
        return next;
      });
      setStrokes((before) => new Map(before).set(stroke.id, stroke));
      pushUndo({ kind: "add", id: stroke.id });
      last = {
        at: e.timeStamp,
        block: d.block,
        box: {
          left: d.rect.left + bounds.minX * d.slot.s,
          top: d.rect.top + bounds.minY * d.slot.s,
          right: d.rect.left + bounds.maxX * d.slot.s,
          bottom: d.rect.top + bounds.maxY * d.slot.s,
        },
      };
    };

    const onUp = (e: PointerEvent) => finish(e, false);
    const onCancel = (e: PointerEvent) => finish(e, true);

    // Safari gives a pen's touch a type. Refusing its touchstart keeps the
    // page from scrolling or selecting under the pen, and refusing its
    // touchmove keeps Scribble from turning the stroke into typed words in
    // the page editor. A finger's touch passes untouched.
    const onTouch = (e: TouchEvent) => {
      const touch = e.changedTouches[0] as StylusTouch | undefined;
      if (touch?.touchType !== "stylus") return;
      if (drawing || draws(e.target)) e.preventDefault();
    };

    pane.addEventListener("pointerdown", onDown, true);
    pane.addEventListener("pointermove", onMove, true);
    pane.addEventListener("pointerup", onUp, true);
    pane.addEventListener("pointercancel", onCancel, true);
    pane.addEventListener("touchstart", onTouch, { capture: true, passive: false });
    pane.addEventListener("touchmove", onTouch, { capture: true, passive: false });
    return () => {
      pane.removeEventListener("pointerdown", onDown, true);
      pane.removeEventListener("pointermove", onMove, true);
      pane.removeEventListener("pointerup", onUp, true);
      pane.removeEventListener("pointercancel", onCancel, true);
      pane.removeEventListener("touchstart", onTouch, true);
      pane.removeEventListener("touchmove", onTouch, true);
      clearLive();
    };
  }, [canEdit, container, eraseStrokes, hidden, myId, place, pushUndo]);

  if (hidden) return null;

  const paths: React.ReactNode[] = [];
  for (const stroke of strokes.values()) {
    const slot = slots.get(slotKey(stroke.blockId, stroke.layer));
    if (!slot) continue;
    const shift = jottingShift(stroke.bounds, stroke.aspect, slot.aspect);
    paths.push(
      <path
        key={stroke.id}
        data-jotting-id={stroke.id}
        d={stroke.d}
        fill={JOT_COLOR_CSS[stroke.color]}
        transform={`translate(${slot.x} ${slot.y + shift * slot.s}) scale(${slot.s})`}
      />,
    );
  }

  const showBar = canEdit && (jot.on || jot.penSeen);
  const toolButton = (on: boolean) =>
    `flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${on ? "bg-clay text-white" : "text-sand-700 hover:bg-sand-100"}`;

  return (
    <>
      {/* The jottings: one SVG at the pane's top left corner, with no size of
          its own, so it adds nothing to what the pane scrolls. It sits over
          the words and under the pane's sticky rows and its cards. */}
      <svg
        data-jottings
        aria-hidden
        width="1"
        height="1"
        className="pointer-events-none absolute top-0 left-0 z-[8] overflow-visible"
      >
        {paths}
        <path ref={liveRef} data-jotting-live />
      </svg>

      {showBar && (
        <div className="pointer-events-none sticky bottom-0 z-30 h-0 print:hidden">
          <div
            data-jot-bar
            data-track-surface="jot"
            className="pointer-events-auto absolute bottom-4 left-1/2 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-1 rounded-full bg-card p-1 shadow-float"
            style={{ touchAction: "manipulation" }}
          >
            {!jot.on ? (
              <button
                type="button"
                data-track="jot:on"
                data-tip={t("reader.jotOnHint")}
                aria-label={t("reader.jot")}
                onClick={() => {
                  jotNew.seen();
                  writeJot({ on: true, tool: "pen" });
                }}
                className={`flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-sand-700 hover:bg-sand-100${
                  jotNew.isNew ? ` ${NEW_GLOW_CLASS}` : ""
                }`}
              >
                <PencilIcon size={15} />
                {t("reader.jot")}
                {jotNew.isNew && <NewPill />}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  data-track="jot:pen"
                  data-tip={t("reader.jotPen")}
                  aria-label={t("reader.jotPen")}
                  aria-pressed={jot.tool === "pen"}
                  onClick={() => writeJot({ tool: "pen" })}
                  className={toolButton(jot.tool === "pen")}
                >
                  <PencilIcon size={16} />
                </button>
                <button
                  type="button"
                  data-track="jot:eraser"
                  data-tip={t("reader.jotEraser")}
                  aria-label={t("reader.jotEraser")}
                  aria-pressed={jot.tool === "eraser"}
                  onClick={() => writeJot({ tool: "eraser" })}
                  className={toolButton(jot.tool === "eraser")}
                >
                  <EraserIcon />
                </button>
                <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-line" />
                {JOT_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    data-track={`jot:color:${color}`}
                    data-tip={t(COLOR_KEY[color])}
                    aria-label={t(COLOR_KEY[color])}
                    aria-pressed={jot.color === color}
                    onClick={() => writeJot({ color, tool: "pen" })}
                    className="flex h-9 w-7 shrink-0 items-center justify-center"
                  >
                    <span
                      className={`block h-5 w-5 rounded-full ${jot.color === color ? "ring-2 ring-clay ring-offset-2 ring-offset-card" : ""}`}
                      style={{ background: JOT_COLOR_CSS[color] }}
                    />
                  </button>
                ))}
                <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-line" />
                <button
                  type="button"
                  data-track="jot:width"
                  data-tip={t(jot.width === 0 ? "reader.jotWidthFine" : "reader.jotWidthBold")}
                  aria-label={t(jot.width === 0 ? "reader.jotWidthFine" : "reader.jotWidthBold")}
                  onClick={() => writeJot({ width: jot.width === 0 ? 1 : 0, tool: "pen" })}
                  className={toolButton(false)}
                >
                  <span className="block rounded-full bg-current" style={{ width: 16, height: JOT_WIDTHS_PX[jot.width] }} />
                </button>
                <button
                  type="button"
                  data-track="jot:undo"
                  data-tip={t("reader.jotUndo")}
                  aria-label={t("reader.jotUndo")}
                  disabled={undo.length === 0}
                  onClick={undoLast}
                  className={`${toolButton(false)} disabled:opacity-40`}
                >
                  <UndoIcon size={16} />
                </button>
                <button
                  type="button"
                  data-track="jot:off"
                  data-tip={t("reader.jotOffHint")}
                  onClick={() => writeJot({ on: false })}
                  className="h-9 shrink-0 rounded-full px-3 text-[13px] font-semibold text-sand-700 hover:bg-sand-100"
                >
                  {t("reader.jotDone")}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

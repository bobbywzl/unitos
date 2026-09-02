"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

// Tooltips: one shared caption for every control that carries data-tooltip.
// Hovering a control with the mouse shows its caption after a short delay;
// moving straight from one control to the next shows the next at once, so a
// row of icons reads in one sweep. Keyboard focus shows it too. A press,
// Escape, a scroll, or leaving the control hides it. data-tooltip-side picks
// the side (bottom by default); the caption flips when that side has no room
// and stays inside the viewport. Mounted once in the root layout: no state
// per control, no wrapper element, and never clipped by a scroll pane, since
// the caption renders here, at the body.
//
// Touch never shows a tooltip: there is no hover, and a tap's emulated mouse
// events would leave one stuck on screen.

type Side = "top" | "bottom" | "left" | "right";
type Point = { x: number; y: number };
type Tip = { text: string; side: Side; rect: DOMRect; pointer: Point | null };

const SHOW_DELAY = 350; // ms of hover before the caption shows
const WARM_WINDOW = 250; // ms after a hide in which the next caption shows at once
const WATCH_EVERY = 150; // ms between checks that the control is still where it was
const GAP = 8; // px between the control and the caption
const EDGE = 8; // px kept clear of the viewport edge
const WIDE = 240; // px: a control wider than this anchors the caption at the pointer
const TALL = 80; // px: a control taller than this anchors the caption at the pointer
const TOOLTIP_ID = "unitos-tooltip";

function sideOf(el: HTMLElement): Side {
  const side = el.dataset.tooltipSide;
  return side === "top" || side === "left" || side === "right" ? side : "bottom";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function tooltipTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>("[data-tooltip]");
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current: HTMLElement | null = null; // the control under the pointer or focus
    let shown: { el: HTMLElement; rect: DOMRect; describedBefore: string | null } | null = null;
    let showTimer: ReturnType<typeof setTimeout> | null = null;
    let watch: ReturnType<typeof setInterval> | null = null;
    let hiddenAt = 0;
    let pointer: Point | null = null;

    const cancel = () => {
      if (showTimer) clearTimeout(showTimer);
      showTimer = null;
    };

    const hide = () => {
      cancel();
      if (!shown) return;
      if (watch) clearInterval(watch);
      watch = null;
      // The caption described the control while it was up; give the previous
      // description back.
      if (shown.describedBefore === null) shown.el.removeAttribute("aria-describedby");
      else shown.el.setAttribute("aria-describedby", shown.describedBefore);
      shown = null;
      hiddenAt = Date.now();
      setTip(null);
    };

    const show = (el: HTMLElement) => {
      const text = el.dataset.tooltip?.trim();
      if (!text) return;
      const rect = el.getBoundingClientRect();
      shown = { el, rect, describedBefore: el.getAttribute("aria-describedby") };
      el.setAttribute("aria-describedby", TOOLTIP_ID);
      setTip({ text, side: sideOf(el), rect, pointer });
      // The control can leave the page or move without a pointer event (a
      // menu closing, a card re-docking, a resize): a periodic check hides
      // the caption then, so it never floats beside nothing.
      watch = setInterval(() => {
        if (!shown) return;
        const now = shown.el.isConnected ? shown.el.getBoundingClientRect() : null;
        if (!now || Math.abs(now.top - shown.rect.top) > 1 || Math.abs(now.left - shown.rect.left) > 1) {
          hide();
        }
      }, WATCH_EVERY);
    };

    const schedule = (el: HTMLElement) => {
      cancel();
      if (Date.now() - hiddenAt < WARM_WINDOW) show(el);
      else showTimer = setTimeout(() => show(el), SHOW_DELAY);
    };

    // Leaving the current control, by pointer, focus, press, or key.
    const leave = () => {
      hide();
      current = null;
    };

    const onPointerOver = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      pointer = { x: e.clientX, y: e.clientY };
      const el = tooltipTarget(e.target);
      if (el === current) return;
      leave();
      current = el;
      if (el) schedule(el);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === "mouse") pointer = { x: e.clientX, y: e.clientY };
    };
    // The pointer left the window: no pointerover follows.
    const onPointerOut = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.relatedTarget === null) leave();
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = tooltipTarget(e.target);
      // Keyboard focus only: a click focuses too, and the press just hid the caption.
      if (!el || el === current || !el.matches(":focus-visible")) return;
      leave();
      current = el;
      pointer = null;
      show(el);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (current && e.target instanceof Node && current.contains(e.target)) leave();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") leave();
    };

    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("pointerdown", leave, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("scroll", leave, true);
    window.addEventListener("blur", leave);
    return () => {
      hide();
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("pointerdown", leave, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("scroll", leave, true);
      window.removeEventListener("blur", leave);
    };
  }, []);

  // Place the caption once it has a size: beside the control on the asked
  // side, flipped when that side has no room, kept inside the viewport. A
  // wide or tall control (the tray's resize bar, a document title) anchors
  // the caption at the pointer instead of its own center, so the caption
  // lands where the reader is looking.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!tip || !node) return;
    const { rect, pointer } = tip;
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const anchorX =
      pointer && rect.width > WIDE
        ? clamp(pointer.x, rect.left, rect.right)
        : rect.left + rect.width / 2;
    const anchorY =
      pointer && rect.height > TALL
        ? clamp(pointer.y, rect.top, rect.bottom)
        : rect.top + rect.height / 2;
    const room = {
      top: rect.top - GAP - h >= EDGE,
      bottom: rect.bottom + GAP + h <= vh - EDGE,
      left: rect.left - GAP - w >= EDGE,
      right: rect.right + GAP + w <= vw - EDGE,
    };
    let side = tip.side;
    if (side === "bottom" && !room.bottom && room.top) side = "top";
    else if (side === "top" && !room.top && room.bottom) side = "bottom";
    else if (side === "left" && !room.left && room.right) side = "right";
    else if (side === "right" && !room.right && room.left) side = "left";
    let left: number;
    let top: number;
    if (side === "top" || side === "bottom") {
      left = anchorX - w / 2;
      top = side === "bottom" ? rect.bottom + GAP : rect.top - GAP - h;
    } else {
      top = anchorY - h / 2;
      left = side === "right" ? rect.right + GAP : rect.left - GAP - w;
    }
    node.style.left = `${Math.round(clamp(left, EDGE, Math.max(EDGE, vw - w - EDGE)))}px`;
    node.style.top = `${Math.round(clamp(top, EDGE, Math.max(EDGE, vh - h - EDGE)))}px`;
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={ref}
      id={TOOLTIP_ID}
      role="tooltip"
      style={{ left: 0, top: 0 }}
      className="tooltip-in pointer-events-none fixed z-[60] w-max max-w-[260px] rounded-[10px] bg-ink px-2.5 py-1.5 text-[12px] leading-snug font-normal text-paper shadow-lift print:hidden"
    >
      {tip.text}
    </div>
  );
}

"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { installModalTrap } from "@/lib/escape-layers";

// The app's one tooltip, mounted once in the root layout. Any element with
// data-tip shows its text in a bubble on hover and on keyboard focus. Call
// sites set the text from t(), so every tooltip is in the UI language. The
// native title attribute is not used anywhere: it waits a second, looks
// different in every browser, never shows for a focused control, and cannot
// be styled.
//
// One set of document-level listeners, no wrapper per control: a control opts
// in with data-tip alone. The bubble sits above the control, centered; near
// the top of the viewport it drops below; it never leaves the viewport
// sideways. It hides on press, scroll, resize, and Escape. On touch a tap
// shows nothing; a long press (LONG_PRESS_MS, the finger still) on a control
// shows its tip and does not press it. On focus it shows only when a key
// moved the focus (Tab, an arrow), never when a dialog or a script placed it.
// Moving from one control to the next while a bubble shows switches
// at once, so sweeping along a toolbar reads as one tooltip following the
// pointer. A control that comes up under a pointer that has not moved (a
// card that opens where the toolbar was, Run turning into Stop) shows no
// tip until the pointer moves on it: the reader did not point at it, and its
// tip would cover the answer that just opened.

const SHOW_DELAY_MS = 260;
// Leaving one control and entering the next within this window skips the
// delay, the way system menus do.
const WARM_MS = 500;
const GAP = 8;
const MARGIN = 8;
const TIP_ID = "app-tip";
// The page editor and its menus draw Google Docs' tooltip instead: 4 px under
// the control, 300 ms before the first, 50 ms to move to the next
// (css/toolbar.css .docs-tip).
const DOCS_DELAY_MS = 300;
const DOCS_SWAP_MS = 50;
const DOCS_GAP = 4;
const isDocsTarget = (el: Element) => el.closest("[data-docs-editor], [data-docs-menu]") !== null;
// A long press on touch: the finger stays within LONG_PRESS_SLOP_PX for
// LONG_PRESS_MS. Only a control takes it; a field keeps its own long press
// (paste, select), and so does a card being lifted.
const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP_PX = 10;
const TOUCH_TIP_MS = 3000;
const LONG_PRESS_CONTROL =
  "button, a[href], summary, select, [role=button], [role=tab], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=option], [role=switch], [role=radio], [role=checkbox]";
const isLongPressControl = (el: Element) =>
  el.matches(LONG_PRESS_CONTROL) &&
  el.closest("input, textarea, [contenteditable=''], [contenteditable='true']") === null;
// Keys that move the focus: a focus they cause shows the tip.
const NAV_KEYS = new Set(["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);
// The focus a key causes comes within this window of the key.
const KEY_FOCUS_MS = 400;

type Tip = { target: Element; text: string };
type Box = { left: number; top: number };

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<Tip | null>(null);
  const timerRef = useRef<number | null>(null);
  const hiddenAtRef = useRef(-Infinity);

  useEffect(() => {
    // Mounted once on every page, as the tooltip is: Tab stays in a dialog
    // with aria-modal (lib/escape-layers.ts).
    installModalTrap();
    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    const hide = () => {
      clearTimer();
      if (!tipRef.current) return;
      hiddenAtRef.current = performance.now();
      tipRef.current = null;
      setTip(null);
    };
    const show = (target: Element) => {
      clearTimer();
      const text = target.getAttribute("data-tip")?.trim();
      if (!text) return hide();
      tipRef.current = { target, text };
      setTip({ target, text });
    };
    const tipTarget = (node: EventTarget | null): Element | null =>
      node instanceof Element ? node.closest("[data-tip]") : null;
    // Where the pointer last moved to, and the control that came up under
    // it while it stood still: that control's tip waits for a move.
    let lastMove: { x: number; y: number } | null = null;
    let stillOver: Element | null = null;
    // The last key that moves the focus, and the last press.
    let navKeyAt = -Infinity;
    let pressAt = -Infinity;
    // A long press in progress, and the control whose tip it showed: the
    // click that ends that press is not a press of the control.
    let longPress: { id: number; x: number; y: number; target: Element; timer: number } | null = null;
    let swallow: { target: Element; until: number } | null = null;
    const endLongPress = () => {
      if (!longPress) return;
      window.clearTimeout(longPress.timer);
      longPress = null;
    };

    const onPointerOver = (e: PointerEvent) => {
      if (e.pointerType === "touch" || e.buttons !== 0) return;
      const target = tipTarget(e.target);
      const current = tipRef.current?.target ?? null;
      if (!target) return hide();
      if (target === current) return;
      // The browser sends pointerover before the move that caused it, so a
      // pointer that moved onto the control is somewhere new; one that stood
      // still while the page changed under it is where it last moved to.
      if (lastMove && e.clientX === lastMove.x && e.clientY === lastMove.y) {
        stillOver = target;
        return hide();
      }
      stillOver = null;
      overTarget(target, current);
    };
    const overTarget = (target: Element, current: Element | null) => {
      const docs = isDocsTarget(target);
      if (current || performance.now() - hiddenAtRef.current < WARM_MS) {
        if (!docs) return show(target);
        clearTimer();
        timerRef.current = window.setTimeout(() => show(target), DOCS_SWAP_MS);
        return;
      }
      clearTimer();
      timerRef.current = window.setTimeout(() => show(target), docs ? DOCS_DELAY_MS : SHOW_DELAY_MS);
    };
    // relatedTarget null: the pointer left the window.
    // A finger that lifts sends one too: a tip a long press showed stays to
    // be read, until the next press, a scroll, or TOUCH_TIP_MS.
    const onPointerOut = (e: PointerEvent) => {
      if (e.relatedTarget === null && e.pointerType !== "touch") hide();
    };
    // The control can leave the page while hovered (a popover closing under
    // the pointer); the next move notices.
    const onPointerMove = (e: PointerEvent) => {
      const moved = !lastMove || e.clientX !== lastMove.x || e.clientY !== lastMove.y;
      lastMove = { x: e.clientX, y: e.clientY };
      if (tipRef.current && !tipRef.current.target.isConnected) hide();
      // The pointer moves on the control that came up under it: now it
      // points at it.
      if (moved && stillOver && e.pointerType !== "touch" && e.buttons === 0) {
        const target = tipTarget(e.target);
        const held = stillOver;
        stillOver = null;
        if (target === held && held.isConnected) overTarget(held, tipRef.current?.target ?? null);
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      const target = tipTarget(e.target);
      if (!target || !target.matches(":focus-visible")) return;
      // Only a focus a key moved: a field a dialog focused on open, or a
      // control the focus came back to, keeps its tip for hover.
      const now = performance.now();
      if (navKeyAt < pressAt || now - navKeyAt > KEY_FOCUS_MS) return;
      show(target);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (tipRef.current && tipRef.current.target === e.target) hide();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (NAV_KEYS.has(e.key)) navKeyAt = performance.now();
      if (e.key === "Escape") hide();
    };
    const onPointerDown = (e: PointerEvent) => {
      pressAt = performance.now();
      hide();
      endLongPress();
      swallow = null;
      if (e.pointerType !== "touch" || !e.isPrimary) return;
      const target = tipTarget(e.target);
      if (!target || !isLongPressControl(target) || !target.getAttribute("data-tip")?.trim()) return;
      const id = e.pointerId;
      const timer = window.setTimeout(() => {
        if (!longPress || longPress.id !== id) return;
        longPress = null;
        // A card the hold lifted is being dragged: no tip over it.
        if (!target.isConnected || target.closest("[aria-roledescription][aria-pressed='true']")) return;
        show(target);
        swallow = { target, until: performance.now() + 1500 };
        timerRef.current = window.setTimeout(hide, TOUCH_TIP_MS);
      }, LONG_PRESS_MS);
      longPress = { id, x: e.clientX, y: e.clientY, target, timer };
    };
    const onTouchMove = (e: PointerEvent) => {
      if (!longPress || e.pointerId !== longPress.id) return;
      if (Math.hypot(e.clientX - longPress.x, e.clientY - longPress.y) > LONG_PRESS_SLOP_PX) endLongPress();
    };
    const onPointerEnd = (e: PointerEvent) => {
      if (longPress && e.pointerId === longPress.id) endLongPress();
    };
    // The press that showed a tip ends in a click (and on Android a context
    // menu first): neither reaches the control.
    const onClick = (e: MouseEvent) => {
      if (!swallow) return;
      const { target, until } = swallow;
      if (performance.now() > until) return void (swallow = null);
      if (!(e.target instanceof Node) || !target.contains(e.target)) return;
      swallow = null;
      e.preventDefault();
      e.stopPropagation();
    };
    const onContextMenu = (e: MouseEvent) => {
      const held = longPress?.target ?? swallow?.target;
      if (held && e.target instanceof Node && held.contains(e.target)) e.preventDefault();
    };
    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onTouchMove, true);
    document.addEventListener("pointerup", onPointerEnd, true);
    document.addEventListener("pointercancel", onPointerEnd, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("scroll", hide, { capture: true, passive: true });
    window.addEventListener("resize", hide);
    window.addEventListener("blur", hide);
    return () => {
      clearTimer();
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("pointermove", onPointerMove);
      endLongPress();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onTouchMove, true);
      document.removeEventListener("pointerup", onPointerEnd, true);
      document.removeEventListener("pointercancel", onPointerEnd, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("resize", hide);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // Place the bubble before paint: above the control, centered, clamped to
  // the viewport; below when the top is too close. While it shows, the
  // control is described by it (the ARIA tooltip pattern).
  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (!tip || !bubble) {
      setBox(null);
      return;
    }
    const r = tip.target.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    let top: number;
    if (isDocsTarget(tip.target)) {
      // Under the control; above it when the window's foot is too close.
      const above = r.bottom + DOCS_GAP + b.height > window.innerHeight - MARGIN;
      top = above ? r.top - DOCS_GAP - b.height : r.bottom + DOCS_GAP;
    } else {
      const below = r.top - GAP - b.height < MARGIN;
      top = below ? r.bottom + GAP : r.top - GAP - b.height;
    }
    const left = Math.max(
      MARGIN,
      Math.min(r.left + r.width / 2 - b.width / 2, window.innerWidth - MARGIN - b.width),
    );
    setBox({ left, top });
    const target = tip.target;
    const described = target.getAttribute("aria-describedby");
    if (described) return;
    target.setAttribute("aria-describedby", TIP_ID);
    return () => target.removeAttribute("aria-describedby");
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={bubbleRef}
      id={TIP_ID}
      role="tooltip"
      className={
        isDocsTarget(tip.target)
          ? "docs-tip pointer-events-none fixed z-[100]"
          : "tip-in pointer-events-none fixed z-[100] max-w-[min(300px,calc(100vw-16px))] rounded-xl bg-ink px-2.5 py-1.5 text-[11.5px] leading-snug font-semibold whitespace-pre-line text-paper shadow-float"
      }
      style={box ? { left: box.left, top: box.top } : { left: 0, top: 0, visibility: "hidden" }}
    >
      {tip.text}
    </div>
  );
}

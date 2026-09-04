"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

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
// sideways. It hides on press, scroll, resize, and Escape, and never shows on
// touch. Moving from one control to the next while a bubble shows switches
// at once, so sweeping along a toolbar reads as one tooltip following the
// pointer.

const SHOW_DELAY_MS = 260;
// Leaving one control and entering the next within this window skips the
// delay, the way system menus do.
const WARM_MS = 500;
const GAP = 8;
const MARGIN = 8;
const TIP_ID = "app-tip";

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

    const onPointerOver = (e: PointerEvent) => {
      if (e.pointerType === "touch" || e.buttons !== 0) return;
      const target = tipTarget(e.target);
      const current = tipRef.current?.target ?? null;
      if (!target) return hide();
      if (target === current) return;
      if (current || performance.now() - hiddenAtRef.current < WARM_MS) return show(target);
      clearTimer();
      timerRef.current = window.setTimeout(() => show(target), SHOW_DELAY_MS);
    };
    // relatedTarget null: the pointer left the window.
    const onPointerOut = (e: PointerEvent) => {
      if (e.relatedTarget === null) hide();
    };
    // The control can leave the page while hovered (a popover closing under
    // the pointer); the next move notices.
    const onPointerMove = () => {
      if (tipRef.current && !tipRef.current.target.isConnected) hide();
    };
    const onFocusIn = (e: FocusEvent) => {
      const target = tipTarget(e.target);
      if (target && target.matches(":focus-visible")) show(target);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (tipRef.current && tipRef.current.target === e.target) hide();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerdown", hide, true);
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
      document.removeEventListener("pointerdown", hide, true);
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
    const below = r.top - GAP - b.height < MARGIN;
    const top = below ? r.bottom + GAP : r.top - GAP - b.height;
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
      className="tip-in pointer-events-none fixed z-[100] max-w-[min(300px,calc(100vw-16px))] rounded-xl bg-ink px-2.5 py-1.5 text-[11.5px] leading-snug font-semibold whitespace-pre-line text-paper shadow-float"
      style={box ? { left: box.left, top: box.top } : { left: 0, top: 0, visibility: "hidden" }}
    >
      {tip.text}
    </div>
  );
}

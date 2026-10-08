import { distanceBetween, HOLD_DISTANCE_PX, HOLD_MS, HOLD_TOLERANCE_PX, skipsDrag } from "@/lib/hold-drag";

// Hold to drag a row of the document list (SPEC.md §6). The numbers are the
// note card's (lib/hold-drag.ts), so a hold feels the same everywhere:
// - A mouse lifts the row by moving HOLD_DISTANCE_PX at once, or by holding
//   still for HOLD_MS and then moving. A press that never moves is a click.
// - A finger holds still for TOUCH_HOLD_MS, then the row lifts and follows
//   it. A finger that moves first is a scroll; a hold let go without a move
//   is a tap. The list scrolls under the finger, so the touch hold is longer
//   than the mouse's: a flick or a tap never picks a row up.
// Once the row lifts, the page neither scrolls nor selects text, and the
// click the release would fire is stopped. Escape cancels.

/** How long a finger holds still before the row lifts. */
export const TOUCH_HOLD_MS = 300;

type Point = { x: number; y: number };

export type TreeDragHandlers = {
  /** The hold is done: the row may show it is picked up. */
  hold: () => void;
  /** The row follows the pointer from here. */
  start: (at: Point) => void;
  move: (at: Point) => void;
  drop: (at: Point) => void;
  /** No drag after all, or Escape: put everything back. */
  cancel: () => void;
};

/** Watch one press on a row. Returns false when the press can never be a
    drag (a second button, a text field, a control marked data-no-drag). */
export function pressToDrag(event: PointerEvent, handlers: TreeDragHandlers): boolean {
  if (!event.isPrimary || event.button !== 0 || skipsDrag(event.target)) return false;
  const touch = event.pointerType !== "mouse";
  const start: Point = { x: event.clientX, y: event.clientY };
  let state: "pressed" | "held" | "dragging" = "pressed";
  const removers: (() => void)[] = [];
  const listen = (target: EventTarget, name: string, handler: (e: Event) => void, options?: AddEventListenerOptions) => {
    target.addEventListener(name, handler, options);
    removers.push(() => target.removeEventListener(name, handler, options));
  };
  const body = document.body;
  const userSelect = body.style.userSelect;

  const finish = () => {
    clearTimeout(timer);
    for (const remove of removers) remove();
    removers.length = 0;
    body.style.userSelect = userSelect;
  };

  const begin = (at: Point) => {
    state = "dragging";
    body.style.userSelect = "none";
    document.getSelection()?.removeAllRanges();
    handlers.start(at);
    handlers.move(at);
  };

  const timer = setTimeout(() => {
    if (state !== "pressed") return;
    state = "held";
    handlers.hold();
  }, touch ? TOUCH_HOLD_MS : HOLD_MS);

  listen(
    document,
    "pointermove",
    (e) => {
      if (!(e instanceof PointerEvent) || e.pointerId !== event.pointerId) return;
      const at = { x: e.clientX, y: e.clientY };
      const moved = distanceBetween(start, at);
      if (state === "dragging") {
        if (e.cancelable) e.preventDefault();
        handlers.move(at);
      } else if (state === "held") {
        if (moved > HOLD_TOLERANCE_PX) begin(at);
      } else if (touch) {
        // A finger that moves before the hold is a scroll.
        if (moved > HOLD_TOLERANCE_PX) finish();
      } else if (moved >= HOLD_DISTANCE_PX) {
        begin(at);
      }
    },
    { passive: false },
  );
  // Once the row is held, a finger moves the row, never the list.
  listen(
    document,
    "touchmove",
    (e) => {
      if (state !== "pressed" && e.cancelable) e.preventDefault();
    },
    { passive: false },
  );
  listen(document, "pointerup", (e) => {
    if (!(e instanceof PointerEvent) || e.pointerId !== event.pointerId) return;
    const was = state;
    finish();
    if (was === "dragging") {
      stopNextClick();
      handlers.drop({ x: e.clientX, y: e.clientY });
    } else if (was === "held") {
      // Held and let go in place: a tap or a click, which goes through.
      handlers.cancel();
    }
  });
  const cancel = () => {
    const was = state;
    finish();
    if (was !== "pressed") handlers.cancel();
  };
  listen(document, "pointercancel", cancel);
  listen(window, "blur", cancel);
  listen(document, "keydown", (e) => {
    if (e instanceof KeyboardEvent && e.key === "Escape" && state === "dragging") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  }, { capture: true });
  // A link or a picture in the row would start the browser's own drag, and
  // a long press its menu.
  listen(window, "dragstart", (e) => e.preventDefault());
  listen(window, "contextmenu", (e) => {
    if (state !== "pressed") e.preventDefault();
  });
  return true;
}

/** The click a release fires lands on the row the drag began on: stopped,
    for that one click alone. */
function stopNextClick() {
  const stop = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  document.addEventListener("click", stop, { capture: true });
  setTimeout(() => document.removeEventListener("click", stop, { capture: true }), 50);
}

/** The nearest box that scrolls up and down, from `el` up. */
export function scrollBoxOf(el: Element | null): HTMLElement | null {
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    if (!(node instanceof HTMLElement)) continue;
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/** How far to scroll a list this frame, with the pointer at `y`: faster the
    closer it is to the list's top or bottom edge, nothing outside the band. */
export function edgeScrollStep(box: DOMRect, y: number): number {
  const BAND = 36;
  const MAX = 14;
  if (y < box.top + BAND) return -Math.ceil(MAX * Math.min(1, (box.top + BAND - y) / BAND));
  if (y > box.bottom - BAND) return Math.ceil(MAX * Math.min(1, (y - (box.bottom - BAND)) / BAND));
  return 0;
}

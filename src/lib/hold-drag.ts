// Hold to drag (SPEC.md §6). A note in its draggable mode is picked up by a
// hold anywhere on it: the pointer stays put for HOLD_MS, the card lifts, and
// from then on it follows the pointer. A press that ends before the hold is a
// click, and a press that moves off before the hold is a scroll or a text
// selection. A mouse may also skip the hold by moving HOLD_DISTANCE_PX at
// once — a mouse never scrolls by dragging the content, so a pull is a drag.
//
// The board's sensor (components/hold-sensor.ts) and the floating card
// (outline/floating-note-editor.tsx) read the same numbers, so a hold feels
// the same on every card.

/** How long the pointer holds still before the card lifts. */
export const HOLD_MS = 150;
/** How far the pointer may drift during the hold and still count as still. */
export const HOLD_TOLERANCE_PX = 6;
/** A mouse that moves this far at once lifts the card without the hold. */
export const HOLD_DISTANCE_PX = 12;

/** A press on one of these never starts a drag: the control keeps it. */
const NO_DRAG = "input, textarea, select, [contenteditable=''], [contenteditable='true'], [data-no-drag]";

export function skipsDrag(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(NO_DRAG) !== null;
}

export function distanceBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** After a drag, the click the release would fire lands on the control the
    hold began on. One capture listener stops it — for the one click after the
    release, never longer (a listener left behind once killed every click in
    the app until a reload). */
export function stopClickAfterDrag() {
  const stop = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };
  document.addEventListener("click", stop, { capture: true });
  const release = () => {
    window.removeEventListener("pointerup", release);
    window.removeEventListener("pointercancel", release);
    setTimeout(() => document.removeEventListener("click", stop, { capture: true }), 50);
  };
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
}

/** Watch a press until it is a hold or a move: onLift runs when the card
    should lift, with the pointer's place. A press that ends or drifts first
    runs nothing. Returns at once; the listeners leave with the press. */
export function watchHold(
  e: { clientX: number; clientY: number; pointerType: string },
  onLift: (at: { x: number; y: number }) => void,
  {
    pull = true,
  }: {
    /** False: a mouse pull never lifts, only the hold does — on text the
        reader may want to select, a pull is a selection. */
    pull?: boolean;
  } = {},
) {
  const start = { x: e.clientX, y: e.clientY };
  const mouse = pull && e.pointerType !== "touch";
  let lifted = false;
  const stop = () => {
    clearTimeout(timer);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    window.removeEventListener("blur", stop);
  };
  const lift = (at: { x: number; y: number }) => {
    if (lifted) return;
    lifted = true;
    stop();
    stopClickAfterDrag();
    window.getSelection()?.removeAllRanges();
    onLift(at);
  };
  const onMove = (ev: PointerEvent) => {
    const at = { x: ev.clientX, y: ev.clientY };
    const moved = distanceBetween(start, at);
    if (mouse && moved >= HOLD_DISTANCE_PX) lift(at);
    else if (moved > HOLD_TOLERANCE_PX) stop();
  };
  const timer = setTimeout(() => lift(start), HOLD_MS);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
  window.addEventListener("blur", stop);
}

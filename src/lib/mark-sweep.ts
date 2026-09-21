// A mark made in this session sweeps in once (globals.css .mark-sweep). The
// sweep paints its tint as a background-image, and that image must not stay:
// a stored AI annotation whose card is closed has no fill (.tool-mark), the
// selection tint rides the same property, and on a span that wraps lines a
// leftover image paints part of the span. So when the sweep ends the class
// comes off the element, the highlight forgets it is fresh, and the reader
// drops the span from its fresh set (reader-interactions.tsx): the resting
// mark is the plain mark.
export const MARK_SWEPT_EVENT = "dissect:mark-swept";
export type MarkSweptDetail = { blockId: string; start: number; end: number };

export function endSweep(el: HTMLElement, detail: MarkSweptDetail) {
  el.classList.remove("mark-sweep");
  el.style.animationDelay = "";
  window.dispatchEvent(new CustomEvent<MarkSweptDetail>(MARK_SWEPT_EVENT, { detail }));
}

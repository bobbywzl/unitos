// One drag that crosses surfaces (SPEC.md §6): a note card of the notes tray,
// a row of the Annotations tab, or one of the reader's own cards over the
// article, dragged onto a note — a note card of the tray, or the floating
// card. The board drag (components/sortable.tsx) moves notes inside one list;
// this moves a card onto a target that is not in that list, and lives outside
// React so the panels, the reader, and the floating card never need one
// shared tree.
//
// A drop target marks itself with data-note-drop-target="<id>" and listens
// with useCardDropTarget (components/outline/use-card-drop.ts). The gesture
// dispatches three events on the window: start, over (the target under the
// pointer, or null), and end (the target it was released on, or null).

/** The cards being dragged: notes of the tray, or an annotation — a row of
    the Annotations tab, or a card of the reader over the article.
    A note that is one of the selected notes carries the whole selection, so
    several notes land in one drop. */
export type CardDrag = {
  kind: "note" | "annotation";
  /** The dragged card first, then the rest: they merge in this order. */
  ids: string[];
  /** The line the ghost shows while it follows the pointer. */
  label: string;
};

/** What a merge does to the text. join: the sources' text lands in the target
    as it is. ai: the model writes the one note that takes their place
    (SPEC.md §6). A drag always merges with AI; the ticker's bulk action is
    where join lives. */
export type MergeMode = "join" | "ai";

export const CARD_DRAG_START = "dissect:card-drag-start";
export const CARD_DRAG_OVER = "dissect:card-drag-over";
export const CARD_DRAG_END = "dissect:card-drag-end";

export type CardDragOverDetail = { drag: CardDrag; targetId: string | null };
export type CardDragEndDetail = { drag: CardDrag; targetId: string | null };

/** The drop target under a point, or null. Targets mark themselves with
    data-note-drop-target; the ghost never takes the hit test (it carries
    pointer-events: none). The point is asked of the document rather than
    measured against every target's box: a note card scrolled out of its
    panel still has a box, and the floating card sits over cards it must win
    against. What the reader can see and press is what takes the drop. */
function targetAt(x: number, y: number): string | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const target = el.closest<HTMLElement>("[data-note-drop-target]");
    if (target) return target.dataset.noteDropTarget ?? null;
  }
  return null;
}

function ghostFor(label: string): HTMLElement {
  const ghost = document.createElement("div");
  ghost.className = "card-drag-ghost";
  ghost.textContent = label;
  document.body.append(ghost);
  return ghost;
}

/** Start the drag. Returns at once; the gesture runs on window listeners
    until the pointer is released or Escape cancels it. onEnd is called with
    the target the card was released on, or null. */
export function startCardDrag(
  from: { clientX: number; clientY: number },
  drag: CardDrag,
  onEnd: (detail: CardDragEndDetail) => void,
) {
  const ghost = ghostFor(drag.label);
  let targetId: string | null = null;
  const place = (x: number, y: number) => {
    ghost.style.left = `${x + 14}px`;
    ghost.style.top = `${y + 14}px`;
  };
  place(from.clientX, from.clientY);
  window.dispatchEvent(new CustomEvent(CARD_DRAG_START, { detail: { drag } }));

  const over = (next: string | null) => {
    if (next === targetId) return;
    targetId = next;
    ghost.classList.toggle("card-drag-ghost-over", next !== null);
    window.dispatchEvent(
      new CustomEvent<CardDragOverDetail>(CARD_DRAG_OVER, { detail: { drag, targetId: next } }),
    );
  };

  const onMove = (e: PointerEvent) => {
    place(e.clientX, e.clientY);
    over(targetAt(e.clientX, e.clientY));
  };
  const finish = (detail: CardDragEndDetail) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("blur", onCancel);
    window.removeEventListener("keydown", onKey, true);
    ghost.remove();
    window.dispatchEvent(new CustomEvent<CardDragEndDetail>(CARD_DRAG_END, { detail }));
    onEnd(detail);
  };
  const onUp = (e: PointerEvent) => {
    finish({ drag, targetId: targetAt(e.clientX, e.clientY) });
  };
  const onCancel = () => finish({ drag, targetId: null });
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    onCancel();
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  // The window losing focus with the button still down is a release too: a
  // release the page never hears (the pointer went up over the browser's own
  // chrome) otherwise left the ghost following the pointer for good.
  window.addEventListener("blur", onCancel);
  window.addEventListener("keydown", onKey, true);
}

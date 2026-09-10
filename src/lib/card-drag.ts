// One drag that crosses surfaces (SPEC.md §6): a note card in the notes tray
// or an annotation card in the Annotations tab, dragged onto the floating
// note card over the article. The board drag (components/sortable.tsx) moves
// notes inside one list; this moves a card out of its panel and onto a target
// that is not in that list, and lives outside React so the two panels and the
// floating card never need one shared tree.
//
// A drop target marks itself with data-note-drop-target="<id>" and listens
// with useCardDropTarget (components/outline/use-card-drop.ts). The gesture
// dispatches three events on the window: start, over (the target under the
// pointer, or null), and end (the target it was released on, or null).

/** The cards being dragged: notes of the tray, or an annotation of the panel.
    A note that is one of the selected notes carries the whole selection, so
    several notes land in one drop. */
export type CardDrag = {
  kind: "note" | "annotation";
  /** The dragged card first, then the rest: they merge in this order. */
  ids: string[];
  /** The line the ghost shows while it follows the pointer. */
  label: string;
};

/** What the drop does. join: the card's text lands in the note as it is.
    ai: the model writes the one note that takes their place (SPEC.md §6). */
export type MergeMode = "join" | "ai";

export const CARD_DRAG_START = "dissect:card-drag-start";
export const CARD_DRAG_OVER = "dissect:card-drag-over";
export const CARD_DRAG_END = "dissect:card-drag-end";
// The floating note card says while it is open, so panels that can drag a card
// onto it show their grips only then.
export const CARD_DROP_TARGET = "dissect:card-drop-target";

export type CardDragOverDetail = { drag: CardDrag; targetId: string | null };
export type CardDragEndDetail = { drag: CardDrag; targetId: string | null; mode: MergeMode };

/** The drop target under a point, or null. Targets mark themselves with
    data-note-drop-target; the ghost never takes the hit test (it is not in
    the document flow of a target and carries pointer-events: none). */
function targetAt(x: number, y: number): string | null {
  for (const el of document.querySelectorAll<HTMLElement>("[data-note-drop-target]")) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return el.dataset.noteDropTarget ?? null;
    }
  }
  return null;
}

/** The merge choice under a point: the pill of the strip the target draws,
    or "join" when the pointer is on the target but on no pill. */
function modeAt(x: number, y: number): MergeMode {
  for (const el of document.querySelectorAll<HTMLElement>("[data-merge-choice]")) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return el.dataset.mergeChoice === "ai" ? "ai" : "join";
    }
  }
  return "join";
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
    window.removeEventListener("keydown", onKey, true);
    ghost.remove();
    window.dispatchEvent(new CustomEvent<CardDragEndDetail>(CARD_DRAG_END, { detail }));
    onEnd(detail);
  };
  const onUp = (e: PointerEvent) => {
    const landed = targetAt(e.clientX, e.clientY);
    finish({ drag, targetId: landed, mode: landed ? modeAt(e.clientX, e.clientY) : "join" });
  };
  const onCancel = () => finish({ drag, targetId: null, mode: "join" });
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    onCancel();
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("keydown", onKey, true);
}

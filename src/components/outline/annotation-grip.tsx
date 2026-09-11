"use client";

import { startCardDrag } from "@/lib/card-drag";
import { useT } from "@/components/lang-provider";

// The grip that drags an annotation into a note (SPEC.md §6, lib/card-drag.ts).
// One grip, wherever an annotation is on screen: the rows of the Annotations
// tab, and the reader's own cards over the article — the explanation, the
// simplification, the analysis, the visualization, the assistant's card, a
// comment, a highlight. Dropped on a note it is copied in: its text lands in
// the note and its anchors are copied as sources, and the annotation stays
// where it is, still painted in the article.

// A short hold and a move starts the drag; a shorter press is an ordinary
// press and the card keeps it.
const DRAG_PX = 6;

export function AnnotationGrip({
  noteId,
  label,
  className,
}: {
  /** The annotation's note: annotations are notes of the hidden Annotations
      section, so a drop merges by id like any other note. */
  noteId: string;
  /** The line the ghost shows while it follows the pointer. */
  label: string;
  className?: string;
}) {
  const t = useT();
  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const fromX = e.clientX;
    const fromY = e.clientY;
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    const onMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - fromX) < DRAG_PX && Math.abs(ev.clientY - fromY) < DRAG_PX) return;
      stop();
      window.getSelection()?.removeAllRanges();
      startCardDrag(
        { clientX: ev.clientX, clientY: ev.clientY },
        { kind: "annotation", ids: [noteId], label },
        () => {},
      );
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }
  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      data-track="annotation-drag"
      aria-label={t("panels.dragAnnotationTitle")}
      data-tip={t("panels.dragAnnotationTitle")}
      className={`flex cursor-grab touch-none items-center rounded-full p-0.5 text-sand-500 hover:bg-clay-100 hover:text-clay-800 ${className ?? ""}`}
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

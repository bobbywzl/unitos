"use client";

import { useEffect, useRef, useState } from "react";

// Files dragged over the page (SPEC.md §15): the window takes the drop, and
// document-bar.tsx adds the files as documents. This says whether a drag
// carrying files is over the page right now, and hands the dropped files on.
//
// No enter/leave counting. dragenter and dragleave pair up only while the
// page holds still: an element that unmounts under the pointer (a hover
// menu closing, the overlay itself mounting) never sends its dragleave, and
// the count stays above zero with no drag — the overlay stuck on the page.
// dragover instead fires the whole time the drag is over the window, so the
// overlay shows while dragover keeps coming and hides when it stops.
//
// The browser fires dragover every 350 ms or so while the pointer holds
// still: the idle wait sits above that, so a still pointer never flickers.
const IDLE_MS = 600;

function hasFiles(e: DragEvent): boolean {
  return e.dataTransfer?.types.includes("Files") ?? false;
}

// The page editor is not a place to add documents (SPEC.md §29): an image
// dropped on the page's text goes into the text only (the text takes the
// drop and cancels it), and the rest of the page editor refuses files.
function overPageEditor(e: DragEvent): boolean {
  return e.target instanceof Element && e.target.closest("[data-docs-editor]") !== null;
}

// Chrome's dragleave for a drag that left the window carries (0, 0);
// Firefox's carries the point outside the viewport.
function leftWindow(e: DragEvent): boolean {
  return (
    e.clientX <= 0 ||
    e.clientY <= 0 ||
    e.clientX >= window.innerWidth ||
    e.clientY >= window.innerHeight
  );
}

export function usePageFileDrop({
  enabled,
  onDrop,
}: {
  /** False for a viewer: no overlay, and the drop is refused so the browser
      does not open the file in place of the page. */
  enabled: boolean;
  onDrop: (files: File[]) => void;
}): boolean {
  const [over, setOver] = useState(false);
  const onDropRef = useRef(onDrop);
  useEffect(() => {
    onDropRef.current = onDrop;
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const hide = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      setOver(false);
    };
    const onDragEnter = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      if (e.defaultPrevented) {
        hide();
        return;
      }
      e.preventDefault();
      const refuse = !enabled || overPageEditor(e);
      if (e.dataTransfer) e.dataTransfer.dropEffect = refuse ? "none" : "copy";
      if (refuse) {
        hide();
        return;
      }
      setOver(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(hide, IDLE_MS);
    };
    const onDragLeave = (e: DragEvent) => {
      if (leftWindow(e)) hide();
    };
    const onDropEvent = (e: DragEvent) => {
      hide();
      if (!hasFiles(e) || e.defaultPrevented) return;
      e.preventDefault();
      if (!enabled || overPageEditor(e)) return;
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length > 0) onDropRef.current(files);
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDropEvent);
    window.addEventListener("dragend", hide);
    return () => {
      hide();
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDropEvent);
      window.removeEventListener("dragend", hide);
    };
  }, [enabled]);

  return over;
}

import type { Editor } from "@tiptap/core";
import { useEffect, useLayoutEffect, useRef } from "react";
import { scrollParent } from "@/components/docs/page/geometry";
import { applyReadingPosition, readReadingPosition, type ReadingPosition } from "@/lib/reading-position";

// The reader's place across a new layout of the same text (SPEC.md §30):
// a PDF import read pageless and drawn in pages again (Read pageless, Show
// pages, a switch to Editing or Suggesting, which draw the pages). The
// block at the reading line, read as the reader scrolls
// (lib/reading-position.ts), goes back under the line once the new layout
// stands, and is held there while its pages settle, until the reader
// scrolls, presses, or types, or HOLD_MS passes.

const HOLD_MS = 1500;

/** Keeps the block at the reading line in place whenever `layout` changes. */
export function useKeepPlace(editor: Editor | null, layout: string): void {
  const last = useRef<ReadingPosition | null>(null);
  const holding = useRef(false);
  // The place, read as the reader scrolls (once a frame at most).
  useEffect(() => {
    const pane = editor && !editor.isDestroyed ? scrollParent(editor.view.dom) : null;
    if (!pane) return;
    let frame = 0;
    const read = () => {
      if (!holding.current) last.current = readReadingPosition(pane, Date.now());
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), read()));
    };
    read();
    pane.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      pane.removeEventListener("scroll", onScroll);
    };
  }, [editor]);

  const shown = useRef(layout);
  useLayoutEffect(() => {
    if (shown.current === layout) return;
    shown.current = layout;
    const pane = editor && !editor.isDestroyed ? scrollParent(editor.view.dom) : null;
    const position = last.current;
    if (!pane || !position || !("blockId" in position)) return;
    holding.current = true;
    let frame = 0;
    const hold = () => {
      applyReadingPosition(pane, position, false);
      frame = requestAnimationFrame(hold);
    };
    const stop = () => {
      if (!holding.current) return;
      holding.current = false;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      pane.removeEventListener("wheel", stop);
      pane.removeEventListener("touchmove", stop);
      pane.removeEventListener("pointerdown", stop, true);
      window.removeEventListener("keydown", stop, true);
      last.current = readReadingPosition(pane, Date.now());
    };
    hold();
    const timer = setTimeout(stop, HOLD_MS);
    pane.addEventListener("wheel", stop, { passive: true });
    pane.addEventListener("touchmove", stop, { passive: true });
    pane.addEventListener("pointerdown", stop, true);
    window.addEventListener("keydown", stop, true);
    return stop;
  }, [editor, layout]);
}

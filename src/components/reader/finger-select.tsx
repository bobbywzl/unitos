"use client";

import { useEffect, type RefObject } from "react";

// The finger selection (SPEC.md §33): a finger drawn along a line of the
// article selects the words it passes, from the word it started on to the
// word under it, and the AI toolbar opens when the finger lifts — the same
// toolbar a long press and its handles open. A finger that moves up or down
// first scrolls, as before.
//
// The browser decides between the two before any script runs: the text
// blocks take `touch-action: pan-y pinch-zoom` (globals.css, on a pane that
// carries data-finger-select), so a drag that starts sideways is handed to
// the page and a drag that starts up or down scrolls. This component only
// turns the sideways drag into a selection. It opens no toolbar itself: the
// reader's own pointerup handler reads the selection when the finger lifts.

const BLOCK_SELECTOR = "[data-block-id], [data-edit-block]";

// Where a sideways drag selects nothing: controls, cards, and fields.
const SKIP =
  "button, input, textarea, select, a[href], video, audio, [role=dialog], [role=menu], [data-jot-bar], " +
  "[data-selection-popover], [data-side-card], [data-log-card], [data-annotation-card], [data-floating-note], " +
  "[data-edit-toolbar], [data-layer-toolbar], [data-anchor-skip]";

// The drag is a selection once it has gone this far sideways, and that much
// further sideways than up or down.
const ENGAGE_PX = 12;
const SIDEWAYS = 1.7;

type Caret = { node: Node; offset: number };

type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

function caretAt(x: number, y: number): Caret | null {
  const doc = document as CaretDocument;
  if (doc.caretPositionFromPoint) {
    const at = doc.caretPositionFromPoint(x, y);
    return at ? { node: at.offsetNode, offset: at.offset } : null;
  }
  const range = doc.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

// A word's letters: the selection grows to the whole word at both ends. A
// script written without spaces (Chinese, Japanese) is selected by the
// character.
const WORD = /[\p{L}\p{N}\p{M}'’_-]/u;
const NO_SPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

function wordEdge(caret: Caret, side: "start" | "end"): Caret {
  if (caret.node.nodeType !== Node.TEXT_NODE) return caret;
  const text = caret.node.textContent ?? "";
  let at = Math.max(0, Math.min(caret.offset, text.length));
  const inWord = (i: number) => i >= 0 && i < text.length && WORD.test(text[i]) && !NO_SPACES.test(text[i]);
  if (side === "start") {
    while (inWord(at - 1)) at--;
  } else {
    // The caret sits before the character under the finger: that character
    // is part of the selection.
    if (at < text.length && NO_SPACES.test(text[at])) at++;
    while (inWord(at)) at++;
  }
  return { node: caret.node, offset: at };
}

function before(a: Caret, b: Caret): boolean {
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.collapse(true);
  return range.comparePoint(b.node, b.offset) >= 0;
}

export function FingerSelect({ container }: { container: RefObject<HTMLDivElement | null> }) {
  useEffect(() => {
    const pane = container.current;
    if (!pane) return;

    // A page the reader has zoomed into pans sideways under one finger: the
    // text blocks give the sideways drag back to the browser while it is.
    const viewport = window.visualViewport;
    const mark = () => {
      if (!viewport || viewport.scale <= 1.02) pane.setAttribute("data-finger-select", "");
      else pane.removeAttribute("data-finger-select");
    };
    mark();
    viewport?.addEventListener("resize", mark);

    type Drag = { pointerId: number; x: number; y: number; start: Caret | null; selecting: boolean };
    let drag: Drag | null = null;

    const inArticle = (node: Node | null): boolean => {
      const el = node instanceof Element ? node : (node?.parentElement ?? null);
      if (!el || el.closest("[data-reader-root]") !== pane) return false;
      return el.closest(BLOCK_SELECTOR) !== null && !el.closest(SKIP);
    };

    const onDown = (e: PointerEvent) => {
      drag = null;
      if (e.pointerType !== "touch" || !e.isPrimary) return;
      const target = e.target;
      if (!(target instanceof Element) || !inArticle(target)) return;
      // Only where the stylesheet gave the sideways drag to the page: a
      // table or a code block that scrolls sideways keeps its scroll.
      const block = target.closest<HTMLElement>(BLOCK_SELECTOR);
      if (!block || !getComputedStyle(block).touchAction.includes("pan-y")) return;
      drag = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, start: null, selecting: false };
    };

    const select = (d: Drag, x: number, y: number) => {
      const here = caretAt(x, y);
      if (!d.start || !here || !inArticle(here.node)) return;
      const forward = before(d.start, here);
      const from = wordEdge(forward ? d.start : here, "start");
      const to = wordEdge(forward ? here : d.start, "end");
      const selection = window.getSelection();
      if (!selection) return;
      // The anchor is where the finger started, so the handles the system
      // draws afterwards extend from the right end.
      if (forward) selection.setBaseAndExtent(from.node, from.offset, to.node, to.offset);
      else selection.setBaseAndExtent(to.node, to.offset, from.node, from.offset);
    };

    const onMove = (e: PointerEvent) => {
      const d = drag;
      if (!d || e.pointerId !== d.pointerId) return;
      const dx = Math.abs(e.clientX - d.x);
      const dy = Math.abs(e.clientY - d.y);
      if (!d.selecting) {
        // Up or down first: the browser scrolls and this drag is over.
        if (dy >= ENGAGE_PX && dx < dy * SIDEWAYS) {
          drag = null;
          return;
        }
        if (dx < ENGAGE_PX || dx < dy * SIDEWAYS) return;
        const start = caretAt(d.x, d.y);
        if (!start || !inArticle(start.node)) {
          drag = null;
          return;
        }
        d.start = start;
        d.selecting = true;
      }
      select(d, e.clientX, e.clientY);
    };

    const onEnd = (e: PointerEvent) => {
      if (drag && e.pointerId === drag.pointerId) drag = null;
    };

    // Capture phase on the pane: the selection stands before the reader's
    // own pointerup handler reads it.
    pane.addEventListener("pointerdown", onDown, true);
    pane.addEventListener("pointermove", onMove, true);
    pane.addEventListener("pointerup", onEnd);
    pane.addEventListener("pointercancel", onEnd);
    return () => {
      viewport?.removeEventListener("resize", mark);
      pane.removeAttribute("data-finger-select");
      pane.removeEventListener("pointerdown", onDown, true);
      pane.removeEventListener("pointermove", onMove, true);
      pane.removeEventListener("pointerup", onEnd);
      pane.removeEventListener("pointercancel", onEnd);
    };
  }, [container]);

  return null;
}

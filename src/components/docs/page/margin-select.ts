import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { scrollParent } from "@/components/docs/page/geometry";

// A press off the words — a page's margin, the canvas beside the page —
// selects as a press on the words does: the caret lands on the nearest
// line, and a drag grows the selection to the words nearest the pointer.
// Left of the text is a line's start, right of it the line's end.
//
// One owner scrolls the pane while a drag selects, from the words or from a
// margin: this file. The browser's own scroll starts 20 px inside the pane's
// edge and runs fast, so a drag along the last line in view ran to the
// document's end; for a drag on the words the browser's scroll is held off
// (frame.css [data-edge-drag]) while this one runs. The band is EDGE px
// inside the pane's bottom edge and under the title row and the toolbar at
// its top. The scroll starts once the pointer is in the band's outer RIM
// px or past the edge, or rests in the band for REST_MS, and grows gently
// with the depth.

const EDGE = 24; // px: the band inside the pane's visible top and bottom edges
const RIM = 6; // px: the band's outer rim, where the scroll starts at once
const REST_MS = 450; // a pointer resting this long in the band starts the scroll
const STILL_PX = 4; // a move shorter than this is resting
const STEP = 18; // px per frame at most, far past the edge

/** The document position nearest a client point, the point pulled into the
    text's box first. Null when the page has no text box to measure. */
export function nearestPos(editor: Editor, clientX: number, clientY: number): number | null {
  const box = editor.view.dom.getBoundingClientRect();
  if (box.width <= 4 || box.height <= 4) return null;
  const x = Math.min(Math.max(clientX, box.left + 2), box.right - 2);
  const y = Math.min(Math.max(clientY, box.top + 2), box.bottom - 2);
  return editor.view.posAtCoords({ left: x, top: y })?.pos ?? null;
}

/** Selects from `anchor` to `head`: in the editor's state when the page is
    edited, and in the browser's selection either way, since Viewing selects
    too — for a highlight — and takes no caret. */
export function selectRange(editor: Editor, anchor: number, head: number) {
  const { state } = editor.view;
  const max = state.doc.content.size;
  anchor = Math.min(anchor, max);
  head = Math.min(head, max);
  if (editor.isEditable) {
    const sel = TextSelection.create(state.doc, anchor, head);
    if (!sel.eq(state.selection)) editor.view.dispatch(state.tr.setSelection(sel));
    return;
  }
  const a = editor.view.domAtPos(anchor);
  const h = editor.view.domAtPos(head);
  window.getSelection()?.setBaseAndExtent(a.node, a.offset, h.node, h.offset);
}

/** The pane's visible edges: its top under the page editor's sticky
    header, its bottom. */
function paneEdges(editor: Editor, pane: HTMLElement): { top: number; bottom: number } {
  const r = pane.getBoundingClientRect();
  const header = editor.view.dom.closest("[data-docs-editor]")?.querySelector(".docs-header");
  return { top: Math.max(r.top, header?.getBoundingClientRect().bottom ?? r.top), bottom: r.bottom };
}

/** The pane's scroll while a drag selects: call `move` with every pointer
    move; `onScroll` runs after each step the pane took. Returns the stop. */
function edgeScroll(
  editor: Editor,
  pane: HTMLElement,
  onScroll: () => void,
): { move: (x: number, y: number) => void; stop: () => void } {
  let y = 0;
  let restX = 0;
  let restY = 0;
  let restAt = 0;
  let running = false;
  let frame = 0;
  // How far into the band the pointer is, signed: + the bottom band, − the
  // top band, 0 outside both. Past the edge counts on beyond EDGE.
  const depth = () => {
    const { top, bottom } = paneEdges(editor, pane);
    const down = y - (bottom - EDGE);
    const up = top + EDGE - y;
    return down > 0 ? down : up > 0 ? -up : 0;
  };
  const tick = () => {
    frame = 0;
    const d = depth();
    if (d === 0) {
      running = false;
      return;
    }
    const deep = Math.abs(d);
    if (!running) running = deep >= EDGE - RIM || performance.now() - restAt >= REST_MS;
    if (running) {
      const ramp = Math.min(deep, EDGE) / EDGE;
      const by = Math.min(STEP, Math.ceil(ramp * ramp * 8 + Math.max(0, deep - EDGE) / 3));
      const before = pane.scrollTop;
      pane.scrollTop += d > 0 ? by : -by;
      if (pane.scrollTop !== before) onScroll();
    }
    frame = requestAnimationFrame(tick);
  };
  return {
    move(x: number, nextY: number) {
      y = nextY;
      if (Math.hypot(x - restX, nextY - restY) >= STILL_PX) {
        restX = x;
        restY = nextY;
        restAt = performance.now();
      }
      if (!frame) frame = requestAnimationFrame(tick);
    },
    stop() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}

/** Grows the selection from `anchor` to the words nearest the pointer until
    the button is let go. */
export function followMarginDrag(editor: Editor, anchor: number, start: MouseEvent) {
  const pane = scrollParent(editor.view.dom);
  let x = start.clientX;
  let y = start.clientY;
  const select = () => {
    if (editor.isDestroyed) return;
    const head = nearestPos(editor, x, y);
    if (head !== null) selectRange(editor, anchor, head);
  };
  const edge = pane ? edgeScroll(editor, pane, select) : null;
  const onMove = (e: MouseEvent) => {
    x = e.clientX;
    y = e.clientY;
    select();
    edge?.move(x, y);
  };
  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp, true);
    edge?.stop();
  };
  window.addEventListener("mousemove", onMove);
  // Capture: the selection is whole before the reader's mouseup reads it.
  window.addEventListener("mouseup", onUp, true);
}

/** A press on the words: from the drag's first move to the button's
    release this file owns the drag, as it owns a margin's. The pane holds
    the browser's own selection and scroll off (frame.css
    [data-edge-drag]: the browser's scroll starts 20 px inside the pane's
    edge and runs fast), the selection grows from the press to the words
    nearest the pointer, and the pane scrolls near its edges by the rules
    above. A press on selected words (a drag moves them), on an object, or
    a double or triple click's drag (by words, by paragraphs) stays the
    browser's. */
export function followTextDrag(editor: Editor, start: MouseEvent) {
  const pane = scrollParent(editor.view.dom);
  if (!pane || pane.scrollHeight <= pane.clientHeight || start.detail > 1) return;
  const target = start.target instanceof Element ? start.target : null;
  if (target?.closest("img, [draggable='true'], [contenteditable='false']")) return;
  const press = nearestPos(editor, start.clientX, start.clientY);
  if (press === null) return;
  const { from, to, anchor: held } = editor.state.selection;
  if (from < to && press > from && press < to && !start.shiftKey) return;
  if (start.shiftKey && !editor.isEditable) return;
  const anchor = start.shiftKey ? held : press;
  let x = start.clientX;
  let y = start.clientY;
  let dragging = false;
  let padding = "";
  const select = () => {
    if (editor.isDestroyed) return;
    const head = nearestPos(editor, x, y);
    if (head !== null) selectRange(editor, anchor, head);
  };
  const edge = edgeScroll(editor, pane, select);
  const onMove = (e: MouseEvent) => {
    if (!(e.buttons & 1)) return onUp();
    x = e.clientX;
    y = e.clientY;
    if (!dragging) {
      if (Math.hypot(x - start.clientX, y - start.clientY) < STILL_PX) return;
      dragging = true;
      // The scrollbar's room stays while the scrollbar is held off, so the
      // page does not move under the pointer.
      const bar = pane.offsetWidth - pane.clientWidth - (parseFloat(getComputedStyle(pane).borderLeftWidth) || 0) - (parseFloat(getComputedStyle(pane).borderRightWidth) || 0);
      padding = pane.style.paddingRight;
      if (bar > 0) pane.style.paddingRight = `${(parseFloat(getComputedStyle(pane).paddingRight) || 0) + bar}px`;
      pane.setAttribute("data-edge-drag", "");
    }
    e.preventDefault();
    select();
    edge.move(x, y);
  };
  const onUp = () => {
    window.removeEventListener("mousemove", onMove, true);
    window.removeEventListener("mouseup", onUp, true);
    window.removeEventListener("dragstart", onUp, true);
    edge.stop();
    if (dragging) {
      pane.removeAttribute("data-edge-drag");
      pane.style.paddingRight = padding;
    }
  };
  window.addEventListener("mousemove", onMove, true);
  // Capture: the selection is whole before the reader's mouseup reads it.
  window.addEventListener("mouseup", onUp, true);
  window.addEventListener("dragstart", onUp, true);
}

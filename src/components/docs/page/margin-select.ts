import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { scrollParent } from "@/components/docs/page/geometry";

// A press off the words — a page's margin, the canvas beside the page —
// selects as a press on the words does: the caret lands on the nearest
// line, and a drag grows the selection to the words nearest the pointer.
// Left of the text is a line's start, right of it the line's end. The pane
// scrolls while the pointer is near its top or bottom edge, or past it.

const EDGE = 40; // px from the pane's edge where the scroll starts
const STEP = 18; // px per frame at the edge itself

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

/** Grows the selection from `anchor` to the words nearest the pointer until
    the button is let go. */
export function followMarginDrag(editor: Editor, anchor: number, start: MouseEvent) {
  const pane = scrollParent(editor.view.dom);
  let x = start.clientX;
  let y = start.clientY;
  let frame = 0;
  const select = () => {
    if (editor.isDestroyed) return;
    const head = nearestPos(editor, x, y);
    if (head !== null) selectRange(editor, anchor, head);
  };
  const scroll = () => {
    frame = 0;
    if (!pane) return;
    const r = pane.getBoundingClientRect();
    const up = r.top + EDGE - y;
    const down = y - (r.bottom - EDGE);
    const by = up > 0 ? -Math.min(STEP, Math.ceil(up / 3)) : down > 0 ? Math.min(STEP, Math.ceil(down / 3)) : 0;
    if (by === 0) return;
    const before = pane.scrollTop;
    pane.scrollTop += by;
    if (pane.scrollTop === before) return;
    select();
    frame = requestAnimationFrame(scroll);
  };
  const onMove = (e: MouseEvent) => {
    x = e.clientX;
    y = e.clientY;
    select();
    if (!frame) frame = requestAnimationFrame(scroll);
  };
  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp, true);
    if (frame) cancelAnimationFrame(frame);
  };
  window.addEventListener("mousemove", onMove);
  // Capture: the selection is whole before the reader's mouseup reads it.
  window.addEventListener("mouseup", onUp, true);
}

import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { dropPoint } from "@tiptap/pm/transform";
import type { EditorView } from "@tiptap/pm/view";
import { isSuggesting } from "@/components/docs/ext/suggest";
import { DropLine } from "@/components/docs/typing/drop";
import { IMAGE_ROW_ITEMS, MAX_IMAGE_ROW_ITEMS } from "@/lib/docs/schema";

// An image row (SPEC.md §29): two to four images or figure objects on one
// line of the page, side by side, as Google Docs draws in-line images that
// share a line. The row runs across the text's width with 6 pt between its
// items; each item keeps its ratio, and when their widths together pass the
// text's width they all scale down by one factor (css/insert.css). The items
// stand on the row's bottom, and the row takes its alignment (left by
// default). Each image keeps its own frame, handles, crop, border, and menu.
//
// A row is made by dropping an image or a figure object on the left or the
// right third of another (an upright drop line shows where), or with Side by
// side with next image; Separate images takes it apart, an item dragged out
// of it lands as a block, and a row left with one item is that item again.
// Each is one undo step. The items keep their nodes, so each keeps its block
// id and its paragraph index row (lib/docs/blocks.ts). In Suggesting mode a
// row is neither made nor taken apart: a drop moves the image as any drop
// does, and the menu items stay off.

export const IMAGE_ROW = "imageRow";

/** An image or a figure object the page holds, and its position. */
export type RowItem = { node: PMNode; pos: number };

/** An item an image row takes: a figure object, or an image in the text's
    flow (a Behind text or In front of text image floats over the page). */
export function rowable(node: PMNode | null | undefined): node is PMNode {
  if (!node || !IMAGE_ROW_ITEMS.has(node.type.name)) return false;
  return node.type.name !== "image" || (node.attrs.wrap !== "behind" && node.attrs.wrap !== "front");
}

/** The image or figure object the selection holds, if it holds one. */
export function selectedItem(state: EditorState): RowItem | null {
  const sel = state.selection;
  return sel instanceof NodeSelection && rowable(sel.node) ? { node: sel.node, pos: sel.from } : null;
}

/** The image row that holds the node at `pos`, or null. */
export function rowOf(doc: PMNode, pos: number): RowItem | null {
  const $pos = doc.resolve(pos);
  return $pos.parent.type.name === IMAGE_ROW ? { node: $pos.parent, pos: $pos.before() } : null;
}

/** What an item stands in on its line: its image row, or itself. */
function unitOf(doc: PMNode, item: RowItem): RowItem {
  return rowOf(doc, item.pos) ?? item;
}

/** The items a line holds: an image row's, each with the suggestion marks
    the row carries (a row added as a suggestion adds each of them), or the
    one item. */
function itemsOf(unit: RowItem): PMNode[] {
  if (unit.node.type.name !== IMAGE_ROW) return [unit.node];
  const items: PMNode[] = [];
  unit.node.forEach((item) => items.push(item.mark(unit.node.marks.reduce((set, mark) => mark.addToSet(set), item.marks))));
  return items;
}

/** The block after an item's line that Side by side with next image would
    join it to: an image, a figure object, or an image row, while the items
    together are four at most. Null unless the item is the last on its line. */
export function nextToJoin(doc: PMNode, pos: number): RowItem | null {
  const node = doc.nodeAt(pos);
  if (!rowable(node)) return null;
  const unit = unitOf(doc, { node, pos });
  if (unit.pos !== pos && pos + node.nodeSize !== unit.pos + unit.node.nodeSize - 1) return null;
  const after = unit.pos + unit.node.nodeSize;
  const next = doc.resolve(after).nodeAfter;
  if (!next) return null;
  const count = next.type.name === IMAGE_ROW ? next.childCount : rowable(next) ? 1 : 0;
  if (count === 0 || itemsOf(unit).length + count > MAX_IMAGE_ROW_ITEMS) return null;
  return { node: next, pos: after };
}

/** The alignment a new row takes: an image row's own, else an image's. */
function alignOf(node: PMNode): string | null {
  const align: unknown = node.type.name === IMAGE_ROW ? node.attrs.textAlign : node.type.name === "image" ? node.attrs.align : null;
  return align === "center" || align === "right" ? align : null;
}

/** The position of the `index`th node in `items`, laid from `start`. */
function offsetOf(items: readonly PMNode[], index: number, start: number): number {
  let at = start;
  for (let i = 0; i < index; i++) at += items[i].nodeSize;
  return at;
}

/** Dispatch `tr` as its own undo step, `pos` selected. */
function commit(view: EditorView, tr: Transaction, pos: number): void {
  closeHistory(tr);
  tr.setSelection(NodeSelection.create(tr.doc, pos));
  view.dispatch(tr.scrollIntoView());
}

/** Side by side with next image: the item's line (the item, or its image
    row) and the block after it become one image row. */
export function sideBySideWithNext(view: EditorView, pos: number): boolean {
  const { state } = view;
  const node = state.doc.nodeAt(pos);
  const next = nextToJoin(state.doc, pos);
  if (!node || !next) return false;
  const unit = unitOf(state.doc, { node, pos });
  const items = [...itemsOf(unit), ...itemsOf(next)];
  const row = state.schema.nodes[IMAGE_ROW].create({ textAlign: alignOf(unit.node) }, items);
  const tr = state.tr.replaceWith(unit.pos, next.pos + next.node.nodeSize, row);
  const index = unit.pos === pos ? 0 : state.doc.resolve(pos).index();
  commit(view, tr, offsetOf(items, index, unit.pos + 1));
  return true;
}

/** Separate images: the image row that holds the item becomes its items,
    in order, each a block of its own. */
export function separateImages(view: EditorView, pos: number): boolean {
  const { state } = view;
  const row = rowOf(state.doc, pos);
  if (!row) return false;
  const items = itemsOf(row);
  const tr = state.tr.replaceWith(row.pos, row.pos + row.node.nodeSize, Fragment.from(items));
  commit(view, tr, offsetOf(items, state.doc.resolve(pos).index(), row.pos));
  return true;
}

export type Side = "left" | "right";

/** The dragged item joins the target on its `side`: in the target's image
    row, or in a new row with it. The dragged node itself moves, so it keeps
    its block id. */
export function joinBeside(view: EditorView, dragged: RowItem, target: RowItem, side: Side): void {
  const { state } = view;
  const tr = state.tr;
  // Taken out the way the page's own drop takes a dragged node out: a list
  // item or a quote left empty goes with it.
  NodeSelection.create(state.doc, dragged.pos).replace(tr);
  const at = tr.mapping.map(target.pos);
  const targetNode = tr.doc.nodeAt(at);
  if (!targetNode) return;
  if (tr.doc.resolve(at).parent.type.name === IMAGE_ROW) {
    const place = side === "left" ? at : at + targetNode.nodeSize;
    tr.insert(place, dragged.node);
    commit(view, tr.setMeta("uiEvent", "drop"), place);
    return;
  }
  const items = side === "left" ? [dragged.node, targetNode] : [targetNode, dragged.node];
  tr.replaceWith(at, at + targetNode.nodeSize, state.schema.nodes[IMAGE_ROW].create({ textAlign: alignOf(targetNode) }, items));
  commit(view, tr.setMeta("uiEvent", "drop"), offsetOf(items, side === "left" ? 0 : 1, at + 1));
}

/** A dragged image or figure object let go elsewhere moves as the page's
    own drop moves it, but as itself: it keeps its block id, where the
    page's drop would give the copy a new one (extensions.ts BlockIds). Out
    of an image row it lands as a block. */
function moveByDrop(view: EditorView, dragged: RowItem, event: DragEvent): boolean {
  const { state } = view;
  const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!at) return false;
  const slice = new Slice(Fragment.from(dragged.node), 0, 0);
  const drop = dropPoint(state.doc, at.pos, slice) ?? at.pos;
  // Let go on itself: nothing moves.
  if (drop >= dragged.pos && drop <= dragged.pos + dragged.node.nodeSize) return true;
  const tr = state.tr;
  NodeSelection.create(state.doc, dragged.pos).replace(tr);
  const pos = tr.mapping.map(drop);
  const before = tr.doc;
  tr.replaceRangeWith(pos, pos, dragged.node);
  if (tr.doc.eq(before)) return false;
  // replaceRangeWith may put the node a step outside `pos`: find it there.
  const $pos = tr.doc.resolve(pos);
  const landed = $pos.nodeAfter?.eq(dragged.node) ? pos : $pos.nodeBefore?.eq(dragged.node) ? pos - dragged.node.nodeSize : null;
  closeHistory(tr);
  if (landed !== null) tr.setSelection(NodeSelection.create(tr.doc, landed));
  view.focus();
  view.dispatch(tr.setMeta("uiEvent", "drop"));
  return true;
}

/** The image or figure object the page's own drag carries, if the drag
    moves one alone. */
function draggedItem(view: EditorView): RowItem | null {
  const dragging = view.dragging as { slice: Slice; move: boolean; node?: NodeSelection } | null;
  if (!dragging || dragging.slice.content.childCount !== 1) return null;
  const sel = dragging.node ?? (view.state.selection instanceof NodeSelection ? view.state.selection : null);
  if (!sel || !rowable(sel.node) || dragging.slice.content.firstChild?.type !== sel.node.type) return null;
  return { node: sel.node, pos: sel.from };
}

/** The drawn box of an item: an image's frame box, a figure's own. */
function boxOf(view: EditorView, pos: number): DOMRect | null {
  const dom = view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return null;
  const box = dom.querySelector(".docs-img-box") ?? dom.querySelector(".reader-figure") ?? dom;
  return box.getBoundingClientRect();
}

type SideDrop = { target: RowItem; side: Side; box: DOMRect };

/** The item under the pointer and the third of it the pointer is on, when
    a drop there would put the dragged item beside it: its left or right
    third, and room in its image row (a fifth item never joins). */
function sideDropAt(view: EditorView, dragged: RowItem, x: number, y: number): SideDrop | null {
  const hit = view.posAtCoords({ left: x, top: y });
  if (!hit || hit.inside < 0) return null;
  const node = view.state.doc.nodeAt(hit.inside);
  if (!rowable(node) || hit.inside === dragged.pos) return null;
  const box = boxOf(view, hit.inside);
  if (!box || box.width <= 0) return null;
  const side: Side | null = x < box.left + box.width / 3 ? "left" : x > box.right - box.width / 3 ? "right" : null;
  if (!side) return null;
  const row = rowOf(view.state.doc, hit.inside);
  const sameRow = row !== null && rowOf(view.state.doc, dragged.pos)?.pos === row.pos;
  if (row && !sameRow && row.node.childCount >= MAX_IMAGE_ROW_ITEMS) return null;
  return { target: { node, pos: hit.inside }, side, box };
}

/** Whether the page takes rows now: a page that takes edits, outside
    Suggesting mode. */
const takesRows = (editor: Editor) => editor.isEditable && !isSuggesting(editor);

/** While a side drop is on offer the page's own drop caret steps aside
    (css/insert.css). */
const SIDE_DROP_CLASS = "docs-side-drop";

function rowPlugins(editor: Editor): Plugin[] {
  const line = new DropLine();
  const clear = () => {
    line.hide();
    document.body.classList.remove(SIDE_DROP_CLASS);
  };
  return [
    new Plugin({
      key: new PluginKey("docsImageRowDrop"),
      props: {
        handleDOMEvents: {
          // A figure object moves only where rows are made: Suggesting mode
          // would suggest the move as a copy under a new block id.
          dragstart: (_view, event) => {
            if (takesRows(editor) || !(event.target instanceof Element && event.target.closest(".docs-figure"))) return false;
            event.preventDefault();
            return true;
          },
          dragover: (view, event) => {
            const dragged = takesRows(editor) ? draggedItem(view) : null;
            const drop = dragged && sideDropAt(view, dragged, event.clientX, event.clientY);
            if (!drop) {
              clear();
              return false;
            }
            // In the middle of the 6 pt between two items.
            line.upright(drop.side === "left" ? drop.box.left - 4 : drop.box.right + 4, drop.box.top, drop.box.bottom);
            document.body.classList.add(SIDE_DROP_CLASS);
            return false;
          },
          dragleave: (view, event) => {
            if (!(event.relatedTarget instanceof globalThis.Node) || !view.dom.contains(event.relatedTarget)) clear();
            return false;
          },
          dragend: () => {
            clear();
            return false;
          },
        },
        handleDrop: (view, event, _slice, moved) => {
          clear();
          const dragged = moved && takesRows(editor) ? draggedItem(view) : null;
          if (!dragged) return false;
          const drop = sideDropAt(view, dragged, event.clientX, event.clientY);
          if (drop) {
            joinBeside(view, dragged, drop.target, drop.side);
            return true;
          }
          return moveByDrop(view, dragged, event);
        },
      },
      view: () => ({ destroy: clear }),
    }),
    new Plugin({
      key: new PluginKey("docsImageRowItems"),
      // An image row left with one item is that item again, and one left
      // with none goes: in the same undo step as the change that left it.
      appendTransaction: (transactions, _old, state) => {
        if (!transactions.some((tr) => tr.docChanged)) return null;
        const lone: RowItem[] = [];
        state.doc.descendants((node, pos) => {
          if (node.type.name === IMAGE_ROW) {
            if (node.childCount < 2) lone.push({ node, pos });
            return false;
          }
          return !node.isTextblock && !node.isAtom;
        });
        if (lone.length === 0) return null;
        const tr = state.tr;
        const sel = state.selection;
        let reselect: number | null = null;
        for (const row of lone.reverse()) {
          const items = itemsOf(row);
          const inside = sel instanceof NodeSelection && sel.from > row.pos && sel.to < row.pos + row.node.nodeSize;
          tr.replaceWith(row.pos, row.pos + row.node.nodeSize, Fragment.from(items));
          if (inside && items.length > 0) reselect = row.pos;
        }
        if (reselect !== null) tr.setSelection(NodeSelection.create(tr.doc, tr.mapping.map(reselect)));
        return tr;
      },
    }),
  ];
}

export const ImageRow = Node.create({
  name: IMAGE_ROW,
  group: "block",
  // One to four: a row left with one item for a moment is that item again
  // (rowPlugins), so the page never draws a row of one.
  content: "(image | figure){1,4}",
  // The items are the row: a click selects one of them, and the row is
  // never selected or dragged as a whole (Backspace after it selects its
  // last item, typing/keys.ts).
  selectable: false,
  draggable: false,

  parseHTML() {
    return [{ tag: "div[data-image-row]" }];
  },

  // The copy a clipboard, a download, and Version history take: a flex row,
  // drawn as the page draws it in another app too.
  renderHTML({ node, HTMLAttributes }) {
    const align = node.attrs.textAlign === "center" ? "center" : node.attrs.textAlign === "right" ? "flex-end" : "flex-start";
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-image-row": "",
        class: "docs-image-row",
        style: `display: flex; align-items: flex-end; justify-content: ${align}; gap: 6pt`,
      }),
      0,
    ];
  },

  addProseMirrorPlugins() {
    return rowPlugins(this.editor);
  },
});

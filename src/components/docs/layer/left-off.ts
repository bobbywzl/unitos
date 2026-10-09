import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { scrollParent } from "@/components/docs/page/geometry";
import { readingLine } from "@/lib/reading-position";

// The left-off mark in the page editor (SPEC.md §6, §30): the block reader's
// small ribbon and faint line above the block of the reading position the
// document opened with (reader.tsx LeftOffMark), so the reader finds the
// place again after scrolling away. Its tooltip reads You left off here. It
// is drawn over the page, never written into the rich text: a widget at the
// block's start that takes no room (css/layer.css .docs-left-off), and it
// moves with the block as the text changes. It never prints.
//
// The mark shows when the document opens. The tab's copy restores the
// reader's exact place, which can leave the position's block's top under
// the header (the reader was past its first lines): the mark then stands
// above the first block whose top shows under the header, the block the
// reader reads into next. A block that runs past the pane's bottom keeps
// the mark, drawn at the reading line inside it. The scroll never moves for
// the mark (lib/reading-position.ts).

const leftOffKey = new PluginKey<DecorationSet>("docsLeftOff");

/** inside: px under the block's top where the mark is drawn; 0 above it. */
type Meta = { blockId: string | null; label: string; inside?: number };

/** How far the ribbon reaches above the block's top (css/layer.css). */
const RIBBON_ABOVE_PX = 16;

/** Where the block with this id starts its words: a paragraph's, a heading's,
    a list line's, a cell's; null when the page has no such block. */
function blockStart(doc: PMNode, blockId: string): number | null {
  let at: number | null = null;
  doc.descendants((node, pos) => {
    if (at !== null) return false;
    if (node.isTextblock) {
      if (node.attrs.blockId === blockId) at = pos;
      return false;
    }
    return true;
  });
  return at;
}

function markDom(label: string, inside = 0): HTMLElement {
  const mark = document.createElement("span");
  mark.className = "docs-left-off";
  if (inside > 0) mark.style.top = `${inside}px`;
  mark.contentEditable = "false";
  mark.dataset.anchorSkip = "";
  mark.dataset.leftOff = "";
  const line = document.createElement("span");
  line.className = "docs-left-off-line";
  line.setAttribute("aria-hidden", "true");
  const ribbon = document.createElement("span");
  ribbon.className = "docs-left-off-ribbon";
  ribbon.setAttribute("role", "img");
  ribbon.setAttribute("aria-label", label);
  ribbon.dataset.tip = label;
  ribbon.innerHTML =
    '<svg aria-hidden="true" width="10" height="13" viewBox="0 0 10 13"><path d="M1 0h8a1 1 0 0 1 1 1v12l-5-3.2L0 13V1a1 1 0 0 1 1-1z" fill="currentColor"/></svg>';
  mark.append(line, ribbon);
  return mark;
}

function decorationsFor(doc: PMNode, meta: Meta): DecorationSet {
  const at = meta.blockId ? blockStart(doc, meta.blockId) : null;
  if (at === null) return DecorationSet.empty;
  const node = doc.nodeAt(at);
  if (!node) return DecorationSet.empty;
  return DecorationSet.create(doc, [
    Decoration.node(at, at + node.nodeSize, { class: "docs-left-off-block" }),
    Decoration.widget(at + 1, () => markDom(meta.label, meta.inside), {
      key: `left-off:${meta.blockId}:${meta.inside ?? 0}`,
      side: -1,
      ignoreSelection: true,
      stopEvent: () => true,
    }),
  ]);
}

function leftOffPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: leftOffKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, set) => {
        const meta = tr.getMeta(leftOffKey) as Meta | undefined;
        if (meta) return decorationsFor(tr.doc, meta);
        return tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
      },
    },
    props: { decorations: (state) => leftOffKey.getState(state) },
  });
}

/** Where the mark shows, with the pane at the position the document opened
    at: above the block when its top shows under the header; else above the
    first block after it whose top shows; else, the block running past the
    pane's bottom, inside it at the reading line. Null: keep it where it is. */
function placeInView(editor: Editor, blockId: string): Pick<Meta, "blockId" | "inside"> | null {
  const { view, state } = editor;
  const pane = scrollParent(view.dom);
  const at = blockStart(state.doc, blockId);
  const own = at === null ? null : view.nodeDOM(at);
  if (!pane || !(own instanceof HTMLElement)) return null;
  const paneRect = pane.getBoundingClientRect();
  const header = view.dom.closest("[data-docs-editor]")?.querySelector(".docs-header");
  const shows = (header ? header.getBoundingClientRect().bottom : paneRect.top) + RIBBON_ABOVE_PX;
  const top = own.getBoundingClientRect().top;
  if (top >= shows) return null;
  let next: Pick<Meta, "blockId" | "inside"> | null = null;
  state.doc.descendants((node, pos) => {
    if (next || pos <= (at ?? 0)) return !next;
    if (!node.isTextblock) return true;
    const dom = view.nodeDOM(pos);
    const id: unknown = node.attrs.blockId;
    // A unit the collapsed view stands in for draws no box.
    if (typeof id !== "string" || !(dom instanceof HTMLElement) || dom.getClientRects().length === 0) return false;
    const blockTop = dom.getBoundingClientRect().top;
    if (blockTop >= shows) next = blockTop < paneRect.bottom - RIBBON_ABOVE_PX ? { blockId: id } : { blockId, inside: Math.round(paneRect.top + readingLine(pane) - top) };
    return false;
  });
  return next;
}

/** Draws the mark above the block, or takes it away (null), and moves it
    into view once the pane stands at the position (placeInView). Returns
    the cleanup that takes the plugin off the editor. */
export function showLeftOff(editor: Editor, blockId: string | null, label: string): () => void {
  if (!leftOffKey.getState(editor.state)) editor.registerPlugin(leftOffPlugin());
  const draw = (meta: Meta) => editor.view.dispatch(editor.state.tr.setMeta(leftOffKey, meta).setMeta("addToHistory", false));
  draw({ blockId, label });
  // The pane is scrolled to the position before the mark is asked for
  // (reader-interactions.tsx); the frame after, the page has laid it out.
  const frame = blockId
    ? requestAnimationFrame(() => {
        if (editor.isDestroyed) return;
        const placed = placeInView(editor, blockId);
        if (placed) draw({ ...placed, label });
      })
    : 0;
  return () => {
    cancelAnimationFrame(frame);
    if (!editor.isDestroyed) editor.unregisterPlugin(leftOffKey);
  };
}

import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import type { SourceInput } from "@/lib/anchors/input";
import { inlineText, outOfIndex } from "@/lib/docs/blocks";
import { ZWSP, type RichNode } from "@/lib/docs/schema";

// Anchors in the page editor (SPEC.md §5, §29): one segment per paragraph,
// offsets in the paragraph's words as lib/docs/blocks.ts derives them. They
// are read from the editor's document: the DOM's <br>s, chips, and mark
// widgets would shift the offsets. Type imports only: the reader loads this
// for every document.

type PageSegment = Omit<SourceInput, "documentId" | "layer">;

const CONTEXT = 32;

/** The page editor inside a reader pane (Tiptap keeps it on its DOM). */
export function pageEditorIn(container: Element | null): Editor | null {
  const dom = container?.querySelector<HTMLElement & { editor?: Editor }>("[data-docs-body]");
  return dom?.editor && !dom.editor.isDestroyed ? dom.editor : null;
}

function inlineLength(node: PMNode): number {
  return inlineText(node.toJSON() as RichNode).length;
}

/** The offset in its paragraph's words of a position in the paragraph
    (blockPos is the position before it). */
function offsetInBlock(block: PMNode, blockPos: number, pos: number): number {
  let offset = 0;
  let at = blockPos + 1;
  for (let i = 0; i < block.childCount && at < pos; i++) {
    const child = block.child(i);
    if (child.isText && pos < at + child.nodeSize) return offset + inlineLength(child.cut(0, pos - at));
    offset += inlineLength(child);
    at += child.nodeSize;
  }
  return offset;
}

/** The position of an offset in a paragraph's words; inside a chip, after
    it. Where the offset falls on what counts no words (a word the index
    leaves out, a zero-width space), a start goes past it and an end stops
    before it. */
export function posInBlock(block: PMNode, blockPos: number, offset: number, end = false): number {
  let left = offset;
  let pos = blockPos + 1;
  for (let i = 0; i < block.childCount; i++) {
    const child = block.child(i);
    const length = inlineLength(child);
    if (end && left === 0) return pos;
    if (child.isText && length > 0) {
      const chars = child.text ?? "";
      for (let j = 0; j < chars.length; j++) {
        if (chars[j] === ZWSP) continue;
        if (left === 0) return pos + j;
        left--;
        if (end && left === 0) return pos + j + 1;
      }
    } else if (left < length) {
      return left === 0 ? pos : pos + child.nodeSize;
    } else {
      left -= length;
    }
    pos += child.nodeSize;
  }
  return pos;
}

/** The paragraph with this blockId and the position before it. */
export function findBlock(doc: PMNode, blockId: string): { node: PMNode; pos: number } | null {
  const found = findIndexed(doc, blockId);
  return found?.node.isTextblock ? found : null;
}

/** The node with this blockId — a paragraph, or an object on its own line:
    a figure, an image, an equation, a line — and the position before it. */
export function findIndexed(doc: PMNode, blockId: string): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.attrs.blockId === blockId && (node.isTextblock || node.isAtom)) found = { node, pos };
    return !node.isTextblock && !node.isAtom;
  });
  return found;
}

/** A page start (SPEC.md §29): an inline atom where a page of the PDF
    begins. It holds no words: a passage, a mark, and a change pass over it. */
export const PAGE_START = "pageStart";

/** from..to less the page starts in it: the stretches of words around them.
    A mark paints them and a change takes them; the page start keeps its
    place and its own look. */
export function aroundPageStarts(doc: PMNode, from: number, to: number): [number, number][] {
  const pieces: [number, number][] = [];
  let start = from;
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== PAGE_START || pos < from) return true;
    if (pos > start) pieces.push([start, pos]);
    start = pos + node.nodeSize;
    return false;
  });
  if (to > start) pieces.push([start, to]);
  return pieces;
}
/** A figure object: an import's figure, its media and its caption drawn
    whole, on a line of its own. */
export const FIGURE = "figure";

/** Images, figure objects, and equations hold no words to quote: a passage
    leaves them out. */
const LEFT_OUT = new Set(["image", FIGURE, "blockMath"]);

/** One segment per paragraph between two positions; whitespace takes none. */
function segmentsBetween(doc: PMNode, from: number, to: number): { segments: PageSegment[]; truncated: boolean } {
  const segments: PageSegment[] = [];
  let truncated = false;
  doc.nodesBetween(from, to, (node, pos) => {
    // A block a person's suggestion removes, or the assistant's adds, has no words to quote.
    if (node.marks.some((m) => outOfIndex(m.type.name, m.attrs.id))) return false;
    if (LEFT_OUT.has(node.type.name)) truncated = true;
    if (!node.isTextblock) return true;
    const blockId = node.attrs.blockId;
    if (typeof blockId !== "string" || !blockId) return false;
    const start = offsetInBlock(node, pos, Math.max(from, pos + 1));
    const end = offsetInBlock(node, pos, Math.min(to, pos + node.nodeSize - 1));
    const text = inlineText(node.toJSON() as RichNode);
    const quotedText = text.slice(start, end);
    if (!quotedText.trim()) return false;
    segments.push({
      blockId,
      startOffset: start,
      endOffset: end,
      quotedText,
      prefix: text.slice(Math.max(0, start - CONTEXT), start),
      suffix: text.slice(end, end + CONTEXT),
    });
    return false;
  });
  return { segments, truncated };
}

/** A DOM boundary as a position; the fallback when it is outside the text (a
    drag that began in the page's margin). */
function positionOf(view: EditorView, node: Node, offset: number, fallback: number): number {
  if (!view.dom.contains(node)) return fallback;
  try {
    return view.posAtDOM(node, offset);
  } catch {
    return fallback;
  }
}

/** The passage a DOM range selects in the page editor; null when the range is
    not in its text. */
export function pageSelectionOfRange(editor: Editor, range: Range) {
  const { view, state } = editor;
  if (!view.dom.contains(range.startContainer) && !view.dom.contains(range.endContainer)) return null;
  const from = positionOf(view, range.startContainer, range.startOffset, state.selection.from);
  const to = positionOf(view, range.endContainer, range.endOffset, state.selection.to);
  return segmentsBetween(state.doc, Math.min(from, to), Math.max(from, to));
}

/** The word the caret stands in or touches (Add comment with no selection, as
    in Google Docs); the language's own word breaks, for Chinese too. */
export function wordAtCaret(editor: Editor): { from: number; to: number } | null {
  const { selection } = editor.state;
  const $pos = selection.$from;
  if (!selection.empty || !$pos.parent.isTextblock) return null;
  const block = $pos.parent;
  const blockPos = $pos.before();
  const offset = offsetInBlock(block, blockPos, $pos.pos);
  let word: { start: number; end: number } | null = null;
  const text = inlineText(block.toJSON() as RichNode);
  for (const part of new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)) {
    const end = part.index + part.segment.length;
    if (!part.isWordLike || end < offset || part.index > offset) continue;
    word = { start: part.index, end };
    if (offset < end) break;
  }
  return word && { from: posInBlock(block, blockPos, word.start), to: posInBlock(block, blockPos, word.end, true) };
}

import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import type { SourceInput } from "@/lib/anchors/input";
import { inlineText } from "@/lib/docs/blocks";
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
    it. Where the offset falls on what counts no words (a removed word, a
    zero-width space), a start goes past it and an end stops before it. */
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
  let found: { node: PMNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.isTextblock && node.attrs.blockId === blockId) found = { node, pos };
    return !node.isTextblock;
  });
  return found;
}

/** Images and equations hold no words to quote: a passage leaves them out. */
const LEFT_OUT = new Set(["image", "blockMath"]);

/** One segment per paragraph between two positions; whitespace takes none. */
function segmentsBetween(doc: PMNode, from: number, to: number): { segments: PageSegment[]; truncated: boolean } {
  const segments: PageSegment[] = [];
  let truncated = false;
  doc.nodesBetween(from, to, (node, pos) => {
    // A block a suggestion removes has no words to quote.
    if (node.marks.some((m) => m.type.name === "deletion")) return false;
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

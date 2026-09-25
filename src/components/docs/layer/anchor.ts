import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { inlineText } from "@/lib/docs/blocks";
import type { RichNode } from "@/lib/docs/schema";

// Anchors in the page editor (SPEC.md §5, §29). A selection is one segment
// per paragraph it touches, each the paragraph's blockId and offsets in its
// words exactly as the paragraph index derives them (lib/docs/blocks.ts
// inlineText). They are read from the editor's document, not from the DOM:
// a line break draws as <br>, a chip draws its own text, and a mark's chip
// is a widget — counted from the DOM, each would shift every offset after it.
// Type imports only: the reader loads this module for every document, and
// the editor library stays in the page editor's own bundle.

export type PageSegment = {
  blockId: string;
  startOffset: number;
  endOffset: number;
  quotedText: string;
  prefix: string;
  suffix: string;
};

/** Prefix and suffix length (SPEC.md §5). */
const CONTEXT = 32;

/** The page editor's editor, found from its DOM (Tiptap keeps the instance on
    the editable element). */
export function pageEditorOf(el: Element | null): Editor | null {
  const dom = el?.closest<HTMLElement & { editor?: Editor }>("[data-docs-body]");
  const editor = dom?.editor;
  return editor && !editor.isDestroyed ? editor : null;
}

/** The page editor inside a reader pane, if the pane shows a blank document. */
export function pageEditorIn(container: Element | null): Editor | null {
  return pageEditorOf(container?.querySelector("[data-docs-body]") ?? null);
}

/** Characters one inline node adds to its paragraph's words. */
function inlineLength(node: PMNode): number {
  if (node.isText) return node.text?.length ?? 0;
  if (node.type.name === "hardBreak") return 1;
  return inlineText(node.toJSON() as RichNode).length;
}

/** A paragraph's words, as its Block row holds them. */
export function blockWords(block: PMNode): string {
  return inlineText(block.toJSON() as RichNode);
}

/** The offset in its paragraph's words of a position inside the paragraph
    (blockPos is the position before the paragraph). */
export function offsetInBlock(block: PMNode, blockPos: number, pos: number): number {
  let offset = 0;
  let at = blockPos + 1;
  for (let i = 0; i < block.childCount && at < pos; i++) {
    const child = block.child(i);
    if (child.isText && pos < at + child.nodeSize) return offset + (pos - at);
    offset += inlineLength(child);
    at += child.nodeSize;
  }
  return offset;
}

/** The document position of an offset in a paragraph's words. An offset
    inside a chip lands after it. */
export function posInBlock(block: PMNode, blockPos: number, offset: number): number {
  let text = 0;
  let pos = blockPos + 1;
  for (let i = 0; i < block.childCount; i++) {
    const child = block.child(i);
    const length = inlineLength(child);
    if (offset <= text + length) {
      if (child.isText) return pos + (offset - text);
      return offset === text ? pos : pos + child.nodeSize;
    }
    text += length;
    pos += child.nodeSize;
  }
  return pos;
}

/** The paragraph with this blockId and the position before it. */
export function findBlock(doc: PMNode, blockId: string): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.isTextblock && node.attrs.blockId === blockId) {
      found = { node, pos };
      return false;
    }
    return !node.isTextblock;
  });
  return found;
}

/** One segment per paragraph between two document positions, in reading
    order; a paragraph whose part is only whitespace takes none. */
export function segmentsBetween(doc: PMNode, from: number, to: number): PageSegment[] {
  const segments: PageSegment[] = [];
  if (to <= from) return segments;
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    const blockId = node.attrs.blockId;
    if (typeof blockId !== "string" || !blockId) return false;
    const start = offsetInBlock(node, pos, Math.max(from, pos + 1));
    const end = offsetInBlock(node, pos, Math.min(to, pos + node.nodeSize - 1));
    if (end <= start) return false;
    const text = blockWords(node);
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
  return segments;
}

/** A DOM boundary as a document position; the fallback when the boundary is
    outside the editor's text (a drag that began in the page's margin). */
function positionOf(view: EditorView, node: Node, offset: number, fallback: number): number {
  if (!view.dom.contains(node)) return fallback;
  try {
    return view.posAtDOM(node, offset);
  } catch {
    return fallback;
  }
}

/** The passage a DOM range selects in the page editor: its segments, one per
    paragraph. Null when the range is not in this editor's text. */
export function pageSegmentsOfRange(editor: Editor, range: Range): PageSegment[] | null {
  const { view, state } = editor;
  if (!view.dom.contains(range.startContainer) && !view.dom.contains(range.endContainer)) return null;
  const from = positionOf(view, range.startContainer, range.startOffset, state.selection.from);
  const to = positionOf(view, range.endContainer, range.endOffset, state.selection.to);
  return segmentsBetween(state.doc, Math.min(from, to), Math.max(from, to));
}

const WORD = /[\p{L}\p{N}\p{M}_'’-]/u;

/** The word the caret stands in or touches, as document positions — the words
    Add comment takes with no selection, as in Google Docs. Null when the
    selection is not a caret or the caret is not at a word. */
export function wordAtCaret(editor: Editor): { from: number; to: number } | null {
  const { selection } = editor.state;
  const $pos = selection.$from;
  if (!selection.empty || !$pos.parent.isTextblock) return null;
  const block = $pos.parent;
  const blockPos = $pos.before();
  const text = blockWords(block);
  const offset = offsetInBlock(block, blockPos, $pos.pos);
  let start = offset;
  let end = offset;
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Segmenter) {
    // The language's own word breaks: Chinese has no spaces between words.
    for (const part of new Segmenter(undefined, { granularity: "word" }).segment(text)) {
      const partEnd = part.index + part.segment.length;
      if (!part.isWordLike || partEnd < offset || part.index > offset) continue;
      start = part.index;
      end = partEnd;
      if (offset < partEnd) break;
    }
  } else {
    while (start > 0 && WORD.test(text[start - 1])) start--;
    while (end < text.length && WORD.test(text[end])) end++;
  }
  if (end <= start) return null;
  return { from: posInBlock(block, blockPos, start), to: posInBlock(block, blockPos, end) };
}

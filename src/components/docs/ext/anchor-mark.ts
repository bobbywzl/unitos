import { Mark, mergeAttributes, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import type { Slice } from "@tiptap/pm/model";
import { findBlock, offsetInBlock, posInBlock } from "@/components/docs/layer/anchor";
import type { Highlight } from "@/components/reader/block-view";
import { ANCHOR_ID_ATTR, ANCHOR_MARK } from "@/lib/docs/schema";

// An annotation's anchor mark (SPEC.md §5): the mark on the words an
// annotation quotes, carrying the Source's id. Google Docs keeps a
// comment's anchor on its words through a cut and a paste; this mark does
// the same for every highlight, comment, note quote, and AI annotation. A
// cut takes the words and the mark; a paste puts them back, and the save
// places the Source by the mark (lib/docs/sync.ts). The mark draws
// nothing: the Unitos layer paints the annotation (annotation-marks.tsx),
// at the mark where there is one.

export const AnchorMark = Mark.create({
  name: ANCHOR_MARK,
  // Typing at an anchor's end stays outside it; typing inside grows it.
  inclusive: false,
  // Two annotations may cover the same words.
  excludes: "",

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute(ANCHOR_ID_ATTR),
        renderHTML: (attrs) => (attrs.id ? { [ANCHOR_ID_ATTR]: String(attrs.id) } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: `span[${ANCHOR_ID_ATTR}]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "docs-anchor" }), 0];
  },
});

/** An anchor mark's span: the paragraph, the offsets in its words, and the
    positions in the document. */
export type AnchorRange = { blockId: string; start: number; end: number; from: number; to: number };

const idsOf = (node: PMNode): string[] => node.marks.flatMap((m) => (m.type.name === ANCHOR_MARK && typeof m.attrs.id === "string" ? [m.attrs.id] : []));

/** Every anchor mark's spans, by the Source's id: one span per run of
    marked words in a paragraph (a chip or an inline equation inside the
    run keeps it one, as the paragraph index reads it). */
export function anchorRanges(doc: PMNode): Map<string, AnchorRange[]> {
  const out = new Map<string, AnchorRange[]>();
  doc.descendants((block, blockPos) => {
    if (!block.isTextblock) return true;
    const blockId = block.attrs.blockId;
    if (typeof blockId !== "string" || !blockId) return false;
    const open = new Map<string, number>();
    let at = blockPos + 1;
    const close = (id: string, from: number) => {
      const start = offsetInBlock(block, blockPos, from);
      const end = offsetInBlock(block, blockPos, at);
      if (end > start) (out.get(id) ?? out.set(id, []).get(id)!).push({ blockId, start, end, from, to: at });
    };
    for (let i = 0; i < block.childCount; i++) {
      const child = block.child(i);
      if (child.isText) {
        const ids = new Set(idsOf(child));
        for (const [id, from] of [...open]) {
          if (ids.has(id)) continue;
          close(id, from);
          open.delete(id);
        }
        for (const id of ids) if (!open.has(id)) open.set(id, at);
      }
      at += child.nodeSize;
    }
    for (const [id, from] of open) close(id, from);
    return false;
  });
  return out;
}

/** The span an anchor's marks place it on: the longest, the first of
    equals (lib/docs/sync.ts placeByMark). */
export function markedSpan(ranges: AnchorRange[]): AnchorRange {
  return ranges.reduce((best, r) => (r.end - r.start > best.end - best.start ? r : best));
}

/** The highlights as the marks place them: a highlight whose Source has
    an anchor mark paints at the mark, wherever its words went (a paste put
    them in another paragraph), and the rest paint where the stored anchor
    says. An orphan paints only at a mark: its words are back. */
export function followMarks(doc: PMNode, highlights: Record<string, Highlight[]>): Record<string, Highlight[]> {
  const ranges = anchorRanges(doc);
  const out: Record<string, Highlight[]> = {};
  for (const [blockId, list] of Object.entries(highlights)) {
    for (const h of list) {
      const marked = h.sourceId ? ranges.get(h.sourceId) : undefined;
      if (!marked) {
        if (!h.orphaned) (out[blockId] ??= []).push(h);
        continue;
      }
      const span = markedSpan(marked);
      (out[span.blockId] ??= []).push({ ...h, start: span.start, end: span.end, orphaned: false });
    }
  }
  return out;
}

/** Whether the change put marked words into the document: a paste, a
    drop, or an undo that brings a cut back (the layer paints their
    annotations again). */
export function insertsAnchorMarks(tr: Transaction): boolean {
  return tr.steps.some((step) => {
    const slice = (step as { slice?: Slice }).slice;
    if (!slice || slice.content.size === 0) return false;
    let found = false;
    slice.content.descendants((node) => {
      if (found) return false;
      if (node.isText && idsOf(node).length > 0) found = true;
      return !found;
    });
    return found;
  });
}

/** The marks brought in line with the painted annotations: every painted
    highlight with a Source gets its mark where it lacks one, and a mark
    whose Source no annotation holds any more (deleted, or another
    document's, pasted in) goes. Null when nothing changes. Run on the
    stored copy's paint alone: a mark an annotation lost with a cut stays
    until the save finds its words gone. */
export function anchorMarksTransaction(editor: Editor, highlights: Record<string, Highlight[]>, painted: (h: Highlight) => boolean): Transaction | null {
  const { state } = editor;
  const type = state.schema.marks[ANCHOR_MARK];
  if (!type) return null;
  const tr = state.tr;
  const wanted = new Set<string>();
  for (const [blockId, list] of Object.entries(highlights)) {
    const block = findBlock(state.doc, blockId);
    for (const h of list) {
      if (!h.sourceId || !painted(h) || h.end <= h.start) continue;
      wanted.add(h.sourceId);
      // An orphan's words are gone: no mark to add, and one that stands
      // (its words pasted back) stays for the save.
      if (!block || h.orphaned) continue;
      const from = posInBlock(block.node, block.pos, h.start);
      const to = posInBlock(block.node, block.pos, h.end, true);
      if (to <= from) continue;
      let covered = true;
      state.doc.nodesBetween(from, to, (node) => {
        if (node.isText && !idsOf(node).includes(h.sourceId!)) covered = false;
        return covered;
      });
      if (!covered) tr.addMark(from, to, type.create({ id: h.sourceId }));
    }
  }
  state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    for (const mark of node.marks) {
      if (mark.type !== type || wanted.has(String(mark.attrs.id))) continue;
      tr.removeMark(pos, pos + node.nodeSize, mark);
    }
    return false;
  });
  return tr.docChanged ? tr.setMeta("addToHistory", false).setMeta("anchorMarks", true) : null;
}

import { Extension, Node, type Editor } from "@tiptap/core";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { Plugin, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { newBlockId } from "@/lib/docs/schema";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// Footnotes (SPEC.md §29), as Google Docs numbers them: the number is an
// inline atom (footnoteReference), the words are paragraphs in the footnotes
// block at the document's end, in the numbers' order. The numbers are
// drawn, not stored; deleting a number deletes its footnote.

const FootnoteReference = Node.create({
  name: "footnoteReference",
  group: "inline",
  inline: true,
  atom: true,
  // A click beside the number puts the caret there: selected, the number
  // (and its footnote) would go with the next key typed.
  selectable: false,
  addAttributes() {
    return {
      footnoteId: { default: null, parseHTML: (el) => el.getAttribute("data-footnote-ref"), rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: "sup[data-footnote-ref]" }];
  },
  renderHTML({ node }) {
    return [
      "sup",
      { "data-footnote-ref": String(node.attrs.footnoteId ?? ""), class: "docs-footnote-ref", "data-anchor-skip": "" },
    ];
  },
});

const Footnotes = Node.create({
  name: "footnotes",
  group: "block",
  content: "footnote+",
  isolating: true,
  selectable: false,
  draggable: false,
  parseHTML() {
    return [{ tag: "div[data-footnotes]" }];
  },
  renderHTML() {
    return ["div", { "data-footnotes": "", class: "docs-footnotes" }, 0];
  },
});

const Footnote = Node.create({
  name: "footnote",
  content: "paragraph+",
  isolating: true,
  defining: true,
  selectable: false,
  draggable: false,
  addAttributes() {
    return {
      footnoteId: { default: null, parseHTML: (el) => el.getAttribute("data-footnote"), rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-footnote]" }];
  },
  renderHTML({ node }) {
    return ["div", { "data-footnote": String(node.attrs.footnoteId ?? ""), class: "docs-footnote" }, 0];
  },
});

type Refs = { ids: string[]; duplicates: { pos: number; id: string }[] };

function referencesOf(doc: PMNode): Refs {
  const ids: string[] = [];
  const duplicates: { pos: number; id: string }[] = [];
  const seen = new Set<string>();
  doc.descendants((node, pos) => {
    if (node.type.name === "footnotes") return false;
    if (node.type.name !== "footnoteReference") return true;
    const id = node.attrs.footnoteId as string | null;
    if (!id || seen.has(id)) duplicates.push({ pos, id: id ?? "" });
    else {
      seen.add(id);
      ids.push(id);
    }
    return false;
  });
  return { ids, duplicates };
}

/** The footnotes the document ends with, by id, and where the blocks are. */
function footnotesOf(doc: PMNode): { byId: Map<string, PMNode>; blocks: { pos: number; node: PMNode }[] } {
  const byId = new Map<string, PMNode>();
  const blocks: { pos: number; node: PMNode }[] = [];
  doc.forEach((node, pos) => {
    if (node.type.name !== "footnotes") return;
    blocks.push({ pos, node });
    node.forEach((footnote) => {
      const id = footnote.attrs.footnoteId as string | null;
      if (id && !byId.has(id)) byId.set(id, footnote);
    });
  });
  return { byId, blocks };
}

/** Bring the footnotes in line with the numbers in `tr`'s document: a
    duplicated number gets its own footnote (a copy of the words), every
    number has a footnote, no footnote lacks a number, the footnotes follow
    the numbers' order, and they sit in one block at the very end. Returns
    whether anything changed. */
function normalizeFootnotes(tr: Transaction): boolean {
  const schema = tr.doc.type.schema;
  const refType = schema.nodes.footnoteReference;
  const blockType = schema.nodes.footnotes;
  const noteType = schema.nodes.footnote;
  const paragraph = schema.nodes.paragraph;
  if (!refType || !blockType || !noteType || !paragraph) return false;
  let changed = false;
  let refs = referencesOf(tr.doc);
  const copies = new Map<string, PMNode>();
  if (refs.duplicates.length > 0) {
    const current = footnotesOf(tr.doc).byId;
    for (const dup of refs.duplicates) {
      const id = newBlockId();
      const original = current.get(dup.id);
      if (original) copies.set(id, noteType.create({ footnoteId: id }, original.content));
      // A new attribute moves no position: dup.pos stays good.
      tr.setNodeMarkup(dup.pos, undefined, { footnoteId: id });
    }
    refs = referencesOf(tr.doc);
    changed = true;
  }
  const { byId, blocks } = footnotesOf(tr.doc);
  const want = refs.ids;
  const lastIsBlock = tr.doc.lastChild?.type === blockType;
  const have = blocks.length === 1 ? blocks[0].node : null;
  const inOrder =
    have !== null &&
    have.childCount === want.length &&
    want.every((id, i) => have.child(i).attrs.footnoteId === id) &&
    lastIsBlock;
  if (inOrder) return changed;
  // Rebuild the block: remove every footnotes block, then add one at the end.
  for (const block of [...blocks].reverse()) {
    tr.delete(block.pos, block.pos + block.node.nodeSize);
  }
  if (want.length > 0) {
    const notes = want.map(
      (id) => byId.get(id) ?? copies.get(id) ?? noteType.create({ footnoteId: id }, paragraph.create()),
    );
    tr.insert(tr.doc.content.size, blockType.create(null, Fragment.fromArray(notes)));
  }
  return true;
}

/** Insert a footnote at the caret: the next number there, and the caret in
    its footnote at the end, as Ctrl+Alt+F does in Google Docs. */
export function insertFootnote(editor: Editor): boolean {
  const { state, view } = editor;
  const refType = state.schema.nodes.footnoteReference;
  if (!refType || !editor.isEditable) return false;
  const $from = state.selection.$from;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return false;
  // Not inside a footnote: Google Docs has no footnotes of footnotes.
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === "footnote") return false;
  const id = newBlockId();
  // The number goes where the selection ends; the words stay.
  const tr = state.tr.insert(state.selection.to, refType.create({ footnoteId: id }));
  normalizeFootnotes(tr);
  let target = -1;
  tr.doc.descendants((node, pos) => {
    if (target >= 0) return false;
    if (node.type.name === "footnote" && node.attrs.footnoteId === id) {
      target = pos + 2;
      return false;
    }
    return true;
  });
  if (target >= 0) tr.setSelection(TextSelection.create(tr.doc, target));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

const numbered = new WeakMap<PMNode, DecorationSet>();

function numberDecorations(doc: PMNode): DecorationSet {
  const cached = numbered.get(doc);
  if (cached) return cached;
  const decorations: Decoration[] = [];
  const order = new Map<string, number>();
  doc.descendants((node, pos) => {
    if (node.type.name === "footnotes") {
      node.forEach((footnote, offset) => {
        const n = order.get(String(footnote.attrs.footnoteId));
        if (n) {
          const at = pos + 1 + offset;
          decorations.push(Decoration.node(at, at + footnote.nodeSize, { "data-n": String(n) }));
        }
      });
      return false;
    }
    if (node.type.name === "footnoteReference") {
      const id = String(node.attrs.footnoteId);
      if (!order.has(id)) order.set(id, order.size + 1);
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { "data-n": String(order.get(id)) }));
      return false;
    }
    return true;
  });
  const set = DecorationSet.create(doc, decorations);
  numbered.set(doc, set);
  return set;
}

function endsWithFootnotes(state: EditorState): boolean {
  return state.doc.lastChild?.type.name === "footnotes";
}

/** The footnotes' keeper: numbering, order, and the block at the end. The
    trailing paragraph the editor adds after the last block never goes after
    the footnotes. */
const FootnoteKeeper = Extension.create({
  name: "docsFootnotes",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (transactions, _old, state) => {
          if (!transactions.some((t) => t.docChanged)) return null;
          const tr = state.tr;
          if (!normalizeFootnotes(tr)) return null;
          return tr;
        },
        filterTransaction: (tr, state) => {
          // The trailing-node plugin's empty paragraph after the footnotes.
          if (!endsWithFootnotes(state) || tr.steps.length !== 1) return true;
          const end = state.doc.content.size;
          const after = tr.doc.content.size;
          const last = tr.doc.lastChild;
          return !(after === end + 2 && last?.type.name === "paragraph" && last.content.size === 0);
        },
        props: {
          decorations: (state) => numberDecorations(state.doc),
        },
      }),
    ];
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Alt-f": () => insertFootnote(this.editor),
    };
  },
});

export const FOOTNOTE_EXTENSIONS = [FootnoteReference, Footnotes, Footnote, FootnoteKeeper];

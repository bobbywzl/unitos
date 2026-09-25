import { Extension, Node, type Editor } from "@tiptap/core";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import { AllSelection, Plugin, Selection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { isMac } from "@/components/docs/keys";
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
    // Before the superscript mark's sup, which would drop the number.
    return [{ tag: "sup[data-footnote-ref]", priority: 60 }];
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

/** The words of each footnote whose number left in a copy, a cut, or a drag,
    by id, as JSON: another page editor has its own schema. */
const copiedWords = new Map<string, unknown>();

/** The nodes a body ends with, the trailing node's list (extensions.ts). */
const LINE_ENDS = new Set(["paragraph", "heading", "bulletList", "orderedList", "taskList"]);

/** Bring the footnotes in line with the numbers in `tr`'s document: a
    number pasted into a footnote goes, a duplicated number gets its own
    footnote (a copy of the words), every number has a footnote (a pasted
    one takes the words it was copied with), no footnote lacks a number, the
    footnotes follow the numbers' order, and they sit in one block at the
    very end, after a line. Returns whether anything changed. */
function normalizeFootnotes(tr: Transaction): boolean {
  const schema = tr.doc.type.schema;
  const refType = schema.nodes.footnoteReference;
  const blockType = schema.nodes.footnotes;
  const noteType = schema.nodes.footnote;
  const paragraph = schema.nodes.paragraph;
  if (!refType || !blockType || !noteType || !paragraph) return false;
  const strays: number[] = [];
  for (const { pos, node } of footnotesOf(tr.doc).blocks) {
    node.descendants((child, offset) => {
      if (child.type === refType) strays.push(pos + 1 + offset);
    });
  }
  for (const at of strays.reverse()) tr.delete(at, at + 1);
  let changed = strays.length > 0;
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
  if (!inOrder) {
    // Rebuild the block: remove every footnotes block, then add one at the end.
    for (const block of [...blocks].reverse()) {
      tr.delete(block.pos, block.pos + block.node.nodeSize);
    }
    if (want.length > 0) {
      const notes = want.map((id) => {
        const words = copiedWords.get(id);
        const content = words ? Fragment.fromJSON(schema, words) : paragraph.create();
        return byId.get(id) ?? copies.get(id) ?? noteType.create({ footnoteId: id }, content);
      });
      tr.insert(tr.doc.content.size, blockType.create(null, Fragment.fromArray(notes)));
    }
    changed = true;
  }
  // The body ends on a line, as a document without footnotes does: a table
  // or another object before the footnotes gets an empty line after it.
  const last = tr.doc.lastChild;
  if (last?.type === blockType && tr.doc.childCount > 1 && !LINE_ENDS.has(tr.doc.child(tr.doc.childCount - 2).type.name)) {
    tr.insert(tr.doc.content.size - last.nodeSize, paragraph.create());
    changed = true;
  }
  return changed;
}

/** Footnote words pasted or dropped go in as paragraphs, never as a second
    footnote with the same id, which normalizeFootnotes would drop. A whole
    footnotes block, closed at the slice's end (Select all), stays for its
    numbers. */
function unwrapFootnotes(slice: Slice): Slice {
  const { content, openStart, openEnd } = slice;
  if (content.lastChild?.type.name !== "footnotes" || openEnd === 0) return slice;
  const out: PMNode[] = [];
  content.forEach((node) => {
    if (node.type.name === "footnotes") node.forEach((note) => note.forEach((p) => out.push(p)));
    else out.push(node);
  });
  const start = content.childCount === 1 ? Math.max(0, openStart - 2) : openStart;
  return new Slice(Fragment.fromArray(out), start, Math.max(0, openEnd - 2));
}

/** The first or the last caret position of the part the caret is in, as
    Google Docs parts a document: the body, or the footnote that holds it. */
function edgeOfPart(state: EditorState, dir: -1 | 1): Selection | null {
  const { doc, selection } = state;
  const $head = selection.$head;
  const notes = doc.lastChild?.type.name === "footnotes" ? doc.lastChild : null;
  let from = 0;
  let to = doc.content.size - (notes?.nodeSize ?? 0);
  for (let d = $head.depth; d > 0; d--) {
    if ($head.node(d).type.name === "footnote") {
      from = $head.start(d);
      to = $head.end(d);
      break;
    }
  }
  return Selection.findFrom(doc.resolve(dir > 0 ? to : from), -dir, true);
}

/** Ctrl+Home and Ctrl+End; Shift extends the selection. */
function toEdge(editor: Editor, dir: -1 | 1, extend: boolean): boolean {
  const { state } = editor;
  const edge = edgeOfPart(state, dir);
  if (!edge) return false;
  const next = extend ? TextSelection.between(state.selection.$anchor, edge.$head) : edge;
  editor.view.dispatch(state.tr.setSelection(next).scrollIntoView());
  return true;
}

/** → and ↓ never leave the part at its end (↓ on its last line goes to the
    line's end); after Select all they go to the body's end. */
function stayInPart(editor: Editor, dir: "right" | "down"): boolean {
  const { state, view } = editor;
  const sel = state.selection;
  if (sel instanceof AllSelection) return toEdge(editor, 1, false);
  const edge = edgeOfPart(state, 1);
  if (!sel.empty || !edge || edge.$head.parent !== sel.$head.parent || !view.endOfTextblock(dir)) return false;
  if (sel.head !== edge.head) view.dispatch(state.tr.setSelection(edge));
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
          transformCopied: (slice, view) => {
            const { byId } = footnotesOf(view.state.doc);
            slice.content.descendants((node) => {
              const id = node.type.name === "footnoteReference" ? String(node.attrs.footnoteId) : "";
              const note = byId.get(id);
              if (note) copiedWords.set(id, note.content.toJSON());
            });
            return slice;
          },
          transformPasted: unwrapFootnotes,
        },
      }),
    ];
  },
  addKeyboardShortcuts() {
    const edge = (dir: -1 | 1, extend: boolean) => () => toEdge(this.editor, dir, extend);
    return {
      "Mod-Alt-f": () => insertFootnote(this.editor),
      "Mod-Home": edge(-1, false),
      "Mod-End": edge(1, false),
      "Mod-Shift-Home": edge(-1, true),
      "Mod-Shift-End": edge(1, true),
      ArrowRight: () => stayInPart(this.editor, "right"),
      ArrowDown: () => stayInPart(this.editor, "down"),
      // ⌘↑ and ⌘↓ on a Mac.
      ...(isMac() && {
        "Mod-ArrowUp": edge(-1, false),
        "Mod-ArrowDown": edge(1, false),
        "Mod-Shift-ArrowUp": edge(-1, true),
        "Mod-Shift-ArrowDown": edge(1, true),
      }),
    };
  },
});

export const FOOTNOTE_EXTENSIONS = [FootnoteReference, Footnotes, Footnote, FootnoteKeeper];

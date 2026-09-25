import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment, type Node as PMNode, type NodeType, type ResolvedPos } from "@tiptap/pm/model";
import { Selection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { liftListItem, sinkListItem } from "@tiptap/pm/schema-list";
import { canSplit } from "@tiptap/pm/transform";
import type { EditorView } from "@tiptap/pm/view";
import { blockText, previousTextblock, runAutocorrect, runCodeFence } from "@/components/docs/typing/autocorrect";
import { firstGraphemeLength, lastGraphemeLength, wordEndAfter, wordStartBefore } from "@/components/docs/typing/chars";

// Google Docs' Enter, Backspace, Delete, Tab, and move-paragraph (SPEC.md §29,
// typing). ProseMirror's defaults differ where Docs is particular: Enter at
// the end of a heading gives Normal text; Backspace at the start of a list
// item takes the bullet away and leaves the text where it was, steps a
// centered or right-aligned line back, and removes an indent before it
// joins; a join keeps the lower paragraph's style unless the upper one is a
// list item; Tab at the start of a paragraph sets a first-line indent.

/** One indent step, in points. */
export const STEP_PT = 36;
/** Docs nests lists nine levels deep: 0 to 8. */
const MAX_LEVEL = 8;

export function isListItemNode(node: PMNode | null | undefined): boolean {
  return node?.type.name === "listItem" || node?.type.name === "taskItem";
}

export function isListNode(node: PMNode | null | undefined): boolean {
  return node?.type.name === "bulletList" || node?.type.name === "orderedList" || node?.type.name === "taskList";
}

function isCell(node: PMNode | null | undefined): boolean {
  return node?.type.name === "tableCell" || node?.type.name === "tableHeader";
}

/** A pending "@" or ":" menu (any @tiptap/suggestion plugin) owns the keys. */
export function suggestionActive(state: EditorState): boolean {
  return state.plugins.some((plugin) => {
    const value: unknown = plugin.getState(state);
    return (
      typeof value === "object" &&
      value !== null &&
      (value as { active?: unknown }).active === true &&
      "range" in value &&
      "query" in value
    );
  });
}

// ── Undo grouping ───────────────────────────────────────────────────────
// Typing groups into one undo step; a structural command (Enter, Tab, a
// list change) and a switch between typing and deleting start a new one.

const lastKind = new WeakMap<EditorView, "insert" | "delete" | "structure">();

/** Mark what kind of edit `tr` is; it opens a new undo step when the kind changes. */
export function groupEdit(view: EditorView, tr: Transaction, kind: "insert" | "delete" | "structure"): Transaction {
  const last = lastKind.get(view);
  if (kind === "structure" || (last && last !== kind)) closeHistory(tr);
  lastKind.set(view, kind);
  return tr;
}

/** After a structural command, the next keystroke opens a new undo step. */
function endStructure(view: EditorView): void {
  lastKind.set(view, "structure");
}

/** Before a paste, a cut, or a drop: what comes next is its own undo step,
    and so is the typing after it. */
export function closeEdit(view: EditorView): void {
  view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
  lastKind.set(view, "structure");
}

// ── Where the caret is ──────────────────────────────────────────────────

type ItemAt = { node: PMNode; pos: number; depth: number; level: number };

/** The list item whose first paragraph holds `$pos`, with its nesting level (0-based). */
export function listItemAt($pos: ResolvedPos): ItemAt | null {
  const d = $pos.depth - 1;
  if (d < 1) return null;
  const item = $pos.node(d);
  if (!isListItemNode(item) || $pos.index(d) !== 0) return null;
  let level = -1;
  for (let i = d - 1; i > 0; i--) if (isListNode($pos.node(i))) level++;
  return { node: item, pos: $pos.before(d), depth: d, level: Math.max(0, level) };
}

function inTable($pos: ResolvedPos): boolean {
  for (let d = $pos.depth; d > 0; d--) if (isCell($pos.node(d))) return true;
  return false;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function orNull(value: number): number | null {
  return value === 0 ? null : value;
}

function dispatch(view: EditorView, tr: Transaction): void {
  view.dispatch(tr.scrollIntoView());
}

// ── Enter ───────────────────────────────────────────────────────────────

/** Enter: an empty list item leaves the list (level 0) or goes out one
    level; a list item splits into two; a heading ended at its end gives a
    Normal text paragraph and drops the pending style; anything else splits
    and keeps its style. Then the autocorrect rules for Enter run. */
export function enter(editor: Editor): boolean {
  const view = editor.view;
  const state = view.state;
  if (!view.editable || suggestionActive(state)) return false;
  const sel = state.selection;
  if (!(sel instanceof TextSelection)) return false;
  if (sel.$from.parent.type.spec.code || sel.$to.parent.type.spec.code) return false;
  const item = listItemAt(sel.$from);
  if (item && sel.empty && sel.$from.parent.content.size === 0 && item.node.childCount === 1) {
    liftListItem(item.node.type)(state, (tr) => dispatch(view, groupEdit(view, tr, "structure")));
    endStructure(view);
    return true;
  }
  if (item && sel.$from.sameParent(sel.$to)) {
    const ok = editor
      .chain()
      .command(({ tr }) => {
        groupEdit(view, tr, "structure");
        return true;
      })
      .splitListItem(item.node.type.name)
      .run();
    if (ok) {
      afterBreak(view, "\n");
      return true;
    }
  }
  const block = sel.$from.parent;
  // An empty line in a quote leaves the quote, as ProseMirror does.
  if (sel.empty && block.content.size === 0 && sel.$from.node(sel.$from.depth - 1).type.name === "blockquote") return false;
  const pending = state.storedMarks;
  const tr = state.tr;
  groupEdit(view, tr, "structure");
  if (!sel.empty) tr.deleteSelection();
  const $pos = tr.selection.$from;
  const node = $pos.parent;
  if (!node.isTextblock) return false;
  const atEnd = $pos.parentOffset === node.content.size;
  const atStart = $pos.parentOffset === 0 && node.content.size > 0;
  const heading =
    node.type.name === "heading" || (node.type.name === "paragraph" && ["title", "subtitle"].includes(String(node.attrs.docStyle)));
  const paragraph = state.schema.nodes.paragraph;
  let after: { type: NodeType; attrs: Record<string, unknown> };
  if (heading && atEnd && paragraph) {
    const attrs: Record<string, unknown> = {};
    for (const name of Object.keys(paragraph.spec.attrs ?? {})) {
      if (name in node.attrs && name !== "blockId" && name !== "docStyle") attrs[name] = node.attrs[name];
    }
    after = { type: paragraph, attrs };
  } else {
    // The text keeps its paragraph id: split at the start, the new empty
    // paragraph above takes a fresh one.
    after = { type: node.type, attrs: { ...node.attrs, blockId: atStart ? node.attrs.blockId : null } };
  }
  if (!canSplit(tr.doc, $pos.pos, 1, [after])) return false;
  const beforePos = $pos.before();
  tr.split($pos.pos, 1, [after]);
  if (atStart && "blockId" in node.attrs) tr.setNodeMarkup(beforePos, undefined, { ...node.attrs, blockId: null });
  if (!(heading && atEnd)) {
    const marks = pending ?? ($pos.parentOffset > 0 ? $pos.marks() : null);
    if (marks) tr.ensureMarks(marks);
  }
  dispatch(view, tr);
  afterBreak(view, "\n");
  return true;
}

function afterBreak(view: EditorView, trigger: string): void {
  if (trigger !== "\n" || !runCodeFence(view)) runAutocorrect(view, trigger);
  endStructure(view);
}

/** Shift+Enter: a line break inside the paragraph; no new list item. */
export function lineBreak(editor: Editor): boolean {
  const view = editor.view;
  const state = view.state;
  if (!view.editable || suggestionActive(state)) return false;
  const { $from } = state.selection;
  const tr = state.tr;
  groupEdit(view, tr, "insert");
  if ($from.parent.type.spec.code) {
    tr.insertText("\n");
    dispatch(view, tr);
    return true;
  }
  const hardBreak = state.schema.nodes.hardBreak;
  if (!hardBreak) return false;
  const marks = state.storedMarks ?? $from.marks();
  tr.replaceSelectionWith(hardBreak.create(), false);
  if (marks.length) tr.ensureMarks(marks);
  dispatch(view, tr);
  runAutocorrect(view, "\v");
  return true;
}

// ── Joining two paragraphs ──────────────────────────────────────────────

/** Delete the node at `pos`, and the list items and lists it leaves empty.
    False when the document would not hold (a list item needs its first
    paragraph). */
function deleteBlock(tr: Transaction, pos: number): boolean {
  const $pos = tr.doc.resolve(pos);
  const node = tr.doc.nodeAt(pos);
  if (!node) return false;
  let depth = $pos.depth;
  let from = pos;
  let to = pos + node.nodeSize;
  while (depth > 0) {
    const parent = $pos.node(depth);
    if (parent.childCount !== 1) break;
    if (!isListItemNode(parent) && !isListNode(parent) && parent.type.name !== "blockquote") break;
    from = $pos.before(depth);
    to = $pos.after(depth);
    depth--;
  }
  const index = $pos.index(depth);
  if (!$pos.node(depth).canReplace(index, index + 1)) return false;
  tr.delete(from, to);
  return true;
}

/** Join two text blocks, `upper` before `lower` (positions before each).
    The joined paragraph keeps the lower paragraph's style — Docs keeps the
    lower paragraph's end — unless the upper one is a list item, whose
    style and list then win. The caret goes to the join. */
function joinBlocks(state: EditorState, upperPos: number, lowerPos: number): Transaction | null {
  const upper = state.doc.nodeAt(upperPos);
  const lower = state.doc.nodeAt(lowerPos);
  if (!upper?.isTextblock || !lower?.isTextblock) return null;
  if (upper.type.spec.code || lower.type.spec.code) return null;
  const $upper = state.doc.resolve(upperPos + 1);
  const keepUpper = isListItemNode($upper.node($upper.depth - 1));
  const tr = state.tr;
  if (keepUpper) {
    const join = upperPos + 1 + upper.content.size;
    tr.insert(join, lower.content);
    if (!deleteBlock(tr, tr.mapping.map(lowerPos))) return null;
    tr.setSelection(TextSelection.create(tr.doc, join));
  } else {
    const join = lowerPos + 1;
    tr.insert(join, upper.content);
    const caret = join + upper.content.size;
    const before = tr.steps.length;
    if (!deleteBlock(tr, upperPos)) return null;
    const mapped = tr.mapping.slice(before).map(caret);
    tr.setSelection(TextSelection.create(tr.doc, mapped));
  }
  return tr;
}

/** The text block that starts after `pos` (a position between blocks), or null. */
function nextTextblock(doc: PMNode, pos: number): { node: PMNode; pos: number } | null {
  if (pos >= doc.content.size) return null;
  const found = Selection.findFrom(doc.resolve(pos), 1, true);
  if (!found || found.from <= pos) return null;
  const $at = found.$from;
  return $at.parent.isTextblock ? { node: $at.parent, pos: $at.before() } : null;
}

// ── Backspace ───────────────────────────────────────────────────────────

export type DeleteMode = "char" | "word" | "line";

/** Backspace, Google Docs' way. `word` is Ctrl+Backspace (Option on a Mac);
    `line` is ⌘+Backspace, the browser's own delete to the line start. */
export function backspace(editor: Editor, mode: DeleteMode): boolean {
  const view = editor.view;
  const state = view.state;
  if (!view.editable || suggestionActive(state)) return false;
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || !sel.empty) {
    lastKind.set(view, "delete");
    return false;
  }
  const $from = sel.$from;
  const block = $from.parent;
  if (!block.isTextblock || block.type.spec.code) return false;
  const offset = $from.parentOffset;
  if (offset > 0) {
    if (mode === "line") return false;
    const text = blockText(block);
    const from =
      mode === "word"
        ? $from.start() + wordStartBefore(text, offset)
        : $from.pos - lastGraphemeLength(text.slice(Math.max(0, offset - 16), offset));
    dispatch(view, groupEdit(view, state.tr.delete(from, $from.pos), "delete"));
    return true;
  }
  return backspaceAtStart(view, $from, mode === "word");
}

function setBlockAttrs(view: EditorView, pos: number, node: PMNode, attrs: Record<string, unknown>): true {
  const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
  dispatch(view, groupEdit(view, tr, "structure"));
  endStructure(view);
  return true;
}

function backspaceAtStart(view: EditorView, $from: ResolvedPos, word: boolean): boolean {
  const state = view.state;
  const block = $from.parent;
  const blockPos = $from.before();
  const item = listItemAt($from);
  // 1. The bullet goes; the text stays where it was.
  if (item && !word) return removeBullet(view, $from, item);
  // 2–3. A centered line goes left; a right-aligned one to the center.
  const align = block.attrs.textAlign;
  if (align === "center") return setBlockAttrs(view, blockPos, block, { textAlign: null });
  if (align === "right") return setBlockAttrs(view, blockPos, block, { textAlign: "center" });
  // 4. An indent goes before anything is joined.
  const start = num(block.attrs.indentLeft);
  const firstLine = num(block.attrs.indentFirstLine);
  if (start > 0 || start + firstLine > 0) {
    if (firstLine === 0) return setBlockAttrs(view, blockPos, block, { indentLeft: null, indentFirstLine: null });
    const both = Math.max(0, Math.min(start, start + firstLine));
    return setBlockAttrs(view, blockPos, block, { indentLeft: orNull(both), indentFirstLine: null });
  }
  const depth = $from.depth;
  const container = $from.node(depth - 1);
  const index = $from.index(depth - 1);
  let tr: Transaction | null = null;
  if (index === 0) {
    // 5. The start of the document or of a table cell: nothing.
    if (container.type.name === "doc" || isCell(container)) return true;
    // The word-delete modifier at a list item's start joins it to the line above.
    if (isListItemNode(container)) {
      const prev = previousTextblock(state.doc, blockPos);
      if (!prev || inTable(state.doc.resolve(prev.start)) !== inTable($from)) return true;
      tr = joinBlocks(state, prev.start - 1, blockPos);
    }
  } else {
    const prev = container.child(index - 1);
    const prevPos = blockPos - prev.nodeSize;
    // 6. Never into a table.
    if (prev.type.name === "table") return true;
    // 7. A page break goes with its paragraph break.
    if (prev.type.name === "pageBreak") {
      tr = state.tr.delete(prevPos, blockPos);
      const above = index >= 2 ? container.child(index - 2) : null;
      if (above?.isTextblock && !above.type.spec.code) {
        const joined = joinBlocks(state.apply(tr), prevPos - above.nodeSize, prevPos);
        if (joined) {
          for (const step of joined.steps) tr.step(step);
          tr.setSelection(TextSelection.create(tr.doc, joined.selection.from));
        }
      }
    } else if (prev.isTextblock) {
      // 8. Join, the Docs way.
      tr = joinBlocks(state, prevPos, blockPos);
    } else if (isListNode(prev)) {
      const last = previousTextblock(state.doc, blockPos);
      if (last) tr = joinBlocks(state, last.start - 1, blockPos);
    }
  }
  if (!tr) return false;
  dispatch(view, groupEdit(view, tr, "delete"));
  return true;
}

/** Backspace at the start of a list item: the item leaves the list and its
    text keeps its place. After an item, the paragraph joins that item as a
    paragraph of its own; as a list's first item, it moves out before the
    list with the level's indent. */
function removeBullet(view: EditorView, $from: ResolvedPos, item: ItemAt): boolean {
  const state = view.state;
  const tr = state.tr;
  const list = $from.node(item.depth - 1);
  const listPos = $from.before(item.depth - 1);
  const index = $from.index(item.depth - 1);
  if (index > 0) {
    tr.join(item.pos);
  } else {
    const paragraph = item.node.firstChild;
    const content = paragraph
      ? item.node.content.replaceChild(
          0,
          paragraph.type.create(
            { ...paragraph.attrs, indentLeft: num(paragraph.attrs.indentLeft) + STEP_PT },
            paragraph.content,
            paragraph.marks,
          ),
        )
      : item.node.content;
    if (list.childCount === 1) {
      tr.replaceWith(listPos, listPos + list.nodeSize, content);
    } else {
      tr.delete(item.pos, item.pos + item.node.nodeSize);
      tr.insert(listPos, content);
    }
    tr.setSelection(TextSelection.create(tr.doc, listPos + 1));
  }
  dispatch(view, groupEdit(view, tr, "structure"));
  endStructure(view);
  return true;
}

// ── Delete ──────────────────────────────────────────────────────────────

/** Delete, Google Docs' way: at a paragraph's end the next paragraph joins
    it (the lower style wins unless this one is a list item); before a table
    or at the end of a cell nothing happens. `word` is Ctrl+Delete. */
export function deleteForward(editor: Editor, word: boolean, mac: boolean): boolean {
  const view = editor.view;
  const state = view.state;
  if (!view.editable || suggestionActive(state)) return false;
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || !sel.empty) {
    lastKind.set(view, "delete");
    return false;
  }
  const $from = sel.$from;
  const block = $from.parent;
  if (!block.isTextblock || block.type.spec.code) return false;
  const offset = $from.parentOffset;
  if (offset < block.content.size) {
    const text = blockText(block);
    const to = word
      ? $from.start() + wordEndAfter(text, offset, mac)
      : $from.pos + firstGraphemeLength(text.slice(offset, offset + 16));
    dispatch(view, groupEdit(view, state.tr.delete($from.pos, to), "delete"));
    return true;
  }
  const depth = $from.depth;
  const container = $from.node(depth - 1);
  const index = $from.index(depth - 1);
  const blockPos = $from.before();
  const after = $from.after();
  let tr: Transaction | null = null;
  if (index === container.childCount - 1) {
    if (container.type.name === "doc" || isCell(container)) return true;
    if (isListItemNode(container)) {
      const next = nextTextblock(state.doc, after);
      if (!next || inTable(state.doc.resolve(next.pos + 1)) !== inTable($from)) return true;
      // A table right after the list: nothing.
      const $next = state.doc.resolve(next.pos);
      if (inTable($next) && !inTable($from)) return true;
      tr = joinBlocks(state, blockPos, next.pos);
    }
  } else {
    const next = container.child(index + 1);
    if (next.type.name === "table") return true;
    if (next.type.name === "pageBreak") {
      tr = state.tr.delete(after, after + next.nodeSize);
    } else if (next.isTextblock) {
      tr = joinBlocks(state, blockPos, after);
    } else if (isListNode(next)) {
      const first = nextTextblock(state.doc, after);
      if (first) tr = joinBlocks(state, blockPos, first.pos);
    }
  }
  if (!tr) return false;
  dispatch(view, groupEdit(view, tr, "delete"));
  return true;
}

// ── Tab and Shift+Tab ───────────────────────────────────────────────────

/** The text blocks the selection touches: [node, pos before it]. */
function touchedBlocks(state: EditorState): { node: PMNode; pos: number }[] {
  const { from, to } = state.selection;
  const out: { node: PMNode; pos: number }[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) {
      out.push({ node, pos });
      return false;
    }
    return true;
  });
  return out;
}

function insertTab(view: EditorView): true {
  const state = view.state;
  const marks = state.storedMarks ?? state.selection.$from.marks();
  const tr = state.tr.replaceSelectionWith(state.schema.text("\t", marks), false);
  dispatch(view, groupEdit(view, tr, "insert"));
  runAutocorrect(view, "\t");
  return true;
}

/** Rules 5 and 6: Tab at a paragraph's start sets a first-line indent, or
    indents the whole paragraph when it has one; Shift+Tab takes them back. */
function firstLineIndent(view: EditorView, pos: number, node: PMNode, shift: boolean): true {
  const start = num(node.attrs.indentLeft);
  const offset = num(node.attrs.indentFirstLine);
  if (offset > 0) {
    if (shift) return setBlockAttrs(view, pos, node, { indentFirstLine: null });
    return setBlockAttrs(view, pos, node, { indentLeft: start + STEP_PT });
  }
  if (shift) {
    if (start <= 0) return true;
    return setBlockAttrs(view, pos, node, { indentLeft: orNull(Math.max(0, start - STEP_PT)) });
  }
  const first = start + offset;
  const next = (Math.floor(first / STEP_PT + 1e-6) + 1) * STEP_PT;
  return setBlockAttrs(view, pos, node, { indentFirstLine: orNull(next - start) });
}

function nest(view: EditorView, item: ItemAt, shift: boolean): true {
  const state = view.state;
  if (shift && item.level === 0) return true;
  if (!shift && item.level >= MAX_LEVEL) return true;
  const command = shift ? liftListItem(item.node.type) : sinkListItem(item.node.type);
  command(state, (tr) => dispatch(view, groupEdit(view, tr, "structure")));
  endStructure(view);
  return true;
}

/** Tab (and Shift+Tab), in Docs' order: table cells, several paragraphs,
    list nesting, the first-line indent, then a tab character. */
export function tab(editor: Editor, shift: boolean): boolean {
  const view = editor.view;
  const state = view.state;
  if (!view.editable || suggestionActive(state)) return false;
  const sel = state.selection;
  if (inTable(sel.$from)) {
    if (shift) {
      editor.commands.goToPreviousCell();
      return true;
    }
    if (editor.commands.goToNextCell()) return true;
    if (editor.can().addRowAfter()) editor.chain().addRowAfter().goToNextCell().run();
    return true;
  }
  if (sel.$from.parent.type.spec.code) {
    dispatch(view, groupEdit(view, state.tr.insertText("\t"), "insert"));
    return true;
  }
  const blocks = touchedBlocks(state);
  const first = blocks[0];
  const whole =
    !sel.empty && blocks.length === 1 && first && sel.from <= first.pos + 1 && sel.to >= first.pos + 1 + first.node.content.size;
  if (blocks.length > 1 || whole) return indentMany(view, shift);
  const $from = sel.$from;
  const atStart = $from.parentOffset === 0;
  const item = listItemAt($from);
  if (!sel.empty) {
    if (!atStart) return insertTab(view);
    if (item) return nest(view, item, shift);
    return firstLineIndent(view, $from.before(), $from.parent, shift);
  }
  if (item && atStart) return nest(view, item, shift);
  if (atStart && $from.parent.content.size > 0 && !$from.parent.type.spec.code) {
    return firstLineIndent(view, $from.before(), $from.parent, shift);
  }
  return insertTab(view);
}

/** Rule 1: every paragraph moves: list lines nest one level, other
    paragraphs move half an inch. Shift+Tab moves nothing when a paragraph
    would go past the margin. */
function indentMany(view: EditorView, shift: boolean): true {
  const state = view.state;
  const blocks = touchedBlocks(state);
  const plain = blocks.filter((b) => !listItemAt(state.doc.resolve(b.pos + 1)));
  const listed = blocks.length - plain.length;
  if (shift && plain.some((b) => num(b.node.attrs.indentLeft) < STEP_PT)) return true;
  if (listed > 0 && plain.length === 0) {
    const $from = state.selection.$from;
    const item = listItemAt($from) ?? listItemAt(state.doc.resolve(blocks[0].pos + 1));
    if (item) {
      const command = shift ? liftListItem(item.node.type) : sinkListItem(item.node.type);
      command(state, (tr) => dispatch(view, groupEdit(view, tr, "structure")));
    }
    endStructure(view);
    return true;
  }
  const tr = state.tr;
  for (const b of plain) {
    const start = num(b.node.attrs.indentLeft);
    const next = Math.max(0, start + (shift ? -STEP_PT : STEP_PT));
    tr.setNodeMarkup(b.pos, undefined, { ...b.node.attrs, indentLeft: orNull(next) });
  }
  if (tr.docChanged) dispatch(view, groupEdit(view, tr, "structure"));
  endStructure(view);
  return true;
}

// ── Move paragraph up and down ──────────────────────────────────────────

/** Ctrl+Shift+↑ and ↓: the paragraphs the selection touches move past the
    block above or below; a table is passed whole; list items move among
    their list and a list's first or last item can leave it. One undo step. */
export function moveParagraphs(editor: Editor, dir: -1 | 1): boolean {
  const view = editor.view;
  const state = view.state;
  if (!view.editable) return false;
  const sel = state.selection;
  const $a = sel.$from;
  const $b = sel.$to;
  const range = $a.blockRange($b);
  if (!range) return true;
  let depth = range.depth;
  let startIndex = range.startIndex;
  let endIndex = range.endIndex;
  // A range that starts a list item moves the items.
  while (depth > 0 && isListItemNode($a.node(depth)) && startIndex === 0) {
    depth -= 1;
    startIndex = $a.index(depth);
    endIndex = $b.index(depth) + 1;
  }
  const parent = $a.node(depth);
  const startPos = $a.posAtIndex(startIndex, depth);
  const endPos = $a.posAtIndex(endIndex, depth);
  const tr = state.tr;
  let shift = 0;
  if (dir === -1 && startIndex > 0) {
    const prev = parent.child(startIndex - 1);
    const moved = state.doc.slice(startPos, endPos).content;
    tr.delete(startPos - prev.nodeSize, endPos);
    tr.insert(startPos - prev.nodeSize, moved.append(Fragment.from(prev)));
    shift = -prev.nodeSize;
  } else if (dir === 1 && endIndex < parent.childCount) {
    const next = parent.child(endIndex);
    const moved = state.doc.slice(startPos, endPos).content;
    tr.delete(startPos, endPos + next.nodeSize);
    tr.insert(startPos, Fragment.from(next).append(moved));
    shift = next.nodeSize;
  } else if (isListNode(parent) && depth > 0 && !isListItemNode($a.node(depth - 1))) {
    const moved = leaveList(tr, state, $a, depth, startIndex, endIndex, dir);
    if (moved === null) return true;
    shift = moved;
  } else {
    return true;
  }
  const anchor = sel.anchor + shift;
  const head = sel.head + shift;
  try {
    tr.setSelection(TextSelection.create(tr.doc, anchor, head));
  } catch {
    tr.setSelection(Selection.near(tr.doc.resolve(Math.min(tr.doc.content.size, Math.max(0, anchor)))));
  }
  dispatch(view, groupEdit(view, tr, "structure"));
  endStructure(view);
  return true;
}

/** A list's first items moving up (or last items moving down) leave the
    list past the block beyond it, as a list of their own with the same
    style; numbering goes on. Returns how far the items moved, or null. */
function leaveList(
  tr: Transaction,
  state: EditorState,
  $a: ResolvedPos,
  depth: number,
  startIndex: number,
  endIndex: number,
  dir: -1 | 1,
): number | null {
  const list = $a.node(depth);
  const listPos = $a.before(depth);
  const container = $a.node(depth - 1);
  const listIndex = $a.index(depth - 1);
  const neighborIndex = listIndex + dir;
  if (neighborIndex < 0 || neighborIndex >= container.childCount) return null;
  const neighbor = container.child(neighborIndex);
  const items: PMNode[] = [];
  const rest: PMNode[] = [];
  list.forEach((child, _offset, i) => (i >= startIndex && i < endIndex ? items : rest).push(child));
  const start = Number(list.attrs.start) || 1;
  const ordered = list.type.name === "orderedList";
  const withStart = (n: number) => (ordered ? { ...list.attrs, start: n } : list.attrs);
  const movedList = list.type.create(dir === -1 ? withStart(start) : withStart(start + rest.length), items);
  const restList = rest.length ? list.type.create(dir === -1 ? withStart(start + items.length) : list.attrs, rest) : null;
  if (dir === -1) {
    const from = listPos - neighbor.nodeSize;
    const nodes = [movedList, neighbor, ...(restList ? [restList] : [])];
    tr.replaceWith(from, listPos + list.nodeSize, nodes);
    // The items moved from inside the list to the front of `from`.
    const oldItemsStart = $a.posAtIndex(startIndex, depth);
    const newItemsStart = from + 1;
    return newItemsStart - oldItemsStart;
  }
  const to = listPos + list.nodeSize + neighbor.nodeSize;
  const nodes = [...(restList ? [restList] : []), neighbor, movedList];
  tr.replaceWith(listPos, to, nodes);
  const oldItemsStart = $a.posAtIndex(startIndex, depth);
  const newItemsStart = listPos + (restList ? restList.nodeSize : 0) + neighbor.nodeSize + 1;
  return newItemsStart - oldItemsStart;
}

import { suggestChangesKey } from "@handlewithcare/prosemirror-suggest-changes";
import { CommandManager, createNodeFromContent, type ChainedCommands, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment, type Mark, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import { ReplaceStep } from "@tiptap/pm/transform";
import { isSuggestionMark, newId, readSuggestions, settle, suggest } from "@/components/docs/ext/suggest";
import { aroundPageStarts, FIGURE, findBlock, findIndexed, PAGE_START, posInBlock } from "@/components/docs/layer/anchor";
import { DOCS_EVENT, fireDocs } from "@/components/docs/typing/events";
import { isList, isListItem } from "@/components/docs/typing/lists";
import { markdownToHtml } from "@/components/docs/typing/markdown";
import { diffSegments } from "@/lib/anchors/remap";
import type { ResolvedOp, SkipReason, SuggestFormat, SuggestMarkFormat, SuggestStyle } from "@/lib/docs/assistant-suggestions";
import { inlineText, outOfIndex } from "@/lib/docs/blocks";
import { newBlockId, suggestionAuthor, type RichNode } from "@/lib/docs/schema";
import { blockPlaces } from "@/lib/docs/suggest-ops";

// The assistant's suggestions in the page editor (SPEC.md §29): the ops the
// model answered with, resolved against the paragraph index, land as
// suggestions authored by the assistant through Suggesting mode's own code.
// Each op is checked against the page as it stands; one that fails is
// skipped with its reason and the others land. The index reads the
// assistant's suggestions as not made yet, so the offsets of the ops stay
// true while the ones before them land. The lot is one transaction: one
// repaint, one undo step. A figure object is no words: an op on one is
// skipped as "object". A page start is no object: a change passes over it
// and keeps it.

/** The why of each op, by the id of a suggestion it made: its card shows it
    for this session. */
const whys = new Map<string, string>();
export const whyOf = (id: string): string | undefined => whys.get(id);

export type Landing = { ids: string[]; skipped: { i: number; reason: SkipReason }[] };

/** The ops as the author's suggestions (the assistant for the account that
    asked), after the suggestions `replacing` names are rejected (a new
    command in place of a pending one), all one undo step: the ids made, in
    the order of the text, and the ops skipped with their reasons. The
    page's selection maps through, and nothing scrolls. */
export function applyAssistantOps(editor: Editor, ops: readonly ResolvedOp[], author: string, replacing: readonly string[] = []): Landing {
  const tr = editor.state.tr;
  const pending = new Set(readSuggestions(tr.doc).flatMap((s) => (replacing.includes(s.id) ? [s.id] : [])));
  if (pending.size) settle(tr, false, pending);
  const made: string[] = [];
  const skipped: Landing["skipped"] = [];
  // The blocks' styles as the server read them (the assistant's
  // suggestions as not made), which no op of this landing changes.
  let places: ReturnType<typeof blockPlaces> | null = null;
  const styleOf = (blockId: string) => (places ??= blockPlaces(tr.doc.toJSON() as RichNode)).get(blockId)?.style;
  // A style change lands after the other ops: a line it makes a list line
  // still takes the words changed in it.
  for (const op of [...ops.filter((o) => o.op !== "set_style"), ...ops.filter((o) => o.op === "set_style")]) {
    const reason = land(editor, tr, op, author, made, styleOf);
    if (reason) skipped.push({ i: op.i, reason });
  }
  if (!tr.docChanged) return { ids: [], skipped };
  editor.view.dispatch(closeHistory(tr).setMeta(suggestChangesKey, { skip: true }));
  // Viewing mode hides suggestions: the page shows them in Editing mode.
  if (!editor.isEditable) fireDocs(editor, DOCS_EVENT.mode, "editing");
  return { ids: readSuggestions(tr.doc).flatMap((s) => (made.includes(s.id) ? [s.id] : [])), skipped };
}

/** One op on the page as it now stands: its suggestions added to `tr`, or
    why it did not land. */
function land(
  editor: Editor,
  tr: Transaction,
  op: ResolvedOp,
  author: string,
  made: string[],
  styleOf: (blockId: string) => SuggestStyle | null | undefined,
): SkipReason | null {
  // One edit on the page as it now stands, suggested under a new id. With
  // `then`, a second edit on the page after the first, under the same id:
  // one suggestion in two steps (a move: the copy added, then the original
  // struck), each tracked on its own so neither is read as the other.
  const commit = (
    build: (state: EditorState) => Transaction | SkipReason,
    then?: (state: EditorState) => Transaction | SkipReason,
  ): SkipReason | null => {
    const state = EditorState.create({ doc: tr.doc });
    const edit = build(state);
    if (typeof edit === "string") return edit;
    if (!edit.docChanged) return null;
    const id = newId(author);
    const first = suggest(edit, state, author, id);
    const steps = [...first.steps];
    if (then) {
      const next = EditorState.create({ doc: first.doc });
      const more = then(next);
      if (typeof more === "string") return more;
      if (more.docChanged) steps.push(...suggest(more, next, author, id).steps);
    }
    for (const step of steps) tr.step(step);
    whys.set(id, op.why);
    made.push(id);
    return null;
  };
  // An op that meets what an op before it in this landing changed is skipped
  // (a list toggled joins the list beside it). The asker's earlier
  // suggestions on these words, or on the blocks around them, give way: a
  // new op on them takes their place. Another person's stack, as the
  // assistant's for someone else do. A style change on the blocks around
  // gives way only to a new style, and meets only a new style: a line this
  // landing made a heading still takes a word fixed in it. An alignment is
  // a block's change of its own, and gives way only to a new alignment; so
  // are its spacing and its indent.
  const clear = (from: number, to: number, kind: "words" | BlockChange = "words"): SkipReason | null => {
    const earlier = new Set<string>();
    let meets = false;
    const counts = (node: PMNode, mark: Mark) =>
      node.isInline || mark.type.name !== "modification" || (kind !== "words" && changeOf(mark.attrs.attrName) === kind);
    tr.doc.nodesBetween(from, to, (node) => {
      for (const mark of node.marks) {
        const id = String(mark.attrs.id);
        if (!isSuggestionMark(mark) || suggestionAuthor(id) !== author || !counts(node, mark)) continue;
        if (made.includes(id)) meets = true;
        else earlier.add(id);
      }
    });
    if (meets) return "overlap";
    if (earlier.size) settle(tr, false, earlier);
    return null;
  };

  // A figure object is no words: an op that removes or replaces one is
  // skipped. Its caption is its words (rewrite_block, below).
  const named =
    op.op === "replace_blocks" || op.op === "remove_blocks"
      ? op.blockIds
      : op.op === "move_blocks"
        ? op.items.flatMap((item) => ("blockIds" in item ? item.blockIds : []))
        : op.op === "insert_blocks" || op.op === "rewrite_block"
          ? []
          : [op.blockId];
  if (named.some((blockId) => findIndexed(tr.doc, blockId)?.node.type.name === FIGURE)) return "object";

  // An object with words of its own takes them as its attribute: an
  // equation its TeX, a figure object its caption.
  const object = op.op === "rewrite_block" ? findIndexed(tr.doc, op.blockId) : null;
  const attr = object?.node.type.name === "blockMath" ? "latex" : object?.node.type.name === FIGURE ? "caption" : null;
  if (op.op === "rewrite_block" && object && !object.node.isTextblock) {
    if (!attr) return "object";
    if (String(object.node.attrs[attr] ?? "").trim() !== op.base.trim()) return "changed";
    return clear(object.pos, object.pos + 1, "style") ?? commit((state) => state.tr.setNodeAttribute(object.pos, attr, op.text));
  }

  switch (op.op) {
    case "replace_words":
    case "rewrite_block": {
      const block = findBlock(tr.doc, op.blockId);
      const text = block ? indexText(block.node) : null;
      const base = op.op === "rewrite_block" ? op.base : op.find;
      const at = text === null ? null : op.op === "rewrite_block" ? (text === op.base ? 0 : null) : wordsAt(text, op);
      const place = at === null ? null : range(tr.doc, op.blockId, at, at + base.length);
      if (at === null || !place) return "changed";
      let reason = clear(place.from, place.to);
      if (reason) return reason;
      // An inline equation stands in the words as $TeX$: a new equation
      // takes its place (Reject keeps the old one whole).
      const math = op.op === "replace_words" && TEX.test(op.find) && TEX.test(op.text.trim()) ? inlineMathAt(tr.doc, place.from, place.to) : null;
      if (math !== null) {
        return commit((state) => {
          const node = state.doc.nodeAt(math)!;
          return state.tr.replaceWith(math, math + node.nodeSize, node.type.create({ ...node.attrs, latex: op.text.trim().slice(1, -1) }, null, node.marks));
        });
      }
      // New words in a format of their own replace the words whole.
      const format = op.op === "replace_words" ? op.format : undefined;
      for (const s of format ? [{ start: 0, end: base.length, text: op.text }] : stretches(base, op.text)) {
        reason =
          commit((state) => {
            const r = range(state.doc, op.blockId, at + s.start, at + s.end);
            if (!r) return "changed";
            const whole = !holdsObject(state.doc, r.from, r.to) && wordsIn(state.doc, r.from, r.to) === base.slice(s.start, s.end);
            return whole ? replaceText(state.tr, r.from, r.to, s.text, format) : "object";
          }) ?? reason;
      }
      return reason;
    }
    case "format_words": {
      const block = findBlock(tr.doc, op.blockId);
      const at = block ? wordsAt(indexText(block.node), op) : null;
      const place = at === null ? null : range(tr.doc, op.blockId, at, at + op.find.length);
      if (at === null || !place) return "changed";
      return (
        clear(place.from, place.to) ??
        commit((state) => {
          const r = range(state.doc, op.blockId, at, at + op.find.length);
          if (!r) return "changed";
          if (wordsIn(state.doc, r.from, r.to) !== op.find) return "object";
          // The words take the format; a page start among them keeps its own.
          const edit = state.tr;
          for (const [from, to] of aroundPageStarts(state.doc, r.from, r.to)) formatWords(edit, from, to, op.format, op.value);
          return edit;
        })
      );
    }
    case "replace_blocks":
    case "remove_blocks": {
      const place = blocksRange(tr.doc, op.blockIds, op.base);
      if (!place) return "changed";
      if (holdsObject(tr.doc, place.from, place.to)) return "object";
      return (
        clear(place.from, place.to) ??
        commit((state) => {
          const r = blocksRange(state.doc, op.blockIds, op.base);
          if (!r) return "changed";
          if (op.op === "remove_blocks") return state.tr.delete(r.from, r.to);
          return state.tr.replaceWith(r.from, r.to, fit(state.doc.resolve(r.from).parent, blocksOf(state, op.markdown)));
        })
      );
    }
    case "move_blocks":
      return moveBlocks(tr, op, author, commit);
    case "insert_blocks": {
      // New blocks may follow a paragraph, or an object on its own line.
      const block = op.afterBlockId === null ? null : findIndexed(tr.doc, op.afterBlockId);
      if (op.afterBlockId !== null && !block) return "changed";
      return (
        (block && clear(block.pos, block.pos + 1)) ??
        commit((state) => {
          const at = insertion(state.doc, op.afterBlockId, blocksOf(state, op.markdown));
          return at ? state.tr.insert(at.pos, at.content) : "changed";
        })
      );
    }
    case "insert_row":
    case "insert_column":
    case "remove_row":
    case "remove_column":
    case "move_row":
    case "move_column": {
      const cell = cellOf(tr.doc, op.blockId);
      if (!cell) return "changed";
      if ((op.op === "move_row" || op.op === "move_column") && !cellOf(tr.doc, op.toBlockId)) return "changed";
      // A row op meets what this landing changed in the row, a column op or
      // a move what it changed in the table. The asker's earlier
      // suggestions in the table stack.
      const table = tr.doc.nodeAt(cell.table)!;
      const whole = op.op !== "insert_row" && op.op !== "remove_row";
      const row = tr.doc.resolve(cell.cell).before();
      const [from, to] = whole ? [cell.table, cell.table + table.nodeSize] : [row, row + tr.doc.nodeAt(row)!.nodeSize];
      let meets = false;
      tr.doc.nodesBetween(from, to, (node) => {
        meets ||= node.marks.some((mark) => isSuggestionMark(mark) && made.includes(String(mark.attrs.id)));
        return !meets;
      });
      return meets ? "overlap" : commit((state) => editTable(editor, state, op));
    }
    case "insert_footnote": {
      const block = findBlock(tr.doc, op.blockId);
      const at = block ? wordsAt(indexText(block.node), op) : null;
      const place = at === null ? null : range(tr.doc, op.blockId, at, at + op.find.length);
      if (at === null || !place) return "changed";
      return (
        clear(place.to, place.to) ??
        commit((state) => {
          const r = range(state.doc, op.blockId, at, at + op.find.length);
          return r ? (addFootnote(state, r.to, op.text) ?? "object") : "changed";
        })
      );
    }
    case "set_spacing":
    case "set_indent": {
      const block = findBlock(tr.doc, op.blockId);
      if (!block) return "changed";
      const values =
        op.op === "set_spacing"
          ? { lineSpacing: op.line, spaceBefore: op.before, spaceAfter: op.after }
          : { indentLeft: op.left, indentRight: op.right, indentFirstLine: op.firstLine };
      return (
        clear(block.pos, block.pos + 1, op.op === "set_spacing" ? "spacing" : "indent") ??
        commit((state) => {
          const found = findBlock(state.doc, op.blockId);
          if (!found) return "changed";
          // The attributes Line & paragraph spacing and the ruler set; a
          // 0 indent or space is none. Values the block has already: no change.
          const next = Object.fromEntries(
            Object.entries(values).flatMap(([name, value]) => (value === undefined ? [] : [[name, value === 0 && name !== "lineSpacing" ? null : value]])),
          );
          if (Object.entries(next).every(([name, value]) => (found.node.attrs[name] ?? null) === value)) return state.tr;
          return state.tr.setNodeMarkup(found.pos, undefined, { ...found.node.attrs, ...next });
        })
      );
    }
    case "set_alignment": {
      const block = findBlock(tr.doc, op.blockId);
      if (!block) return "changed";
      return (
        clear(block.pos, block.pos + 1, "alignment") ??
        commit((state) => {
          const found = findBlock(state.doc, op.blockId);
          if (!found) return "changed";
          // The toolbar's own command, on this block.
          const edit = state.tr.setSelection(TextSelection.create(state.doc, found.pos + 1));
          new CommandManager({ editor, state }).createChain(edit).setTextAlign(op.alignment).run();
          return edit;
        })
      );
    }
    case "set_style": {
      const block = findBlock(tr.doc, op.blockId);
      if (!block || styleOf(op.blockId) !== op.baseStyle) return "changed";
      return (
        clear(block.pos, block.pos + 1, "style") ??
        commit((state) => {
          const found = findBlock(state.doc, op.blockId);
          if (!found) return "changed";
          // The Styles menu's and the list buttons' own commands, on this block.
          const edit = state.tr.setSelection(TextSelection.create(state.doc, found.pos + 1));
          restyle(new CommandManager({ editor, state }).createChain(edit), op.baseStyle, op.style).run();
          return edit;
        })
      );
    }
  }
}

/** A block's words as the paragraph index reads them. */
const indexText = (node: PMNode) => inlineText(node.toJSON() as RichNode);

/** Where an op's words stand in the block's words now: where the server
    found them, else their one place in the block; null when they moved. */
function wordsAt(text: string, { start, end, find }: { start: number; end: number; find: string }): number | null {
  if (text.slice(start, end) === find) return start;
  const at = text.indexOf(find);
  return at >= 0 && at === text.lastIndexOf(find) ? at : null;
}

/** The positions of the block's words start..end, as the index counts them. */
function range(doc: PMNode, blockId: string, start: number, end: number): { from: number; to: number } | null {
  const block = findBlock(doc, blockId);
  if (!block) return null;
  const from = posInBlock(block.node, block.pos, start);
  return { from, to: end > start ? posInBlock(block.node, block.pos, end, true) : from };
}

/** The words between two positions of a block, as the index reads them. An
    offset inside a smart chip's label or an inline equation's TeX has no
    position of its own, so words that cut through one read otherwise here. */
const wordsIn = (doc: PMNode, from: number, to: number) => doc.slice(from, to).content.content.map(indexText).join("");

/** The range holds an object striking would remove: a smart chip, a
    footnote's number, an inline equation, a bookmark. A page start is none:
    a change passes over it and keeps it. */
function holdsObject(doc: PMNode, from: number, to: number): boolean {
  let found = false;
  doc.nodesBetween(from, to, (node) => {
    found ||= node.isInline && !node.isText && node.type.name !== "hardBreak" && node.type.name !== PAGE_START;
    return !found;
  });
  return found;
}

type Stretch = { start: number; end: number; text: string };

/** Where `text` differs from `base`, by word: the stretches of base's words
    that change, and the words that take their place. Changes two words
    apart or closer join; when most words change, the change is one
    stretch. */
function stretches(base: string, text: string): Stretch[] {
  const words = (s: string) => s.match(/\S+/g)?.length ?? 0;
  const segments = diffSegments(base, text);
  const same = segments.reduce((n, s) => n + (s.matched ? words(base.slice(s.oldStart, s.oldEnd)) : 0), 0);
  // More than 60% of the words change.
  const whole = 2 * same < 0.4 * (words(base) + words(text));
  const out: { oldStart: number; oldEnd: number; newStart: number; newEnd: number }[] = [];
  let between = 0;
  for (const s of segments) {
    if (s.matched) {
      between += words(base.slice(s.oldStart, s.oldEnd));
      continue;
    }
    const last = out.at(-1);
    if (last && (whole || between <= 2)) Object.assign(last, { oldEnd: s.oldEnd, newEnd: s.newEnd });
    else out.push({ oldStart: s.oldStart, oldEnd: s.oldEnd, newStart: s.newStart, newEnd: s.newEnd });
    between = 0;
  }
  // The spaces both sides share stay out of the change.
  const space = (i: number, j: number) => base[i] === text[j] && /\s/.test(base[i]);
  return out.flatMap(({ oldStart: a, oldEnd: b, newStart: c, newEnd: d }) => {
    for (; a < b && c < d && space(a, c); a++) c++;
    for (; b > a && d > c && space(b - 1, d - 1); b--) d--;
    return a < b || c < d ? [{ start: a, end: b, text: text.slice(c, d) }] : [];
  });
}

/** from..to replaced by `text`, a line break for each "\n" outside code:
    the new words take the marks where they start. A page start in the
    range stays where it stands: the words after it go, and the new words
    take the place of the words before it. */
function replaceText(tr: Transaction, from: number, to: number, text: string, format?: SuggestMarkFormat): Transaction {
  const [head, ...rest] = aroundPageStarts(tr.doc, from, to);
  // The last first, so the positions before them hold.
  for (const [a, b] of rest.reverse()) tr.delete(a, b);
  const [start, end] = head ?? [from, from];
  if (!text) return end > start ? tr.delete(start, end) : tr;
  const $from = tr.doc.resolve(start);
  const { schema } = tr.doc.type;
  const kept = (start === end ? $from.marks() : $from.marksAcross(tr.doc.resolve(end))) ?? [];
  const marks = format ? schema.marks[MARKS[format]].create().addToSet(kept) : kept;
  const lines = $from.parent.type.spec.code ? [text] : text.split("\n");
  const nodes = lines.flatMap((line, i) => [...(i ? [schema.nodes.hardBreak.create()] : []), ...(line ? [schema.text(line, marks)] : [])]);
  return tr.replaceWith(start, end, nodes);
}

const MARKS: Record<SuggestMarkFormat, string> = { bold: "bold", italic: "italic", underline: "underline", strikethrough: "strike" };
// The text style attribute each value format sets, as the toolbar sets it.
const TEXT_STYLE: Record<"color" | "highlight_color" | "font" | "size", string> = {
  color: "color",
  highlight_color: "backgroundColor",
  font: "fontFamily",
  size: "fontSize",
};

/** A format on from..to: a mark on (bold, italic, underline, strikethrough),
    a link to `value` ("" takes the link off), or a text style value (the
    color, the font, the size in points) set beside the words' other text
    styles, as the toolbar sets them. */
function formatWords(tr: Transaction, from: number, to: number, format: SuggestFormat, value = ""): void {
  const { marks } = tr.doc.type.schema;
  if (format === "link") {
    if (value) tr.addMark(from, to, marks.link.create({ href: value }));
    else tr.removeMark(from, to, marks.link);
    return;
  }
  if (format === "color" || format === "highlight_color" || format === "font" || format === "size") {
    const attrs = { [TEXT_STYLE[format]]: format === "size" ? `${value}pt` : value };
    tr.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText) return;
      const current = marks.textStyle.isInSet(node.marks)?.attrs ?? {};
      tr.addMark(Math.max(from, pos), Math.min(to, pos + node.nodeSize), marks.textStyle.create({ ...current, ...attrs }));
    });
    return;
  }
  tr.addMark(from, to, marks[MARKS[format]].create());
}

/** An inline equation's words: $TeX$. */
const TEX = /^\$[^$]+\$$/;

/** The position of the inline equation from..to holds whole and alone, or null. */
function inlineMathAt(doc: PMNode, from: number, to: number): number | null {
  const node = doc.nodeAt(from);
  return node?.type.name === "inlineMath" && to === from + node.nodeSize ? from : null;
}

/** The table a cell's paragraph stands in: the table's position, the
    cell's, and the row's index. */
function cellOf(doc: PMNode, blockId: string): { table: number; cell: number; row: number } | null {
  const block = findBlock(doc, blockId);
  if (!block) return null;
  const $pos = doc.resolve(block.pos);
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.spec.tableRole !== "table") continue;
    return { table: $pos.before(depth), cell: $pos.before(depth + 2), row: $pos.index(depth) };
  }
  return null;
}

/** A new cell with its words: its one paragraph holds them. */
function filledCell(cell: PMNode, words: string): PMNode {
  const paragraph = cell.firstChild;
  if (!paragraph || !words) return cell;
  return cell.type.create(cell.attrs, paragraph.type.create(paragraph.attrs, paragraph.type.schema.text(words)), cell.marks);
}

/** A row or column command's inserts made again on `state`, each new cell
    carrying its words: one insert per new row or cell, at the place it
    took. Words typed into cells the same change adds read to the library
    as more rows, so the words go in with the cells. Null when the command
    did more than insert (merged cells widened). */
function withWords(state: EditorState, scratch: Transaction, words: string[], row: boolean): Transaction | null {
  const inserts: { pos: number; node: PMNode }[] = [];
  for (let i = 0; i < scratch.steps.length; i++) {
    const step = scratch.steps[i];
    if (!(step instanceof ReplaceStep) || step.from !== step.to || step.slice.openStart || step.slice.openEnd || step.slice.content.childCount !== 1) return null;
    inserts.push({ pos: scratch.mapping.slice(0, i).invert().map(step.from), node: step.slice.content.firstChild! });
  }
  inserts.sort((a, b) => a.pos - b.pos);
  const filled = inserts.map(({ pos, node }, k) => {
    if (!row) return { pos, node: filledCell(node, words[k] ?? "") };
    const cells: PMNode[] = [];
    node.forEach((cell, _offset, j) => cells.push(filledCell(cell, words[j] ?? "")));
    return { pos, node: node.type.create(node.attrs, cells, node.marks) };
  });
  const edit = state.tr;
  // The last first, so the places before it hold.
  for (const { pos, node } of filled.reverse()) edit.insert(pos, node);
  return edit;
}

/** A row or a column added, removed, or moved, as the table menu does it,
    on the cell `op.blockId` names; new cells take their words. A row that
    holds or crosses merged cells does not move. */
function editTable(
  editor: Editor,
  state: EditorState,
  op: Extract<ResolvedOp, { op: "insert_row" | "insert_column" | "remove_row" | "remove_column" | "move_row" | "move_column" }>,
): Transaction | SkipReason {
  const at = cellOf(state.doc, op.blockId);
  if (!at) return "changed";
  const edit = state.tr.setSelection(TextSelection.create(state.doc, at.cell + 2));
  const chain = new CommandManager({ editor, state }).createChain(edit);
  if (op.op === "remove_row") return chain.deleteRow().run() ? edit : "object";
  if (op.op === "remove_column") return chain.deleteColumn().run() ? edit : "object";
  if (op.op === "insert_row" || op.op === "insert_column") {
    const added = op.op === "insert_row" ? (op.where === "above" ? chain.addRowBefore() : chain.addRowAfter()) : op.where === "left" ? chain.addColumnBefore() : chain.addColumnAfter();
    if (!added.run()) return "object";
    return withWords(state, edit, op.cells, op.op === "insert_row") ?? "object";
  }
  if (op.op === "move_column") return moveColumn(state, edit, at, op);
  // move_row: the row out, and a copy of it where it goes; its paragraphs
  // take new ids, as moved blocks do.
  const to = cellOf(state.doc, op.toBlockId);
  const map = TableMap.get(state.doc.nodeAt(at.table)!);
  const merged = (row: number) => map.map.slice(row * map.width, (row + 1) * map.width).some((cell, col) => (row > 0 && map.map[(row - 1) * map.width + col] === cell) || (row < map.height - 1 && map.map[(row + 1) * map.width + col] === cell));
  if (!to || to.table !== at.table || merged(at.row)) return "object";
  const rows = state.doc.nodeAt(at.table)!;
  const start = (index: number) => {
    let pos = at.table + 1;
    for (let i = 0; i < index; i++) pos += rows.child(i).nodeSize;
    return pos;
  };
  const target = to.row + (op.where === "below" ? 1 : 0);
  // Where it stands already: no change.
  if (target === at.row || target === at.row + 1) return edit;
  const row = rows.child(at.row);
  const copy = row.type.create(row.attrs, freshIds(row.content), row.marks);
  const from = start(at.row);
  edit.insert(start(target), copy);
  const moved = edit.mapping.map(from);
  edit.delete(moved, moved + row.nodeSize);
  return edit;
}

/** A column out, cell by cell, and a copy of each cell where the column
    goes, in the same rows; the copies' paragraphs take new ids, as a moved
    row's do. A table with a merged cell in either column does not move. */
function moveColumn(
  state: EditorState,
  edit: Transaction,
  at: { table: number; cell: number },
  op: Extract<ResolvedOp, { op: "move_column" }>,
): Transaction | SkipReason {
  const to = cellOf(state.doc, op.toBlockId);
  const table = state.doc.nodeAt(at.table)!;
  if (!to || to.table !== at.table) return "object";
  const map = TableMap.get(table);
  const start = at.table + 1;
  const col = map.colCount(at.cell - start);
  const target = map.colCount(to.cell - start) + (op.where === "right" ? 1 : 0);
  const merged = (c: number) =>
    c < map.width && Array.from({ length: map.height }, (_, r) => table.nodeAt(map.map[r * map.width + c])!).some((cell) => cell.attrs.colspan > 1 || cell.attrs.rowspan > 1);
  if (merged(col) || merged(target)) return "object";
  // Where it stands already: no change.
  if (target === col || target === col + 1) return edit;
  let rowStart = start;
  table.forEach((row, _offset, r) => {
    const cellPos = start + map.map[r * map.width + col];
    const cell = state.doc.nodeAt(cellPos)!;
    const place = target < map.width ? start + map.map[r * map.width + target] : rowStart + row.nodeSize - 1;
    edit.insert(edit.mapping.map(place), cell.type.create(cell.attrs, freshIds(cell.content), cell.marks));
    const moved = edit.mapping.map(cellPos);
    edit.delete(moved, moved + cell.nodeSize);
    rowStart += row.nodeSize;
  });
  return edit;
}

/** What a row moves as (lib/assistant/reorder-run.ts richTextUnits): the
    item of a top-level list that holds it, with the lines nested under it,
    else the top-level node that holds it. */
type RowNode = { from: number; to: number; item: { list: PMNode; listFrom: number; listTo: number } | null };

function rowNode(doc: PMNode, blockId: string): RowNode | null {
  const found = findIndexed(doc, blockId);
  if (!found) return null;
  const $pos = doc.resolve(found.pos);
  if ($pos.depth === 0) return { from: found.pos, to: found.pos + found.node.nodeSize, item: null };
  if ($pos.depth >= 2 && isList($pos.node(1)) && isListItem($pos.node(2))) {
    return { from: $pos.before(2), to: $pos.after(2), item: { list: $pos.node(1), listFrom: $pos.before(1), listTo: $pos.after(1) } };
  }
  return { from: $pos.before(1), to: $pos.after(1), item: null };
}

/** `node` as an item of `list`: itself when it is one, else the list's
    kind of item with the same content (a task line into a bulleted list). */
function itemOf(list: PMNode, node: PMNode): PMNode {
  const type = list.type.contentMatch.defaultType;
  return !type || node.type === type ? node : type.create(null, node.content);
}

/** The order pass's move (lib/assistant/reorder.ts): its nodes, each while
    it holds exactly the rows and the words the server read, go right after
    the node that holds afterBlockId, with the new headings among them, as
    one suggestion: the nodes struck where they stood and added where they
    go. Accept moves them, Reject leaves them. A line of a list moves as its
    item: after a line, into that line's list; after a block, into the list
    of its kind beside the place, else in a list of its kind of its own. A
    list every item of which moves goes with them. A block cannot go between
    the lines of a list: that move is skipped. A node holds the asker's earlier suggestions
    (the same command's windows changed its words, in this landing or before
    it): the copy carries them accepted and the place it leaves takes them
    back, so the move is the one suggestion on those words. A node with
    another author's suggestion is skipped: its copy would repeat it. */
function moveBlocks(
  tr: Transaction,
  op: Extract<ResolvedOp, { op: "move_blocks" }>,
  author: string,
  commit: (build: (state: EditorState) => Transaction | SkipReason, then?: (state: EditorState) => Transaction | SkipReason) => SkipReason | null,
): SkipReason | null {
  const units = op.items.flatMap((item) => ("blockIds" in item ? [item] : []));
  const rangeOf = (doc: PMNode, unit: { blockIds: string[] }) => rowNode(doc, unit.blockIds[0]);
  const own = new Set<string>();
  for (const unit of units) {
    const r = rangeOf(tr.doc, unit);
    if (!r) return "changed";
    let other = false;
    tr.doc.nodesBetween(r.from, r.to, (node) => {
      for (const mark of node.marks) {
        if (!isSuggestionMark(mark)) continue;
        const id = String(mark.attrs.id);
        if (suggestionAuthor(id) !== author) other = true;
        else own.add(id);
      }
    });
    if (other) return "overlap";
  }
  // The copies: each node with the asker's suggestions in it accepted. A node
  // those suggestions remove whole has no copy: the move takes it away.
  const accepted = EditorState.create({ doc: tr.doc }).tr;
  if (own.size) settle(accepted, true, own);
  const copies = units.map((unit) => {
    for (const id of unit.blockIds) {
      const r = rowNode(accepted.doc, id);
      if (r) return { content: accepted.doc.slice(r.from, r.to).content, list: r.item?.list.type.name ?? null };
    }
    return { content: Fragment.empty, list: null };
  });
  if (own.size) settle(tr, false, own);
  // The nodes as the server read them: the rows and their words.
  for (const unit of units) {
    const r = rangeOf(tr.doc, unit);
    if (!r || rowsBetween(tr.doc, r.from, r.to).join("\n") !== unit.blockIds.join("\n")) return "changed";
    if (unit.blockIds.some((id, k) => {
      const block = findIndexed(tr.doc, id);
      return !block || indexText(block.node) !== unit.base[k];
    })) return "changed";
  }
  const firstRows = new Set(units.map((unit) => unit.blockIds[0]));
  // The items of `list` that are moved originals: a list whose every item moves goes whole.
  const wholeList = (list: PMNode) => {
    let every = true;
    list.forEach((child) => {
      let holds = false;
      child.descendants((node) => {
        if (typeof node.attrs.blockId === "string" && firstRows.has(node.attrs.blockId)) holds = true;
        return !holds;
      });
      if (!holds) every = false;
    });
    return every;
  };
  return commit(
    // The copies, where they go.
    (state) => {
      const { schema } = state;
      const ranges = units.map((unit) => rangeOf(state.doc, unit));
      if (ranges.some((r) => !r)) return "changed";
      const moved = ranges as RowNode[];
      const after = op.afterBlockId === null ? null : rowNode(state.doc, op.afterBlockId);
      if (op.afterBlockId !== null && !after) return "changed";
      const at = after ? after.to : 0;
      if (moved.some((r) => r.from < at && at < r.to)) return "changed";
      // What goes in: each moved node with the list it came from, the new blocks.
      let u = 0;
      const parts: { node: PMNode; list: string | null }[] = [];
      for (const item of op.items) {
        if ("blockIds" in item) {
          const copy = copies[u++];
          movedCopy(copy.content).forEach((node) => parts.push({ node, list: isListItem(node) ? copy.list : null }));
        } else blocksOf(state, item.markdown).forEach((node) => parts.push({ node, list: null }));
      }
      if (parts.length === 0) return "changed";
      const gone = (listFrom: number) => {
        const list = state.doc.nodeAt(listFrom);
        return !!list && isList(list) && wholeList(list);
      };
      // Items in a row of one list's kind become one list of that kind.
      const topLevel = (ps: typeof parts): PMNode[] => {
        const out: PMNode[] = [];
        let run: PMNode[] = [];
        let kind: string | null = null;
        const flush = () => {
          if (run.length > 0 && kind) out.push(schema.nodes[kind].create(null, run));
          run = [];
          kind = null;
        };
        for (const part of ps) {
          if (!part.list) {
            flush();
            out.push(part.node);
            continue;
          }
          if (kind && kind !== part.list) flush();
          kind = part.list;
          run.push(part.node);
        }
        flush();
        return out;
      };
      const allItems = parts.every((part) => part.list !== null);
      const edit = state.tr;
      let pos = at;
      let nodes: PMNode[];
      if (after?.item) {
        const { list, listFrom, listTo } = after.item;
        if (gone(listFrom)) return "changed";
        if (allItems) nodes = parts.map((part) => itemOf(list, part.node));
        else if (at === listTo - 1) {
          pos = listTo;
          nodes = topLevel(parts);
        } else return "notText"; // A block cannot go between the lines of a list.
      } else {
        const kinds = new Set(parts.map((part) => part.list));
        const $at = state.doc.resolve(at);
        const before = $at.nodeBefore;
        const next = $at.nodeAfter;
        const kind = allItems && kinds.size === 1 ? parts[0].list! : null;
        if (kind && before && before.type.name === kind && !gone(at - before.nodeSize)) {
          pos = at - 1;
          nodes = parts.map((part) => itemOf(before, part.node));
        } else if (kind && next && next.type.name === kind && !gone(at)) {
          pos = at + 1;
          nodes = parts.map((part) => itemOf(next, part.node));
        } else nodes = topLevel(parts);
      }
      edit.insert(pos, Fragment.fromArray(nodes));
      return edit;
    },
    // The originals, struck: a node, or a list whose every item moves.
    (state) => {
      const ranges = units.map((unit) => rangeOf(state.doc, unit));
      if (ranges.some((r) => !r)) return "changed";
      const moved = ranges as RowNode[];
      const deletions: { from: number; to: number }[] = moved.filter((r) => !r.item);
      const byList = new Map<number, RowNode[]>();
      for (const r of moved) if (r.item) byList.set(r.item.listFrom, [...(byList.get(r.item.listFrom) ?? []), r]);
      for (const [listFrom, items] of byList) {
        if (wholeList(items[0].item!.list)) deletions.push({ from: listFrom, to: items[0].item!.listTo });
        else deletions.push(...items);
      }
      const edit = state.tr;
      for (const r of [...deletions].sort((a, b) => b.from - a.from)) edit.delete(edit.mapping.map(r.from), edit.mapping.map(r.to));
      return edit;
    },
  );
}

/** A moved block's copy: each indexed node takes a new id from the editor
    and names the block it copies, whose id it takes once the move is
    accepted (ext/suggest.ts settle), so the anchors on it stay. */
function movedCopy(content: Fragment): Fragment {
  const out: PMNode[] = [];
  content.forEach((node) => {
    const id = node.attrs.blockId;
    const attrs = "blockId" in node.attrs ? { ...node.attrs, blockId: null, movedFrom: typeof id === "string" ? id : null } : node.attrs;
    out.push(node.isText ? node : node.type.create(attrs, movedCopy(node.content), node.marks));
  });
  return Fragment.fromArray(out);
}

/** Content with every block id taken off: the editor gives each a new one. */
function freshIds(content: Fragment): Fragment {
  const out: PMNode[] = [];
  content.forEach((node) => {
    const attrs = "blockId" in node.attrs ? { ...node.attrs, blockId: null } : node.attrs;
    out.push(node.isText ? node : node.type.create(attrs, freshIds(node.content), node.marks));
  });
  return Fragment.fromArray(out);
}

// What the footnote numbers may not end: a body that ends on an object gets
// an empty line before the footnotes, as insert/footnotes.ts normalizes it.
const LINE_ENDS = new Set(["paragraph", "heading", "bulletList", "orderedList", "taskList"]);

/** A footnote at `pos`: its number there, and its words in the footnotes at
    the document's end, in the numbers' order, as Insert footnote makes it.
    Null where a footnote cannot stand (code, a footnote). */
function addFootnote(state: EditorState, pos: number, words: string): Transaction | null {
  const { schema } = state;
  const { footnoteReference: ref, footnotes: block, footnote: note, paragraph } = schema.nodes;
  const $pos = state.doc.resolve(pos);
  if (!ref || !block || !note || !paragraph || !$pos.parent.isTextblock || $pos.parent.type.spec.code) return null;
  for (let depth = $pos.depth; depth > 0; depth--) if ($pos.node(depth).type === note) return null;
  const id = newBlockId();
  const edit = state.tr.insert(pos, ref.create({ footnoteId: id }));
  let before = 0;
  edit.doc.descendants((node, at) => {
    if (node.type === block) return false;
    if (node.type === ref && at < pos) before++;
    return true;
  });
  const footnote = note.create({ footnoteId: id }, paragraph.create({ blockId: newBlockId() }, schema.text(words)));
  const last = edit.doc.lastChild;
  if (last?.type === block) {
    let at = edit.doc.content.size - last.nodeSize + 1;
    for (let i = 0; i < Math.min(before, last.childCount); i++) at += last.child(i).nodeSize;
    return edit.insert(at, footnote);
  }
  const line = last && !LINE_ENDS.has(last.type.name) ? [paragraph.create({ blockId: newBlockId() })] : [];
  return edit.insert(edit.doc.content.size, [...line, block.create(null, footnote)]);
}

/** Markdown as the page editor's blocks, parsed as Paste from Markdown
    parses it. */
function blocksOf(state: EditorState, markdown: string): Fragment {
  // An image on a line of its own is an image block, as By URL inserts it;
  // the lines between are Markdown.
  const nodes: PMNode[] = [];
  let text: string[] = [];
  const flush = () => {
    if (text.join("").trim()) {
      const html = markdownToHtml(text.join("\n"));
      (createNodeFromContent(html, state.schema, { slice: false, parseOptions: { preserveWhitespace: "full" } }) as PMNode).content.forEach((node) => nodes.push(node));
    }
    text = [];
  };
  for (const line of markdown.split("\n")) {
    const image = IMAGE_LINE.exec(line);
    if (image && state.schema.nodes.image) {
      flush();
      nodes.push(state.schema.nodes.image.create({ src: image[2], alt: image[1] }));
    } else text.push(line);
  }
  flush();
  return Fragment.fromArray(nodes);
}

// An image line as the server keeps it (lib/docs/suggest-ops.ts): a web address.
const IMAGE_LINE = /^\s*!\[([^\]\n]*)\]\((https?:\/\/\S+?)\)\s*$/i;

/** The block changes that give way only to their own kind. */
type BlockChange = "style" | "alignment" | "spacing" | "indent";
const SPACING = new Set(["lineSpacing", "spaceBefore", "spaceAfter"]);
const INDENT = new Set(["indentLeft", "indentRight", "indentFirstLine"]);
const changeOf = (attrName: unknown): BlockChange =>
  attrName === "textAlign" ? "alignment" : SPACING.has(String(attrName)) ? "spacing" : INDENT.has(String(attrName)) ? "indent" : "style";

/** New blocks in a list: a list of its kind goes in as its lines. */
function fit(parent: PMNode, content: Fragment): Fragment {
  const only = content.childCount === 1 ? content.firstChild : null;
  return only && isList(parent) && only.type === parent.type ? only.content : content;
}

/** Where new blocks go after a block: into its list as lines after its line
    when they are a list of its kind, else after the list it stands in, else
    right after it; with no block, at the document's start. */
function insertion(doc: PMNode, afterBlockId: string | null, content: Fragment): { pos: number; content: Fragment } | null {
  if (afterBlockId === null) return { pos: 0, content };
  const block = findIndexed(doc, afterBlockId);
  if (!block) return null;
  const $pos = doc.resolve(block.pos);
  let inner = 0;
  let outer = 0;
  for (let depth = $pos.depth; depth > 0; depth--) {
    if (!isList($pos.node(depth))) continue;
    inner ||= depth;
    outer = depth;
  }
  const lines = inner ? fit($pos.node(inner), content) : content;
  if (lines !== content) return { pos: $pos.after(inner + 1), content: lines };
  return { pos: outer ? $pos.after(outer) : block.pos + block.node.nodeSize, content };
}

/** The whole blocks these rows stand for, while they still hold the words
    `base` records and no other row stands between them: a list line with
    its list item, and a list whose every line goes with the list. */
function blocksRange(doc: PMNode, blockIds: readonly string[], base: readonly string[]): { from: number; to: number } | null {
  const blocks = blockIds.map((id) => findBlock(doc, id));
  const [first, last] = [blocks[0], blocks[blocks.length - 1]];
  if (!first || !last || blocks.some((b, i) => !b || indexText(b.node) !== base[i])) return null;
  let range = doc.resolve(first.pos).blockRange(doc.resolve(last.pos + last.node.nodeSize));
  while (range && range.depth > 0 && range.startIndex === 0 && range.endIndex === range.parent.childCount && (isList(range.parent) || isListItem(range.parent))) {
    range = doc.resolve(range.$from.before(range.depth)).blockRange(doc.resolve(range.$from.after(range.depth)));
  }
  if (!range || rowsBetween(doc, range.start, range.end).join("\n") !== blockIds.join("\n")) return null;
  return { from: range.start, to: range.end };
}

/** The index rows between two positions, in order. */
function rowsBetween(doc: PMNode, from: number, to: number): string[] {
  const ids: string[] = [];
  doc.nodesBetween(from, to, (node) => {
    if (node.marks.some((m) => outOfIndex(m.type.name, m.attrs.id))) return false;
    if (typeof node.attrs.blockId !== "string") return true;
    ids.push(node.attrs.blockId);
    return false;
  });
  return ids;
}

type ListStyle = "bulleted" | "numbered" | "checklist";
const LISTS: Record<ListStyle, (chain: ChainedCommands) => ChainedCommands> = {
  bulleted: (chain) => chain.toggleBulletList(),
  numbered: (chain) => chain.toggleOrderedList(),
  checklist: (chain) => chain.toggleTaskList(),
};
const isListStyle = (style: SuggestStyle): style is ListStyle => style in LISTS;

/** A block from one style to another, as the list buttons and the Styles
    menu take it: a list line leaves its list for a paragraph style. */
function restyle(chain: ChainedCommands, from: SuggestStyle, to: SuggestStyle): ChainedCommands {
  if (isListStyle(to)) return LISTS[to](chain);
  if (!isListStyle(from)) return chain.setDocStyle(to);
  const lifted = LISTS[from](chain);
  return to === "normal" ? lifted : lifted.setDocStyle(to);
}

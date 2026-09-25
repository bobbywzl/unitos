import { suggestChangesKey } from "@handlewithcare/prosemirror-suggest-changes";
import { CommandManager, createNodeFromContent, type ChainedCommands, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Fragment, Node as PMNode } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import { isSuggestionMark, newId, readSuggestions, settle, suggest } from "@/components/docs/ext/suggest";
import { findBlock, posInBlock } from "@/components/docs/layer/anchor";
import { blockStyle } from "@/components/docs/toolbar/styles";
import { DOCS_EVENT, fireDocs } from "@/components/docs/typing/events";
import { isList, isListItem } from "@/components/docs/typing/lists";
import { markdownToHtml } from "@/components/docs/typing/markdown";
import { diffSegments } from "@/lib/anchors/remap";
import type { ResolvedOp, SkipReason, SuggestFormat, SuggestStyle } from "@/lib/docs/assistant-suggestions";
import { inlineText, outOfIndex } from "@/lib/docs/blocks";
import { suggestionAuthor, type RichNode } from "@/lib/docs/schema";

// The assistant's suggestions in the page editor (SPEC.md §29): the ops the
// model answered with, resolved against the paragraph index, land as
// suggestions authored by the assistant through Suggesting mode's own code.
// Each op is checked against the page as it stands; one that fails is
// skipped with its reason and the others land. The index reads the
// assistant's suggestions as not made yet, so the offsets of the ops stay
// true while the ones before them land. The lot is one transaction: one
// repaint, one undo step.

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
  for (const op of ops) {
    const reason = land(editor, tr, op, author, made);
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
function land(editor: Editor, tr: Transaction, op: ResolvedOp, author: string, made: string[]): SkipReason | null {
  // One edit on the page as it now stands, suggested under a new id.
  const commit = (build: (state: EditorState) => Transaction | SkipReason): SkipReason | null => {
    const state = EditorState.create({ doc: tr.doc });
    const edit = build(state);
    if (typeof edit === "string") return edit;
    if (!edit.docChanged) return null;
    const id = newId(author);
    for (const step of suggest(edit, state, author, id).steps) tr.step(step);
    whys.set(id, op.why);
    made.push(id);
    return null;
  };
  // The asker's earlier suggestions on these words, or on the blocks around
  // them, give way: a new op on them takes their place. Another person's
  // stack, as the assistant's for someone else do. A style change on the
  // blocks around gives way only to a new style.
  const giveWay = (from: number, to: number, style = false) => {
    const ids = new Set<string>();
    tr.doc.nodesBetween(from, to, (node) => {
      for (const mark of node.marks) {
        const id = String(mark.attrs.id);
        if (!isSuggestionMark(mark) || suggestionAuthor(id) !== author || made.includes(id)) continue;
        if (node.isInline || style || mark.type.name !== "modification") ids.add(id);
      }
    });
    if (ids.size) settle(tr, false, ids);
  };

  switch (op.op) {
    case "replace_words":
    case "rewrite_block": {
      const block = findBlock(tr.doc, op.blockId);
      const text = block ? indexText(block.node) : null;
      const base = op.op === "rewrite_block" ? op.base : op.find;
      const at = text === null ? null : op.op === "rewrite_block" ? (text === op.base ? 0 : null) : wordsAt(text, op);
      const place = at === null ? null : range(tr.doc, op.blockId, at, at + base.length);
      if (at === null || !place) return "changed";
      giveWay(place.from, place.to);
      let reason: SkipReason | null = null;
      for (const s of stretches(base, op.text)) {
        reason =
          commit((state) => {
            const r = range(state.doc, op.blockId, at + s.start, at + s.end);
            if (!r) return "changed";
            return holdsObject(state.doc, r.from, r.to) ? "object" : replaceText(state.tr, r.from, r.to, s.text);
          }) ?? reason;
      }
      return reason;
    }
    case "format_words": {
      const block = findBlock(tr.doc, op.blockId);
      const at = block ? wordsAt(indexText(block.node), op) : null;
      const place = at === null ? null : range(tr.doc, op.blockId, at, at + op.find.length);
      if (at === null || !place) return "changed";
      giveWay(place.from, place.to);
      return commit((state) => {
        const r = range(state.doc, op.blockId, at, at + op.find.length);
        return r ? state.tr.addMark(r.from, r.to, state.schema.marks[MARKS[op.format]].create()) : "changed";
      });
    }
    case "replace_blocks":
    case "remove_blocks": {
      const place = blocksRange(tr.doc, op.blockIds, op.base);
      if (!place) return "changed";
      if (holdsObject(tr.doc, place.from, place.to)) return "object";
      giveWay(place.from, place.to);
      return commit((state) => {
        const r = blocksRange(state.doc, op.blockIds, op.base);
        if (!r) return "changed";
        if (op.op === "remove_blocks") return state.tr.delete(r.from, r.to);
        return state.tr.replaceWith(r.from, r.to, fit(state.doc.resolve(r.from).parent, blocksOf(state, op.markdown)));
      });
    }
    case "insert_blocks": {
      if (op.afterBlockId !== null && !findBlock(tr.doc, op.afterBlockId)) return "changed";
      return commit((state) => {
        const at = insertion(state.doc, op.afterBlockId, blocksOf(state, op.markdown));
        return at ? state.tr.insert(at.pos, at.content) : "changed";
      });
    }
    case "set_style": {
      const block = findBlock(tr.doc, op.blockId);
      if (!block || styleOf(tr.doc, block) !== op.baseStyle) return "changed";
      giveWay(block.pos, block.pos + 1, true);
      return commit((state) => {
        const found = findBlock(state.doc, op.blockId);
        if (!found) return "changed";
        // The Styles menu's and the list buttons' own commands, on this block.
        const edit = state.tr.setSelection(TextSelection.create(state.doc, found.pos + 1));
        restyle(new CommandManager({ editor, state }).createChain(edit), op.baseStyle, op.style).run();
        return edit;
      });
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

/** The range holds an object striking would remove: a smart chip, a
    footnote's number, an inline equation, a bookmark. */
function holdsObject(doc: PMNode, from: number, to: number): boolean {
  let found = false;
  doc.nodesBetween(from, to, (node) => {
    found ||= node.isInline && !node.isText && node.type.name !== "hardBreak";
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
    the new words take the marks where they start. */
function replaceText(tr: Transaction, from: number, to: number, text: string): Transaction {
  if (!text) return tr.delete(from, to);
  const $from = tr.doc.resolve(from);
  const marks = (from === to ? $from.marks() : $from.marksAcross(tr.doc.resolve(to))) ?? [];
  const { schema } = tr.doc.type;
  const lines = $from.parent.type.spec.code ? [text] : text.split("\n");
  const nodes = lines.flatMap((line, i) => [...(i ? [schema.nodes.hardBreak.create()] : []), ...(line ? [schema.text(line, marks)] : [])]);
  return tr.replaceWith(from, to, nodes);
}

const MARKS: Record<SuggestFormat, string> = { bold: "bold", italic: "italic", underline: "underline", strikethrough: "strike" };

/** Markdown as the page editor's blocks, parsed as Paste from Markdown
    parses it. */
function blocksOf(state: EditorState, markdown: string): Fragment {
  const html = markdownToHtml(markdown);
  return (createNodeFromContent(html, state.schema, { slice: false, parseOptions: { preserveWhitespace: "full" } }) as PMNode).content;
}

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
  const block = findBlock(doc, afterBlockId);
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
const LIST_STYLE: Record<string, ListStyle> = { bulletList: "bulleted", orderedList: "numbered", taskList: "checklist" };
const isListStyle = (style: SuggestStyle): style is ListStyle => style in LISTS;

/** A block's style as the ops name it: the list of a list line, else its
    paragraph style. */
function styleOf(doc: PMNode, block: { node: PMNode; pos: number }): SuggestStyle {
  const $pos = doc.resolve(block.pos);
  const line = isListItem($pos.parent) && $pos.index() === 0;
  return (line && LIST_STYLE[$pos.node(-1).type.name]) || blockStyle(block.node);
}

/** A block from one style to another, as the list buttons and the Styles
    menu take it: a list line leaves its list for a paragraph style. */
function restyle(chain: ChainedCommands, from: SuggestStyle, to: SuggestStyle): ChainedCommands {
  if (isListStyle(to)) return LISTS[to](chain);
  if (!isListStyle(from)) return chain.setDocStyle(to);
  const lifted = LISTS[from](chain);
  return to === "normal" ? lifted : lifted.setDocStyle(to);
}

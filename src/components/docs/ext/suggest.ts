import { Extension, Mark, type AnyExtension, type Editor } from "@tiptap/core";
import type { Fragment, Mark as PMMark, MarkSpec, Node as PMNode } from "@tiptap/pm/model";
import { AllSelection, EditorState, Plugin, Selection, TextSelection, type Transaction } from "@tiptap/pm/state";
import {
  AddMarkStep,
  AddNodeMarkStep,
  AttrStep,
  Mapping,
  RemoveMarkStep,
  ReplaceAroundStep,
  ReplaceStep,
  replaceStep,
  Transform,
  type Step,
} from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  applySuggestion,
  applySuggestions,
  deletion,
  insertion,
  modification,
  revertSuggestion,
  revertSuggestions,
  suggestChanges,
  suggestChangesKey,
  transformToSuggestionTransaction,
} from "@handlewithcare/prosemirror-suggest-changes";
import { isList, isListItem } from "@/components/docs/typing/lists";
import { SUGGESTION_MARK_TYPES, suggestionAuthor, ZWSP } from "@/lib/docs/schema";

// Suggesting mode (SPEC.md §29), on @handlewithcare/prosemirror-suggest-changes.

const SPECS = { insertion, deletion, modification } as const;
type Kind = keyof typeof SPECS;
const TAGS: Record<Kind, string> = { insertion: "ins", deletion: "del", modification: "span" };

export const isSuggestionMark = (mark: PMMark) => SUGGESTION_MARK_TYPES.has(mark.type.name);
/** Words added or removed: an insertion or a deletion mark. */
const isWordMark = (mark: PMMark) => mark.type.name === "insertion" || mark.type.name === "deletion";
const isModification = (mark: PMMark) => mark.type.name === "modification";

/** The suggestion the marks carry; a deletion first, as it can lie over
    another person's added words. */
const idIn = (marks: readonly PMMark[] | undefined) => {
  const mark = marks?.find((m) => m.type.name === "deletion") ?? marks?.find(isSuggestionMark);
  return mark ? String(mark.attrs.id) : null;
};

/** The suggestion the caret stands in or touches, or a selection starts in. */
export function suggestionAt(state: EditorState): string | null {
  const { $from, empty } = state.selection;
  let id = (empty ? idIn($from.nodeBefore?.marks) : null) ?? idIn($from.nodeAfter?.marks);
  for (let depth = $from.depth; !id && depth > 0; depth--) id = idIn($from.node(depth).marks);
  return id;
}

type Side = "added" | "removed";

/** One suggestion, as its card reads it. */
export type Suggestion = {
  id: string;
  /** Where its words start on the page. */
  from: number;
  /** What it adds and what it removes, in the order of the text: words,
      "¶" where a paragraph breaks, and objects (an image, a line break). */
  added: (string | PMNode)[];
  removed: (string | PMNode)[];
  /** Its format changes: each modification mark, with the node it is on. */
  formats: { mark: PMMark; node: PMNode }[];
  /** The whole blocks it adds and removes: [from, to] each. */
  blocks: Record<Side, [number, number][]>;
  /** It takes whole blocks out and puts their words back as whole blocks:
      "move" when they come back elsewhere or in another order; else a list
      changed where they stand, [the list before, the list after] ("" for
      none) at the first line that changed. */
  same: "move" | [string, string] | null;
};

type Draft = Suggestion & {
  /** Where each of its marks stands. */
  at: number[];
  last: Record<Side, number>;
  inline: boolean;
  texts: Record<Side, string[]>;
  lists: Record<Side, string[]>;
};

const bySide = <T>(make: () => T): Record<Side, T> => ({ added: make(), removed: make() });

/** The list a text block stands in: its type's name, or "". */
function listOf(doc: PMNode, pos: number): string {
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth--) if (isList($pos.node(depth))) return $pos.node(depth).type.name;
  return "";
}

/** The block a paragraph stands for: with the list item and the list
    around it while they hold nothing else. */
function outerBlock(doc: PMNode, pos: number): [number, number] {
  const $pos = doc.resolve(pos);
  let depth = $pos.depth;
  while (depth > 0 && $pos.node(depth).childCount === 1 && (isList($pos.node(depth)) || isListItem($pos.node(depth)))) depth--;
  const from = depth === $pos.depth ? pos : $pos.before(depth + 1);
  return [from, from + (doc.nodeAt(from)?.nodeSize ?? 0)];
}

/** The deletion that strikes every word of a text block, if one does. */
function struckBy(node: PMNode): PMMark | undefined {
  const mark = node.firstChild?.marks.find((m) => m.type.name === "deletion");
  return mark && node.content.content.every((child) => mark.isInSet(child.marks)) ? mark : undefined;
}

/** Both sides are whole blocks with the same words: see `Suggestion.same`. */
function sameWords(d: Draft): Suggestion["same"] {
  const { added, removed } = d.texts;
  if (d.inline || !added.join("") || !removed.join("")) return null;
  const inOrder = added.join("") === removed.join("");
  if (!inOrder && [...added].sort().join("\n") !== [...removed].sort().join("\n")) return null;
  const [a, r] = [d.blocks.added, d.blocks.removed];
  const touching = a[0][0] === r[r.length - 1][1] || r[0][0] === a[a.length - 1][1];
  if (!inOrder || !touching) return "move";
  const at = Math.max(0, d.lists.removed.findIndex((list, i) => list !== d.lists.added[i]));
  return [d.lists.removed[at] ?? "", d.lists.added[at] ?? ""];
}

const read = new WeakMap<PMNode, Suggestion[]>();

/** Every suggestion in `doc`, in the order of the text. */
export function readSuggestions(doc: PMNode): Suggestion[] {
  const cached = read.get(doc);
  if (cached) return cached;
  const drafts = new Map<string, Draft>();
  const draft = (id: string, pos: number): Draft => {
    let d = drafts.get(id);
    if (!d) {
      const sides = { blocks: bySide(() => []), last: bySide(() => -1), texts: bySide(() => []), lists: bySide(() => []) };
      d = { id, from: pos, at: [], added: [], removed: [], formats: [], same: null, inline: false, ...sides };
      drafts.set(id, d);
    }
    d.at.push(pos);
    return d;
  };
  // A piece of what a side holds; `key` is its paragraph, and "¶" goes
  // between two paragraphs.
  const add = (d: Draft, side: Side, key: number, piece: string | PMNode) => {
    if (d.last[side] >= 0 && d.last[side] !== key) d[side].push("¶");
    d.last[side] = key;
    if (piece !== "") d[side].push(piece);
  };
  // The blocks a suggestion marks whole, open around the node being read.
  const open: { d: Draft; side: Side; end: number; words: boolean }[] = [];
  let block = -1;
  // The paragraph being read when one suggestion strikes all its words.
  let struck: Draft | null = null;
  doc.descendants((node, pos) => {
    while (open.length && open[open.length - 1].end <= pos) open.pop();
    for (const mark of node.marks) {
      if (!isSuggestionMark(mark)) continue;
      const d = draft(String(mark.attrs.id), pos);
      if (isModification(mark)) {
        d.formats.push({ mark, node });
        continue;
      }
      const side: Side = mark.type.name === "insertion" ? "added" : "removed";
      if (open.some((o) => o.d === d && o.side === side)) continue;
      if (node.isInline) {
        if (d !== struck || side === "added") d.inline = true;
        add(d, side, block, node.isText ? (node.text ?? "").replaceAll(ZWSP, "") : node);
        continue;
      }
      // An object is named; a block of words reads as its words.
      const words = node.isTextblock || (!node.isAtom && node.type.name !== "table");
      if (!words) add(d, side, pos, node);
      d.blocks[side].push([pos, pos + node.nodeSize]);
      d.texts[side].push(node.textContent);
      open.push({ d, side, end: pos + node.nodeSize, words });
    }
    const reading = open.filter((o) => o.words);
    if (node.isTextblock) {
      block = pos;
      for (const o of reading) {
        add(o.d, o.side, pos, "");
        o.d.lists[o.side].push(listOf(doc, pos));
      }
      // A paragraph whose words one suggestion strikes whole is a block it
      // removes (a bullet taken off a one-line list).
      const mark = struckBy(node);
      struck = mark ? draft(String(mark.attrs.id), pos) : null;
      if (struck && !open.some((o) => o.d === struck)) {
        struck.blocks.removed.push(outerBlock(doc, pos));
        struck.texts.removed.push(node.textContent);
        struck.lists.removed.push(listOf(doc, pos));
      }
    } else if (node.isInline) {
      for (const o of reading) add(o.d, o.side, block, node.isText ? (node.text ?? "").replaceAll(ZWSP, "") : node);
    }
    return true;
  });
  const drafted = [...drafts.values()].map((d) => ({ d, same: sameWords(d) }));
  // A suggestion stands where its words show: outside the copies hidden
  // for blocks put back with the same words (a format change on a line
  // whose list then changed).
  const hidden = drafted.flatMap(({ d, same }) => (same ? d.blocks.removed : []));
  const out = drafted.map(({ d, same }): Suggestion => {
    const { id, added, removed, formats, blocks } = d;
    const shown = d.at.find((pos) => !hidden.some(([from, to]) => pos >= from && pos < to)) ?? d.from;
    return { id, from: same ? blocks.added[0][0] : shown, added, removed, formats, blocks, same };
  });
  read.set(doc, out);
  return out;
}

function suggestionMark(name: Kind) {
  const spec: MarkSpec = SPECS[name];
  return Mark.create({
    name,
    inclusive: false,
    // Another person's added words can carry this author's deletion too.
    excludes: name === "modification" ? spec.excludes : `${name} modification`,
    addAttributes() {
      return Object.fromEntries(
        Object.entries(spec.attrs ?? {}).map(([key, attr]) => [
          key,
          "default" in attr ? { default: attr.default, validate: attr.validate } : { isRequired: true, validate: attr.validate },
        ]),
      );
    },
    // A mark on a whole block (a pasted paragraph, a new table) wraps it in a
    // div the layout skips (display: contents). renderHTML is not told which
    // of the two it draws, so the schema's own toDOM is given.
    extendMarkSchema(extension) {
      if (extension.name !== name) return {};
      return {
        toDOM: (mark: PMMark, inline: boolean) => [
          inline ? TAGS[name] : "div",
          {
            "data-suggestion": String(mark.attrs.id),
            "data-author": suggestionAuthor(mark.attrs.id),
            ...(!inline && { "data-suggestion-block": name }),
          },
          0,
        ],
      };
    },
  });
}

const suggesters = new WeakMap<Editor, string>();
/** Suggesting mode is on in this editor. */
export const isSuggesting = (editor: Editor) => suggesters.has(editor);

/** Suggesting mode on for an author (their account id), or off (null). */
export function setSuggesting(editor: Editor, author: string | null): void {
  if (author === null) suggesters.delete(editor);
  else suggesters.set(editor, author);
}

let lastTime = 0;
/** A new suggestion's id: "<account id>.<ms>", a millisecond past the last
    id this page made. */
const newId = (author: string) => `${author}.${(lastTime = Math.max(Date.now(), lastTime + 1))}`;

const EACH = "docsSuggestEach";
/** Each step of `tr` becomes a suggestion of its own (Replace all). */
export const suggestEach = (tr: Transaction) => tr.setMeta(EACH, true);

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The id an edit to an earlier suggestion keeps: the earlier one's, when
    it is the same author's. */
const keptId = (earlier: PMMark | undefined, id: string): string =>
  earlier && suggestionAuthor(earlier.attrs.id) === suggestionAuthor(id) ? String(earlier.attrs.id) : id;

const isMarkStep = (step: Step): step is AddMarkStep | RemoveMarkStep =>
  step instanceof AddMarkStep || step instanceof RemoveMarkStep;

/** A step that changes formatting only: a mark on words, or a block's type
    or attributes (setNodeMarkup). */
const isFormatStep = (step: Step) =>
  isMarkStep(step) ||
  step instanceof AttrStep ||
  (step instanceof ReplaceAroundStep &&
    step.insert === 1 &&
    step.slice.size === 2 &&
    step.gapFrom === step.from + 1 &&
    step.gapTo === step.to - 1);

/** `out` in place of `tr`: it keeps `tr`'s metas (undo grouping, focus) and
    its scroll, as the library's tracked transactions do. */
function carry(out: Transaction, tr: Transaction): Transaction {
  (out as unknown as { meta: unknown }).meta = (tr as unknown as { meta: unknown }).meta;
  if (tr.scrolledIntoView) out.scrollIntoView();
  return out;
}

/** The name of the mark a word modification changes. */
function changedMark(mod: PMMark): string | null {
  const value = (mod.attrs.newValue ?? mod.attrs.previousValue) as { type?: unknown } | null;
  return typeof value?.type === "string" ? value.type : null;
}

/** A mark put on or taken off words: the words take it, and a modification
    keeps the mark they had before, unless they are a suggestion's own. The
    library would record it as the words deleted and added again. */
function suggestMark(tr: Transaction, step: AddMarkStep | RemoveMarkStep, id: string): void {
  // A suggestion's own marks are no formatting (Clear formatting, Paint format).
  if (isSuggestionMark(step.mark)) return;
  const { insertion: added, deletion: removed, modification: changed } = tr.doc.type.schema.marks;
  const adding = step instanceof AddMarkStep;
  const type = step.mark.type;
  tr.doc.nodesBetween(step.from, step.to, (node, pos, parent) => {
    if (!node.isInline) return true;
    if (removed.isInSet(node.marks) || !parent?.type.allowsMarkType(type)) return false;
    const from = Math.max(pos, step.from);
    const to = Math.min(pos + node.nodeSize, step.to);
    if (adding) tr.addMark(from, to, step.mark);
    else tr.removeMark(from, to, step.mark);
    if (added.isInSet(node.marks)) return false;
    const earlier = node.marks.find((m) => m.type === changed && changedMark(m) === type.name);
    const previousValue: unknown = earlier ? earlier.attrs.previousValue : (type.isInSet(node.marks)?.toJSON() ?? null);
    const newValue = adding ? step.mark.toJSON() : null;
    if (earlier) tr.removeMark(from, to, earlier);
    if (!same(previousValue, newValue)) {
      tr.addMark(from, to, changed.create({ id: keptId(earlier, id), type: "mark", previousValue, newValue }));
    }
    return false;
  });
}

/** A block changed again keeps the value from before its first change, and
    a change back to it is no suggestion at all. A block a suggestion adds,
    or one inside it, takes the change as it is and stays added (the library
    would drop its insertion mark for the modification). */
function chainBlockChanges(tr: Transaction, before: PMNode, id: string): void {
  const isAdded = (node: PMNode) => node.marks.find((m) => m.type.name === "insertion");
  tr.doc.descendants((node, pos) => {
    const fresh = node.marks.filter((m) => isModification(m) && m.attrs.id === id);
    if (fresh.length === 0) return true;
    const was = before.nodeAt(pos);
    const $pos = before.resolve(pos);
    let inAddedBlock = false;
    for (let depth = $pos.depth; depth > 0 && !inAddedBlock; depth--) inAddedBlock = Boolean(isAdded($pos.node(depth)));
    const added = was && isAdded(was);
    let marks = node.marks;
    for (const mod of fresh) {
      const earlier = was?.marks.find((m) => isModification(m) && m.attrs.type === mod.attrs.type && m.attrs.attrName === mod.attrs.attrName);
      const previousValue: unknown = earlier ? earlier.attrs.previousValue : mod.attrs.previousValue;
      marks = mod.removeFromSet(marks);
      if (!added && !inAddedBlock && !same(previousValue, mod.attrs.newValue)) {
        marks = mod.type.create({ ...mod.attrs, id: keptId(earlier, id), previousValue }).addToSet(marks);
      }
    }
    tr.setNodeMarkup(pos, undefined, node.attrs, added ? added.addToSet(marks) : marks);
    return true;
  });
}

/** A change of formatting only. The library records a block's change as a
    modification on the block; a mark on words is recorded here. */
function suggestFormat(tr: Transaction, state: EditorState, id: string): Transaction {
  const blocks = state.tr;
  for (const step of tr.steps) if (!isMarkStep(step)) blocks.step(step);
  const out = blocks.docChanged ? transformToSuggestionTransaction(blocks, state, () => id) : blocks;
  if (blocks.docChanged) chainBlockChanges(out, state.doc, id);
  for (const step of tr.steps) if (isMarkStep(step)) suggestMark(out, step, id);
  if (tr.selectionSet) out.setSelection(tr.selection.map(out.doc, new Mapping()));
  if (tr.storedMarksSet) out.setStoredMarks(tr.storedMarks);
  return carry(out, tr);
}

/** Where a transaction's steps landed in its final document. */
function touched(tr: Transaction): [number, number][] {
  const ranges: [number, number][] = [];
  tr.steps.forEach((step, i) => {
    const rest = tr.mapping.slice(i + 1);
    const add = (from: number, to: number) => ranges.push([rest.map(from, -1), rest.map(to, 1)]);
    if (isMarkStep(step)) add(step.from, step.to);
    else if (step instanceof AddNodeMarkStep) add(step.pos, step.pos + 1);
    else step.getMap().forEach((_from, _to, from, to) => add(from, to));
  });
  return ranges;
}

/** The library gives new words the id of a suggestion they touch, and gives
    a touching suggestion the new words' id: across two authors that credits
    one person's words to the other. Words that had a suggestion keep its
    id; words new to one take this author's: the one right beside the
    change, as the text stood before it (Backspace pressed again), else a
    new one. */
function keepAuthors(tr: Transaction, before: PMNode, author: string, id: string): void {
  const back = tr.mapping.invert();
  const fixes: { from: number; to: number; old: PMMark; mark: PMMark; block: boolean }[] = [];
  const check = (from: number, to: number, mark: PMMark, block: boolean, beside: PMMark[] = []) => {
    const origin = back.mapResult(from, 1);
    const was = origin.deletedAfter ? undefined : before.nodeAt(origin.pos)?.marks.find((m) => m.type === mark.type);
    const markAuthor = suggestionAuthor(mark.attrs.id);
    const own = beside.find((m) => m.type === mark.type && suggestionAuthor(m.attrs.id) === author);
    const want = was ? (suggestionAuthor(was.attrs.id) === markAuthor ? mark.attrs.id : was.attrs.id) : markAuthor === author ? mark.attrs.id : (own?.attrs.id ?? id);
    if (want === mark.attrs.id) return;
    const last = fixes.at(-1);
    if (last && !block && last.to === from && last.old.eq(mark) && last.mark.attrs.id === want) last.to = to;
    else fixes.push({ from, to, old: mark, mark: mark.type.create({ ...mark.attrs, id: want }), block });
  };
  for (const [from, to] of touched(tr)) {
    const beside = [before.resolve(back.map(from, -1)).nodeBefore, before.resolve(back.map(to, 1)).nodeAfter].flatMap((n) => n?.marks ?? []);
    tr.doc.nodesBetween(from, to, (node, pos) => {
      const marks = node.marks.filter(isWordMark);
      if (!node.isText) {
        for (const mark of marks) check(pos, pos + 1, mark, true);
        return true;
      }
      for (let at = Math.max(pos, from); at < Math.min(pos + node.nodeSize, to); at++) {
        for (const mark of marks) check(at, at + 1, mark, false, beside);
      }
      return false;
    });
  }
  for (const fix of fixes) {
    if (fix.block) tr.removeNodeMark(fix.from, fix.old).addNodeMark(fix.from, fix.mark);
    else tr.removeMark(fix.from, fix.to, fix.old).addMark(fix.from, fix.to, fix.mark);
  }
}

/** A change of letter case (Capitalization) comes one step a letter; it is
    suggested as the stretch it changes in each paragraph replaced. */
function caseChange(tr: Transaction, state: EditorState): Transaction {
  const stretches = new Map<number, [number, number]>();
  for (const step of tr.steps) {
    if (!(step instanceof ReplaceStep) || step.slice.size !== step.to - step.from) return tr;
    const text = step.slice.content.textBetween(0, step.slice.size);
    if (!text || text.toLowerCase() !== state.doc.textBetween(step.from, step.to).toLowerCase()) return tr;
    const paragraph = state.doc.resolve(step.from).start();
    const [from, to] = stretches.get(paragraph) ?? [step.from, step.to];
    stretches.set(paragraph, [Math.min(from, step.from), Math.max(to, step.to)]);
  }
  const out = state.tr;
  for (const [from, to] of stretches.values()) out.replace(from, to, tr.doc.slice(from, to));
  return carry(out.setSelection(tr.selection.map(out.doc, new Mapping())), tr);
}

/** A block's id is no formatting: its change is no suggestion (Enter at a
    paragraph's start gives the new paragraph above a fresh one). */
function dropIdChanges(tr: Transaction): Transaction {
  for (const [from, to] of touched(tr)) {
    tr.doc.nodesBetween(from, to, (node, pos) => {
      const mark = node.marks.find((m) => isModification(m) && m.attrs.attrName === "blockId");
      if (mark) tr.removeNodeMark(pos, mark);
    });
  }
  return tr;
}

/** Backspace or Delete on a suggested paragraph break — one of the
    zero-width spaces that hold it, or the break between them — takes the
    break back: the two paragraphs join and both zero-width spaces go. */
function takeBackBreak(tr: Transaction, state: EditorState): Transaction | null {
  const step = tr.steps[0];
  if (tr.steps.length !== 1 || !(step instanceof ReplaceStep) || step.slice.size) return null;
  const { doc } = state;
  const addedSpace = (pos: number) => {
    const node = pos >= 0 ? doc.resolve(pos).nodeAfter : null;
    return Boolean(node?.text?.startsWith(ZWSP) && node.marks.some((m) => m.type.name === "insertion"));
  };
  const near = (pos: number, dir: 1 | -1) => Selection.findFrom(doc.resolve(pos), dir, true)?.from ?? -1;
  // Where the break may stand: [the upper paragraph's end, the lower one's start].
  const $from = doc.resolve(step.from);
  const breaks: [number, number][] = [[step.from, step.to]];
  if (step.to === step.from + 1 && addedSpace(step.from)) {
    if (step.from === $from.start()) breaks.push([near($from.before(), -1), step.from]);
    if (step.to === $from.end()) breaks.push([step.to, near($from.after(), 1)]);
  }
  const found = breaks.find(([end, start]) => {
    if (end < 0 || start <= end || !addedSpace(end - 1) || !addedSpace(start)) return false;
    const $end = doc.resolve(end);
    const $start = doc.resolve(start);
    // Nothing but the two paragraphs' edges lies between them.
    return end === $end.end() && start === $start.start() && start - end === $end.depth + $start.depth - 2 * $end.sharedDepth(start);
  });
  if (!found) return null;
  const out = state.tr.delete(found[0] - 1, found[1] + 1);
  return carry(out.setSelection(TextSelection.create(out.doc, found[0] - 1)), tr);
}

/** A mapping from `doc` to `doc` with every suggestion accepted. */
function acceptMapping(doc: PMNode): Mapping {
  // The library settles no format change on words, and those move no text.
  const plain = new Transform(doc).removeMark(0, doc.content.size, doc.type.schema.marks.modification);
  let mapping = new Mapping();
  applySuggestions(EditorState.create({ doc: plain.doc }), (settled) => (mapping = settled.mapping));
  return mapping;
}

/** A step that moves blocks (a list toggled, a line nested). */
const movesBlocks = (step: Step) => step instanceof ReplaceAroundStep && !isFormatStep(step);

/** The selection stands in what the transaction adds: a command put it
    there (a table's first cell, a footnote, a new row, a list line). */
const inAdded = (tr: Transaction) => tr.mapping.invert().mapResult(tr.selection.head).deletedAcross || tr.steps.some(movesBlocks);

/** `tr` again on `state`, whose doc has the same positions, with `steps`. */
function redo(tr: Transaction, state: EditorState, steps: readonly Step[]): Transaction {
  const out = state.tr;
  for (const step of steps) out.step(step);
  if (tr.selectionSet) out.setSelection(tr.selection.map(out.doc, new Mapping()));
  if (tr.storedMarksSet) out.setStoredMarks(tr.storedMarks);
  return carry(out, tr);
}

/** The library reads a step that moves blocks (a list toggled, a line
    nested), and a mark set in a longer edit, as the blocks it touches
    replaced with every suggestion in them accepted, and accepting a format
    change on words throws. Such a step goes to it as that replace with the
    words as they stand: they keep their format change. */
function asReplace(step: Step, doc: PMNode): Step {
  const moves = movesBlocks(step);
  if (!moves && !isMarkStep(step)) return step;
  const { from, to } = step as ReplaceAroundStep | AddMarkStep | RemoveMarkStep;
  const applied = step.apply(doc).doc;
  const map = step.getMap();
  const range = applied?.resolve(map.map(from, -1)).blockRange(applied.resolve(map.map(to, 1)));
  if (!applied || !range) return step;
  let words = false;
  applied.nodesBetween(range.start, range.end, (node) => {
    words ||= node.isInline && node.marks.some(isModification);
  });
  const [start, end] = moves ? [range.start, range.end] : [from, to];
  const back = map.invert();
  return (words && replaceStep(doc, back.map(start), back.map(end), applied.slice(start, end))) || step;
}

/** One replace of the whole blocks that differ between `before` and `doc`,
    in the parent both share; null when none differ. A transaction that
    moves blocks in more than one step (a line lifted out of a list, then
    wrapped in a list of another kind; a list toggled, then joined to its
    neighbor) goes to the library as that replace, with the words as they
    stand: it reads each step against the text before it, and a step on
    blocks an earlier step moved loses its place. */
function oneReplace(before: PMNode, doc: PMNode): Step | null {
  const start = before.content.findDiffStart(doc.content);
  const end = before.content.findDiffEnd(doc.content);
  if (start === null || !end) return null;
  // Where the same content repeats, the ends found can overlap the start.
  const over = Math.max(0, start - Math.min(end.a, end.b));
  const [$fromA, $toA, $fromB, $toB] = [before.resolve(start), before.resolve(end.a + over), doc.resolve(start), doc.resolve(end.b + over)];
  const a = $fromA.blockRange($toA);
  const b = $fromB.blockRange($toB);
  if (!a || !b) return null;
  // Whole blocks, in the parent both sides share.
  const depth = Math.min(a.depth, b.depth) + 1;
  return replaceStep(before, $fromA.before(depth), $toA.after(depth), doc.slice($fromB.before(depth), $toB.after(depth)));
}

type Aside = { from: number; to: number; mark: PMMark };

/** Another person's added words that an edit takes out: the library deletes
    added words outright, but they stay, struck as this author's deletion. */
function othersAdded(tr: Transaction, author: string): Aside[] {
  const added = tr.doc.type.schema.marks.insertion;
  const out: Aside[] = [];
  tr.steps.forEach((step, i) => {
    if (!(step instanceof ReplaceStep) || step.from === step.to) return;
    // (A sliced mapping inverts whole: a new one of the steps before this.)
    const back = new Mapping(tr.mapping.maps.slice(0, i)).invert();
    const [from, to] = [back.map(step.from, 1), back.map(step.to, -1)];
    tr.docs[0].nodesBetween(from, to, (node, pos) => {
      const mark = added.isInSet(node.marks);
      if (!mark || suggestionAuthor(mark.attrs.id) === author) return true;
      out.push(node.isInline ? { from: Math.max(pos, from), to: Math.min(pos + node.nodeSize, to), mark } : { from: pos, to: pos, mark });
      return false;
    });
  });
  return out;
}

/** The library's tracked copy of `tr`, run with `aside` taken off: it never
    sees those marks, and they come back on their words (a block's on it). */
function track(tr: Transaction, state: EditorState, aside: Aside[], id: () => string): Transaction {
  const run = (edit: Transaction, base: EditorState) => {
    const one = edit.steps.length > 1 && edit.steps.some(movesBlocks) ? oneReplace(edit.before, edit.doc) : null;
    const steps = one ? [one] : edit.steps.map((step, i) => asReplace(step, edit.docs[i]));
    return transformToSuggestionTransaction(steps.some((step, i) => step !== edit.steps[i]) ? redo(edit, base, steps) : edit, base, id);
  };
  if (aside.length === 0) return run(tr, state);
  const prep = state.tr;
  for (const { from, to, mark } of aside) {
    if (from === to) prep.removeNodeMark(from, mark);
    else prep.removeMark(from, to, mark);
  }
  const base = EditorState.create({ doc: prep.doc, selection: state.selection.map(prep.doc, new Mapping()) });
  const tracked = run(redo(tr, base, tr.steps), base);
  const out = redo(tracked, state, [...prep.steps, ...tracked.steps]);
  for (const { from, to, mark } of aside) {
    const start = tracked.mapping.mapResult(from, 1);
    if (from === to && !start.deleted) out.addNodeMark(start.pos, mark);
    else if (start.pos < tracked.mapping.map(to, -1)) out.addMark(start.pos, tracked.mapping.map(to, -1), mark);
  }
  return out;
}

/** `doc` with these suggestions taken back: what they remove stays, what
    they add goes. */
function takeBack(doc: PMNode, own: Suggestion[]): Transform {
  const ids = new Set(own.map((s) => s.id));
  const t = new Transform(doc);
  doc.descendants((node, pos) => {
    const mark = node.marks.find((m) => m.type.name === "deletion" && ids.has(String(m.attrs.id)));
    if (mark && node.isInline) t.removeMark(pos, pos + node.nodeSize, mark);
    else if (mark) t.removeNodeMark(pos, mark);
  });
  for (const [from, to] of own.flatMap((s) => s.blocks.added).sort((a, b) => b[0] - a[0])) t.delete(from, to);
  return t;
}

/** `doc` as the author of these suggestions sees it: the blocks they remove
    taken out, and their marks off the blocks they add. A list item left
    starting with a list gives its place to that list's items (an edit
    wrapped a removed line in an item of its own). */
function asSeen(doc: PMNode, ids: Set<string>): Transform {
  const t = new Transform(doc);
  const mine = (mark: PMMark | undefined) => mark !== undefined && ids.has(String(mark.attrs.id));
  const removed: number[] = [];
  doc.descendants((node, pos) => {
    if (node.isInline) return false;
    const added = node.marks.find((m) => m.type.name === "insertion");
    if (added && mine(added)) t.removeNodeMark(pos, added);
    if (!mine(node.marks.find((m) => m.type.name === "deletion")) && !(node.isTextblock && mine(struckBy(node)))) return true;
    removed.push(pos);
    return false;
  });
  for (const pos of removed.reverse()) {
    const [from, to] = outerBlock(t.doc, pos);
    const $from = t.doc.resolve(from);
    const item = $from.parent;
    const list = isListItem(item) && $from.index() === 0 ? item.maybeChild(1) : null;
    if (!list || !isList(list)) {
      t.delete(from, to);
      continue;
    }
    const items = list.content.content.map((child) => (child.type === item.type ? child : item.type.create(null, child.content, child.marks)));
    const last = items.length - 1;
    items[last] = items[last].copy(items[last].content.append(item.content.cut(to - from + list.nodeSize)));
    t.replaceWith($from.before(), $from.after(), items);
  }
  return t;
}

/** Two stretches of blocks read the same, whatever their block ids (the
    copy a suggestion adds takes new ones). */
function sameBlocks(a: Fragment, b: Fragment): boolean {
  if (a.childCount !== b.childCount) return false;
  return a.content.every((x, i) => {
    const y = b.child(i);
    if (x.isText) return x.eq(y);
    const attrs = "blockId" in x.attrs ? { ...y.attrs, blockId: x.attrs.blockId } : y.attrs;
    return x.hasMarkup(y.type, attrs, y.marks) && sameBlocks(x.content, y.content);
  });
}

/** A block edit that meets this author's own list changes (a list toggled
    again, a line of their new list nested) takes their place: the text
    before them, and the edit's result as the author sees it, make one list
    change, or none when they read the same. */
function replaceListChanges(tr: Transaction, state: EditorState, author: string, id: string): { tr: Transaction; seen: Transform } | null {
  const start = state.doc.content.findDiffStart(tr.doc.content);
  const end = state.doc.content.findDiffEnd(tr.doc.content);
  if (start === null || !end) return null;
  const meets = ([from, to]: [number, number]) => from < Math.max(start, end.a) && to > start;
  const own = readSuggestions(state.doc).filter(
    (s) => Array.isArray(s.same) && suggestionAuthor(s.id) === author && [...s.blocks.removed, ...s.blocks.added].some(meets),
  );
  if (own.length === 0) return null;
  const before = takeBack(state.doc, own);
  const seen = asSeen(tr.doc, new Set(own.map((s) => s.id)));
  const step = oneReplace(before.doc, seen.doc);
  if (!step && !before.doc.eq(seen.doc)) return null;
  const out = state.tr;
  for (const s of before.steps) out.step(s);
  if (step && !(step instanceof ReplaceStep && sameBlocks(before.doc.slice(step.from, step.to).content, step.slice.content))) {
    const base = EditorState.create({ doc: before.doc });
    const edit = base.tr.step(step);
    for (const tracked of track(edit, base, othersAdded(edit, author), () => id).steps) out.step(tracked);
  }
  return { tr: carry(out, tr), seen };
}

function suggest(edit: Transaction, state: EditorState, author: string): Transaction {
  const id = newId(author);
  if (edit.steps.every(isFormatStep)) return dropIdChanges(suggestFormat(edit, state, id));
  const each = edit.getMeta(EACH) === true;
  const tr = edit.steps.length > 1 && !each ? caseChange(edit, state) : edit;
  const back = takeBackBreak(tr, state);
  if (back) return back;
  const own = tr.steps.some(movesBlocks) ? replaceListChanges(tr, state, author, id) : null;
  const tracked = own?.tr ?? track(tr, state, othersAdded(tr, author), () => (each ? newId(author) : id));
  keepAuthors(tracked, state.doc, author, id);
  dropIdChanges(tracked);
  const step = tr.steps[0];
  const one = tr.steps.length === 1 && step instanceof ReplaceStep;
  const caret = state.selection.empty ? state.selection.from : -1;
  if (inAdded(tr)) {
    // The same place in the tracked copy: both read alike once accepted.
    const mapping = new Mapping(own?.seen.mapping.maps);
    mapping.appendMapping(acceptMapping(own?.seen.doc ?? tr.doc));
    mapping.appendMapping(acceptMapping(tracked.doc).invert());
    const at = (pos: number) => tracked.doc.resolve(Math.min(Math.max(0, mapping.map(pos)), tracked.doc.content.size));
    tracked.setSelection(TextSelection.between(at(tr.selection.anchor), at(tr.selection.head)));
  } else if (one && !step.slice.size && step.from === caret) {
    // Delete strikes what follows the caret, and the caret goes past it.
    tracked.setSelection(Selection.near(tracked.doc.resolve(tracked.mapping.map(step.to))));
  } else if (one && !tr.selectionSet && caret >= 0 && (step.to < caret || step.from > caret)) {
    // An edit away from the caret (autocorrect's capital) leaves it where it was.
    tracked.setSelection(Selection.near(tracked.doc.resolve(tracked.mapping.map(caret))));
  }
  return tracked;
}

/** The zero-width spaces the library puts at a paragraph's edge to hold a
    suggested break, left behind once their suggestion is settled. */
function dropStrays(tr: Transaction): void {
  const strays: number[] = [];
  const plain = (node: PMNode) => !node.marks.some(isWordMark);
  tr.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const { firstChild: first, lastChild: last } = node;
    if (first?.text?.startsWith(ZWSP) && plain(first)) strays.push(pos + 1);
    if (last?.text?.endsWith(ZWSP) && plain(last) && !(last === first && last.text.length === 1)) {
      strays.push(pos + node.nodeSize - 2);
    }
    return false;
  });
  for (const at of strays.reverse()) tr.delete(at, at + 1);
}

/** Accept or reject one suggestion, or every one (no id), as one undo step.
    The library applies or reverts the words added and removed; format
    changes are settled here, since the library takes every modification
    for a block's and settles all of them whatever their id. The other
    suggestions' modifications stand aside while it runs. */
export function settleSuggestions(editor: Editor, accept: boolean, id?: string): void {
  const { state } = editor;
  const { schema } = state;
  const tr = state.tr;
  const markOf = (json: unknown) => {
    try {
      return json ? schema.markFromJSON(json) : null;
    } catch {
      return null;
    }
  };
  const aside: { pos: number; to: number; mark: PMMark; inline: boolean }[] = [];
  state.doc.descendants((node, pos) => {
    const mods = node.marks.filter(isModification);
    if (mods.length === 0) return true;
    const settled = (mod: PMMark) => id === undefined || String(mod.attrs.id) === id;
    if (node.isInline) {
      const to = pos + node.nodeSize;
      for (const mod of mods) {
        tr.removeMark(pos, to, mod);
        if (!settled(mod)) aside.push({ pos, to, mark: mod, inline: true });
        else if (!accept) {
          const next = markOf(mod.attrs.newValue);
          const previous = markOf(mod.attrs.previousValue);
          if (next) tr.removeMark(pos, to, next.type);
          if (previous) tr.addMark(pos, to, previous);
        }
      }
      return false;
    }
    let type = node.type;
    const attrs = { ...node.attrs };
    for (const mod of mods) {
      if (!settled(mod)) aside.push({ pos, to: pos, mark: mod, inline: false });
      else if (!accept && mod.attrs.type === "nodeType") type = schema.nodes[String(mod.attrs.previousValue)] ?? type;
      else if (!accept && mod.attrs.type === "attr") attrs[String(mod.attrs.attrName)] = mod.attrs.previousValue;
    }
    tr.setNodeMarkup(pos, type, attrs, node.marks.filter((m) => !isModification(m)));
    return true;
  });
  // The library reads the character after a block it takes out, which
  // throws past the document's end: an empty line stands there while it runs.
  const end = tr.doc.content.size;
  tr.insert(end, schema.nodes.paragraph.create());
  const start = tr.steps.length;
  const run = id === undefined ? (accept ? applySuggestions : revertSuggestions) : accept ? applySuggestion(id) : revertSuggestion(id);
  run(EditorState.create({ doc: tr.doc }), (library) => library.steps.forEach((step) => tr.step(step)));
  const map = tr.mapping.slice(start);
  if (tr.doc.childCount > 1) tr.delete(map.map(end), tr.doc.content.size);
  for (const { pos, to, mark, inline } of aside) {
    if (inline) {
      const from = map.map(pos, 1);
      const end = map.map(to, -1);
      if (from < end) tr.addMark(from, end, mark);
    } else {
      const at = map.mapResult(pos, 1);
      if (!at.deletedAfter) tr.addNodeMark(at.pos, mark);
    }
  }
  dropStrays(tr);
  editor.view.dispatch(tr.setMeta(suggestChangesKey, { skip: true }));
}

/** Select a suggestion's words and give the page the focus: its card opens.
    (The library's own select reads one suggestion mark a node, and misses
    a deletion over another person's added words.) */
export function focusSuggestion(editor: Editor, id: string): void {
  const { doc } = editor.state;
  let [from, to] = [-1, -1];
  doc.descendants((node, pos) => {
    if (!node.marks.some((m) => isSuggestionMark(m) && m.attrs.id === id)) return true;
    if (from < 0) from = pos;
    to = pos + node.nodeSize;
    return false;
  });
  if (from < 0) return;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(doc, from, to)).scrollIntoView());
  editor.view.focus();
}

/** Blocks a suggestion puts back with the same words draw once: the removed
    copy hides, and a list changed in place draws as a format change. */
function sameWordsDecorations(doc: PMNode): DecorationSet {
  const node = (cls: string) => ([from, to]: [number, number]) => Decoration.node(from, to, { class: cls });
  const decorations = readSuggestions(doc).flatMap((s) =>
    s.same
      ? [...s.blocks.removed.map(node("docs-suggest-hidden")), ...(s.same === "move" ? [] : s.blocks.added.map(node("docs-suggest-restyled")))]
      : [],
  );
  return DecorationSet.create(doc, decorations);
}

/** Select all in Suggesting mode, from the first letter the page shows: a
    removed copy hidden at the top would make a list command read every line
    as plain. Null when none is hidden there. */
function shownAll(doc: PMNode): Selection | null {
  const hidden = readSuggestions(doc).flatMap((s) => (s.same ? s.blocks.removed : []));
  const first = (pos: number): Selection | null => {
    const sel = Selection.findFrom(doc.resolve(pos), 1, true);
    const range = sel && hidden.find(([from, to]) => from < sel.from && sel.from < to);
    return range ? first(range[1]) : sel;
  };
  const start = first(0);
  const end = Selection.atEnd(doc);
  return start && start.from !== Selection.atStart(doc).from && start.from < end.to ? TextSelection.between(start.$from, end.$to) : null;
}

const Suggesting = Extension.create({
  name: "docsSuggesting",
  // Every node that holds blocks takes the suggestion marks on them (a new
  // table, a removed list item), and a code block on its words.
  onBeforeCreate() {
    const { schema } = this.editor;
    const marks = [...SUGGESTION_MARK_TYPES].map((name) => schema.marks[name]);
    for (const type of Object.values(schema.nodes)) {
      if (type.markSet) type.markSet = [...type.markSet, ...marks];
    }
  },
  // The library's plugin (a pilcrow where a paragraph break is suggested,
  // arrow keys that step over its zero-width spaces), and the blocks a
  // suggestion puts back with the same words, drawn once.
  addProseMirrorPlugins() {
    return [
      suggestChanges(),
      new Plugin<DecorationSet>({
        state: {
          init: (_, { doc }) => sameWordsDecorations(doc),
          apply: (tr, set, _, { doc }) => (tr.docChanged ? sameWordsDecorations(doc) : set),
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
  dispatchTransaction({ transaction: tr, next }) {
    const author = suggesters.get(this.editor);
    const shown = author && tr.selection instanceof AllSelection ? shownAll(tr.doc) : null;
    if (shown) tr.setSelection(shown);
    const passes =
      !author ||
      !tr.docChanged ||
      tr.getMeta("addToHistory") === false ||
      tr.getMeta("history$") !== undefined ||
      tr.getMeta(suggestChangesKey) !== undefined;
    next(passes ? tr : suggest(tr, this.editor.state, author));
  },
});

export const suggestExtensions: AnyExtension[] = [
  suggestionMark("insertion"),
  suggestionMark("deletion"),
  suggestionMark("modification"),
  Suggesting,
];

import { Extension, Mark, type AnyExtension, type Editor } from "@tiptap/core";
import type { Mark as PMMark, MarkSpec, Node as PMNode } from "@tiptap/pm/model";
import { EditorState, Selection, type Transaction } from "@tiptap/pm/state";
import { AddMarkStep, AddNodeMarkStep, AttrStep, Mapping, RemoveMarkStep, ReplaceAroundStep, ReplaceStep, type Step } from "@tiptap/pm/transform";
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

// Suggesting mode (SPEC.md §29), on @handlewithcare/prosemirror-suggest-changes.
// A suggestion is one id on insertion, deletion, and modification marks,
// "<author's account id>.<ms since epoch>", so its card names who made it and
// when. While Suggesting is on, every edit becomes suggestions before it
// lands (dispatchTransaction); undo, a stored copy loading, and the layer's
// own bookkeeping pass as they are.

const SPECS = { insertion, deletion, modification } as const;
type Kind = keyof typeof SPECS;
const TAGS: Record<Kind, string> = { insertion: "ins", deletion: "del", modification: "span" };
/** The suggestion marks' names: formatting tools leave them alone. */
export const SUGGESTION_MARKS: ReadonlySet<string> = new Set(Object.keys(SPECS));
/** What the library puts at a paragraph's edge to hold a suggested break. */
export const ZWSP = "\u200B";

export const isSuggestionMark = (mark: PMMark) => SUGGESTION_MARKS.has(mark.type.name);
/** Words added or removed: an insertion or a deletion mark. */
const isWordMark = (mark: PMMark) => mark.type.name === "insertion" || mark.type.name === "deletion";
const isModification = (mark: PMMark) => mark.type.name === "modification";

const idIn = (marks: readonly PMMark[] | undefined) => {
  const mark = marks?.find(isSuggestionMark);
  return mark ? String(mark.attrs.id) : null;
};

/** The suggestion the caret stands in or touches, or a selection starts in. */
export function suggestionAt(state: EditorState): string | null {
  const { $from, empty } = state.selection;
  let id = (empty ? idIn($from.nodeBefore?.marks) : null) ?? idIn($from.nodeAfter?.marks);
  for (let depth = $from.depth; !id && depth > 0; depth--) id = idIn($from.node(depth).marks);
  return id;
}

/** Every suggestion's id, in the order of the text. */
export function suggestionIds(doc: PMNode): string[] {
  const ids = new Set<string>();
  doc.descendants((node) => {
    for (const mark of node.marks) if (isSuggestionMark(mark)) ids.add(String(mark.attrs.id));
  });
  return [...ids];
}

/** The account id a suggestion's id names. */
export function suggestionAuthor(id: unknown): string {
  const s = String(id);
  return s.slice(0, Math.max(0, s.lastIndexOf(".")));
}

/** When a suggestion was made (ms since epoch); 0 when its id has no time. */
export function suggestionTime(id: unknown): number {
  const s = String(id);
  return Number(s.slice(s.lastIndexOf(".") + 1)) || 0;
}

function suggestionMark(name: Kind) {
  const spec: MarkSpec = SPECS[name];
  return Mark.create({
    name,
    inclusive: false,
    excludes: spec.excludes,
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
    a change back to it is no suggestion at all. */
function chainBlockChanges(tr: Transaction, before: PMNode, id: string): void {
  tr.doc.descendants((node, pos) => {
    const fresh = node.marks.filter((m) => isModification(m) && m.attrs.id === id);
    if (fresh.length === 0) return true;
    let marks = node.marks;
    for (const mod of fresh) {
      const earlier = before
        .nodeAt(pos)
        ?.marks.find((m) => isModification(m) && m.attrs.type === mod.attrs.type && m.attrs.attrName === mod.attrs.attrName);
      const previousValue: unknown = earlier ? earlier.attrs.previousValue : mod.attrs.previousValue;
      marks = mod.removeFromSet(marks);
      if (!same(previousValue, mod.attrs.newValue)) {
        marks = mod.type.create({ ...mod.attrs, id: keptId(earlier, id), previousValue }).addToSet(marks);
      }
    }
    tr.setNodeMarkup(pos, undefined, node.attrs, marks);
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
  if (tr.scrolledIntoView) out.scrollIntoView();
  // The edit's metas (undo grouping, focus) ride along, as the library keeps them.
  (out as unknown as { meta: unknown }).meta = (tr as unknown as { meta: unknown }).meta;
  return out;
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
    id; words new to one take this author's. */
function keepAuthors(tr: Transaction, before: PMNode, author: string, id: string): void {
  const back = tr.mapping.invert();
  const fixes: { from: number; to: number; old: PMMark; mark: PMMark; block: boolean }[] = [];
  const check = (from: number, to: number, mark: PMMark, block: boolean) => {
    const origin = back.mapResult(from, 1);
    const was = origin.deletedAfter ? undefined : before.nodeAt(origin.pos)?.marks.find((m) => m.type === mark.type);
    const markAuthor = suggestionAuthor(mark.attrs.id);
    const want = was ? (suggestionAuthor(was.attrs.id) === markAuthor ? mark.attrs.id : was.attrs.id) : markAuthor === author ? mark.attrs.id : id;
    if (want === mark.attrs.id) return;
    const last = fixes.at(-1);
    if (last && !block && last.to === from && last.old.eq(mark) && last.mark.attrs.id === want) last.to = to;
    else fixes.push({ from, to, old: mark, mark: mark.type.create({ ...mark.attrs, id: want }), block });
  };
  for (const [from, to] of touched(tr)) {
    tr.doc.nodesBetween(from, to, (node, pos) => {
      const marks = node.marks.filter(isWordMark);
      if (!node.isText) {
        for (const mark of marks) check(pos, pos + 1, mark, true);
        return true;
      }
      for (let at = Math.max(pos, from); at < Math.min(pos + node.nodeSize, to); at++) {
        for (const mark of marks) check(at, at + 1, mark, false);
      }
      return false;
    });
  }
  for (const fix of fixes) {
    if (fix.block) tr.removeNodeMark(fix.from, fix.old).addNodeMark(fix.from, fix.mark);
    else tr.removeMark(fix.from, fix.to, fix.old).addMark(fix.from, fix.to, fix.mark);
  }
}

function suggest(tr: Transaction, state: EditorState, author: string): Transaction {
  const id = `${author}.${Date.now()}`;
  if (tr.steps.every(isFormatStep)) return suggestFormat(tr, state, id);
  const tracked = transformToSuggestionTransaction(tr, state, () => id);
  keepAuthors(tracked, state.doc, author, id);
  // The library puts the caret after what an edit adds, as typing does. An
  // edit away from the caret (autocorrect's capital) leaves the caret where it was.
  const step = tr.steps[0];
  const caret = state.selection.empty ? state.selection.from : -1;
  if (!tr.selectionSet && tr.steps.length === 1 && step instanceof ReplaceStep && caret >= 0 && (step.to < caret || step.from > caret)) {
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
  const start = tr.steps.length;
  const run = id === undefined ? (accept ? applySuggestions : revertSuggestions) : accept ? applySuggestion(id) : revertSuggestion(id);
  run(EditorState.create({ doc: tr.doc }), (library) => library.steps.forEach((step) => tr.step(step)));
  const map = tr.mapping.slice(start);
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

const Suggesting = Extension.create({
  name: "docsSuggesting",
  // Every node that holds blocks takes the suggestion marks on them (a new
  // table, a removed list item), and a code block on its words.
  onBeforeCreate() {
    const { schema } = this.editor;
    const marks = [...SUGGESTION_MARKS].map((name) => schema.marks[name]);
    for (const type of Object.values(schema.nodes)) {
      if (type.markSet) type.markSet = [...type.markSet, ...marks];
    }
  },
  // The library's plugin: a pilcrow where a paragraph break is suggested,
  // and arrow keys that step over its zero-width spaces.
  addProseMirrorPlugins() {
    return [suggestChanges()];
  },
  dispatchTransaction({ transaction: tr, next }) {
    const author = suggesters.get(this.editor);
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

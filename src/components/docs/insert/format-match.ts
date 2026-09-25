import { Extension, type Editor } from "@tiptap/core";
import type { Mark, Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import { Plugin, PluginKey, Selection, SelectionRange, TextSelection } from "@tiptap/pm/state";
import type { Mappable } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// Format options (SPEC.md §29), from the right-click menu: Select all
// matching text selects every run of the document formatted like the
// selection, as one selection of many ranges that the next formatting
// command changes at once; Update '<style>' to match gives every paragraph
// of the selection's paragraph style the selection's formatting.

/** A selection of several ranges. The page draws them (it cannot show
    more than one range itself); every command that walks the selection's
    ranges — bold, a color, a size — changes them all. */
export class MultiRangeSelection extends Selection {
  constructor(ranges: readonly SelectionRange[]) {
    super(ranges[0].$from, ranges[ranges.length - 1].$to, [...ranges]);
  }

  map(doc: PMNode, mapping: Mappable): Selection {
    const ranges: SelectionRange[] = [];
    for (const r of this.ranges) {
      const from = mapping.map(r.$from.pos, 1);
      const to = mapping.map(r.$to.pos, -1);
      if (to > from) ranges.push(new SelectionRange(doc.resolve(from), doc.resolve(to)));
    }
    if (ranges.length === 0) return TextSelection.near(doc.resolve(mapping.map(this.head)));
    if (ranges.length === 1) return TextSelection.create(doc, ranges[0].$from.pos, ranges[0].$to.pos);
    return new MultiRangeSelection(ranges);
  }

  eq(other: Selection): boolean {
    return (
      other instanceof MultiRangeSelection &&
      other.ranges.length === this.ranges.length &&
      other.ranges.every((r, i) => r.$from.pos === this.ranges[i].$from.pos && r.$to.pos === this.ranges[i].$to.pos)
    );
  }

  toJSON(): { type: string; ranges: [number, number][] } {
    return { type: "docsMultiRange", ranges: this.ranges.map((r) => [r.$from.pos, r.$to.pos]) };
  }

  static fromJSON(doc: PMNode, json: { ranges?: [number, number][] }): Selection {
    const ranges = (json.ranges ?? []).map(([from, to]) => new SelectionRange(doc.resolve(from), doc.resolve(to)));
    return ranges.length > 1 ? new MultiRangeSelection(ranges) : TextSelection.create(doc, ranges[0]?.$from.pos ?? 0);
  }
}

MultiRangeSelection.prototype.visible = false;
Selection.jsonID("docsMultiRange", MultiRangeSelection);

/** The formatting a run carries, less its link: what "matching" compares. */
function marksKey(marks: readonly Mark[]): string {
  return marks
    .filter((m) => m.type.name !== "link")
    .map((m) => `${m.type.name}${JSON.stringify(m.attrs)}`)
    .sort()
    .join("|");
}

/** A paragraph's style: Normal text, Title, Subtitle, or a heading level. */
export function paragraphStyle(node: PMNode): string {
  if (node.type.name === "heading") return `h${Number(node.attrs.level) || 1}`;
  const style = node.attrs.docStyle as string | null | undefined;
  return style === "title" || style === "subtitle" ? style : "normal";
}

function runAt($pos: ResolvedPos): PMNode | null {
  const after = $pos.nodeAfter;
  if (after?.isText) return after;
  const before = $pos.nodeBefore;
  return before?.isText ? before : null;
}

/** Select every run formatted like the start of the selection, in
    paragraphs of the same style. */
export function selectAllMatching(editor: Editor): boolean {
  const { state, view } = editor;
  const $from = state.selection.$from;
  const sample = runAt($from);
  if (!sample || !$from.parent.isTextblock) return false;
  const key = marksKey(sample.marks);
  const style = paragraphStyle($from.parent);
  const ranges: SelectionRange[] = [];
  state.doc.descendants((node, pos, parent) => {
    if (node.isTextblock) return paragraphStyle(node) === style;
    if (!node.isText) return true;
    if (!parent || marksKey(node.marks) !== key) return false;
    const last = ranges[ranges.length - 1];
    if (last && last.$to.pos === pos) {
      ranges[ranges.length - 1] = new SelectionRange(last.$from, state.doc.resolve(pos + node.nodeSize));
    } else {
      ranges.push(new SelectionRange(state.doc.resolve(pos), state.doc.resolve(pos + node.nodeSize)));
    }
    return false;
  });
  if (ranges.length === 0) return false;
  const selection = ranges.length === 1 ? TextSelection.create(state.doc, ranges[0].$from.pos, ranges[0].$to.pos) : new MultiRangeSelection(ranges);
  view.dispatch(state.tr.setSelection(selection));
  view.focus();
  return true;
}

/** Give every paragraph of the selection's style the selection's
    formatting: its character formatting (the link stays where it is) and
    its paragraph spacing. */
export function updateStyleToMatch(editor: Editor): boolean {
  const { state, view } = editor;
  const $from = state.selection.$from;
  const parent = $from.parent;
  if (!parent.isTextblock) return false;
  const style = paragraphStyle(parent);
  const sample = runAt($from);
  const marks = (sample?.marks ?? []).filter((m) => m.type.name !== "link");
  const spacing = {
    lineSpacing: parent.attrs.lineSpacing ?? null,
    spaceBefore: parent.attrs.spaceBefore ?? null,
    spaceAfter: parent.attrs.spaceAfter ?? null,
  };
  const tr = state.tr;
  state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (paragraphStyle(node) !== style || node.type.spec.code) return false;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...spacing });
    const from = pos + 1;
    const to = pos + node.nodeSize - 1;
    if (to > from) {
      for (const type of Object.values(state.schema.marks)) {
        if (type.name !== "link") tr.removeMark(from, to, type);
      }
      for (const mark of marks) tr.addMark(from, to, mark);
    }
    return false;
  });
  if (!tr.docChanged) return false;
  view.dispatch(tr);
  return true;
}

const multiKey = new PluginKey("docsMultiRange");

/** Draws a selection of several ranges. */
export const MultiRangeDraw = Extension.create({
  name: "docsMultiRange",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: multiKey,
        props: {
          decorations(state) {
            const sel = state.selection;
            if (!(sel instanceof MultiRangeSelection)) return null;
            return DecorationSet.create(
              state.doc,
              sel.ranges.map((r) => Decoration.inline(r.$from.pos, r.$to.pos, { class: "docs-multi-selection" })),
            );
          },
        },
      }),
    ];
  },
});

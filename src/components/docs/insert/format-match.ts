import { Extension, type Editor } from "@tiptap/core";
import type { Mark, Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import { Plugin, Selection, SelectionRange, TextSelection } from "@tiptap/pm/state";
import type { Mappable } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { blockStyle } from "@/components/docs/toolbar/styles";

// Format options ▸ Select all matching text (SPEC.md §29): every run
// formatted like the selection, as one selection of many ranges that the
// next formatting command changes at once.

/** A selection of several ranges, drawn by MultiRangeDraw; every command
    that walks the selection's ranges changes them all. */
class MultiRangeSelection extends Selection {
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
  const style = blockStyle($from.parent);
  const ranges: SelectionRange[] = [];
  state.doc.descendants((node, pos, parent) => {
    if (node.isTextblock) return blockStyle(node) === style;
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

/** Draws a selection of several ranges. */
export const MultiRangeDraw = Extension.create({
  name: "docsMultiRange",
  addProseMirrorPlugins() {
    return [
      new Plugin({
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

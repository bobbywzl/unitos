import type { Mark, MarkType } from "@tiptap/pm/model";
import { isHistoryTransaction } from "@tiptap/pm/history";
import { Plugin, type Transaction } from "@tiptap/pm/state";
import { AddMarkStep, RemoveMarkStep, ReplaceAroundStep } from "@tiptap/pm/transform";
import type { EditorView } from "@tiptap/pm/view";
import { SUGGESTION_MARKS } from "@/components/docs/ext/suggest";

// Repeat last action (Ctrl+Y with nothing to redo), as Google Docs does it
// (SPEC.md §29, typing): the last formatting — a style added or taken away,
// a paragraph's style, alignment, spacing, or indent — is applied again to
// the selection.

type Action = {
  add: Mark[];
  remove: MarkType[];
  /** Paragraph changes: the node type to give, and the attributes that changed. */
  block: { type: string; attrs: Record<string, unknown> } | null;
};

const last = new WeakMap<EditorView, Action>();

/** A step that swaps a paragraph's type or attributes and keeps its words
    (setNodeMarkup). */
function isRestyle(step: ReplaceAroundStep): boolean {
  return (
    step.gapFrom - step.from === 1 &&
    step.to - step.gapTo === 1 &&
    step.insert === 1 &&
    step.slice.openStart === 0 &&
    step.slice.content.childCount === 1
  );
}

/** The formatting a transaction made, or null when it did anything else. */
function formattingOf(tr: Transaction): Action | null {
  if (!tr.docChanged) return null;
  const action: Action = { add: [], remove: [], block: null };
  for (let i = 0; i < tr.steps.length; i++) {
    const step = tr.steps[i];
    // A suggestion's own marks are not formatting to repeat.
    if (step instanceof AddMarkStep) {
      if (!SUGGESTION_MARKS.has(step.mark.type.name)) action.add.push(step.mark);
    } else if (step instanceof RemoveMarkStep) {
      if (!SUGGESTION_MARKS.has(step.mark.type.name)) action.remove.push(step.mark.type);
    }
    else if (step instanceof ReplaceAroundStep && isRestyle(step)) {
      const before = tr.docs[i].nodeAt(step.from);
      const after = tr.docs[i + 1]?.nodeAt(step.from) ?? tr.doc.nodeAt(tr.mapping.slice(i + 1).map(step.from));
      if (!before || !after || !after.isTextblock) return null;
      const attrs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(after.attrs)) if (k !== "blockId" && before.attrs[k] !== v) attrs[k] = v;
      action.block = { type: after.type.name, attrs };
    } else return null;
  }
  return action.add.length || action.remove.length || action.block ? action : null;
}

/** Watches the edits; the last formatting is kept per editor view. */
export function repeatPlugin(): Plugin {
  let view: EditorView | null = null;
  return new Plugin({
    view(v) {
      view = v;
      return { destroy: () => void (view = null) };
    },
    appendTransaction(transactions) {
      if (!view) return null;
      for (const tr of transactions) {
        if (isHistoryTransaction(tr) || tr.getMeta("appendedTransaction") || tr.getMeta("docsRepeat")) continue;
        const action = formattingOf(tr);
        if (action) last.set(view, action);
      }
      return null;
    },
  });
}

/** Apply the last formatting, if any, to the selection. */
export function repeatLastAction(view: EditorView): void {
  const action = last.get(view);
  if (!action) return;
  const { state } = view;
  const { from, to, empty } = state.selection;
  const tr = state.tr.setMeta("docsRepeat", true);
  if (empty) {
    let marks = state.storedMarks ?? state.selection.$from.marks();
    for (const type of action.remove) marks = type.removeFromSet(marks);
    for (const mark of action.add) marks = mark.addToSet(marks);
    tr.setStoredMarks(marks);
  } else {
    for (const type of action.remove) tr.removeMark(from, to, type);
    for (const mark of action.add) tr.addMark(from, to, mark);
  }
  if (action.block) {
    const type = state.schema.nodes[action.block.type];
    const attrs = action.block.attrs;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true;
      if (type && (node.type === type || type.isTextblock)) {
        try {
          tr.setNodeMarkup(pos, type, { ...node.attrs, ...attrs });
        } catch {
          // The paragraph cannot take that type here.
        }
      }
      return false;
    });
  }
  view.dispatch(tr);
}

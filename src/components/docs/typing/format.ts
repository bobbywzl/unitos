import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { applyFormatting, captureFormatting, type Formatting } from "@/components/docs/toolbar/paint-format";
import { charClass } from "@/components/docs/typing/chars";

// The text shortcuts Google Docs binds beyond Bold, Italic, and Underline
// (SPEC.md §29, typing): small caps, capitalization, copy and paste
// formatting (the toolbar's Paint format code), tick a checklist line.

export type TextCase = "lower" | "upper" | "title";

/** Format > Text > Capitalization: the selected letters in lowercase,
    UPPERCASE, or Title Case (each word's first letter, by Docs' words:
    don't, well-known). Every text node keeps its marks; one undo step. */
export function setCase(editor: Editor, mode: TextCase): boolean {
  const { state } = editor;
  const tr = state.tr;
  for (const { $from, $to } of state.selection.ranges) {
    let blockStart = -1;
    let inWord = false;
    state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (!node.isInline) return true;
      const start = Math.max(pos, $from.pos);
      const $start = state.doc.resolve(start);
      if ($start.start() !== blockStart) {
        // A word the selection starts inside goes on.
        blockStart = $start.start();
        const before = [...$start.parent.textBetween(0, $start.parentOffset, undefined, " ")].reverse().find((ch) => charClass(ch) !== "t");
        inWord = before !== undefined && charClass(before) === "w";
      }
      if (!node.isText || !node.text) {
        inWord = false;
        return false;
      }
      const end = Math.min(pos + node.nodeSize, $to.pos);
      let at = start;
      for (const ch of node.text.slice(start - pos, end - pos)) {
        const cls = charClass(ch);
        const next = mode === "upper" || (mode === "title" && cls === "w" && !inWord) ? ch.toUpperCase() : ch.toLowerCase();
        if (cls !== "t") inWord = cls === "w";
        // One step per changed letter: the marks painted over the words keep their ends.
        if (next !== ch) tr.replaceWith(tr.mapping.map(at), tr.mapping.map(at + ch.length), state.schema.text(next, node.marks));
        at += ch.length;
      }
      return false;
    });
  }
  if (tr.docChanged) editor.view.dispatch(closeHistory(tr));
  return true;
}

/** Small caps on or off (a textStyle attribute). */
export function toggleSmallCaps(editor: Editor): boolean {
  const on = editor.getAttributes("textStyle").fontVariant === "small-caps";
  editor
    .chain()
    .setMark("textStyle", { fontVariant: on ? null : "small-caps" })
    .removeEmptyTextStyle()
    .run();
  return true;
}

/** Ctrl+Alt+Enter: the checklist line under the caret ticks or unticks. */
export function toggleCheckbox(editor: Editor): boolean {
  const { state } = editor;
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "taskItem") {
      editor.view.dispatch(state.tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, checked: !node.attrs.checked }));
      return true;
    }
  }
  return true;
}

const copied = new WeakMap<Editor, Formatting>();

/** Ctrl+Alt+C: remember the formatting where the selection starts, text and
    paragraph, as the toolbar's Paint format copies it. */
export function copyFormatting(editor: Editor): boolean {
  copied.set(editor, captureFormatting(editor.state));
  return true;
}

/** Ctrl+Alt+V: the remembered formatting goes on the selection, as Paint
    format applies it. */
export function pasteFormatting(editor: Editor): boolean {
  const formatting = copied.get(editor);
  if (formatting) applyFormatting(editor, formatting);
  return true;
}

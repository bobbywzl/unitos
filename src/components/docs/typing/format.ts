import type { Editor } from "@tiptap/core";
import { applyFormatting, captureFormatting, type Formatting } from "@/components/docs/toolbar/paint-format";

// The text shortcuts Google Docs binds beyond Bold, Italic, and Underline
// (SPEC.md §29, typing): small caps, copy and paste formatting (the
// toolbar's Paint format code), tick a checklist line.

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

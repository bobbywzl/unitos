import type { Editor } from "@tiptap/core";
import type { Mark } from "@tiptap/pm/model";

// The text shortcuts Google Docs binds beyond Bold, Italic, and Underline
// (SPEC.md §29, typing): small caps, clear formatting, copy and paste text
// formatting, open the link under the caret, tick a checklist line.

/** Small caps on or off (a textStyle attribute). */
export function toggleSmallCaps(editor: Editor): boolean {
  if (!editor.isEditable || !editor.state.schema.marks.textStyle) return false;
  const on = editor.getAttributes("textStyle").fontVariant === "small-caps";
  editor
    .chain()
    .setMark("textStyle", { fontVariant: on ? null : "small-caps" })
    .removeEmptyTextStyle()
    .run();
  return true;
}

/** Ctrl+\: the text loses every style but its link. */
export function clearFormatting(editor: Editor): boolean {
  if (!editor.isEditable) return false;
  const { state } = editor;
  const { from, to, empty, $from } = state.selection;
  const link = state.schema.marks.link;
  const tr = state.tr;
  if (empty) {
    tr.setStoredMarks((state.storedMarks ?? $from.marks()).filter((m) => m.type === link));
  } else {
    for (const type of Object.values(state.schema.marks)) if (type !== link) tr.removeMark(from, to, type);
  }
  editor.view.dispatch(tr);
  return true;
}

/** Alt+Enter: the link under the caret opens in a new tab. */
export function openLinkAtCaret(editor: Editor): boolean {
  const href = editor.getAttributes("link").href as string | undefined;
  if (href) window.open(href, "_blank", "noopener,noreferrer");
  return true;
}

/** Ctrl+Alt+Enter: the checklist line under the caret ticks or unticks. */
export function toggleCheckbox(editor: Editor): boolean {
  if (!editor.isEditable) return true;
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

const copied = new WeakMap<Editor, readonly Mark[]>();

/** Ctrl+Alt+C: remember the text formatting at the selection's start. */
export function copyFormatting(editor: Editor): boolean {
  const { state } = editor;
  const { from, empty, $from } = state.selection;
  const marks = empty ? (state.storedMarks ?? $from.marks()) : (state.doc.nodeAt(from)?.marks ?? $from.marks());
  copied.set(
    editor,
    marks.filter((m) => m.type.name !== "link"),
  );
  return true;
}

/** Ctrl+Alt+V: the remembered formatting replaces the selection's (links stay). */
export function pasteFormatting(editor: Editor): boolean {
  const marks = copied.get(editor);
  if (!marks || !editor.isEditable) return true;
  const { state } = editor;
  const { from, to, empty } = state.selection;
  const tr = state.tr;
  if (empty) {
    tr.setStoredMarks(marks);
  } else {
    for (const type of Object.values(state.schema.marks)) if (type.name !== "link") tr.removeMark(from, to, type);
    for (const mark of marks) tr.addMark(from, to, mark);
  }
  editor.view.dispatch(tr);
  return true;
}

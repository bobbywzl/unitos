import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

// The text shortcuts Google Docs binds beyond Bold, Italic, and Underline
// (SPEC.md §29, typing): the font size one point up or down, small caps,
// clear formatting, open the link under the caret, tick a checklist line.

/** Each paragraph style's size in points when no run sets one. */
const STYLE_SIZE: Record<string, number> = { title: 26, subtitle: 15, h1: 20, h2: 16, h3: 14, h4: 12, h5: 11, h6: 11 };

function styleSize(block: PMNode | null | undefined): number {
  if (!block) return 11;
  if (block.type.name === "heading") return STYLE_SIZE[`h${block.attrs.level}`] ?? 11;
  const docStyle = block.attrs.docStyle as string | null | undefined;
  return (docStyle && STYLE_SIZE[docStyle]) || 11;
}

/** A fontSize attribute in points ("11pt", "14.6667px"), or null. */
function points(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return null;
  return value.endsWith("px") ? n * 0.75 : n;
}

function clampSize(n: number): string {
  const v = Math.max(1, Math.min(400, Math.round(n * 2) / 2));
  return `${v}pt`;
}

/** Ctrl+Shift+. and Ctrl+Shift+,: every run in the selection one point
    bigger or smaller; with a caret, the next typed text. */
export function stepFontSize(editor: Editor, dir: 1 | -1): boolean {
  if (!editor.isEditable) return false;
  const { state } = editor;
  const { from, to, empty, $from } = state.selection;
  const textStyle = state.schema.marks.textStyle;
  if (!textStyle) return false;
  if (empty) {
    const now = points(editor.getAttributes("textStyle").fontSize) ?? styleSize($from.parent);
    editor.chain().setFontSize(clampSize(now + dir)).run();
    return true;
  }
  const tr = state.tr;
  state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (!node.isText) return true;
    const mark = textStyle.isInSet(node.marks);
    const now = points(mark?.attrs.fontSize) ?? styleSize(parent);
    const s = Math.max(pos, from);
    const e = Math.min(pos + node.nodeSize, to);
    tr.addMark(s, e, textStyle.create({ ...(mark?.attrs ?? {}), fontSize: clampSize(now + dir) }));
    return false;
  });
  editor.view.dispatch(tr);
  return true;
}

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

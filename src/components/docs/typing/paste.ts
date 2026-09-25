import type { Editor } from "@tiptap/core";
import { Fragment, Slice, type Mark, type ResolvedPos, type Schema } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { fragmentToMarkdown, markdownToHtml } from "@/components/docs/typing/markdown";
import { uploadImage } from "@/lib/images";

// Paste in the page editor (SPEC.md §29, typing), as Google Docs pastes:
// plain text becomes one paragraph per line (blank lines too) in the style at
// the caret; Ctrl+Shift+V pastes the plain text alone; an image pasted or
// dropped from the computer is uploaded and goes in as an image. With Enable
// Markdown on, Paste from Markdown and Copy as Markdown work too.

/** Messages the paste code shows, in the page's language (set by the typing area). */
export const pasteMessages = { uploadFailed: "Couldn't add the image", noClipboard: "Couldn't read the clipboard", copied: "Copied" };

let lastPasteAt = 0;
let plainArmedAt = 0;

export function notePaste(): void {
  lastPasteAt = Date.now();
}

/** Plain text as a slice: a paragraph per line, each in `marks`; inside
    code the text stays as it is. */
export function plainTextSlice(schema: Schema, text: string, $context: ResolvedPos, marks: readonly Mark[]): Slice {
  const clean = text.replace(/\r\n?/g, "\n");
  if ($context.parent.type.spec.code) {
    return clean ? new Slice(Fragment.from(schema.text(clean)), 0, 0) : Slice.empty;
  }
  const paragraph = schema.nodes.paragraph;
  const lines = clean.split("\n");
  const nodes = lines.map((line) => paragraph.create(null, line ? schema.text(line, marks) : null));
  return new Slice(Fragment.from(nodes), 1, 1);
}

/** Insert plain text at the selection, in the style at the caret. */
function insertPlainText(view: EditorView, text: string): void {
  const { state } = view;
  const marks = state.storedMarks ?? state.selection.$from.marks();
  const slice = plainTextSlice(state.schema, text, state.selection.$from, marks);
  const tr: Transaction = state.tr.replaceSelection(slice).scrollIntoView();
  tr.setMeta("paste", true);
  view.dispatch(tr);
}

/** Ctrl+Shift+V: the browser's own paste event carries plain text (the
    editor sees Shift held). Where the browser fires none, the clipboard is
    read and its text goes in plain. */
export function armPlainPaste(view: EditorView): void {
  plainArmedAt = Date.now();
  const armed = plainArmedAt;
  window.setTimeout(() => {
    if (lastPasteAt >= armed || plainArmedAt !== armed) return;
    const read = navigator.clipboard?.readText?.bind(navigator.clipboard);
    if (!read) return;
    read()
      .then((text) => {
        if (text && view.editable && !view.isDestroyed) insertPlainText(view, text);
      })
      .catch(() => {
        // No permission to read the clipboard: nothing to paste.
      });
  }, 150);
}

function toast(text: string): void {
  window.dispatchEvent(new CustomEvent("dissect:toast", { detail: { text } }));
}

/** The image files among `files`. */
export function imageFiles(files: FileList | null | undefined): File[] {
  return Array.from(files ?? []).filter((f) => f.type.startsWith("image/"));
}

/** Upload images and insert them at `pos` (the selection when absent). */
export async function insertImageFiles(editor: Editor, files: File[], pos?: number): Promise<void> {
  let at = pos;
  for (const file of files) {
    try {
      const { url } = await uploadImage(file);
      if (editor.isDestroyed) return;
      const content = { type: "image", attrs: { src: url, alt: file.name } };
      if (at === undefined) editor.chain().focus().insertContent(content).run();
      else {
        editor.chain().focus().insertContentAt(Math.min(at, editor.state.doc.content.size), content).run();
        at = editor.state.selection.to;
      }
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : pasteMessages.uploadFailed);
    }
  }
}

/** Paste from Markdown: the clipboard's Markdown goes in as formatted text. */
export async function pasteMarkdown(editor: Editor): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    if (text && editor.isEditable) editor.chain().focus().insertContent(markdownToHtml(text)).run();
  } catch {
    toast(pasteMessages.noClipboard);
  }
}

/** Copy as Markdown: the selection goes to the clipboard as Markdown text. */
export async function copyMarkdown(editor: Editor): Promise<void> {
  const { from, to, empty } = editor.state.selection;
  if (empty) return;
  try {
    await navigator.clipboard.writeText(fragmentToMarkdown(editor.state.doc.slice(from, to).content));
    toast(pasteMessages.copied);
  } catch {
    toast(pasteMessages.noClipboard);
  }
}

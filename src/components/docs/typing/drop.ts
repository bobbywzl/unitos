import type { Editor } from "@tiptap/core";
import { Selection } from "@tiptap/pm/state";
import { insertPoint } from "@tiptap/pm/transform";
import type { EditorView } from "@tiptap/pm/view";
import { DOCS_EVENT, fireDocs } from "@/components/docs/typing/events";
import { closeEdit } from "@/components/docs/typing/keys";
import { acceptedImages, imageFiles, insertImageFiles, insertImageUrls } from "@/components/docs/typing/paste";
import { droppedImageUrls, mayCarryPageImage, type DroppedImageUrl } from "@/lib/image-drop";
import type { TFunc } from "@/lib/i18n/dictionaries";

// Images dropped on the page editor (SPEC.md §29), as Google Docs takes them:
// a file from the computer, or a picture dragged from another page, dropped
// anywhere on the page — on the words, in a margin, under the last line, or
// on the gray around the page — goes in where a caret at the drop point
// stands: on its own line after that paragraph, before it when the caret is
// at its start, in place of an empty line. While the drag is over the page,
// the drop line says where. The images go in through the one path
// (typing/paste.ts): they show at once, faint until stored, and follow the
// images' rules. Viewing mode changes nothing and says so. A file dropped on
// the page never becomes a project document
// (components/reader/use-page-file-drop.ts).

export type DropState = {
  /** The reader may edit this document. */
  canEdit: boolean;
  /** The reader may edit the project: a document it may not edit is then an
      import another account's project holds too. */
  projectEditor: boolean;
  /** The page takes changes now: Editing or Suggesting. */
  editing: boolean;
  t: TFunc;
};

/** What a drag from outside the page carries: files; an address (a picture
    or a link from another page); or words. */
type DragKind = "files" | "address" | "words";

// The drags the app starts itself (a quote on its way to a note) are theirs.
const APP_TYPE = /^application\/x-unitos/;

function dragKind(view: EditorView, e: DragEvent): DragKind | null {
  const dt = e.dataTransfer;
  // A drag that started in this page (words or an image it moves) is
  // ProseMirror's own.
  if (!dt || view.dragging) return null;
  const types = Array.from(dt.types);
  if (types.some((type) => APP_TYPE.test(type))) return null;
  if (types.includes("Files")) return "files";
  if (mayCarryPageImage(dt)) return "address";
  if (types.includes("text/html") || types.includes("text/plain")) return "words";
  return null;
}

/** The page and the gray around it; not the title row, the toolbar, the
    rulers, or a header or footer being written. */
function onPage(shell: HTMLElement, target: EventTarget | null): boolean {
  if (!(target instanceof Element) || !shell.contains(target)) return false;
  return !target.closest(".docs-header, .docs-hf-prose, [role='dialog'], [data-docs-menu]");
}

/** A point over the page, moved onto the text: a margin's point to the
    nearest line's side. */
function intoText(view: EditorView, x: number, y: number): { left: number; top: number } {
  const box = view.dom.getBoundingClientRect();
  return { left: Math.min(Math.max(x, box.left + 1), box.right - 1), top: Math.min(Math.max(y, box.top + 1), box.bottom - 1) };
}

type Line = { left: number; right: number; y: number };
type Landing = { pos: number; line: Line };

/** Where images dropped at (x, y) go: by the caret nearest the point, in
    the textblock it stands in. Above the text is the document's start,
    under it the document's end. */
function landingAt(view: EditorView, x: number, y: number): Landing | null {
  const { doc } = view.state;
  const box = view.dom.getBoundingClientRect();
  let caret: number | null;
  if (y < box.top) caret = Selection.findFrom(doc.resolve(0), 1, true)?.from ?? null;
  else if (y > box.bottom) caret = Selection.findFrom(doc.resolve(doc.content.size), -1, true)?.from ?? null;
  else caret = view.posAtCoords(intoText(view, x, y))?.pos ?? null;
  const end: Landing = { pos: doc.content.size, line: { left: box.left, right: box.right, y: box.bottom } };
  if (caret === null) return end;
  const $caret = doc.resolve(caret);
  const $at = $caret.parent.isTextblock
    ? $caret
    : (Selection.findFrom($caret, -1, true) ?? Selection.findFrom($caret, 1, true))?.$from;
  if (!$at?.parent.isTextblock) return end;
  const block = $at.parent;
  const start = $at.before();
  const dom = view.nodeDOM(start);
  const r = dom instanceof HTMLElement ? dom.getBoundingClientRect() : null;
  if (!r) return end;
  const line = { left: r.left, right: r.right, y: r.bottom };
  // An empty line takes the image in its place.
  if (block.content.size === 0 && !block.type.spec.code) return { pos: $at.pos, line: { ...line, y: (r.top + r.bottom) / 2 } };
  // A caret at the line's start puts the image before it.
  if ($at.parentOffset === 0 && $at.pos === caret) {
    return { pos: insertPoint(doc, start, doc.type.schema.nodes.image) ?? start, line: { ...line, y: r.top } };
  }
  // Else the image goes after the paragraph (typing/paste.ts imageSpot).
  return { pos: $at.pos, line };
}

/** The drop line: where dropped images would land, or, for words, a caret
    where they would go in. */
class DropLine {
  private el: HTMLElement | null = null;
  private idle: ReturnType<typeof setTimeout> | null = null;

  private place(left: number, top: number, width: number, height: number): void {
    if (!this.el) {
      this.el = document.body.appendChild(document.createElement("div"));
      this.el.className = "docs-drop-line";
      this.el.setAttribute("aria-hidden", "true");
    }
    Object.assign(this.el.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    // dragover comes every 350 ms or so while the pointer holds still; a
    // drag that left the window sends nothing more.
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => this.hide(), 600);
  }

  line(line: Line): void {
    this.place(line.left, line.y - 1, Math.max(0, line.right - line.left), 2);
  }

  caret(view: EditorView, x: number, y: number): void {
    const pos = view.posAtCoords(intoText(view, x, y))?.pos;
    if (pos === undefined) return this.hide();
    const c = view.coordsAtPos(pos);
    this.place(c.left - 1, c.top, 2, c.bottom - c.top);
  }

  hide(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    this.el?.remove();
    this.el = null;
  }
}

/** The page's message, as the reader shows its toasts, with an action. */
function say(view: EditorView, text: string, action?: { label: string; run: () => void }): void {
  view.dom.dispatchEvent(new CustomEvent("dissect:toast", { bubbles: true, detail: { text, action } }));
}

/** Why an image did not go into a page that takes no changes now. */
function sayNoChanges(editor: Editor, state: DropState): void {
  const { t } = state;
  if (state.canEdit) {
    say(editor.view, t("docsTyping.imageViewing"), {
      label: t("docsTyping.switchToEditing"),
      run: () => fireDocs(editor, DOCS_EVENT.mode, "editing"),
    });
  } else say(editor.view, t(state.projectEditor ? "api.importShared" : "api.viewingOnly"));
}

/** Take images dropped on the page editor of `editor`, and pasted while its
    page takes no changes. `state` reads the page as it is now. */
export function listenImageDrop(editor: Editor, state: () => DropState): () => void {
  const view = editor.view;
  const shell = view.dom.closest<HTMLElement>("[data-docs-editor]");
  if (!shell) return () => undefined;
  const drop = new DropLine();
  // Words handed on to ProseMirror (typing/drop.ts takes the margin's drop)
  // are not taken again.
  let handing = false;

  /** Whether this path takes the drag. Over the words, while the page takes
      changes, words and addresses are ProseMirror's (its caret shows where
      they go); a picture among them is taken at the drop. */
  const takes = (e: DragEvent, kind: DragKind, editing: boolean): boolean => {
    if (kind === "files") return true;
    const onWords = e.target instanceof Node && view.dom.contains(e.target);
    if (editing) return !onWords;
    return kind === "address";
  };

  const onOver = (e: DragEvent) => {
    if (handing) return;
    const kind = dragKind(view, e);
    if (!kind || !onPage(shell, e.target)) return;
    const { editing } = state();
    if (!takes(e, kind, editing)) {
      drop.hide();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    if (!editing) drop.hide();
    else if (kind === "words") drop.caret(view, e.clientX, e.clientY);
    else {
      const landing = landingAt(view, e.clientX, e.clientY);
      if (landing) drop.line(landing.line);
    }
  };

  const onLeave = (e: DragEvent) => {
    if (!(e.relatedTarget instanceof Node) || !shell.contains(e.relatedTarget)) drop.hide();
  };

  const onDrop = (e: DragEvent) => {
    if (handing) return;
    const kind = dragKind(view, e);
    if (!kind || !onPage(shell, e.target)) return;
    drop.hide();
    const now = state();
    const files = kind === "files" ? [...(e.dataTransfer?.files ?? [])] : [];
    // A picture from another page: its address (a browser may give the
    // file's type and none of its bytes).
    const images: DroppedImageUrl[] = kind !== "words" && files.length === 0 ? droppedImageUrls(e.dataTransfer) : [];
    if (!takes(e, kind, now.editing) && images.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (kind === "address" && view.dom.contains(e.target as Node)) {
      // ProseMirror's drop caret goes with the drag it did not get to drop.
      view.dom.dispatchEvent(new DragEvent("dragleave"));
    }
    if (!now.editing) {
      // An image says why nothing changed; a file that is not an image says
      // so (acceptedImages); words or a link change nothing.
      if (images.length > 0 || imageFiles(files).length > 0) sayNoChanges(editor, now);
      else acceptedImages(editor, files);
      return;
    }
    if (files.length > 0 || images.length > 0) {
      const landing = landingAt(view, e.clientX, e.clientY);
      if (!landing) return;
      // A drop is its own undo step (ext/typing.ts).
      closeEdit(view);
      if (files.length > 0) void insertImageFiles(editor, files, landing.pos);
      else void insertImageUrls(editor, images, landing.pos);
      return;
    }
    if (kind === "files") return;
    // Words or a link dropped in a margin go in at the nearest point of the
    // text, as ProseMirror drops them there.
    const at = intoText(view, e.clientX, e.clientY);
    handing = true;
    try {
      view.dom.dispatchEvent(
        new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: e.dataTransfer, clientX: at.left, clientY: at.top }),
      );
    } finally {
      handing = false;
    }
  };

  const onEnd = () => drop.hide();

  // A paste while the page takes no changes: an image says why nothing
  // changed. The paste is this page's when the last press was on it.
  let pressedHere = false;
  const onPress = (e: PointerEvent) => {
    pressedHere = e.target instanceof Node && shell.contains(e.target);
  };
  const onPaste = (e: ClipboardEvent) => {
    const now = state();
    if (now.editing || !pressedHere || e.defaultPrevented) return;
    const active = document.activeElement;
    if (active && active !== document.body && !shell.contains(active)) return;
    if (imageFiles(e.clipboardData?.files).length === 0) return;
    e.preventDefault();
    sayNoChanges(editor, now);
  };

  shell.addEventListener("dragenter", onOver, true);
  shell.addEventListener("dragover", onOver, true);
  shell.addEventListener("dragleave", onLeave, true);
  shell.addEventListener("drop", onDrop, true);
  window.addEventListener("dragend", onEnd);
  window.addEventListener("drop", onEnd);
  document.addEventListener("pointerdown", onPress, true);
  document.addEventListener("paste", onPaste);
  return () => {
    drop.hide();
    shell.removeEventListener("dragenter", onOver, true);
    shell.removeEventListener("dragover", onOver, true);
    shell.removeEventListener("dragleave", onLeave, true);
    shell.removeEventListener("drop", onDrop, true);
    window.removeEventListener("dragend", onEnd);
    window.removeEventListener("drop", onEnd);
    document.removeEventListener("pointerdown", onPress, true);
    document.removeEventListener("paste", onPaste);
  };
}

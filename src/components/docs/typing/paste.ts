import type { Editor } from "@tiptap/core";
import { Fragment, Slice, type Mark, type Node as PMNode, type ResolvedPos, type Schema } from "@tiptap/pm/model";
import { NodeSelection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { insertPoint } from "@tiptap/pm/transform";
import type { EditorView } from "@tiptap/pm/view";
import { insertT, toast } from "@/components/docs/insert/context";
import { fragmentToMarkdown, markdownToHtml } from "@/components/docs/typing/markdown";
import { uploadImage } from "@/lib/images";

// Paste in the page editor (SPEC.md §29, typing), as Google Docs pastes:
// plain text becomes one paragraph per line (blank lines too) in the style at
// the caret; Ctrl+Shift+V pastes the plain text alone; an image pasted or
// dropped from the computer is uploaded and goes in as an image on its own
// line. Pasted HTML keeps only the formatting a save keeps, Word's lists and
// Google Docs' checklists included, and its pictures are copied into Unitos.
// With Enable Markdown on, Paste from Markdown and Copy as Markdown work too.

/** Points per CSS unit. A font size's em, rem, and % count against Normal
    text's 11 pt. */
const PT_PER_UNIT: Record<string, number> = { pt: 1, px: 0.75, in: 72, cm: 72 / 2.54, mm: 72 / 25.4 };
const PT_PER_FONT_UNIT: Record<string, number> = { ...PT_PER_UNIT, em: 11, rem: 11, "%": 0.11 };

function toPoints(value: string, units = PT_PER_UNIT): number | null {
  const m = /^(-?[\d.]+)(pt|px|in|cm|mm|r?em|%)$/.exec(value.trim());
  const n = m && units[m[2]] ? parseFloat(m[1]) * units[m[2]] : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** A pasted paragraph's indents and spacing become the data attributes the
    page's paragraphs read. */
function keepParagraphFormat(el: HTMLElement): void {
  if (!/^(P|H[1-6])$/.test(el.tagName)) return;
  const set = (attr: string, value: string) => {
    const pt = value ? toPoints(value) : null;
    if (pt && !el.hasAttribute(attr)) el.setAttribute(attr, String(pt));
  };
  set("data-indent-left", el.style.marginLeft);
  set("data-indent-first-line", el.style.textIndent);
  set("data-space-before", el.style.marginTop || el.style.paddingTop);
  set("data-space-after", el.style.marginBottom || el.style.paddingBottom);
}

/** A pasted element's color and highlight (Word's too) become #rrggbb and
    its size whole or half points, the values a save keeps
    (lib/docs/schema.ts); what cannot be read goes. A table cell's
    background is the cell's (data-bg, insert/table.ts). */
function keepTextFormat(el: HTMLElement, hex: (value: string) => string | null): void {
  const s = el.style;
  const highlight = s.backgroundColor || /mso-highlight:\s*([^;]+)/i.exec(el.getAttribute("style") ?? "")?.[1] || "";
  if (!s.color && !highlight && !s.fontSize) return;
  const color = hex(s.color);
  const background = hex(highlight);
  if (background && /^T[DH]$/.test(el.tagName)) el.setAttribute("data-bg", background);
  const pt = toPoints(s.fontSize, PT_PER_FONT_UNIT);
  for (const name of ["color", "background", "font-size"]) s.removeProperty(name);
  // Written as text: a color set through el.style would read back as rgb().
  const style = [
    s.cssText,
    color && `color: ${color};`,
    background && `background-color: ${background};`,
    pt !== null && `font-size: ${Math.min(400, Math.max(1, Math.round(pt * 2) / 2))}pt;`,
  ]
    .filter(Boolean)
    .join(" ");
  if (style) el.setAttribute("style", style);
  else el.removeAttribute("style");
}

/** Word's list paragraphs (style mso-list:lN levelM) become list items at
    level M, without the marker Word writes before each. A marker in Symbol
    or Wingdings, "o", or one character that is not a letter or a digit
    ("·", "§", "•") means bullets; any other ("1.", "a.", "一、") numbers. */
function wordLists(root: DocumentFragment): void {
  // The list open at each level, and the Word list it holds.
  let open: HTMLElement[] = [];
  let openId = "";
  root.querySelectorAll<HTMLElement>("p[style*='mso-list']").forEach((p) => {
    const m = /mso-list:\s*(l\d+)\s+level(\d+)\s*(lfo\d+)?/i.exec(p.getAttribute("style") ?? "");
    const nodes = [...p.childNodes];
    const from = nodes.findIndex((n) => n instanceof Comment && n.data === "[if !supportLists]");
    const to = nodes.findIndex((n, i) => i > from && n instanceof Comment && n.data === "[endif]");
    if (!m || from < 0 || to < 0) return;
    const marker = p.ownerDocument.createElement("span");
    marker.append(...nodes.slice(from, to + 1));
    const bullet = /^([^\p{L}\p{N}]|o)$/u.test(marker.textContent.trim()) || /font-family:\s*"?(symbol|wingdings)/i.test(marker.innerHTML);
    const kind = bullet ? "UL" : "OL";
    const id = `${m[1]} ${m[3]}`;
    if (p.previousElementSibling !== open[0] || id !== openId) open = [];
    openId = id;
    const level = Math.min(Number(m[2]), open.length + 1);
    open.length = Math.min(open.length, level);
    if (open[level - 1]?.tagName !== kind) {
      open.length = level - 1;
      const list = p.ownerDocument.createElement(kind);
      if (level === 1) p.before(list);
      else open[level - 2].lastElementChild?.append(list);
      open.push(list);
    }
    const item = p.ownerDocument.createElement("li");
    open[level - 1].append(item);
    item.append(p);
    // The list indents the item.
    p.style.removeProperty("margin-left");
    p.style.removeProperty("text-indent");
  });
}

/** A Google Docs checklist line (li role="checkbox") becomes a checklist
    line, ticked or not, without its checkbox picture; a ticked line's
    strikethrough is the checklist's, not the words'. */
function docsChecklists(root: DocumentFragment): void {
  root.querySelectorAll<HTMLElement>("li[role='checkbox']").forEach((li) => {
    const checked = li.getAttribute("aria-checked") === "true";
    li.parentElement?.setAttribute("data-type", "taskList");
    li.setAttribute("data-type", "taskItem");
    li.setAttribute("data-checked", String(checked));
    li.querySelectorAll(":scope > img").forEach((img) => img.remove());
    if (!checked) return;
    for (const el of [li, ...li.querySelectorAll<HTMLElement>("[style]")]) {
      el.style.textDecorationLine = el.style.textDecorationLine.replace("line-through", "");
    }
  });
}

/** Pasted HTML as the page editor keeps it: Word's lists, Google Docs'
    checklists, its paragraph and text formats (above), and its pictures
    copied into Unitos (copyImages). */
export function pastedHtml(editor: Editor, html: string): string {
  const box = document.createElement("template");
  box.innerHTML = html;
  wordLists(box.content);
  docsChecklists(box.content);
  // The browser reads each color: a see-through one is drawn over the white
  // page; none, a keyword, or a color outside sRGB is null.
  const probe = document.body.appendChild(document.createElement("i"));
  probe.hidden = true;
  const hexes = new Map<string, string | null>();
  const hex = (value: string): string | null => {
    if (!value || /^(inherit|initial|unset|revert|currentcolor)|var\(/i.test(value)) return null;
    if (!hexes.has(value)) {
      probe.style.color = "";
      probe.style.color = value;
      const m = probe.style.color ? /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/.exec(getComputedStyle(probe).color) : null;
      const alpha = m ? Number(m[4] ?? 1) : 0;
      const channel = (c: string) => Math.round(255 - alpha * (255 - Number(c))).toString(16).padStart(2, "0");
      hexes.set(value, m && alpha > 0 ? `#${channel(m[1])}${channel(m[2])}${channel(m[3])}` : null);
    }
    return hexes.get(value) ?? null;
  };
  box.content.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
    keepParagraphFormat(el);
    keepTextFormat(el, hex);
  });
  probe.remove();
  copyImages(editor, box.content);
  return box.innerHTML;
}

/** The positions of the images at address `src`. */
function imagesAt(doc: PMNode, src: string): number[] {
  const found: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "image" && node.attrs.src === src) found.push(pos);
  });
  return found;
}

/** Pictures in pasted HTML are copied into Unitos. A data: picture shows at
    once from a blob: address; one no save keeps (file:, cid:) goes. Once
    the paste has landed, each picture it put in the document is uploaded
    (the path insertImageFiles takes) and its images take the stored
    address. A remote picture the browser may not read keeps its address; a
    data: picture that cannot be stored goes, with the reason. */
function copyImages(editor: Editor, root: DocumentFragment): void {
  const sources = new Map<string, Blob | null>();
  root.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") ?? "";
    const data = /^data:(image\/[\w.+-]+);base64,/i.exec(src);
    if (/^https?:\/\//i.test(src)) {
      if (!src.startsWith(`${location.origin}/`)) sources.set(src, null);
    } else if (data) {
      try {
        const blob = new Blob([Uint8Array.from(atob(src.slice(data[0].length)), (c) => c.charCodeAt(0))], { type: data[1] });
        const url = URL.createObjectURL(blob);
        img.setAttribute("src", url);
        sources.set(url, blob);
      } catch {
        img.remove();
      }
    } else if (!src.startsWith("/api/images/")) img.remove();
  });
  if (sources.size === 0) return;
  window.setTimeout(() => {
    sources.forEach(async (blob, src) => {
      let url: string | null = null;
      if (imagesAt(editor.state.doc, src).length > 0) {
        try {
          const bytes = blob ?? (await (await fetch(src)).blob());
          url = (await uploadImage(new File([bytes], "image", { type: bytes.type }))).url;
        } catch (err) {
          if (blob) uploadFailed(editor, err);
        }
      }
      if (blob) URL.revokeObjectURL(src);
      if (url || blob) setImageSrc(editor, src, url);
    });
  }, 0);
}

/** Every image at address `from` takes address `to`, or goes when `to` is
    null. The paste is the undo step, not this. */
function setImageSrc(editor: Editor, from: string, to: string | null): void {
  if (editor.isDestroyed) return;
  const { tr } = editor.state;
  for (const pos of imagesAt(tr.doc, from)) {
    if (to) tr.setNodeAttribute(pos, "src", to);
    else tr.delete(tr.mapping.map(pos), tr.mapping.map(pos + 1));
  }
  if (tr.docChanged) editor.view.dispatch(tr.setMeta("addToHistory", false));
}

function uploadFailed(editor: Editor, err: unknown): void {
  toast(err instanceof Error && err.message ? err.message : insertT(editor)("docsTyping.uploadFailed"));
}

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
        if (text && view.editable && !view.isDestroyed) view.pasteText(text);
      })
      .catch(() => {
        // No permission to read the clipboard: nothing to paste.
      });
  }, 150);
}

/** The image files among `files`. */
export function imageFiles(files: FileList | null | undefined): File[] {
  return Array.from(files ?? []).filter((f) => f.type.startsWith("image/"));
}

/** Where an image goes for a caret at `pos`, as in Google Docs: on its own
    line after the caret's paragraph, or in place of the caret's line when
    that line is empty (insertContentAt replaces it). */
function imageSpot(doc: PMNode, pos: number): number {
  const $pos = doc.resolve(pos);
  const line = $pos.parent;
  if (!line.isTextblock || (line.content.size === 0 && !line.type.spec.code)) return pos;
  return insertPoint(doc, $pos.after(), line.type.schema.nodes.image) ?? $pos.after();
}

/** Insert images at `pos` (the selection when absent, which the first image
    replaces), each on its own line (imageSpot). Each shows at once from a
    blob: address, uploads, and takes the stored address, as copyImages
    does; one the server refuses goes, with the reason. */
export async function insertImageFiles(editor: Editor, files: File[], pos?: number): Promise<void> {
  let at = pos;
  const shown = files.map((file) => {
    const src = URL.createObjectURL(file);
    insertImage(editor, { src }, at);
    at = editor.state.selection.to;
    return src;
  });
  await Promise.all(
    files.map(async (file, i) => {
      let url: string | null = null;
      try {
        url = (await uploadImage(file)).url;
      } catch (err) {
        uploadFailed(editor, err);
      }
      setImageSrc(editor, shown[i], url);
      URL.revokeObjectURL(shown[i]);
    }),
  );
}

/** A new image selected in `tr` hands the caret to the empty line under it,
    a new one when the next line holds words, as Google Docs leaves the caret
    after a new image: the next key never replaces it. */
export function caretUnderImage(tr: Transaction): boolean {
  if (!(tr.selection instanceof NodeSelection) || tr.selection.node.type.name !== "image") return false;
  const after = tr.selection.to;
  const next = tr.doc.resolve(after).nodeAfter;
  if (!next?.isTextblock || next.content.size > 0) tr.insert(after, tr.doc.type.schema.nodes.paragraph.create());
  tr.setSelection(TextSelection.create(tr.doc, after + 1));
  return true;
}

/** An image on its own line after the paragraph at `pos` (else the
    selection, which it replaces), or in place of an empty line. */
export function insertImage(editor: Editor, attrs: { src: string }, pos?: number): void {
  editor
    .chain()
    .focus()
    .command(({ tr, commands }) => {
      const { from } = tr.selection;
      const spot = pos ?? tr.deleteSelection().mapping.map(from);
      return commands.insertContentAt(imageSpot(tr.doc, Math.min(spot, tr.doc.content.size)), { type: "image", attrs });
    })
    .command(({ tr }) => caretUnderImage(tr))
    .run();
}

/** Paste from Markdown: the clipboard's Markdown goes in as formatted text. */
export async function pasteMarkdown(editor: Editor): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    if (text && editor.isEditable) editor.chain().focus().insertContent(markdownToHtml(text)).run();
  } catch {
    toast(insertT(editor)("docsTyping.pasteNoClipboard"));
  }
}

/** Copy as Markdown: the selection goes to the clipboard as Markdown text. */
export async function copyMarkdown(editor: Editor): Promise<void> {
  const { from, to, empty } = editor.state.selection;
  if (empty) return;
  try {
    await navigator.clipboard.writeText(fragmentToMarkdown(editor.state.doc.slice(from, to).content));
    toast(insertT(editor)("docsTyping.copied"));
  } catch {
    toast(insertT(editor)("docsTyping.pasteNoClipboard"));
  }
}

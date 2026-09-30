import type { Editor } from "@tiptap/core";
import { Fragment, Slice, type Mark, type Node as PMNode, type ResolvedPos, type Schema } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { insertPoint } from "@tiptap/pm/transform";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { insertT, toast } from "@/components/docs/insert/context";
import { listFormat } from "@/components/docs/toolbar/lists";
import { fragmentToMarkdown, markdownToHtml } from "@/components/docs/typing/markdown";
import { LIST_COUNTERS, type ListCounter, type ListLevel } from "@/lib/docs/schema";
import { imageFileFrom, type DroppedImageUrl } from "@/lib/image-drop";
import { isImageFile, refuseImage, uploadImage, type ImageRefusal } from "@/lib/images";
import type { TKey } from "@/lib/i18n/dictionaries";

// Paste in the page editor (SPEC.md §29, typing), as Google Docs pastes:
// plain text becomes one paragraph per line (blank lines too) in the style at
// the caret; Ctrl+Shift+V pastes the plain text alone; an image pasted or
// dropped (typing/drop.ts) is uploaded and goes in as an image on its own
// line, faint with a turning ring until it is stored. Pasted HTML keeps only
// the formatting a save keeps, Word's lists and Google Docs' checklists
// included, and its images are copied into Unitos. With Enable Markdown
// on, Paste from Markdown and Copy as Markdown work too.

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
    line, ticked or not, without its checkbox image; a ticked line's
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

/** A Google Docs list keeps the counters its clipboard carries: each line's
    list-style-type at its aria-level (upper-alpha, lower-roman, square) is
    that level's, and the outermost list takes the preset that draws them,
    else them as its own levels (toolbar/lists.ts listFormat). The words
    around a number ("(a)") are not on the clipboard: a level reads "a.". */
function docsListFormats(root: DocumentFragment): void {
  const bullets: Record<string, string> = { disc: "●", circle: "○", square: "■" };
  for (const list of root.querySelectorAll<HTMLElement>("ol, ul")) {
    if (list.parentElement?.closest("ol, ul") || list.getAttribute("data-type") === "taskList") continue;
    const seen: (ListLevel | undefined)[] = [];
    for (const li of list.querySelectorAll<HTMLElement>("li[aria-level]")) {
      const k = Number(li.getAttribute("aria-level")) - 1;
      const type = li.style.listStyleType;
      if (!Number.isInteger(k) || k < 0 || k > 8 || seen[k]) continue;
      if ((LIST_COUNTERS as readonly string[]).includes(type)) seen[k] = { counter: type as ListCounter, format: `%${k}.` };
      else if (bullets[type]) seen[k] = { bullet: bullets[type] };
    }
    const format = listFormat(list.tagName === "OL" ? "orderedList" : "bulletList", seen);
    if (format && "listStyle" in format) list.setAttribute("data-list-style", format.listStyle);
    else if (format) list.setAttribute("data-list-levels", format.listLevels);
  }
}

/** Pasted HTML as the page editor keeps it: Word's lists, Google Docs'
    lists and checklists, its paragraph and text formats (above), and its
    images copied into Unitos (copyImages). */
export function pastedHtml(editor: Editor, html: string): string {
  const box = document.createElement("template");
  box.innerHTML = html;
  wordLists(box.content);
  docsChecklists(box.content);
  docsListFormats(box.content);
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

/** Images in pasted HTML are copied into Unitos. A data: image shows at
    once from a blob: address; one no save keeps (file:, cid:) goes. Once
    the paste has landed, each image it put in the document is uploaded
    (the path insertImageFiles takes) and its images take the stored
    address. A remote image the browser may not read keeps its address; a
    data: image that cannot be stored goes, with the reason. */
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
        markUpload(editor, src, true);
        try {
          const bytes = blob ?? (await (await fetch(src)).blob());
          url = (await uploadImage(new File([bytes], "image", { type: bytes.type }))).url;
        } catch (err) {
          if (blob) uploadFailed(editor, err);
        }
        markUpload(editor, src, false);
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
  toast(err instanceof Error && err.message ? err.message : insertT(editor)("docsTyping.uploadFailed"), editor);
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

/** The image files among `files`: png, jpg, gif, webp, or bmp, by type or
    by name (lib/handwritten/image.ts). */
export function imageFiles(files: FileList | File[] | null | undefined): File[] {
  return Array.from(files ?? []).filter(isImageFile);
}

// ── The images' rules: the type, the size, the tier ─────────────────────

/** Whether the page's reader has Unitos Premium (lib/tiers.ts), set by the
    typing area; unknown counts as yes, and the server checks again. */
const premiumOf = new WeakMap<Editor, boolean>();

export function setImagePremium(editor: Editor, premium: boolean): void {
  premiumOf.set(editor, premium);
}

const REFUSAL: Record<Exclude<ImageRefusal, "not-image">, TKey> = {
  "too-large": "api.imageTooLarge",
  premium: "api.imageNeedsPremium",
};

/** The files the page takes as images, in order. The first file it refuses
    says why, before anything uploads: not an image (a PDF goes on the
    document list, not in the text), larger than 25 MB, or larger than
    5 MB without Unitos Premium (lib/images.ts refuseImage). */
export function acceptedImages(editor: Editor, files: File[]): File[] {
  const t = insertT(editor);
  const premium = premiumOf.get(editor) ?? true;
  let said = false;
  return files.filter((file) => {
    const refusal = refuseImage(file, premium);
    if (refusal && !said) {
      said = true;
      toast(refusal === "not-image" ? t("docsTyping.notAnImage", { name: file.name || t("docsTyping.thisFile") }) : t(REFUSAL[refusal]), editor);
    }
    return refusal === null;
  });
}

// ── Images on their way: faint, with a turning ring ─────────────────────

type Uploads = { srcs: ReadonlySet<string>; decorations: DecorationSet };
const uploadsKey = new PluginKey<Uploads>("docsImageUploads");

function uploadDecorations(doc: PMNode, srcs: ReadonlySet<string>): DecorationSet {
  if (srcs.size === 0) return DecorationSet.empty;
  const found: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "image" && srcs.has(String(node.attrs.src))) {
      found.push(Decoration.node(pos, pos + node.nodeSize, { class: "docs-img-uploading" }));
    }
    return node.isBlock && !node.isTextblock;
  });
  return DecorationSet.create(doc, found);
}

/** The images whose address is uploading draw faint with a turning ring
    (docs.css) until the stored address takes its place. */
export function uploadsPlugin(): Plugin<Uploads> {
  return new Plugin<Uploads>({
    key: uploadsKey,
    state: {
      init: () => ({ srcs: new Set(), decorations: DecorationSet.empty }),
      apply(tr, value, _old, state: EditorState) {
        const change = tr.getMeta(uploadsKey) as { src: string; on: boolean } | undefined;
        if (!change && (!tr.docChanged || value.srcs.size === 0)) return value;
        const srcs = new Set(value.srcs);
        if (change?.on) srcs.add(change.src);
        else if (change) srcs.delete(change.src);
        return { srcs, decorations: uploadDecorations(state.doc, srcs) };
      },
    },
    props: {
      decorations(state) {
        return uploadsKey.getState(state)?.decorations ?? null;
      },
    },
  });
}

function markUpload(editor: Editor, src: string, on: boolean): void {
  if (editor.isDestroyed || !uploadsKey.get(editor.state)) return;
  editor.view.dispatch(editor.state.tr.setMeta(uploadsKey, { src, on }).setMeta("addToHistory", false));
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
    replaces), each on its own line (imageSpot), in the order given. The
    files the rules refuse stay out, with the reason (acceptedImages). Each
    shows at once from a blob: address, uploads, and takes the stored
    address, as copyImages does; one the server refuses goes, with the
    reason. */
export async function insertImageFiles(editor: Editor, files: File[], pos?: number): Promise<void> {
  const taken = acceptedImages(editor, files);
  let at = pos;
  const shown = taken.map((file) => {
    const src = URL.createObjectURL(file);
    markUpload(editor, src, true);
    insertImage(editor, { src }, at);
    at = editor.state.selection.to;
    return src;
  });
  await Promise.all(
    taken.map(async (file, i) => {
      let url: string | null = null;
      try {
        url = (await uploadImage(file)).url;
      } catch (err) {
        uploadFailed(editor, err);
      }
      markUpload(editor, shown[i], false);
      setImageSrc(editor, shown[i], url);
      URL.revokeObjectURL(shown[i]);
    }),
  );
}

/** Insert images dragged from another page at `pos`, each on its own line,
    as insertImageFiles does. A data: image goes in as a file. Any other
    shows at once from its own address and uploads when the browser may read
    it, then takes the stored address; one the browser may not read keeps its
    address, as a pasted image does (copyImages). */
export async function insertImageUrls(editor: Editor, images: DroppedImageUrl[], pos: number): Promise<void> {
  const data = images.filter((image) => image.url.startsWith("data:"));
  if (data.length === images.length) {
    const files = (await Promise.all(data.map((image) => imageFileFrom(image.url)))).filter((f): f is File => f !== null);
    await insertImageFiles(editor, files, pos);
    return;
  }
  let at = pos;
  const shown = images.filter((image) => !image.url.startsWith("data:"));
  for (const image of shown) {
    markUpload(editor, image.url, true);
    insertImage(editor, { src: image.url, alt: image.alt }, at);
    at = editor.state.selection.to;
  }
  await Promise.all(
    shown.map(async (image) => {
      let url: string | null = null;
      const file = await imageFileFrom(image.url);
      if (file && refuseImage(file, premiumOf.get(editor) ?? true) === null) {
        try {
          url = (await uploadImage(file)).url;
        } catch {
          // Refused by the server: the image keeps its own address.
        }
      }
      markUpload(editor, image.url, false);
      if (url) setImageSrc(editor, image.url, url);
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
export function insertImage(
  editor: Editor,
  attrs: { src: string; alt?: string; width?: number; height?: number; chart?: string; drawing?: string },
  pos?: number,
): void {
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
    toast(insertT(editor)("docsTyping.pasteNoClipboard"), editor);
  }
}

/** Copy as Markdown: the selection goes to the clipboard as Markdown text. */
export async function copyMarkdown(editor: Editor): Promise<void> {
  const { from, to, empty } = editor.state.selection;
  if (empty) return;
  try {
    await navigator.clipboard.writeText(fragmentToMarkdown(editor.state.doc.slice(from, to).content));
    toast(insertT(editor)("docsTyping.copied"), editor);
  } catch {
    toast(insertT(editor)("docsTyping.pasteNoClipboard"), editor);
  }
}

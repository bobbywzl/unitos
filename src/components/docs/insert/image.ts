import { Extension, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView, type NodeView } from "@tiptap/pm/view";
import { emitInsert, insertContext } from "@/components/docs/insert/context";

// Images (SPEC.md §29), the way Google Docs handles them: a new image keeps
// its ratio and fits the text's width; selected, it gets the blue frame, the
// eight handles (the corners keep the ratio, the sides stretch one way), and
// the round rotation handle; a double press crops it (black handles, the
// rest dimmed; Enter or a press outside applies, Escape cancels). Its layout
// is Google Docs' five: In line, Wrap text, Break text, Behind text, In
// front of text (a pageless page takes In line only). An image stays a block
// of its own in the rich text (a FIGURE row), so In line sits on its own
// line, aligned. Border, recolor, transparency, brightness, and contrast
// are attributes too. Paste and drop upload the file (POST /api/images).

export type Wrap = "inline" | "wrap" | "break" | "behind" | "front";
export const WRAPS: Wrap[] = ["inline", "wrap", "break", "behind", "front"];
export type WrapSide = "both" | "left" | "right";
export type ImageAlign = "left" | "center" | "right";
export type Recolor = "none" | "grayscale" | "sepia" | "negative";
export type Dash = "solid" | "dotted" | "dashed";

const PX_PER_PT = 96 / 72;
const MIN_SIZE = 16;
const MIN_CROP = 0.05;

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function oneOf<T extends string>(value: unknown, list: readonly T[], fallback: T): T {
  return list.includes(value as T) ? (value as T) : fallback;
}

/** An image's attributes, every value checked. */
export function imageAttrs(node: PMNode) {
  const a = node.attrs;
  return {
    src: typeof a.src === "string" ? a.src : "",
    alt: typeof a.alt === "string" ? a.alt : "",
    title: typeof a.title === "string" ? a.title : "",
    width: typeof a.width === "number" && a.width > 0 ? a.width : null,
    height: typeof a.height === "number" && a.height > 0 ? a.height : null,
    rotation: num(a.rotation, 0),
    cropTop: num(a.cropTop, 0),
    cropRight: num(a.cropRight, 0),
    cropBottom: num(a.cropBottom, 0),
    cropLeft: num(a.cropLeft, 0),
    wrap: oneOf<Wrap>(a.wrap, WRAPS, "inline"),
    wrapSide: oneOf<WrapSide>(a.wrapSide, ["both", "left", "right"], "both"),
    align: oneOf<ImageAlign>(a.align, ["left", "center", "right"], "left"),
    wrapMargin: num(a.wrapMargin, 9),
    offsetX: num(a.offsetX, 0),
    offsetY: num(a.offsetY, 0),
    borderColor: typeof a.borderColor === "string" && /^#[0-9a-fA-F]{6}$/.test(a.borderColor) ? a.borderColor : null,
    borderWidth: num(a.borderWidth, 0),
    borderDash: oneOf<Dash>(a.borderDash, ["solid", "dotted", "dashed"], "solid"),
    recolor: oneOf<Recolor>(a.recolor, ["none", "grayscale", "sepia", "negative"], "none"),
    transparency: Math.min(100, Math.max(0, num(a.transparency, 0))),
    brightness: Math.min(100, Math.max(-100, num(a.brightness, 0))),
    contrast: Math.min(100, Math.max(-100, num(a.contrast, 0))),
  };
}

export type ImageAttrs = ReturnType<typeof imageAttrs>;

/** Every attribute back to the image as it was inserted. */
export const RESET_ATTRS = {
  rotation: 0,
  cropTop: 0,
  cropRight: 0,
  cropBottom: 0,
  cropLeft: 0,
  borderColor: null,
  borderWidth: 0,
  borderDash: "solid",
  recolor: "none",
  transparency: 0,
  brightness: 0,
  contrast: 0,
} as const;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    docsImage: {
      /** Change the selected image's attributes. */
      updateImage: (attrs: Record<string, unknown>) => ReturnType;
    };
  }
}

/** The text column's width in CSS pixels at 100%. */
export function textWidthPx(editor: Editor): number {
  const setup = insertContext(editor)?.pageSetup;
  if (setup) return (setup.width - setup.margins.left - setup.margins.right) * PX_PER_PT;
  return editor.view.dom.clientWidth || 624;
}

/** The selected image and its position, if an image is selected. */
export function selectedImage(state: EditorState): { node: PMNode; pos: number } | null {
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.type.name === "image") return { node: sel.node, pos: sel.from };
  return null;
}

function filterOf(a: ImageAttrs): string {
  const parts: string[] = [];
  if (a.brightness) parts.push(`brightness(${1 + a.brightness / 100})`);
  if (a.contrast) parts.push(`contrast(${1 + a.contrast / 100})`);
  if (a.recolor === "grayscale") parts.push("grayscale(1)");
  if (a.recolor === "sepia") parts.push("sepia(1)");
  if (a.recolor === "negative") parts.push("invert(1)");
  return parts.join(" ");
}

type Dir = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const DIRS: Dir[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const imageViews = new WeakMap<HTMLElement, ImageView>();

/** The node view of the image at `pos`, if it is drawn. */
export function imageViewAt(view: EditorView, pos: number): ImageView | null {
  const dom = view.nodeDOM(pos);
  return dom instanceof HTMLElement ? imageViews.get(dom) ?? null : null;
}

export class ImageView implements NodeView {
  dom: HTMLElement;
  private box: HTMLElement;
  private frame: HTMLElement;
  private img: HTMLImageElement;
  private chrome: HTMLElement | null = null;
  private ghost: HTMLImageElement | null = null;
  private angleTip: HTMLElement | null = null;
  private selected = false;
  private crop: {
    top: number;
    right: number;
    bottom: number;
    left: number;
    fullW: number;
    fullH: number;
    shiftX: number;
    shiftY: number;
    onKey: (e: KeyboardEvent) => void;
    onDown: (e: MouseEvent) => void;
  } | null = null;

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    private editor: Editor,
  ) {
    this.dom = document.createElement("figure");
    this.dom.className = "docs-img";
    this.box = document.createElement("span");
    this.box.className = "docs-img-box";
    this.frame = document.createElement("span");
    this.frame.className = "docs-img-frame";
    this.img = document.createElement("img");
    this.img.draggable = false;
    this.img.decoding = "async";
    this.frame.append(this.img);
    this.box.append(this.frame);
    this.dom.append(this.box);
    imageViews.set(this.dom, this);
    this.img.addEventListener("load", () => this.selected && this.placeChrome());
    this.frame.addEventListener("dblclick", (e) => {
      if (!this.editor.isEditable) return;
      e.preventDefault();
      this.startCrop();
    });
    this.box.addEventListener("mousedown", (e) => this.onBoxDown(e));
    this.render();
  }

  get attrs(): ImageAttrs {
    return imageAttrs(this.node);
  }

  private pageless(): boolean {
    return insertContext(this.editor)?.pageSetup.pageless ?? false;
  }

  /** Draw the node's attributes. */
  private render() {
    const a = this.attrs;
    const wrap: Wrap = this.pageless() ? "inline" : a.wrap;
    const blockId = this.node.attrs.blockId as string | null | undefined;
    if (blockId) this.dom.setAttribute("data-block-id", blockId);
    else this.dom.removeAttribute("data-block-id");
    this.dom.setAttribute("data-wrap", wrap);
    this.dom.setAttribute("data-align", a.align);
    this.dom.setAttribute("data-side", a.wrapSide);
    this.dom.style.setProperty("--docs-img-margin", `${a.wrapMargin}pt`);
    if (this.img.getAttribute("src") !== a.src) this.img.src = a.src;
    this.img.alt = a.alt;
    if (a.title) this.img.title = a.title;
    else this.img.removeAttribute("title");
    const sized = a.width !== null && a.height !== null;
    const box = this.box.style;
    box.width = a.width !== null ? `${a.width}px` : "";
    box.aspectRatio = sized ? `${a.width} / ${a.height}` : "";
    box.transform = a.rotation ? `rotate(${a.rotation}deg)` : "";
    box.left = wrap === "behind" || wrap === "front" ? `${a.offsetX}px` : "";
    box.top = wrap === "behind" || wrap === "front" ? `${a.offsetY}px` : "";
    this.box.classList.toggle("is-sized", sized);
    const cropped = sized && (a.cropTop || a.cropRight || a.cropBottom || a.cropLeft);
    const img = this.img.style;
    if (cropped) {
      const w = 1 - a.cropLeft - a.cropRight;
      const h = 1 - a.cropTop - a.cropBottom;
      img.position = "absolute";
      img.width = `${100 / w}%`;
      img.height = `${100 / h}%`;
      img.left = `${(-a.cropLeft / w) * 100}%`;
      img.top = `${(-a.cropTop / h) * 100}%`;
      img.maxWidth = "none";
    } else {
      img.position = "";
      img.width = sized ? "100%" : "";
      img.height = sized ? "100%" : "";
      img.left = "";
      img.top = "";
      img.maxWidth = "";
    }
    img.filter = filterOf(a);
    img.opacity = a.transparency ? String(1 - a.transparency / 100) : "";
    this.frame.style.outline =
      a.borderColor && a.borderWidth > 0 ? `${a.borderWidth}pt ${a.borderDash} ${a.borderColor}` : "";
    if (this.selected) this.placeChrome();
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    if (!this.crop) this.render();
    return true;
  }

  selectNode() {
    this.selected = true;
    this.dom.classList.add("is-selected");
    this.placeChrome();
  }

  deselectNode() {
    this.selected = false;
    this.dom.classList.remove("is-selected");
    if (this.crop) this.applyCrop();
    this.chrome?.remove();
    this.chrome = null;
  }

  stopEvent(event: Event): boolean {
    const target = event.target as Element | null;
    if (target?.closest(".docs-img-chrome")) return true;
    if (event.type === "dblclick") return true;
    if (this.crop) return event.type.startsWith("mouse") || event.type.startsWith("drag");
    // A layout that floats over the text moves by its own drag.
    const w = this.attrs.wrap;
    if (this.selected && (w === "behind" || w === "front") && event.type === "mousedown") return true;
    return false;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy() {
    if (this.crop) this.endCrop();
    imageViews.delete(this.dom);
  }

  // ── The selection chrome: the frame's handles ────────────────────────

  private placeChrome() {
    if (!this.editor.isEditable) return;
    if (!this.chrome) {
      this.chrome = document.createElement("span");
      this.chrome.className = "docs-img-chrome";
      this.chrome.setAttribute("data-anchor-skip", "");
      this.chrome.contentEditable = "false";
      for (const dir of DIRS) {
        const handle = document.createElement("span");
        handle.className = `docs-img-handle docs-img-handle-${dir}`;
        handle.dataset.dir = dir;
        handle.addEventListener("mousedown", (e) => this.startResize(e, dir));
        this.chrome.append(handle);
      }
      const stem = document.createElement("span");
      stem.className = "docs-img-stem";
      const rotate = document.createElement("span");
      rotate.className = "docs-img-rotate";
      rotate.addEventListener("mousedown", (e) => this.startRotate(e));
      this.chrome.append(stem, rotate);
      this.box.append(this.chrome);
    }
    this.chrome.classList.toggle("is-cropping", Boolean(this.crop));
  }

  private pos(): number | null {
    const pos = this.getPos();
    return typeof pos === "number" ? pos : null;
  }

  /** Write attributes and keep the image selected. */
  commit(attrs: Record<string, unknown>) {
    const pos = this.pos();
    if (pos === null) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node) return;
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
    tr.setSelection(NodeSelection.create(tr.doc, pos));
    this.view.dispatch(tr);
  }

  /** The box's size as drawn, at 100% zoom. */
  private drawnSize(): { w: number; h: number } {
    return { w: this.box.offsetWidth, h: this.box.offsetHeight };
  }

  private zoom(): number {
    const rect = this.box.getBoundingClientRect();
    const rotated = this.attrs.rotation % 180 !== 0;
    const w = this.box.offsetWidth;
    return w > 0 && !rotated ? rect.width / w : 1;
  }

  /** A pointer move, turned into the box's own unrotated frame. */
  private local(dx: number, dy: number): { x: number; y: number } {
    const r = (-this.attrs.rotation * Math.PI) / 180;
    const z = this.zoom();
    return { x: (dx * Math.cos(r) - dy * Math.sin(r)) / z, y: (dx * Math.sin(r) + dy * Math.cos(r)) / z };
  }

  private drag(e: MouseEvent, move: (dx: number, dy: number, ev: MouseEvent) => void, end: () => void) {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const onMove = (ev: MouseEvent) => move(ev.clientX - x0, ev.clientY - y0, ev);
    const onUp = () => {
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("mouseup", onUp, true);
      document.body.classList.remove("docs-img-dragging");
      end();
    };
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);
    document.body.classList.add("docs-img-dragging");
  }

  private startResize(e: MouseEvent, dir: Dir) {
    if (e.button !== 0) return;
    if (this.crop) {
      this.cropDrag(e, dir);
      return;
    }
    const { w: w0, h: h0 } = this.drawnSize();
    const max = this.attrs.wrap === "behind" || this.attrs.wrap === "front" ? 4000 : textWidthPx(this.editor);
    let next = { w: w0, h: h0 };
    const sx = dir.includes("e") ? 1 : dir.includes("w") ? -1 : 0;
    const sy = dir.includes("s") ? 1 : dir.includes("n") ? -1 : 0;
    this.drag(
      e,
      (dx, dy) => {
        const d = this.local(dx, dy);
        let w = w0 + sx * d.x;
        let h = h0 + sy * d.y;
        if (sx !== 0 && sy !== 0) {
          // A corner keeps the ratio: the larger change wins.
          const scale = Math.max(w / w0, h / h0);
          w = w0 * scale;
          h = h0 * scale;
        }
        if (w > max) {
          if (sx !== 0 && sy !== 0) h = (h * max) / w;
          w = max;
        }
        w = Math.max(MIN_SIZE, w);
        h = Math.max(MIN_SIZE, h);
        next = { w, h };
        this.box.style.width = `${w}px`;
        this.box.style.aspectRatio = `${w} / ${h}`;
        this.box.classList.add("is-sized");
        this.img.style.width = this.img.style.position === "absolute" ? this.img.style.width : "100%";
        this.img.style.height = this.img.style.position === "absolute" ? this.img.style.height : "100%";
      },
      () => {
        if (next.w !== w0 || next.h !== h0) this.commit({ width: Math.round(next.w), height: Math.round(next.h) });
      },
    );
  }

  private startRotate(e: MouseEvent) {
    if (e.button !== 0) return;
    const rect = this.box.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let angle = this.attrs.rotation;
    this.angleTip = document.createElement("span");
    this.angleTip.className = "docs-img-angle";
    this.chrome?.append(this.angleTip);
    this.drag(
      e,
      (_dx, _dy, ev) => {
        let a = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90;
        if (ev.shiftKey) a = Math.round(a / 15) * 15;
        angle = ((Math.round(a) % 360) + 360) % 360;
        this.box.style.transform = `rotate(${angle}deg)`;
        if (this.angleTip) this.angleTip.textContent = `${angle}°`;
      },
      () => {
        this.angleTip?.remove();
        this.angleTip = null;
        if (angle !== this.attrs.rotation) this.commit({ rotation: angle });
      },
    );
  }

  private onBoxDown(e: MouseEvent) {
    if (e.button !== 0 || this.crop || !this.selected || !this.editor.isEditable) return;
    const target = e.target as Element;
    if (target.closest(".docs-img-chrome")) return;
    const a = this.attrs;
    if (a.wrap !== "behind" && a.wrap !== "front") return;
    let off = { x: a.offsetX, y: a.offsetY };
    const z = this.zoom();
    this.drag(
      e,
      (dx, dy) => {
        off = { x: a.offsetX + dx / z, y: a.offsetY + dy / z };
        this.box.style.left = `${off.x}px`;
        this.box.style.top = `${off.y}px`;
      },
      () => {
        if (off.x !== a.offsetX || off.y !== a.offsetY) this.commit({ offsetX: Math.round(off.x), offsetY: Math.round(off.y) });
      },
    );
  }

  // ── Crop ─────────────────────────────────────────────────────────────

  get cropping(): boolean {
    return this.crop !== null;
  }

  startCrop() {
    if (this.crop || !this.editor.isEditable) return;
    const a = this.attrs;
    const { w, h } = this.drawnSize();
    if (w === 0 || h === 0) return;
    const fullW = w / (1 - a.cropLeft - a.cropRight);
    const fullH = h / (1 - a.cropTop - a.cropBottom);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        ev.stopPropagation();
        this.applyCrop();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        this.cancelCrop();
      }
    };
    const onDown = (ev: MouseEvent) => {
      if (this.box.contains(ev.target as Node)) return;
      this.applyCrop();
    };
    this.crop = {
      top: a.cropTop,
      right: a.cropRight,
      bottom: a.cropBottom,
      left: a.cropLeft,
      fullW,
      fullH,
      shiftX: 0,
      shiftY: 0,
      onKey,
      onDown,
    };
    // The box keeps its size in pixels while the crop changes.
    this.box.style.width = `${w}px`;
    this.box.style.aspectRatio = `${w} / ${h}`;
    this.ghost = document.createElement("img");
    this.ghost.className = "docs-img-ghost";
    this.ghost.src = a.src;
    this.ghost.draggable = false;
    this.box.insertBefore(this.ghost, this.frame);
    this.dom.classList.add("is-cropping");
    if (!this.selected) {
      const pos = this.pos();
      if (pos !== null) this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)));
    }
    this.placeChrome();
    this.drawCrop();
    window.addEventListener("keydown", onKey, true);
    window.setTimeout(() => document.addEventListener("mousedown", onDown, true), 0);
  }

  private drawCrop() {
    const c = this.crop;
    if (!c || !this.ghost) return;
    const w = c.fullW * (1 - c.left - c.right);
    const h = c.fullH * (1 - c.top - c.bottom);
    this.box.style.width = `${w}px`;
    this.box.style.aspectRatio = `${w} / ${h}`;
    this.box.style.translate = c.shiftX || c.shiftY ? `${c.shiftX}px ${c.shiftY}px` : "";
    const img = this.img.style;
    img.position = "absolute";
    img.maxWidth = "none";
    img.width = `${c.fullW}px`;
    img.height = `${c.fullH}px`;
    img.left = `${-c.left * c.fullW}px`;
    img.top = `${-c.top * c.fullH}px`;
    const g = this.ghost.style;
    g.width = `${c.fullW}px`;
    g.height = `${c.fullH}px`;
    g.left = `${-c.left * c.fullW}px`;
    g.top = `${-c.top * c.fullH}px`;
  }

  private cropDrag(e: MouseEvent, dir: Dir) {
    const c = this.crop;
    if (!c) return;
    const start = { ...c };
    this.drag(
      e,
      (dx, dy) => {
        const d = this.local(dx, dy);
        if (dir.includes("e")) c.right = Math.min(1 - start.left - MIN_CROP, Math.max(0, start.right - d.x / c.fullW));
        if (dir.includes("w")) {
          c.left = Math.min(1 - start.right - MIN_CROP, Math.max(0, start.left + d.x / c.fullW));
          c.shiftX = start.shiftX + (c.left - start.left) * c.fullW;
        }
        if (dir.includes("s")) c.bottom = Math.min(1 - start.top - MIN_CROP, Math.max(0, start.bottom - d.y / c.fullH));
        if (dir.includes("n")) {
          c.top = Math.min(1 - start.bottom - MIN_CROP, Math.max(0, start.top + d.y / c.fullH));
          c.shiftY = start.shiftY + (c.top - start.top) * c.fullH;
        }
        this.drawCrop();
      },
      () => undefined,
    );
  }

  private endCrop() {
    const c = this.crop;
    if (!c) return;
    window.removeEventListener("keydown", c.onKey, true);
    document.removeEventListener("mousedown", c.onDown, true);
    this.crop = null;
    this.ghost?.remove();
    this.ghost = null;
    this.box.style.translate = "";
    this.dom.classList.remove("is-cropping");
    this.chrome?.classList.remove("is-cropping");
  }

  applyCrop() {
    const c = this.crop;
    if (!c) return;
    this.endCrop();
    const round = (v: number) => Math.round(v * 10000) / 10000;
    this.commit({
      cropTop: round(c.top),
      cropRight: round(c.right),
      cropBottom: round(c.bottom),
      cropLeft: round(c.left),
      width: Math.round(c.fullW * (1 - c.left - c.right)),
      height: Math.round(c.fullH * (1 - c.top - c.bottom)),
    });
    this.render();
  }

  cancelCrop() {
    if (!this.crop) return;
    this.endCrop();
    this.render();
  }
}

// ── Uploads: paste and drop ─────────────────────────────────────────────

type UploadMeta = { add: { id: object; pos: number } } | { remove: object };
const uploadKey = new PluginKey<DecorationSet>("docsImageUpload");

function uploadWidget() {
  const span = document.createElement("span");
  span.className = "docs-img-uploading";
  span.setAttribute("data-anchor-skip", "");
  return span;
}

function placeholderPos(state: EditorState, id: object): number | null {
  const found = uploadKey.getState(state)?.find(undefined, undefined, (spec) => spec.id === id);
  return found && found.length > 0 ? found[0].from : null;
}

/** The size a new image takes: its own, fitted to the text's width. */
export function fittedSize(natural: { w: number; h: number }, maxWidth: number): { width: number; height: number } {
  const scale = natural.w > maxWidth ? maxWidth / natural.w : 1;
  return { width: Math.max(1, Math.round(natural.w * scale)), height: Math.max(1, Math.round(natural.h * scale)) };
}

export function naturalSize(src: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const probe = new Image();
    probe.onload = () => resolve({ w: probe.naturalWidth, h: probe.naturalHeight });
    probe.onerror = () => resolve(null);
    probe.src = src;
  });
}

export async function uploadImageFile(file: File): Promise<string> {
  const res = await fetch("/api/images", { method: "POST", body: file });
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !body.url) throw new Error(body.error ?? "");
  return body.url;
}

/** Build the image node for a source, fitted to the text's width. */
export async function imageNodeFor(editor: Editor, src: string): Promise<PMNode | null> {
  const type = editor.schema.nodes.image;
  if (!type) return null;
  const natural = await naturalSize(src);
  const size = natural ? fittedSize(natural, textWidthPx(editor)) : { width: null, height: null };
  return type.create({ src, ...size });
}

/** Upload the files and put each image where the placeholder stands. */
export async function uploadImagesAt(editor: Editor, files: File[], pos: number): Promise<void> {
  for (const file of files) {
    const id = {};
    const at = Math.max(0, Math.min(pos, editor.state.doc.content.size));
    editor.view.dispatch(editor.state.tr.setMeta(uploadKey, { add: { id, pos: at } } satisfies UploadMeta));
    try {
      const url = await uploadImageFile(file);
      const node = await imageNodeFor(editor, url);
      if (editor.isDestroyed) return;
      const here = placeholderPos(editor.state, id);
      if (node && here !== null) {
        const tr = editor.state.tr.setMeta(uploadKey, { remove: id } satisfies UploadMeta);
        tr.replaceRangeWith(here, here, node);
        editor.view.dispatch(tr);
      } else {
        editor.view.dispatch(editor.state.tr.setMeta(uploadKey, { remove: id } satisfies UploadMeta));
      }
    } catch (err) {
      if (editor.isDestroyed) return;
      editor.view.dispatch(editor.state.tr.setMeta(uploadKey, { remove: id } satisfies UploadMeta));
      const t = insertContext(editor)?.t;
      const text = err instanceof Error && err.message ? err.message : t ? t("common.requestFailed") : "";
      emitInsert(editor, { type: "toast", text });
    }
  }
}

/** Insert an image from an address or an uploaded file at the selection. */
export async function insertImageFrom(editor: Editor, source: { url: string } | { file: File }): Promise<void> {
  if ("file" in source) {
    await uploadImagesAt(editor, [source.file], editor.state.selection.from);
    return;
  }
  const node = await imageNodeFor(editor, source.url);
  if (!node || editor.isDestroyed) return;
  const { from, to } = editor.state.selection;
  editor.view.dispatch(editor.state.tr.replaceRangeWith(from, to, node).scrollIntoView());
  editor.view.focus();
}

/** Replace the selected image's picture, keeping its place and width. */
export async function replaceImage(editor: Editor, pos: number, source: { url: string } | { file: File }): Promise<void> {
  let url: string;
  try {
    url = "file" in source ? await uploadImageFile(source.file) : source.url;
  } catch (err) {
    const t = insertContext(editor)?.t;
    emitInsert(editor, { type: "toast", text: err instanceof Error && err.message ? err.message : t ? t("common.requestFailed") : "" });
    return;
  }
  const natural = await naturalSize(url);
  if (editor.isDestroyed) return;
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "image") return;
  const width = imageAttrs(node).width ?? (natural ? fittedSize(natural, textWidthPx(editor)).width : null);
  const height = natural && width ? Math.round((natural.h / natural.w) * width) : null;
  const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    ...RESET_ATTRS,
    src: url,
    width,
    height,
  });
  tr.setSelection(NodeSelection.create(tr.doc, pos));
  editor.view.dispatch(tr);
}

/** Reset image: no crop, no turn, no adjustments, its own size fitted. */
export async function resetImage(editor: Editor, pos: number): Promise<void> {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "image") return;
  const natural = await naturalSize(imageAttrs(node).src);
  const size = natural ? fittedSize(natural, textWidthPx(editor)) : { width: null, height: null };
  const current = editor.state.doc.nodeAt(pos);
  if (!current || current.type.name !== "image") return;
  const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...RESET_ATTRS, ...size });
  tr.setSelection(NodeSelection.create(tr.doc, pos));
  editor.view.dispatch(tr);
}

function imageFiles(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));
}

/** Resize or turn the selected image from the keys (Google Docs' Ctrl+Alt+K
    and the others). */
function nudge(editor: Editor, fn: (a: ImageAttrs, w: number, h: number) => Record<string, unknown>): boolean {
  const hit = selectedImage(editor.state);
  if (!hit) return false;
  const view = imageViewAt(editor.view, hit.pos);
  const a = imageAttrs(hit.node);
  const w = a.width ?? view?.dom.querySelector<HTMLElement>(".docs-img-box")?.offsetWidth ?? 100;
  const h = a.height ?? view?.dom.querySelector<HTMLElement>(".docs-img-box")?.offsetHeight ?? 100;
  return editor.commands.updateImage(fn(a, w, h));
}

function scaled(sx: number, sy: number) {
  return (_a: ImageAttrs, w: number, h: number) => ({
    width: Math.max(MIN_SIZE, Math.round(w * sx)),
    height: Math.max(MIN_SIZE, Math.round(h * sy)),
  });
}

function turned(by: number) {
  return (a: ImageAttrs) => ({ rotation: (((a.rotation + by) % 360) + 360) % 360 });
}

export const DocsImage = Extension.create({
  name: "docsImage",
  addGlobalAttributes() {
    const data = (name: string, parse: (v: string) => unknown, fallback: unknown) => ({
      default: fallback,
      parseHTML: (el: HTMLElement) => {
        const v = el.getAttribute(`data-${name}`);
        return v === null ? fallback : parse(v);
      },
      renderHTML: (attrs: Record<string, unknown>) => {
        const key = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
        const v = attrs[key];
        return v === fallback || v === null || v === undefined ? {} : { [`data-${name}`]: String(v) };
      },
    });
    const n = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : null);
    const s = (v: string) => v;
    return [
      {
        types: ["image"],
        attributes: {
          rotation: data("rotation", n, 0),
          cropTop: data("crop-top", n, 0),
          cropRight: data("crop-right", n, 0),
          cropBottom: data("crop-bottom", n, 0),
          cropLeft: data("crop-left", n, 0),
          wrap: data("wrap", s, "inline"),
          wrapSide: data("wrap-side", s, "both"),
          align: data("align", s, "left"),
          wrapMargin: data("wrap-margin", n, 9),
          offsetX: data("offset-x", n, 0),
          offsetY: data("offset-y", n, 0),
          borderColor: data("border-color", s, null),
          borderWidth: data("border-width", n, 0),
          borderDash: data("border-dash", s, "solid"),
          recolor: data("recolor", s, "none"),
          transparency: data("transparency", n, 0),
          brightness: data("brightness", n, 0),
          contrast: data("contrast", n, 0),
        },
      },
    ];
  },
  addCommands() {
    return {
      updateImage:
        (attrs) =>
        ({ state, dispatch }) => {
          const hit = selectedImage(state);
          if (!hit) return false;
          if (dispatch) {
            const tr = state.tr.setNodeMarkup(hit.pos, undefined, { ...hit.node.attrs, ...attrs });
            tr.setSelection(NodeSelection.create(tr.doc, hit.pos));
            dispatch(tr);
          }
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    const withImage = (fn: () => boolean) => () => (selectedImage(this.editor.state) ? fn() : false);
    return {
      "Mod-Alt-y": () => {
        if (!selectedImage(this.editor.state)) return false;
        emitInsert(this.editor, { type: "image-options", section: "alt" });
        return true;
      },
      "Mod-Alt-k": withImage(() => nudge(this.editor, scaled(1.1, 1.1))),
      "Mod-Alt-j": withImage(() => nudge(this.editor, scaled(1 / 1.1, 1 / 1.1))),
      "Mod-Alt-b": withImage(() => nudge(this.editor, scaled(1.1, 1))),
      "Mod-Alt-w": withImage(() => nudge(this.editor, scaled(1 / 1.1, 1))),
      "Mod-Alt-i": withImage(() => nudge(this.editor, scaled(1, 1.1))),
      "Mod-Alt-q": withImage(() => nudge(this.editor, scaled(1, 1 / 1.1))),
      "Alt-ArrowRight": withImage(() => nudge(this.editor, turned(15))),
      "Alt-ArrowLeft": withImage(() => nudge(this.editor, turned(-15))),
      "Alt-Shift-ArrowRight": withImage(() => nudge(this.editor, turned(1))),
      "Alt-Shift-ArrowLeft": withImage(() => nudge(this.editor, turned(-1))),
      Escape: () => {
        const hit = selectedImage(this.editor.state);
        if (!hit) return false;
        const after = hit.pos + hit.node.nodeSize;
        const tr = this.editor.state.tr.setSelection(TextSelection.near(this.editor.state.doc.resolve(after)));
        this.editor.view.dispatch(tr);
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<DecorationSet>({
        key: uploadKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            let next = set.map(tr.mapping, tr.doc);
            const meta = tr.getMeta(uploadKey) as UploadMeta | undefined;
            if (meta && "add" in meta) {
              next = next.add(tr.doc, [Decoration.widget(meta.add.pos, uploadWidget, { id: meta.add.id, side: 1 })]);
            } else if (meta && "remove" in meta) {
              next = next.remove(next.find(undefined, undefined, (spec) => spec.id === meta.remove));
            }
            return next;
          },
        },
        props: {
          decorations(state) {
            return uploadKey.getState(state);
          },
          nodeViews: {
            image: (node, view, getPos) => new ImageView(node, view, getPos, editor),
          },
          handlePaste(view, event) {
            const files = imageFiles(event.clipboardData?.files);
            if (files.length === 0 || !editor.isEditable) return false;
            // Words copied with a picture of them (Word, a web page) paste as
            // words; a picture alone uploads.
            const html = event.clipboardData?.getData("text/html") ?? "";
            const words = html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
            if (words) return false;
            event.preventDefault();
            void uploadImagesAt(editor, files, view.state.selection.from);
            return true;
          },
          handleDrop(view, event, _slice, moved) {
            if (moved || !editor.isEditable) return false;
            const files = imageFiles(event.dataTransfer?.files);
            if (files.length === 0) return false;
            event.preventDefault();
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
            void uploadImagesAt(editor, files, at?.pos ?? view.state.selection.from);
            return true;
          },
        },
      }),
    ];
  },
});

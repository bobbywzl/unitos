import { join } from "node:path";
import { PDF_CMAPS } from "@/lib/pdf-runtime";
import type { Region } from "@/lib/video/types";
import { cropBox } from "@/lib/figure-crop";

// Handwritten documents (SPEC.md §16): page rendering from the stored PDF
// bytes. One place renders pages for the page image route, the classifier,
// conversion, and Circle & ask — same width rules everywhere.
// unpdf loads per call, not with the module: routes import this file at the
// top level, and loading the parse chain with a route module broke responses
// on Vercel before (see /api/documents). The same holds for pdfjs-dist.

// A scan stores its pages as JBIG2, CCITT fax, or JPEG 2000 images, and
// pdf.js decodes those three with WebAssembly modules only. unpdf's pdf.js
// cannot load them: every such image fails to decode and the page renders
// white — a scanned book's pages, its classification samples, and its
// conversion input were all blank. Renders open the PDF with pdfjs-dist, the
// same pdf.js version unpdf bundles (6.1.200, so the CMaps in
// src/lib/parse/pdf/cmaps/ still match), with its wasm folder. The parse and
// the page counts stay on unpdf. A PDF that names a standard font (Helvetica,
// Times) without embedding it draws from pdfjs-dist's standard fonts, as it
// did from unpdf's. next.config.ts traces both folders and the worker into
// the API functions. pdf.js wants the trailing slashes.
const PDFJS_DIST = join(process.cwd(), "node_modules", "pdfjs-dist");
const PDF_DECODERS = {
  wasmUrl: `${join(PDFJS_DIST, "wasm")}/`,
  standardFontDataUrl: `${join(PDFJS_DIST, "standard_fonts")}/`,
};

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type RenderDocument = Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;
type WorkerGlobal = { pdfjsWorker?: { WorkerMessageHandler?: unknown } };

// pdf.js on Node runs its worker in the same thread, and takes it from
// globalThis.pdfjsWorker when that is set — the first time a document opens,
// once for good. unpdf's bundle sets that global to its own worker, which
// cannot load the decoders, so a render opened after any parse ran on it and
// drew a scan white again. Renders take pdfjs-dist's own worker instead,
// handed to pdfjs-dist's fake worker setup before its first document. The
// worker module sets the global as it loads; the global goes back to what it
// was, so the parse keeps unpdf's worker. Loaded once per process.
let renderer: Promise<PdfJs> | null = null;
function loadRenderer(): Promise<PdfJs> {
  renderer ??= (async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const scope = globalThis as WorkerGlobal;
    const prior = Object.getOwnPropertyDescriptor(scope, "pdfjsWorker");
    const { WorkerMessageHandler } = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    // Only pdfjs-dist's own assignment is undone: a global unpdf set while
    // the module loaded stays.
    if (scope.pdfjsWorker?.WorkerMessageHandler === WorkerMessageHandler) {
      if (prior) Object.defineProperty(scope, "pdfjsWorker", prior);
      else delete scope.pdfjsWorker;
    }
    Object.defineProperty(pdfjs.PDFWorker, "_setupFakeWorkerGlobal", {
      value: Promise.resolve(WorkerMessageHandler),
      configurable: true,
    });
    return pdfjs;
  })();
  return renderer;
}

// pdf.js 6.1.200 paints an opaque RGB image (ImageKind RGB_24BPP: every
// photo, every color or gray scan) by turning it into RGBA 16 rows at a time
// (putBinaryImageData, convertRGBToRGBA), and that conversion's tail loop
// starts from the image's first byte instead of the chunk's (j = i * 4, not
// srcPos + i * 4): each chunk walks every byte before it, writing nothing.
// The time grows with the square of the image's height — a 12 MP photo's
// page took 11 s, a 9000 x 9000 scan's two renders 5 minutes. pdf.js fixed
// the loop later. Here such an image turns into RGBA once, as its data
// reaches the page (PDFObjects.resolve, for the page's objects and the
// document's shared ones), and pdf.js paints it by copy: the same pixels,
// the same render. Images benchmark finding: page images of photos and
// scans were the slowest step of every add of one.
const RGB_24BPP = 2;
const RGBA_32BPP = 3;
type ImageData24 = { kind?: unknown; data?: unknown; width?: unknown; height?: unknown };
let rgbPaintFixed = false;

function rgbaImage(value: unknown): unknown {
  const image = value as ImageData24 | null;
  if (!image || typeof image !== "object" || image.kind !== RGB_24BPP) return value;
  const { data, width, height } = image;
  if (!(data instanceof Uint8Array || data instanceof Uint8ClampedArray)) return value;
  if (typeof width !== "number" || typeof height !== "number") return value;
  const pixels = width * height;
  if (data.length < pixels * 3) return value;
  const rgba = new Uint8ClampedArray(pixels * 4);
  for (let p = 0, q = 0; q < rgba.length; p += 3, q += 4) {
    rgba[q] = data[p];
    rgba[q + 1] = data[p + 1];
    rgba[q + 2] = data[p + 2];
    rgba[q + 3] = 255;
  }
  return { ...image, kind: RGBA_32BPP, data: rgba };
}

// pdf.js paints an image through a canvas of the image's own size: a
// 25000 x 18000 one-bit scan (56 MB as decoded) asks for a 1.8 GB canvas,
// and a 35000 x 35000 one asks for 4.9 GB, which Skia refuses. An image past
// PAINT_MAX_PIXELS is box-averaged by a whole factor to at most
// PAINT_TARGET_PIXELS before it reaches the page: no page image draws more
// than 24 MP (pageImageWidth), so the page looks the same. An image at or
// under PAINT_MAX_PIXELS is untouched, so every render it was in before
// stays the same. Images benchmark finding: a large-format JBIG2 scan took
// the add past 2 GB, and a giant CCITT scan's pages drew nothing.
const GRAYSCALE_1BPP = 1;
const PAINT_MAX_PIXELS = 100_000_000;
const PAINT_TARGET_PIXELS = 16_000_000;

type DecodedImage = { kind: number; data: Uint8Array | Uint8ClampedArray; width: number; height: number };

function decodedImage(value: unknown): DecodedImage | null {
  const image = value as ImageData24 | null;
  if (!image || typeof image !== "object") return null;
  const { kind, data, width, height } = image;
  if (kind !== GRAYSCALE_1BPP && kind !== RGB_24BPP && kind !== RGBA_32BPP) return null;
  if (!(data instanceof Uint8Array || data instanceof Uint8ClampedArray)) return null;
  if (typeof width !== "number" || typeof height !== "number" || width < 1 || height < 1) return null;
  const length = kind === GRAYSCALE_1BPP ? ((width + 7) >> 3) * height : width * height * (kind === RGB_24BPP ? 3 : 4);
  return data.length >= length ? { kind, data, width, height } : null;
}

/** An image past PAINT_MAX_PIXELS, box-averaged to at most
    PAINT_TARGET_PIXELS, as RGBA; any other value as it is. */
function reducedImage(value: unknown): unknown {
  const image = decodedImage(value);
  if (!image || image.width * image.height <= PAINT_MAX_PIXELS) return value;
  const { kind, data, width, height } = image;
  const k = Math.ceil(Math.sqrt((width * height) / PAINT_TARGET_PIXELS));
  const w = Math.ceil(width / k);
  const h = Math.ceil(height / k);
  const channels = kind === GRAYSCALE_1BPP ? 1 : kind === RGB_24BPP ? 3 : 4;
  const stride = kind === GRAYSCALE_1BPP ? (width + 7) >> 3 : width * channels;
  const sum = new Float64Array(w * 4);
  const count = new Uint32Array(w);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let ty = 0; ty < h; ty++) {
    sum.fill(0);
    count.fill(0);
    const y1 = Math.min(height, (ty + 1) * k);
    for (let y = ty * k; y < y1; y++) {
      const row = y * stride;
      if (kind === GRAYSCALE_1BPP) {
        // A set bit is white, a clear bit black (pdf.js
        // convertBlackAndWhiteToRGBA); rows are padded to whole bytes.
        for (let x = 0; x < width; x++) {
          const tx = (x / k) | 0;
          count[tx]++;
          if ((data[row + (x >> 3)] >> (7 - (x & 7))) & 1) sum[tx * 4] += 255;
        }
      } else {
        for (let x = 0, p = row; x < width; x++, p += channels) {
          const tx = (x / k) | 0;
          count[tx]++;
          sum[tx * 4] += data[p];
          sum[tx * 4 + 1] += data[p + 1];
          sum[tx * 4 + 2] += data[p + 2];
          sum[tx * 4 + 3] += channels === 4 ? data[p + 3] : 255;
        }
      }
    }
    for (let tx = 0; tx < w; tx++) {
      const n = count[tx] || 1;
      const q = (ty * w + tx) * 4;
      if (kind === GRAYSCALE_1BPP) {
        out[q] = out[q + 1] = out[q + 2] = sum[tx * 4] / n;
        out[q + 3] = 255;
      } else {
        out[q] = sum[tx * 4] / n;
        out[q + 1] = sum[tx * 4 + 1] / n;
        out[q + 2] = sum[tx * 4 + 2] / n;
        out[q + 3] = sum[tx * 4 + 3] / n;
      }
    }
  }
  return { ...(value as object), kind: RGBA_32BPP, data: out, width: w, height: h };
}

/** Once per process: images reach the page as RGBA (see above). objs is a
    page's PDFObjects; its class is not exported, so the fix goes on its
    prototype. */
function fixRgbPaint(objs: unknown): void {
  if (rgbPaintFixed || !objs) return;
  const proto = Object.getPrototypeOf(objs) as { resolve?: (id: string, data?: unknown) => void };
  const resolve = proto.resolve;
  if (typeof resolve !== "function") return;
  proto.resolve = function (this: unknown, id: string, data: unknown = null) {
    const reduced = reducedImage(data);
    return resolve.call(this, id, reduced === data ? rgbaImage(data) : reduced);
  };
  rgbPaintFixed = true;
}

/** The PDF opened for rendering, from a copy of the bytes (pdf.js detaches
    its buffer). The caller destroys it. */
async function openForRender(bytes: Uint8Array): Promise<RenderDocument> {
  const { getDocument } = await loadRenderer();
  return getDocument({ data: new Uint8Array(bytes), ...PDF_CMAPS, ...PDF_DECODERS }).promise;
}

/** One page drawn on a node canvas at width. page is 1-based. */
async function drawPage(pdf: RenderDocument, n: number, renderWidth: RenderWidth) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const page = await pdf.getPage(n);
  fixRgbPaint(page.objs);
  try {
    const base = page.getViewport({ scale: 1 });
    const width = widthFor(renderWidth, base.width, base.height, n);
    const size = pageSizeAt(base.width, base.height, width);
    const viewport = page.getViewport({ scale: width / Math.max(1, base.width) });
    const canvas = createCanvas(size.width, size.height);
    // pdf.js types name the DOM canvas; the node canvas draws the same.
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: canvas.getContext("2d") as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    return { canvas, size };
  } finally {
    page.cleanup();
  }
}

/** Encoded image bytes in a fresh ArrayBuffer-backed array: Response and
    the model SDK both want Uint8Array<ArrayBuffer>. */
function ownBytes(encoded: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(encoded.byteLength);
  out.set(encoded);
  return out;
}

// The reader's page image and the conversion input. Wide enough that small
// handwriting stays legible.
export const PAGE_IMAGE_WIDTH = 1400;
// The classifier only decides handwritten vs text article; smaller is enough.
export const CLASSIFY_IMAGE_WIDTH = 900;
// The stored page image (PageImage): JPEG, since a scanned or drawn page
// is a photo-like picture — a fraction of the PNG's bytes at this quality.
export const PAGE_IMAGE_QUALITY = 85;

export type PageSize = { width: number; height: number };

// A new document's page image (pageImageWidth): a page more than twice as
// wide as tall keeps PAGE_IMAGE_SHORT_SIDE px of height; no page draws more
// than PAGE_IMAGE_MAX_PIXELS, the picture an image add keeps
// (lib/handwritten/image-pdf.ts), nor more than JPEG_MAX_SIDE px a side (JPEG
// stops at 65535).
const PAGE_IMAGE_SHORT_SIDE = 700;
const PAGE_IMAGE_MAX_PIXELS = 24_000_000;
const JPEG_MAX_SIDE = 65_000;

/** The width a new document's page image draws at, from the page's size in
    points: PAGE_IMAGE_WIDTH, wider for a wide page, narrower for a page so
    tall it would pass the pixel cap. A stored page image keeps the width it
    was drawn at (PageImage.width, lib/handwritten/page-images.ts): an old
    document draws at PAGE_IMAGE_WIDTH as it always did. Images benchmark
    finding: a 9000 x 1000 panorama drew 1400 x 156, its words a few pixels
    high, and a 1170 x 16000 screenshot drew 1400 x 19144, 27 megapixels. */
export function pageImageWidth(pageWidth: number, pageHeight: number): number {
  const aspect = Math.max(1, pageWidth) / Math.max(1, pageHeight);
  const wanted = aspect > PAGE_IMAGE_WIDTH / PAGE_IMAGE_SHORT_SIDE ? PAGE_IMAGE_SHORT_SIDE * aspect : PAGE_IMAGE_WIDTH;
  const capped = Math.min(wanted, Math.sqrt(PAGE_IMAGE_MAX_PIXELS * aspect), JPEG_MAX_SIDE, JPEG_MAX_SIDE * aspect);
  return Math.max(1, Math.floor(capped));
}

/** A render's width: one width for every page, or one per page from its
    size in points and its number (1-based). */
export type RenderWidth = number | ((pageWidth: number, pageHeight: number, page: number) => number);

function widthFor(width: RenderWidth, pageWidth: number, pageHeight: number, page: number): number {
  return typeof width === "number" ? width : width(pageWidth, pageHeight, page);
}

/** The PDF's page count, from a copy of the bytes (pdf.js detaches its buffer). */
export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes), PDF_CMAPS);
  return pdf.numPages;
}

/** One page rendered to PNG. page is 1-based. */
export async function renderPdfPage(
  bytes: Uint8Array,
  page: number,
  width: RenderWidth = PAGE_IMAGE_WIDTH,
): Promise<Uint8Array<ArrayBuffer>> {
  const pdf = await openForRender(bytes);
  try {
    const { canvas } = await drawPage(pdf, page, width);
    return ownBytes(canvas.toBuffer("image/png"));
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/** Every page's size in pixels when rendered at width, in page order
    (index 0 = page 1). Reads the page boxes only — no render. */
export async function pdfPageSizes(
  bytes: Uint8Array,
  width: RenderWidth = PAGE_IMAGE_WIDTH,
): Promise<PageSize[]> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes), PDF_CMAPS);
  try {
    const sizes: PageSize[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      sizes.push(pageSizeAt(viewport.width, viewport.height, widthFor(width, viewport.width, viewport.height, n)));
      page.cleanup();
    }
    return sizes;
  } finally {
    await pdf.loadingTask.destroy();
  }
}

function pageSizeAt(pageWidth: number, pageHeight: number, width: number): PageSize {
  const scale = width / Math.max(1, pageWidth);
  return { width: Math.round(pageWidth * scale), height: Math.round(pageHeight * scale) };
}

/** Pages rendered to JPEG at width, the PDF opened once for all of them.
    Each page goes to onPage as it finishes; onPage returning false stops the
    run (the caller's time budget). A page whose render fails is skipped
    with a warning — the caller still has the others. */
export async function renderPdfPagesJpeg(
  bytes: Uint8Array,
  pages: number[],
  width: RenderWidth,
  onPage: (page: number, image: Uint8Array<ArrayBuffer>, size: PageSize) => Promise<boolean | void>,
): Promise<void> {
  const pdf = await openForRender(bytes);
  try {
    for (const n of pages) {
      if (n < 1 || n > pdf.numPages) continue;
      let image: Uint8Array<ArrayBuffer>;
      let size: PageSize;
      try {
        const drawn = await drawPage(pdf, n, width);
        image = ownBytes(drawn.canvas.toBuffer("image/jpeg", PAGE_IMAGE_QUALITY));
        size = drawn.size;
      } catch (err) {
        console.warn(`[handwritten] page render failed (page ${n}):`, err);
        continue;
      }
      if ((await onPage(n, image, size)) === false) return;
    }
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/** The circled part of a page image, with a little context around (pad, in
    percent of the page), scaled up so small handwriting reaches the model at
    legible size unless scaleUp is off. A PDF figure's region crops tight and
    keeps the render's own pixels. Null when the crop fails — the caller still
    has the whole page. */
export async function cropPageRegion(
  pageImage: Uint8Array,
  region: Region,
  opts: { pad?: number; scaleUp?: boolean } = {},
): Promise<Uint8Array | null> {
  try {
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const img = await loadImage(Buffer.from(pageImage));
    // pad: percent of the page.
    const { x, y, width: sw, height: sh } = cropBox(region, img.width, img.height, opts.pad ?? 2.5);
    if (sw < 8 || sh < 8) return null;
    const scale = opts.scaleUp === false ? 1 : Math.max(1, Math.min(4, 700 / Math.max(sw, sh)));
    const canvas = createCanvas(Math.round(sw * scale), Math.round(sh * scale));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, x, y, sw, sh, 0, 0, canvas.width, canvas.height);
    return new Uint8Array(canvas.toBuffer("image/png"));
  } catch (err) {
    console.warn("[handwritten] page crop failed:", err);
    return null;
  }
}

/** PAGE block text. Stored data stays English (SPEC.md §2); source chips and
    the digest read it. */
export function pageBlockText(page: number): string {
  return `Page ${page}`;
}

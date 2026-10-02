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

/** The PDF opened for rendering, from a copy of the bytes (pdf.js detaches
    its buffer). The caller destroys it. */
async function openForRender(bytes: Uint8Array): Promise<RenderDocument> {
  const { getDocument } = await loadRenderer();
  return getDocument({ data: new Uint8Array(bytes), ...PDF_CMAPS, ...PDF_DECODERS }).promise;
}

/** One page drawn on a node canvas at width. page is 1-based. */
async function drawPage(pdf: RenderDocument, n: number, width: number) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const page = await pdf.getPage(n);
  try {
    const base = page.getViewport({ scale: 1 });
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
  width: number = PAGE_IMAGE_WIDTH,
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
  width: number = PAGE_IMAGE_WIDTH,
): Promise<PageSize[]> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes), PDF_CMAPS);
  try {
    const sizes: PageSize[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      sizes.push(pageSizeAt(viewport.width, viewport.height, width));
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
  width: number,
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

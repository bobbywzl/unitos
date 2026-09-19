import "@/lib/pdf-runtime";
import { regionBounds, type Region } from "@/lib/video/types";

// Handwritten documents (SPEC.md §16): page rendering from the stored PDF
// bytes. One place renders pages for the page image route, the classifier,
// conversion, and Circle & ask — same width rules everywhere.
// unpdf loads per call, not with the module: routes import this file at the
// top level, and loading the parse chain with a route module broke responses
// on Vercel before (see /api/documents).

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
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  return pdf.numPages;
}

/** One page rendered to PNG. page is 1-based. */
export async function renderPdfPage(
  bytes: Uint8Array,
  page: number,
  width: number = PAGE_IMAGE_WIDTH,
): Promise<Uint8Array<ArrayBuffer>> {
  const { renderPageAsImage } = await import("unpdf");
  const png = await renderPageAsImage(new Uint8Array(bytes), page, {
    canvasImport: () => import("@napi-rs/canvas"),
    width,
  });
  // Copy into a fresh ArrayBuffer-backed array: Response and the model SDK
  // both want Uint8Array<ArrayBuffer>.
  return new Uint8Array(png instanceof Uint8Array ? png : new Uint8Array(png as ArrayBuffer));
}

/** Every page's size in pixels when rendered at width, in page order
    (index 0 = page 1). Reads the page boxes only — no render. */
export async function pdfPageSizes(
  bytes: Uint8Array,
  width: number = PAGE_IMAGE_WIDTH,
): Promise<PageSize[]> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
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
  const { getDocumentProxy, createIsomorphicCanvasFactory } = await import("unpdf");
  const CanvasFactory = await createIsomorphicCanvasFactory(() => import("@napi-rs/canvas"));
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { CanvasFactory });
  try {
    for (const n of pages) {
      if (n < 1 || n > pdf.numPages) continue;
      let image: Uint8Array<ArrayBuffer>;
      let size: PageSize;
      try {
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        size = pageSizeAt(base.width, base.height, width);
        const viewport = page.getViewport({ scale: width / Math.max(1, base.width) });
        const factory = new CanvasFactory();
        const drawing = factory.create(size.width, size.height);
        try {
          if (!drawing.context) throw new Error("No canvas context");
          // pdf.js types name the DOM canvas; the node canvas draws the same.
          await page.render({
            canvas: drawing.canvas as unknown as HTMLCanvasElement,
            canvasContext: drawing.context as unknown as CanvasRenderingContext2D,
            viewport,
          }).promise;
          if (!("toBuffer" in drawing.canvas)) throw new Error("No node canvas");
          const jpeg = drawing.canvas.toBuffer("image/jpeg", PAGE_IMAGE_QUALITY);
          image = new Uint8Array(jpeg.byteLength);
          image.set(jpeg);
        } finally {
          factory.destroy(drawing);
          page.cleanup();
        }
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
    const b = regionBounds(region);
    const pad = opts.pad ?? 2.5; // percent of the page
    const x1 = (Math.max(0, b.x1 - pad) / 100) * img.width;
    const y1 = (Math.max(0, b.y1 - pad) / 100) * img.height;
    const x2 = (Math.min(100, b.x2 + pad) / 100) * img.width;
    const y2 = (Math.min(100, b.y2 + pad) / 100) * img.height;
    const sw = x2 - x1;
    const sh = y2 - y1;
    if (sw < 8 || sh < 8) return null;
    const scale = opts.scaleUp === false ? 1 : Math.max(1, Math.min(4, 700 / Math.max(sw, sh)));
    const canvas = createCanvas(Math.round(sw * scale), Math.round(sh * scale));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, x1, y1, sw, sh, 0, 0, canvas.width, canvas.height);
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

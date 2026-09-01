import { db } from "@/lib/db";
import { outboundFetch } from "@/lib/outbound-fetch";

// Figure content for model calls, shared by every route that anchors on a
// FIGURE block (SPEC.md §4: one pipeline, never per-feature forks).
// An image figure attaches its image bytes; an SVG chart attaches its source;
// a PDF figure attaches its stored page rendered to PNG; a video figure
// carries only its caption. The image is fetched here, not by the model SDK:
// a fetch that fails (hotlink guard, timeout, wrong type) degrades to caption
// and context instead of failing the whole request.

export type FigureContent = {
  kind: "image" | "svg" | "video" | "figure";
  caption: string;
  svgSource?: string;
  imageUrl?: string;
};

export type FigureImage = { bytes: Uint8Array; mediaType: string };

/** The figure's visual, and whether it is the whole PDF page it sits on. */
export type FigureVisual = { image: FigureImage; page: boolean };

const SVG_SOURCE_MAX = 12_000;
const IMAGE_MAX_BYTES = 4_500_000; // the API caps an image at 5 MB
const IMAGE_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/** What a FIGURE block holds for the model. Null for any other block type. */
export function figureContent(
  block: { type: string; html: string | null; text: string } | null,
): FigureContent | null {
  if (!block || block.type !== "FIGURE") return null;
  const html = block.html ?? "";
  const imgSrc = html.match(/<img[^>]*\ssrc="([^"]+)"/i)?.[1]?.replace(/&amp;/g, "&");
  const svgStart = html.indexOf("<svg");
  const svgSource = !imgSrc && svgStart >= 0 ? html.slice(svgStart, svgStart + SVG_SOURCE_MAX) : undefined;
  return {
    kind: imgSrc ? "image" : svgSource ? "svg" : /<video/i.test(html) ? "video" : "figure",
    caption: block.text,
    svgSource,
    // http(s), data:image, or relative — fetchFigureImage validates and resolves.
    imageUrl: imgSrc || undefined,
  };
}

/** The figure's complete visual for the model, wherever it lives: the <img>
    (fetched, decoded from a data: URI, or resolved relative to the page), or —
    a PDF figure — the stored page rendered to PNG. Null when neither exists
    or nothing could be produced. */
export async function figureVisual(
  figure: FigureContent,
  block: { page: number | null },
  documentId: string,
  pageUrl?: string | null,
): Promise<FigureVisual | null> {
  if (figure.imageUrl) {
    const image = await fetchFigureImage(figure.imageUrl, pageUrl);
    if (image) return { image, page: false };
  }
  if (block.page !== null && figure.kind !== "video") {
    const image = await renderFigurePage(documentId, block.page);
    if (image) return { image, page: true };
  }
  return null;
}

/** Fetch or decode a figure's image for the model. Null on any failure — the
    caption and the document still carry the request. */
export async function fetchFigureImage(
  imageUrl: string,
  pageUrl?: string | null,
): Promise<FigureImage | null> {
  // Inline image: decode, never fetch.
  if (imageUrl.startsWith("data:")) {
    const match = imageUrl.match(/^data:([a-z/+.-]+);base64,(.+)$/i);
    if (!match) return null;
    const mediaType = match[1].toLowerCase();
    if (!IMAGE_MEDIA_TYPES.has(mediaType)) return null;
    try {
      const bytes = new Uint8Array(Buffer.from(match[2], "base64"));
      if (bytes.length === 0 || bytes.length > IMAGE_MAX_BYTES) return null;
      return { bytes, mediaType };
    } catch {
      return null;
    }
  }
  // A relative src (parsed before URLs were absolutized) resolves against the
  // document's page.
  let resolved: string;
  try {
    resolved = new URL(imageUrl, pageUrl ?? undefined).toString();
  } catch {
    return null;
  }
  if (!/^https?:\/\//.test(resolved)) return null;
  try {
    const res = await outboundFetch(resolved, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Unitos/1.0)",
        Accept: "image/png,image/jpeg,image/webp,image/gif,image/*;q=0.8",
        ...(pageUrl ? { Referer: pageUrl } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const mediaType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!IMAGE_MEDIA_TYPES.has(mediaType)) return null;
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > IMAGE_MAX_BYTES) return null;
    return { bytes: new Uint8Array(buffer), mediaType };
  } catch (err) {
    console.warn(`[derive] figure image fetch failed (${imageUrl}):`, err);
    return null;
  }
}

/** A PDF figure's page rendered to PNG from the document's stored bytes — the
    same render /api/documents/[documentId]/figure/[blockId] serves the reader.
    unpdf loads lazily so it stays out of route module graphs (see
    /api/documents). */
export async function renderFigurePage(
  documentId: string,
  page: number,
): Promise<FigureImage | null> {
  try {
    const document = await db.document.findUnique({
      where: { id: documentId },
      select: { fileData: true },
    });
    if (!document?.fileData) return null;
    const { renderPageAsImage } = await import("unpdf");
    // pdf.js transfers (detaches) the buffer it receives — render a copy.
    const png = await renderPageAsImage(new Uint8Array(document.fileData), page, {
      canvasImport: () => import("@napi-rs/canvas"),
      width: 1200,
    });
    const bytes = new Uint8Array(png);
    if (bytes.length === 0 || bytes.length > IMAGE_MAX_BYTES) return null;
    return { bytes, mediaType: "image/png" };
  } catch (err) {
    console.warn(`[derive] figure page render failed (${documentId} p${page}):`, err);
    return null;
  }
}

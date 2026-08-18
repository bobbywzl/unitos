import { outboundFetch } from "@/lib/outbound-fetch";

// Figure content for model calls, shared by every route that anchors on a
// FIGURE block (SPEC.md §4: one pipeline, never per-feature forks).
// An image figure attaches its image bytes; an SVG chart attaches its source;
// a video figure carries only its caption. The image is fetched here, not by
// the model SDK: a fetch that fails (hotlink guard, timeout, wrong type)
// degrades to caption and context instead of failing the whole request.

export type FigureContent = {
  kind: "image" | "svg" | "video" | "figure";
  caption: string;
  svgSource?: string;
  imageUrl?: string;
};

export type FigureImage = { bytes: Uint8Array; mediaType: string };

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
    imageUrl: imgSrc && /^https?:\/\//.test(imgSrc) ? imgSrc : undefined,
  };
}

/** Fetch a figure's image for the model. Null on any failure — the caption
    and the document still carry the request. */
export async function fetchFigureImage(
  imageUrl: string,
  pageUrl?: string | null,
): Promise<FigureImage | null> {
  try {
    const res = await outboundFetch(imageUrl, {
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

import { NextResponse } from "next/server";
import { z } from "zod";
import { documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { cropPageRegion, renderPdfPage } from "@/lib/handwritten/pages";
import { serverT } from "@/lib/i18n/server";
import { parseRegion } from "@/lib/video/types";

// Rendering a PDF page can outlive the default timeout.
export const maxDuration = 60;

// The page renders at this width when the figure is a region of it, so the
// crop keeps the render's own pixels at reading size.
const REGION_PAGE_WIDTH = 2000;
const PAGE_WIDTH = 1200;

// blockId: a FigureMedia id (a figure object of an import, SPEC.md §29) or
// a FIGURE block's id (a block document). The folder keeps its name.
const paramsSchema = z.object({
  documentId: z.string().min(1),
  blockId: z.string().min(1),
});

// A stored region: the JSON shape, or the JSON string a figure object's
// attribute carries.
function regionOf(value: unknown) {
  if (typeof value !== "string") return parseRegion(value);
  try {
    return parseRegion(JSON.parse(value));
  } catch {
    return null;
  }
}

// A PDF figure's visual: its page rendered to PNG from the document's stored
// bytes, cropped to the figure's region when the parse found one (SPEC.md
// §16). The figure is an import's FigureMedia row or a block document's
// FIGURE block. A web figure's images load from its own html, never from
// here, so a FigureMedia row without a page is 404 like a FIGURE block
// parsed before pages were stored (page null): the reader falls back to
// the caption.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ documentId: string; blockId: string }> },
) {
  const t = await serverT();
  const parsed = paramsSchema.safeParse(await ctx.params);
  if (!parsed.success) {
    return NextResponse.json({ error: t("api.blockNotFound") }, { status: 404 });
  }
  const { documentId, blockId: id } = parsed.data;

  const [media, block] = await Promise.all([
    db.figureMedia.findUnique({
      where: { id },
      select: { documentId: true, page: true, region: true },
    }),
    db.block.findUnique({
      where: { id },
      select: { documentId: true, type: true, page: true, region: true },
    }),
  ]);
  const figure =
    media && media.documentId === documentId
      ? media
      : block && block.documentId === documentId && block.type === "FIGURE"
        ? block
        : null;
  if (!figure || figure.page === null) {
    return NextResponse.json({ error: t("api.blockNotFound") }, { status: 404 });
  }
  const access = await documentAccess(documentId, "viewer");
  if (access instanceof NextResponse) return access;

  const document = await db.document.findUnique({
    where: { id: documentId },
    select: { fileData: true },
  });
  if (!document?.fileData) {
    return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });
  }

  const region = regionOf(figure.region);
  const page = await renderPdfPage(
    new Uint8Array(document.fileData),
    figure.page,
    region ? REGION_PAGE_WIDTH : PAGE_WIDTH,
  );
  const png = region ? ((await cropPageRegion(page, region, { pad: 0.15, scaleUp: false })) ?? page) : page;
  // Response wants an ArrayBuffer-backed array; the crop comes off a canvas buffer.
  const body = new Uint8Array(png.byteLength);
  body.set(png);
  return new Response(body, {
    headers: {
      "Content-Type": "image/png",
      // An id's render never changes: a FigureMedia row is never rewritten
      // (a re-parse makes new ones), and re-parse gives FIGURE blocks new ids.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

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

const paramsSchema = z.object({
  documentId: z.string().min(1),
  blockId: z.string().min(1),
});

// A PDF figure's visual: its page rendered to PNG from the document's stored
// bytes, cropped to the figure's region when the parse found one (SPEC.md
// §16). FIGURE blocks parsed before pages were stored have page null — 404,
// the reader falls back to the caption.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ documentId: string; blockId: string }> },
) {
  const t = await serverT();
  const parsed = paramsSchema.safeParse(await ctx.params);
  if (!parsed.success) {
    return NextResponse.json({ error: t("api.blockNotFound") }, { status: 404 });
  }
  const { documentId, blockId } = parsed.data;

  const block = await db.block.findUnique({
    where: { id: blockId },
    select: { documentId: true, type: true, page: true, region: true },
  });
  if (!block || block.documentId !== documentId || block.type !== "FIGURE" || block.page === null) {
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

  const region = parseRegion(block.region);
  const page = await renderPdfPage(
    new Uint8Array(document.fileData),
    block.page,
    region ? REGION_PAGE_WIDTH : PAGE_WIDTH,
  );
  const png = region ? ((await cropPageRegion(page, region, { pad: 0.3, scaleUp: false })) ?? page) : page;
  // Response wants an ArrayBuffer-backed array; the crop comes off a canvas buffer.
  const body = new Uint8Array(png.byteLength);
  body.set(png);
  return new Response(body, {
    headers: {
      "Content-Type": "image/png",
      // A block id's render never changes: re-parse recreates blocks under new ids.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { renderPageImage } from "@/lib/handwritten/page-images";
import { PAGE_RENDER_REV } from "@/lib/handwritten/page-url";
import { serverT } from "@/lib/i18n/server";

// A page without a stored render renders now; that can outlive the default timeout.
export const maxDuration = 60;

const paramsSchema = z.object({
  documentId: z.string().min(1),
  blockId: z.string().min(1),
});

// A handwritten document's page: the PAGE block's stored render (PageImage,
// SPEC.md §16). A page without one — a document from before pages were kept,
// or a render that has not landed yet — renders from the document's stored
// bytes now and is kept for the next request; so does a page an older
// renderer drew (PageImage.renderRev, lib/handwritten/page-url.ts). A slides
// document's slide (SPEC.md §27): the SLIDE block's stored picture, rendered
// from Drive's PDF export after the add; a slide without one answers 404 —
// the stored file is the .pptx, there is nothing to render from — and the
// reader shows the
// replica alone.
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
    select: { documentId: true, type: true, page: true },
  });
  if (
    !block ||
    block.documentId !== documentId ||
    (block.type !== "PAGE" && block.type !== "SLIDE") ||
    block.page === null
  ) {
    return NextResponse.json({ error: t("api.blockNotFound") }, { status: 404 });
  }
  const access = await documentAccess(documentId, "viewer");
  if (access instanceof NextResponse) return access;

  const stored = await db.pageImage.findUnique({ where: { blockId }, select: { data: true, renderRev: true } });
  let image: Uint8Array | null = stored?.data ?? null;
  if (!image && block.type === "SLIDE") {
    return NextResponse.json({ error: t("api.blockNotFound") }, { status: 404 });
  }
  // A page an older renderer drew (renderRev null) may be a scan drawn white:
  // it is drawn again, and the stored image answers when that fails.
  const stale = block.type === "PAGE" && image !== null && (stored?.renderRev ?? 0) < PAGE_RENDER_REV;
  if (!image || stale) {
    const document = await db.document.findUnique({
      where: { id: documentId },
      select: { fileData: true },
    });
    const rendered = document?.fileData
      ? await renderPageImage(blockId, new Uint8Array(document.fileData), block.page)
      : null;
    // The old image answers uncached, so the next request tries the render again.
    if (!rendered && image) return pageResponse(image, "private, no-cache");
    image = rendered;
    if (!image) {
      return document?.fileData
        ? NextResponse.json({ error: t("api.blockNotFound") }, { status: 404 })
        : NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });
    }
  }
  // A block id's page render never changes within a renderer revision: a
  // shape switch recreates blocks under new ids, and a new renderer changes
  // the URL's r (lib/handwritten/page-url.ts).
  return pageResponse(image, "private, max-age=31536000, immutable");
}

function pageResponse(image: Uint8Array, cacheControl: string): Response {
  // Response wants an ArrayBuffer-backed array; the stored bytes come off the driver's buffer.
  const body = new Uint8Array(image.byteLength);
  body.set(image);
  return new Response(body, { headers: { "Content-Type": "image/jpeg", "Cache-Control": cacheControl } });
}

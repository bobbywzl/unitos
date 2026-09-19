import { NextResponse } from "next/server";
import { z } from "zod";
import { documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { renderPageImage } from "@/lib/handwritten/page-images";
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
// bytes now and is kept for the next request. A slides document's slide
// (SPEC.md §27): the SLIDE block's stored picture, rendered from Drive's PDF
// export after the add; a slide without one answers 404 — the stored file
// is the .pptx, there is nothing to render from — and the reader shows the
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

  const stored = await db.pageImage.findUnique({ where: { blockId }, select: { data: true } });
  let image: Uint8Array | null = stored?.data ?? null;
  if (!image && block.type === "SLIDE") {
    return NextResponse.json({ error: t("api.blockNotFound") }, { status: 404 });
  }
  if (!image) {
    const document = await db.document.findUnique({
      where: { id: documentId },
      select: { fileData: true },
    });
    if (!document?.fileData) {
      return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });
    }
    image = await renderPageImage(blockId, new Uint8Array(document.fileData), block.page);
    if (!image) {
      return NextResponse.json({ error: t("api.blockNotFound") }, { status: 404 });
    }
  }
  // Response wants an ArrayBuffer-backed array; the stored bytes come off the driver's buffer.
  const body = new Uint8Array(image.byteLength);
  body.set(image);
  return new Response(body, {
    headers: {
      "Content-Type": "image/jpeg",
      // A block id's page render never changes: a shape switch recreates blocks under new ids.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

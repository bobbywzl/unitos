import { NextResponse } from "next/server";
import { z } from "zod";
import { documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { renderPdfPage } from "@/lib/handwritten/pages";
import { serverT } from "@/lib/i18n/server";

// Rendering a PDF page can outlive the default timeout.
export const maxDuration = 60;

const paramsSchema = z.object({
  documentId: z.string().min(1),
  blockId: z.string().min(1),
});

// A handwritten document's page: the PAGE block's PDF page rendered to PNG
// from the document's stored bytes (SPEC.md §14). The figure route's twin for
// PAGE blocks.
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
  if (!block || block.documentId !== documentId || block.type !== "PAGE" || block.page === null) {
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

  const png = await renderPdfPage(new Uint8Array(document.fileData), block.page);
  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      // A block id's page render never changes: a shape switch recreates blocks under new ids.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

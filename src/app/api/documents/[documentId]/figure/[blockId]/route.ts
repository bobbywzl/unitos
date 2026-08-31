import { NextResponse } from "next/server";
import { renderPageAsImage } from "unpdf";
import { z } from "zod";
import { documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";

// Rendering a PDF page can outlive the default timeout.
export const maxDuration = 60;

const paramsSchema = z.object({
  documentId: z.string().min(1),
  blockId: z.string().min(1),
});

// A PDF figure's visual: its page rendered to PNG from the document's stored
// bytes. FIGURE blocks parsed before pages were stored have page null — 404,
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
    select: { documentId: true, type: true, page: true },
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

  // pdf.js transfers (detaches) the buffer it receives — render a copy.
  const png = await renderPageAsImage(new Uint8Array(document.fileData), block.page, {
    canvasImport: () => import("@napi-rs/canvas"),
    width: 1200,
  });
  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      // A block id's page render never changes: re-parse recreates blocks under new ids.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

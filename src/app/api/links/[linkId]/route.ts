import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Remove a link. Recorded as a LINK_REMOVE edit so the Edits panel shows it.
export async function DELETE(_req: Request, ctx: { params: Promise<{ linkId: string }> }) {
  const { linkId } = await ctx.params;
  const link = await db.docLink.findUnique({
    where: { id: linkId },
    include: { toDocument: { select: { title: true } } },
  });
  if (!link) return NextResponse.json({ error: "Link not found" }, { status: 404 });

  await db.docLink.delete({ where: { id: linkId } });
  await db.blockEdit.create({
    data: {
      documentId: link.fromDocumentId,
      blockId: link.fromBlockId,
      kind: "LINK_REMOVE",
      meta: {
        toDocumentId: link.toDocumentId,
        toTitle: link.toDocument.title,
        quotedText: link.quotedText,
      },
    },
  });
  return NextResponse.json({ ok: true });
}

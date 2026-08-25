import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";

// Remove a link. Recorded as a LINK_REMOVE edit so the Edits panel shows it.
export async function DELETE(_req: Request, ctx: { params: Promise<{ linkId: string }> }) {
  const t = await serverT();
  const { linkId } = await ctx.params;
  const link = await db.docLink.findUnique({
    where: { id: linkId },
    include: { toDocument: { select: { title: true } } },
  });
  if (!link) return NextResponse.json({ error: t("api.linkNotFound") }, { status: 404 });

  await db.$transaction([
    db.docLink.delete({ where: { id: linkId } }),
    db.blockEdit.create({
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
    }),
  ]);
  return NextResponse.json({ ok: true });
}

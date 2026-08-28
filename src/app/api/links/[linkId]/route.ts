import { NextResponse } from "next/server";
import { bumpDocument, documentAccess } from "@/lib/collab";
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
  const access = await documentAccess(link.fromDocumentId, "editor");
  if (access instanceof NextResponse) return access;

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
        userId: access.user.id,
      },
    }),
  ]);
  await bumpDocument(link.fromDocumentId);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { bumpDocument, notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";

// Undo of a Remove, and Restore on History's "removed a link" (WALK5-01,
// WALK5-08): the link shows in the project again. The DELETE removes the
// one DocLinkHidden row of the link in the project the request names, and
// nothing else: the link's row, its reason, its replies, and the notes on it
// were kept all along, and the link stays hidden in every other project it
// was removed from. Any editor or the owner of the project restores, so the
// owner brings back an editor's removal. Recorded as a LINK_ADD edit with
// meta.restored, so History says who restored it (SPEC.md §13).
export async function DELETE(req: Request, ctx: { params: Promise<{ linkId: string }> }) {
  const t = await serverT();
  const { linkId } = await ctx.params;
  const notebookId = new URL(req.url).searchParams.get("notebookId");
  if (!notebookId) return NextResponse.json({ error: t("api.validationFailed") }, { status: 400 });
  const access = await notebookAccess(notebookId, "editor");
  if (access instanceof NextResponse) return access;
  const link = await db.docLink.findUnique({
    where: { id: linkId },
    include: { toDocument: { select: { title: true } } },
  });
  const hidden = link
    ? await db.docLinkHidden.findUnique({ where: { docLinkId_notebookId: { docLinkId: linkId, notebookId } } })
    : null;
  if (!link || !hidden) return NextResponse.json({ error: t("api.linkNotFound") }, { status: 404 });

  await db.$transaction([
    db.docLinkHidden.delete({ where: { docLinkId_notebookId: { docLinkId: linkId, notebookId } } }),
    db.blockEdit.create({
      data: {
        documentId: link.fromDocumentId,
        blockId: link.fromBlockId,
        kind: "LINK_ADD",
        meta: {
          linkId: link.id,
          notebookId,
          restored: true,
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

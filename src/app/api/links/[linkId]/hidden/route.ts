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
// meta.restored, so History says who restored it (SPEC.md §13). Undo names
// its Remove's edit (`edit`): when the newest removal of the link in the
// project is another edit (someone restored and removed it again since),
// it answers 409 and the hide stays theirs (REV7-06). Restore names none.
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
  const editId = new URL(req.url).searchParams.get("edit");
  if (editId && (await newestRemoval(link.fromDocumentId, linkId, notebookId)) !== editId) {
    return NextResponse.json({ error: t("api.linkUndoStale") }, { status: 409 });
  }

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

// The id of the newest LINK_REMOVE edit of the link that hid it in the project.
async function newestRemoval(documentId: string, linkId: string, notebookId: string): Promise<string | null> {
  const edits = await db.blockEdit.findMany({
    where: { documentId, kind: "LINK_REMOVE", meta: { path: ["linkId"], equals: linkId } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, meta: true },
    take: 50,
  });
  const inProject = edits.find(({ meta }) => {
    const m = meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {};
    return m.notebookId === notebookId || (Array.isArray(m.hiddenIn) && m.hiddenIn.includes(notebookId));
  });
  return inProject?.id ?? null;
}

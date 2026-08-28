import { NextResponse } from "next/server";
import { bumpDocument, bumpNotebook, documentAccess, noteAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";

// Delete one reply: its author, or the corpus owner.
export async function DELETE(_req: Request, ctx: { params: Promise<{ replyId: string }> }) {
  const t = await serverT();
  const { replyId } = await ctx.params;
  const reply = await db.reply.findUnique({
    where: { id: replyId },
    select: {
      id: true,
      userId: true,
      noteId: true,
      note: { select: { section: { select: { notebookId: true } } } },
      blockEdit: { select: { documentId: true } },
    },
  });
  if (!reply) return NextResponse.json({ error: t("api.replyNotFound") }, { status: 404 });

  const access = reply.noteId
    ? await noteAccess(reply.noteId, "viewer")
    : await documentAccess(reply.blockEdit!.documentId, "viewer");
  if (access instanceof NextResponse) return access;
  if (reply.userId !== access.user.id && access.role !== "owner") {
    return NextResponse.json({ error: t("api.replyNotYours") }, { status: 403 });
  }

  await db.reply.delete({ where: { id: replyId } });
  if (reply.note) await bumpNotebook(reply.note.section.notebookId);
  else if (reply.blockEdit) await bumpDocument(reply.blockEdit.documentId);
  return NextResponse.json({ ok: true });
}

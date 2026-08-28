import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpDocument, bumpNotebook, documentAccess, noteAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

const patchSchema = z.object({ resolved: z.boolean() });

// Resolve or reopen one reply. Any editor of the corpus can — resolution is a
// shared state, like the rest of the corpus.
export async function PATCH(req: Request, ctx: { params: Promise<{ replyId: string }> }) {
  const t = await serverT();
  const { replyId } = await ctx.params;
  const { data, error } = await parseBody(req, patchSchema);
  if (error) return error;
  const reply = await db.reply.findUnique({
    where: { id: replyId },
    select: {
      id: true,
      noteId: true,
      note: { select: { section: { select: { notebookId: true } } } },
      blockEdit: { select: { documentId: true } },
      docLink: { select: { fromDocumentId: true } },
    },
  });
  if (!reply) return NextResponse.json({ error: t("api.replyNotFound") }, { status: 404 });
  const access = reply.noteId
    ? await noteAccess(reply.noteId, "editor")
    : reply.docLink
      ? await documentAccess(reply.docLink.fromDocumentId, "editor")
      : await documentAccess(reply.blockEdit!.documentId, "editor");
  if (access instanceof NextResponse) return access;

  const updated = await db.reply.update({
    where: { id: replyId },
    data: { resolvedById: data.resolved ? access.user.id : null },
  });
  if (reply.note) await bumpNotebook(reply.note.section.notebookId);
  else if (reply.docLink) await bumpDocument(reply.docLink.fromDocumentId);
  else if (reply.blockEdit) await bumpDocument(reply.blockEdit.documentId);
  return NextResponse.json(updated);
}

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
      docLink: { select: { fromDocumentId: true } },
    },
  });
  if (!reply) return NextResponse.json({ error: t("api.replyNotFound") }, { status: 404 });

  const access = reply.noteId
    ? await noteAccess(reply.noteId, "viewer")
    : reply.docLink
      ? await documentAccess(reply.docLink.fromDocumentId, "viewer")
      : await documentAccess(reply.blockEdit!.documentId, "viewer");
  if (access instanceof NextResponse) return access;
  if (reply.userId !== access.user.id && access.role !== "owner") {
    return NextResponse.json({ error: t("api.replyNotYours") }, { status: 403 });
  }

  await db.reply.delete({ where: { id: replyId } });
  if (reply.note) await bumpNotebook(reply.note.section.notebookId);
  else if (reply.docLink) await bumpDocument(reply.docLink.fromDocumentId);
  else if (reply.blockEdit) await bumpDocument(reply.blockEdit.documentId);
  return NextResponse.json({ ok: true });
}

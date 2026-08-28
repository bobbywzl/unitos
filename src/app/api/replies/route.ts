import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpDocument, bumpNotebook, documentAccess, noteAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

const createSchema = z
  .object({
    noteId: z.string().min(1).optional(),
    blockEditId: z.string().min(1).optional(),
    content: z.string().min(1).max(4000),
  })
  .refine((d) => Boolean(d.noteId) !== Boolean(d.blockEditId), {
    message: "Provide noteId or blockEditId, not both",
  });

// One reply under a note (notes and annotations alike) or under one edit —
// how collaborators comment on each other's work. Editors reply; viewers read.
export async function POST(req: Request) {
  const t = await serverT();
  const { data, error } = await parseBody(req, createSchema);
  if (error) return error;

  if (data.noteId) {
    const note = await db.note.findUnique({
      where: { id: data.noteId },
      select: { id: true, section: { select: { notebookId: true } } },
    });
    if (!note) return NextResponse.json({ error: t("api.noteNotFound") }, { status: 404 });
    const access = await noteAccess(data.noteId, "editor");
    if (access instanceof NextResponse) return access;
    const reply = await db.reply.create({
      data: { noteId: data.noteId, userId: access.user.id, content: data.content.trim() },
    });
    await bumpNotebook(note.section.notebookId);
    return NextResponse.json(reply, { status: 201 });
  }

  const edit = await db.blockEdit.findUnique({
    where: { id: data.blockEditId! },
    select: { id: true, documentId: true },
  });
  if (!edit) return NextResponse.json({ error: t("api.editNotFound") }, { status: 404 });
  const access = await documentAccess(edit.documentId, "editor");
  if (access instanceof NextResponse) return access;
  const reply = await db.reply.create({
    data: { blockEditId: edit.id, userId: access.user.id, content: data.content.trim() },
  });
  await bumpDocument(edit.documentId);
  return NextResponse.json(reply, { status: 201 });
}

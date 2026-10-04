import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpDocument, bumpNotebook, documentAccess, notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { documentFootprint, editableNotebooks } from "@/lib/document-footprint";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

// Reader body font and title for this document. Either field, or both.
const patchSchema = z
  .object({
    font: z.enum(["default", "serif", "mono", "sans"]).optional(),
    title: z.string().trim().min(1).max(200).optional(),
  })
  .refine((d) => d.font !== undefined || d.title !== undefined);

export async function PATCH(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  const { documentId } = await ctx.params;
  const { data, error } = await parseBody(req, patchSchema);
  if (error) return error;
  const document = await db.document.findUnique({ where: { id: documentId } });
  if (!document) return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });
  const access = await documentAccess(documentId, "editor");
  if (access instanceof NextResponse) return access;
  const updated = await db.document.update({
    where: { id: documentId },
    data: {
      ...(data.font !== undefined ? { font: data.font === "default" ? null : data.font } : {}),
      ...(data.title !== undefined ? { title: data.title } : {}),
    },
  });
  await bumpDocument(documentId);
  return NextResponse.json(updated);
}

// Delete a document from the library (SPEC.md §5). It detaches from every
// project; its blocks and links go with it, and so do its annotations: the
// notes of a project's hidden Annotations section whose every source quotes
// it, marks on text that is gone. A note that quotes it keeps its words and
// its quotes, orphaned, and an assistant conversation stays in the history:
// their sources lose the document (onDelete SetNull).
//
// A document is shared when a project the caller cannot edit also holds it,
// quotes it, or has notes written in it: the same file added by another
// account is the same document (lib/parse/ingest.ts, dedupeByHash). Delete
// then only removes it from the caller's own projects, as Remove from project
// does: the document, its blocks, and every annotation stay, so a delete
// never reaches a project the caller cannot edit.
//
// ?scope=project&notebookId=… is Remove from this project: only that
// project's attachment goes. The document, its blocks, and every annotation
// stay, in the library and in its other projects, and adding it back from
// Library shows the project's annotations again. A document no other
// project holds is refused (409): removed, it would be in no project and
// out of the reader's reach, and Delete document is the way to remove it.
export async function DELETE(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  const { documentId } = await ctx.params;
  const document = await db.document.findUnique({ where: { id: documentId }, select: { title: true } });
  if (!document) return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });
  const params = new URL(req.url).searchParams;
  if (params.get("scope") === "project") {
    const notebookId = params.get("notebookId");
    if (!notebookId) return NextResponse.json({ error: t("api.documentNotAttachedToCorpus") }, { status: 400 });
    return removeFromProject(documentId, notebookId, document.title);
  }
  const access = await documentAccess(documentId, "editor");
  if (access instanceof NextResponse) return access;

  const footprint = await documentFootprint(documentId);
  const annotations = footprint.annotations;
  const notebooks = footprint.quoting;
  const involved = footprint.involved;
  const editable = await editableNotebooks(involved, access.user);
  if (involved.some((id) => !editable.has(id))) {
    const mine = footprint.attached.filter((id) => editable.has(id));
    await db.$transaction([
      db.notebookDocument.deleteMany({ where: { documentId, notebookId: { in: mine } } }),
      db.notebookEvent.createMany({
        data: mine.map((notebookId) => ({
          notebookId,
          userId: access.user.id,
          kind: "DOCUMENT_DETACH",
          content: document.title,
        })),
      }),
    ]);
    for (const id of mine) await bumpNotebook(id);
    return NextResponse.json({ ok: true, detached: true });
  }

  // Bump before the attachments go, so every corpus that carried it refreshes.
  await bumpDocument(documentId);
  await db.$transaction([
    db.note.deleteMany({ where: { id: { in: annotations } } }),
    db.source.updateMany({ where: { documentId }, data: { orphaned: true } }),
    db.notebookDocument.deleteMany({ where: { documentId } }),
    db.document.delete({ where: { id: documentId } }),
  ]);
  // The projects whose notes quoted it refresh their quotes.
  for (const id of notebooks) await bumpNotebook(id);
  return NextResponse.json({ ok: true });
}

// Remove from this project: this project's NotebookDocument row only.
async function removeFromProject(documentId: string, notebookId: string, title: string) {
  const t = await serverT();
  const access = await notebookAccess(notebookId, "editor");
  if (access instanceof NextResponse) return access;
  const attached = await db.notebookDocument.findMany({ where: { documentId }, select: { notebookId: true } });
  if (!attached.some((a) => a.notebookId === notebookId)) {
    return NextResponse.json({ error: t("api.documentNotAttachedToCorpus") }, { status: 404 });
  }
  if (attached.length < 2) {
    return NextResponse.json({ error: t("api.documentOnlyProject") }, { status: 409 });
  }
  await db.$transaction([
    db.notebookDocument.delete({ where: { notebookId_documentId: { notebookId, documentId } } }),
    db.notebookEvent.create({
      data: { notebookId, userId: access.user.id, kind: "DOCUMENT_DETACH", content: title },
    }),
  ]);
  await bumpNotebook(notebookId);
  return NextResponse.json({ ok: true, detached: true });
}

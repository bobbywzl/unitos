import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpDocument, bumpNotebook, documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
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

// Delete a document from the library. Detaches from all notebooks; blocks
// cascade. The sources in it go: a note keeps its text and loses the source,
// and an annotation with no source left in another document goes with the
// document (an annotation anchored nowhere would read as a sidebar
// conversation, SPEC.md §7).
export async function DELETE(_req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  const { documentId } = await ctx.params;
  const document = await db.document.findUnique({ where: { id: documentId } });
  if (!document) return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });
  const access = await documentAccess(documentId, "editor");
  if (access instanceof NextResponse) return access;

  const cited = await db.source.findMany({
    where: { documentId },
    select: { noteId: true, note: { select: { section: { select: { hidden: true, notebookId: true } } } } },
  });
  const annotationIds = [...new Set(cited.filter((s) => s.note.section.hidden).map((s) => s.noteId))];
  const anchoredElsewhere = new Set(
    (
      await db.source.findMany({
        where: { noteId: { in: annotationIds }, documentId: { not: documentId } },
        select: { noteId: true },
      })
    ).map((s) => s.noteId),
  );
  const goneAnnotationIds = annotationIds.filter((id) => !anchoredElsewhere.has(id));
  const citingNotebookIds = new Set(cited.map((s) => s.note.section.notebookId));

  // Bump before the attachments go, so every corpus that carried it refreshes.
  const bumped = await bumpDocument(documentId);
  await db.$transaction([
    db.note.deleteMany({ where: { id: { in: goneAnnotationIds } } }),
    db.source.deleteMany({ where: { documentId } }),
    db.notebookDocument.deleteMany({ where: { documentId } }),
    db.document.delete({ where: { id: documentId } }),
  ]);
  // A project whose notes cited it without carrying it refreshes too.
  for (const notebookId of citingNotebookIds) {
    if (!(notebookId in bumped)) await bumpNotebook(notebookId);
  }
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpDocument, bumpNotebook, documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { ANNOTATIONS_SECTION_TITLE } from "@/lib/derive/config";
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
export async function DELETE(_req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  const { documentId } = await ctx.params;
  const document = await db.document.findUnique({ where: { id: documentId } });
  if (!document) return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });
  const access = await documentAccess(documentId, "editor");
  if (access instanceof NextResponse) return access;

  const citing = await db.source.findMany({
    where: { documentId },
    select: {
      noteId: true,
      note: {
        select: {
          derivationType: true,
          section: { select: { hidden: true, title: true, notebookId: true } },
          sources: { select: { documentId: true } },
        },
      },
    },
  });
  const annotations = new Set(
    citing
      .filter(
        ({ note }) =>
          note.section.hidden &&
          note.section.title === ANNOTATIONS_SECTION_TITLE &&
          note.derivationType !== "SYNTHESIS" &&
          note.sources.every((s) => s.documentId === documentId),
      )
      .map((c) => c.noteId),
  );
  const notebooks = new Set(citing.map(({ note }) => note.section.notebookId));

  // Bump before the attachments go, so every corpus that carried it refreshes.
  await bumpDocument(documentId);
  await db.$transaction([
    db.note.deleteMany({ where: { id: { in: [...annotations] } } }),
    db.source.updateMany({ where: { documentId }, data: { orphaned: true } }),
    db.notebookDocument.deleteMany({ where: { documentId } }),
    db.document.delete({ where: { id: documentId } }),
  ]);
  // The projects whose notes quoted it refresh their quotes.
  for (const id of notebooks) await bumpNotebook(id);
  return NextResponse.json({ ok: true });
}

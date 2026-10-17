import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { detachWrites } from "@/lib/documents/detach";
import { serverT } from "@/lib/i18n/server";
import { distillationList, extractionList } from "@/lib/types";
import { parseBody } from "@/lib/validate";

// Delete one stored distillation (DISTILL, the reader's Extract) — or several
// selected at once — or one extraction (EXTRACT, the reader's Match-it) from
// the attachment, or move the document to a folder (SPEC.md §6; null = the
// project itself). Exactly one of the four.
const patchSchema = z
  .object({
    removeDistillationId: z.string().min(1).optional(),
    removeDistillationIds: z.array(z.string().min(1)).min(1).max(50).optional(),
    removeExtractionId: z.string().min(1).optional(),
    folderId: z.string().min(1).nullable().optional(),
  })
  .refine(
    (d) =>
      [d.removeDistillationId, d.removeDistillationIds, d.removeExtractionId].filter(Boolean).length +
        (d.folderId !== undefined ? 1 : 0) ===
      1,
    {
      message:
        "Provide exactly one of removeDistillationId, removeDistillationIds, removeExtractionId, folderId",
    },
  );

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ notebookId: string; documentId: string }> },
) {
  const t = await serverT();
  const { notebookId, documentId } = await ctx.params;
  const access = await notebookAccess(notebookId, "editor");
  if (access instanceof NextResponse) return access;
  const { data, error } = await parseBody(req, patchSchema);
  if (error) return error;
  const attachment = await db.notebookDocument.findUnique({
    where: { notebookId_documentId: { notebookId, documentId } },
  });
  if (!attachment) {
    return NextResponse.json({ error: t("api.documentNotAttached") }, { status: 404 });
  }
  if (data.folderId !== undefined) {
    if (data.folderId) {
      const folder = await db.documentFolder.findFirst({
        where: { id: data.folderId, notebookId },
        select: { id: true },
      });
      if (!folder) return NextResponse.json({ error: t("api.folderNotFound") }, { status: 404 });
    }
    await db.notebookDocument.update({
      where: { notebookId_documentId: { notebookId, documentId } },
      // A move into another list drops the place it had in the old one
      // (Custom order, SPEC.md §6): it lists first in the new one.
      data: {
        folderId: data.folderId,
        ...(data.folderId !== attachment.folderId ? { position: null } : {}),
      },
    });
    await bumpNotebook(notebookId);
    return NextResponse.json({ ok: true });
  }
  await db.notebookDocument.update({
    where: { notebookId_documentId: { notebookId, documentId } },
    data:
      data.removeDistillationId || data.removeDistillationIds
        ? {
            distillations: distillationList(attachment.distillations).filter(
              (d) => d.id !== data.removeDistillationId && !data.removeDistillationIds?.includes(d.id),
            ),
          }
        : {
            extractions: extractionList(attachment.extractions).filter(
              (x) => x.id !== data.removeExtractionId,
            ),
          },
  });
  await bumpNotebook(notebookId);
  return NextResponse.json({ ok: true });
}

// Detach a document from a notebook. The document stays in the library, and
// the project's work on it stays in the history event.
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ notebookId: string; documentId: string }> },
) {
  const t = await serverT();
  const { notebookId, documentId } = await ctx.params;
  const access = await notebookAccess(notebookId, "editor");
  if (access instanceof NextResponse) return access;
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: { title: true },
  });
  // The project's work on the document is kept in the history event, and
  // adding the document back puts it back (lib/documents/detach.ts).
  const writes = await detachWrites([
    { notebookId, documentId, userId: access.user.id, title: document?.title ?? "" },
  ]);
  if (writes.length === 0) return NextResponse.json({ error: t("api.documentNotAttached") }, { status: 404 });
  await db.$transaction(writes);
  await bumpNotebook(notebookId);
  return NextResponse.json({ ok: true });
}

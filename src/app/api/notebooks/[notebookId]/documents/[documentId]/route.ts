import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { distillationList, extractionList, keypointsStored } from "@/lib/types";
import { parseBody } from "@/lib/validate";

// The stored distillation (KEYPOINTS, the reader's Distill) of one attachment.
// Distill persists before it answers, so a run whose response was cut short
// may still have finished: the reader asks here before calling it a failure.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ notebookId: string; documentId: string }> },
) {
  const { notebookId, documentId } = await ctx.params;
  const access = await notebookAccess(notebookId, "viewer");
  if (access instanceof NextResponse) return access;
  const attachment = await db.notebookDocument.findUnique({
    where: { notebookId_documentId: { notebookId, documentId } },
    select: { keypoints: true },
  });
  return NextResponse.json({ keypoints: keypointsStored(attachment?.keypoints) });
}

// Delete one stored distillation (DISTILL, the reader's Extract) — or several
// selected at once — or one extraction (EXTRACT, the reader's Match-it), or
// the keypoints (KEYPOINTS, the reader's Distill) from the attachment.
// Exactly one of the four.
const patchSchema = z
  .object({
    removeDistillationId: z.string().min(1).optional(),
    removeDistillationIds: z.array(z.string().min(1)).min(1).max(50).optional(),
    removeExtractionId: z.string().min(1).optional(),
    removeKeypoints: z.literal(true).optional(),
  })
  .refine(
    (d) =>
      [d.removeDistillationId, d.removeDistillationIds, d.removeExtractionId, d.removeKeypoints].filter(
        Boolean,
      ).length === 1,
    {
      message:
        "Provide exactly one of removeDistillationId, removeDistillationIds, removeExtractionId, removeKeypoints",
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
  await db.notebookDocument.update({
    where: { notebookId_documentId: { notebookId, documentId } },
    data: data.removeKeypoints
      ? { keypoints: Prisma.DbNull }
      : data.removeDistillationId || data.removeDistillationIds
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

// Detach a document from a notebook. The document stays in the library.
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
  const deleted = await db.notebookDocument
    .delete({ where: { notebookId_documentId: { notebookId, documentId } } })
    .catch(() => null);
  if (!deleted) return NextResponse.json({ error: t("api.documentNotAttached") }, { status: 404 });
  await db.notebookEvent.create({
    data: {
      notebookId,
      userId: access.user.id,
      kind: "DOCUMENT_DETACH",
      content: document?.title ?? "",
    },
  });
  await bumpNotebook(notebookId);
  return NextResponse.json({ ok: true });
}

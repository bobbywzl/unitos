import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { distillationList, extractionList } from "@/lib/types";
import { parseBody } from "@/lib/validate";

// Delete one stored distillation or extraction from the attachment.
const patchSchema = z
  .object({
    removeDistillationId: z.string().min(1).optional(),
    removeExtractionId: z.string().min(1).optional(),
  })
  .refine((d) => Boolean(d.removeDistillationId) !== Boolean(d.removeExtractionId), {
    message: "Provide removeDistillationId or removeExtractionId, not both",
  });

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ notebookId: string; documentId: string }> },
) {
  const { notebookId, documentId } = await ctx.params;
  const { data, error } = await parseBody(req, patchSchema);
  if (error) return error;
  const attachment = await db.notebookDocument.findUnique({
    where: { notebookId_documentId: { notebookId, documentId } },
  });
  if (!attachment) {
    return NextResponse.json({ error: "Document is not attached" }, { status: 404 });
  }
  await db.notebookDocument.update({
    where: { notebookId_documentId: { notebookId, documentId } },
    data: data.removeDistillationId
      ? {
          distillations: distillationList(attachment.distillations).filter(
            (d) => d.id !== data.removeDistillationId,
          ),
        }
      : {
          extractions: extractionList(attachment.extractions).filter(
            (x) => x.id !== data.removeExtractionId,
          ),
        },
  });
  return NextResponse.json({ ok: true });
}

// Detach a document from a notebook. The document stays in the library.
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ notebookId: string; documentId: string }> },
) {
  const { notebookId, documentId } = await ctx.params;
  const deleted = await db.notebookDocument
    .delete({ where: { notebookId_documentId: { notebookId, documentId } } })
    .catch(() => null);
  if (!deleted) return NextResponse.json({ error: "Document is not attached" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

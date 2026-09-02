import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpDocument, documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

// Reader body font and title for this document. Either field, or both.
const patchSchema = z
  .object({
    font: z.enum(["default", "serif", "mono"]).optional(),
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

// Delete a document from the library. Refused while notes cite it. Detaches from all
// notebooks; blocks cascade.
export async function DELETE(_req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  const { documentId } = await ctx.params;
  const document = await db.document.findUnique({ where: { id: documentId } });
  if (!document) return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });
  const access = await documentAccess(documentId, "editor");
  if (access instanceof NextResponse) return access;

  const cited = await db.source.count({ where: { documentId } });
  if (cited > 0) {
    return NextResponse.json({ error: t("api.notesCiteDocument") }, { status: 409 });
  }

  // Bump before the attachments go, so every corpus that carried it refreshes.
  await bumpDocument(documentId);
  await db.$transaction([
    db.notebookDocument.deleteMany({ where: { documentId } }),
    db.document.delete({ where: { id: documentId } }),
  ]);
  return NextResponse.json({ ok: true });
}

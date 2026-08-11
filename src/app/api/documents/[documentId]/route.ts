import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseBody } from "@/lib/validate";

// Delete a document from the library. Refused while notes cite it. Detaches from all
// notebooks; blocks cascade.
const patchSchema = z.object({
  font: z.enum(["default", "serif", "mono"]),
});

// Reader body font for this document.
export async function PATCH(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await ctx.params;
  const { data, error } = await parseBody(req, patchSchema);
  if (error) return error;
  const document = await db.document.findUnique({ where: { id: documentId } });
  if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  const updated = await db.document.update({
    where: { id: documentId },
    data: { font: data.font === "default" ? null : data.font },
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await ctx.params;
  const document = await db.document.findUnique({ where: { id: documentId } });
  if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const cited = await db.source.count({ where: { documentId } });
  if (cited > 0) {
    return NextResponse.json(
      { error: "Notes cite this document. Delete those notes first." },
      { status: 409 },
    );
  }

  await db.$transaction([
    db.notebookDocument.deleteMany({ where: { documentId } }),
    db.document.delete({ where: { id: documentId } }),
  ]);
  return NextResponse.json({ ok: true });
}

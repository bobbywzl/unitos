import { NextResponse } from "next/server";
import { db } from "@/lib/db";

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

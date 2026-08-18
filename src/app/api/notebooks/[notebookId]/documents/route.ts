import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { attachDocument } from "@/lib/parse/attach";
import { parseBody } from "@/lib/validate";

const attachSchema = z.object({
  documentId: z.string().min(1),
});

// Attach an existing document from the library. No re-parse.
export async function POST(req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await ctx.params;
  const { data, error } = await parseBody(req, attachSchema);
  if (error) return error;

  const notebook = await db.notebook.findUnique({ where: { id: notebookId } });
  if (!notebook) return NextResponse.json({ error: "Corpus not found" }, { status: 404 });
  const document = await db.document.findUnique({ where: { id: data.documentId } });
  if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  await attachDocument(notebookId, data.documentId);
  return NextResponse.json({ ok: true }, { status: 201 });
}

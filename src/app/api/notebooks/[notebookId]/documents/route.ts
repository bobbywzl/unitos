import { after, NextResponse } from "next/server";
import { z } from "zod";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
import { buildConnections } from "@/lib/connect";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { attachDocument } from "@/lib/parse/attach";
import { parseBody } from "@/lib/validate";

const attachSchema = z.object({
  documentId: z.string().min(1),
});

// Attach an existing document from the library. No re-parse.
export async function POST(req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const t = await serverT();
  const { notebookId } = await ctx.params;
  const access = await notebookAccess(notebookId, "editor");
  if (access instanceof NextResponse) return access;
  const { data, error } = await parseBody(req, attachSchema);
  if (error) return error;

  const notebook = await db.notebook.findUnique({ where: { id: notebookId } });
  if (!notebook) return NextResponse.json({ error: t("api.corpusNotFound") }, { status: 404 });
  const document = await db.document.findUnique({ where: { id: data.documentId } });
  if (!document) return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });

  await attachDocument(notebookId, data.documentId);
  await bumpNotebook(notebookId);
  // Recommended links (SPEC.md §13): scan the document against this corpus.
  after(() => buildConnections(notebookId, data.documentId, access.user.id).catch(() => {}));
  return NextResponse.json({ ok: true }, { status: 201 });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { formalizedArticle } from "@/lib/types";
import { parseBody } from "@/lib/validate";
import { materializeArticle } from "@/lib/video/article-document";

const bodySchema = z.object({ notebookId: z.string().min(1) });

// Open the stored formalized article as a document (SPEC.md §11). Articles
// stored before they became documents get one here, parsed from the stored
// markdown — no model call. Idempotent: an article keeps one document.
export async function POST(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  const { documentId } = await ctx.params;
  const { data, error } = await parseBody(req, bodySchema);
  if (error) return error;
  const access = await notebookAccess(data.notebookId, "editor");
  if (access instanceof NextResponse) return access;
  const attachment = await db.notebookDocument.findUnique({
    where: { notebookId_documentId: { notebookId: data.notebookId, documentId } },
  });
  if (!attachment) {
    return NextResponse.json({ error: t("api.documentNotAttachedToCorpus") }, { status: 404 });
  }
  const article = formalizedArticle(attachment.formalized);
  if (!article) {
    return NextResponse.json({ error: t("api.noStoredArticle") }, { status: 404 });
  }
  const existing = article.documentId
    ? await db.document.findUnique({ where: { id: article.documentId }, select: { id: true } })
    : null;
  if (existing) {
    return NextResponse.json({ ok: true, articleDocumentId: existing.id });
  }
  const articleDocumentId = await materializeArticle(data.notebookId, {
    ...article,
    documentId: undefined,
  });
  await db.notebookDocument.update({
    where: { notebookId_documentId: { notebookId: data.notebookId, documentId } },
    data: { formalized: { article: { ...article, documentId: articleDocumentId } } },
  });
  await bumpNotebook(data.notebookId);
  return NextResponse.json({ ok: true, articleDocumentId }, { status: 201 });
}

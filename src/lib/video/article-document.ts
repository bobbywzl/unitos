import { db } from "@/lib/db";
import { attachDocument } from "@/lib/parse/attach";
import { parseMarkdown } from "@/lib/parse/markdown";
import { PARSER_VERSION } from "@/lib/parse/types";
import type { FormalizedArticle } from "@/lib/types";

/** The formalized article as a real document in the corpus (SPEC.md §11): its
    markdown parses into blocks, so every reader tool — highlights, comments,
    assistant, distill, edit mode — works on it exactly as on any document.
    Returns the article document's id. Regenerate rewrites the same document's
    blocks; anchors on it re-resolve by quote (SPEC.md §5), like a re-parse. */
export async function materializeArticle(
  notebookId: string,
  article: FormalizedArticle,
): Promise<string> {
  const blocks = parseMarkdown(article.markdown);
  const rows = blocks.map((b, i) => ({
    order: i,
    type: b.type,
    text: b.text,
    html: b.html,
    citations: b.citations,
    styles: b.styles,
    links: b.links,
  }));
  const existing = article.documentId
    ? await db.document.findUnique({ where: { id: article.documentId } })
    : null;
  if (existing) {
    await db.$transaction(async (tx) => {
      await tx.block.deleteMany({ where: { documentId: existing.id } });
      await tx.block.createMany({
        data: rows.map((row) => ({ ...row, documentId: existing.id })),
      });
      await tx.document.update({
        where: { id: existing.id },
        data: { title: article.title, parserVersion: PARSER_VERSION },
      });
    });
    await attachDocument(notebookId, existing.id);
    return existing.id;
  }
  const document = await db.$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: { title: article.title, parserVersion: PARSER_VERSION },
    });
    await tx.block.createMany({ data: rows.map((row) => ({ ...row, documentId: doc.id })) });
    return doc;
  });
  await attachDocument(notebookId, document.id);
  return document.id;
}

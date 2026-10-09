import { bumpNotebook } from "@/lib/collab";
import { db } from "@/lib/db";
import { attachDocument } from "@/lib/parse/attach";
import { parseMarkdown } from "@/lib/parse/markdown";
import { PARSER_VERSION } from "@/lib/parse/types";
import type { AssistantAnchor } from "@/lib/types";

// A new document of the project written by the assistant (SPEC.md §7, the
// create_document action): the plan's markdown becomes blocks the way a
// Stitch page does (lib/graph/stitch.ts materializeGenerated), and every
// quote line becomes a block that links back to the passage it copied, so
// the reader clicks from the new document to its source. The document lands
// beside the document it was written from, in its folder; Undo deletes it.

export type DocumentQuote = AssistantAnchor & { documentId: string; line: number };

/** A markdown line that is a quote: its words after the marker. */
const QUOTE_LINE = /^\s*>\s?(.*)$/;

export async function writeAssistantDocument(input: {
  notebookId: string;
  userId: string | null;
  fromDocumentId: string;
  command: string;
  title: string;
  markdown: string;
  quotes: DocumentQuote[];
}): Promise<{ id: string; title: string; blocks: number; links: number }> {
  // One chunk per run of prose lines, and one per quote line, so a quote is
  // its own block and carries its source.
  const byLine = new Map(input.quotes.map((q) => [q.line, q]));
  const chunks: { markdown: string; source: DocumentQuote | null }[] = [];
  let prose: string[] = [];
  const endProse = () => {
    if (prose.some((l) => l.trim())) chunks.push({ markdown: prose.join("\n"), source: null });
    prose = [];
  };
  input.markdown.replace(/\r\n/g, "\n").split("\n").forEach((line, i) => {
    const quote = QUOTE_LINE.exec(line);
    if (!quote) {
      prose.push(line);
      return;
    }
    endProse();
    const source = byLine.get(i) ?? null;
    const words = (source?.quotedText ?? quote[1]).trim();
    if (words) chunks.push({ markdown: words, source });
  });
  endProse();

  const rows: { order: number; type: ReturnType<typeof parseMarkdown>[number]["type"]; text: string; html: string | null; citations: unknown; styles: unknown; links: unknown; source: DocumentQuote | null }[] = [];
  for (const chunk of chunks) {
    const blocks = parseMarkdown(chunk.markdown);
    blocks.forEach((b, i) => {
      rows.push({ order: rows.length, type: b.type, text: b.text, html: b.html ?? null, citations: b.citations, styles: b.styles, links: b.links, source: i === 0 ? chunk.source : null });
    });
  }
  if (rows.length === 0) throw new Error("the new document has no words");

  const folder = await db.notebookDocument.findUnique({
    where: { notebookId_documentId: { notebookId: input.notebookId, documentId: input.fromDocumentId } },
    select: { folderId: true },
  });
  let links = 0;
  const created = await db.$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: { title: input.title.trim().slice(0, 200), parserVersion: PARSER_VERSION, generatedCommand: input.command.slice(0, 4_000) },
    });
    const blocks = await Promise.all(
      rows.map((row) =>
        tx.block.create({
          data: {
            documentId: doc.id,
            order: row.order,
            type: row.type,
            text: row.text,
            html: row.html,
            citations: row.citations as never,
            styles: row.styles as never,
            links: row.links as never,
          },
          select: { id: true, text: true },
        }),
      ),
    );
    // Provenance (SPEC.md §1): a quote clicks back to the passage it copied.
    for (let i = 0; i < rows.length; i++) {
      const source = rows[i].source;
      const block = blocks[i];
      if (!source || !block.text.trim()) continue;
      await tx.docLink.create({
        data: {
          recommended: false,
          reason: null,
          createdById: input.userId,
          fromDocumentId: doc.id,
          fromBlockId: block.id,
          startOffset: 0,
          endOffset: block.text.length,
          quotedText: block.text,
          prefix: "",
          suffix: "",
          toDocumentId: source.documentId,
          toBlockId: source.blockId,
          toStartOffset: source.startOffset,
          toEndOffset: source.endOffset,
          toQuotedText: source.quotedText,
          toPrefix: source.prefix,
          toSuffix: source.suffix,
        },
      });
      links++;
    }
    return doc;
  });
  await attachDocument(input.notebookId, created.id, folder?.folderId ?? null);
  await bumpNotebook(input.notebookId);
  return { id: created.id, title: created.title, blocks: rows.length, links };
}

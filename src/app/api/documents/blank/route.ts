import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpNotebook, documentAccess, notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { deriveBlocks, withoutSuggestions } from "@/lib/docs/blocks";
import { emptyRichText, INDEXED_NODE_TYPES, newBlockId, sanitizeRichText, type RichNode } from "@/lib/docs/schema";
import { serverT } from "@/lib/i18n/server";
import { attachDocument } from "@/lib/parse/attach";
import { PARSER_VERSION } from "@/lib/parse/types";
import { parseBody } from "@/lib/validate";

const createSchema = z.object({
  notebookId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  // File > Make a copy: the blank document to copy, and whether its
  // suggestions come with it.
  copyOf: z.string().min(1).optional(),
  suggestions: z.boolean().optional(),
});

/** A copy's rich text: every paragraph gets a fresh id (a block id is
    unique across documents), a link to one of its headings follows the
    heading, and without its suggestions it reads as if each were rejected. */
function copyRichText(doc: RichNode, suggestions: boolean): RichNode | null {
  const ids = new Map<string, string>();
  const fresh = (node: RichNode): RichNode => {
    const out = { ...node, content: node.content?.map(fresh) };
    if (INDEXED_NODE_TYPES.has(node.type)) {
      const id = newBlockId();
      if (typeof node.attrs?.blockId === "string") ids.set(node.attrs.blockId, id);
      out.attrs = { ...node.attrs, blockId: id };
    }
    return out;
  };
  const relink = (node: RichNode): RichNode => ({
    ...node,
    content: node.content?.map(relink),
    marks: node.marks?.map((mark) => {
      const id = mark.type === "link" ? /^#heading=(.+)$/.exec(String(mark.attrs?.href))?.[1] : undefined;
      const to = id && ids.get(id);
      return to ? { ...mark, attrs: { ...mark.attrs, href: `#heading=${to}` } } : mark;
    }),
  });
  const text = suggestions ? doc : { ...doc, content: withoutSuggestions(doc.content ?? []) };
  return sanitizeRichText(relink(fresh(text)));
}

// A blank document (SPEC.md §15, §29): one the reader writes here. No file,
// no source, no parse: the document is rich text, one empty paragraph or a
// copy's (File > Make a copy: the rich text and the page setup, never the
// notes, annotations, or comments), and its Block rows are the paragraph
// index derived from it. It opens in the page editor. Nothing to finish, so
// the response is the plain id and title, not an ingest stream.
export async function POST(req: Request) {
  const t = await serverT();
  const { data, error } = await parseBody(req, createSchema);
  if (error) return error;
  const notebook = await db.notebook.findUnique({ where: { id: data.notebookId } });
  if (!notebook) return NextResponse.json({ error: t("api.corpusNotFound") }, { status: 404 });
  const access = await notebookAccess(data.notebookId, "editor");
  if (access instanceof NextResponse) return access;

  let richText = emptyRichText(newBlockId());
  let pageSetup: Prisma.InputJsonValue | undefined;
  let folderId: string | null = null;
  if (data.copyOf) {
    const source = await documentAccess(data.copyOf, "viewer");
    if (source instanceof NextResponse) return source;
    const original = await db.document.findUnique({
      where: { id: data.copyOf },
      select: { richText: true, pageSetup: true, notebooks: { where: { notebookId: data.notebookId }, select: { folderId: true } } },
    });
    if (!original) return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });
    const copied = original.richText ? copyRichText(original.richText as unknown as RichNode, data.suggestions === true) : null;
    if (!copied) return NextResponse.json({ error: t("api.notBlankDocument") }, { status: 400 });
    richText = copied;
    pageSetup = (original.pageSetup ?? undefined) as Prisma.InputJsonValue | undefined;
    // The copy sits beside the original, as in Google Docs.
    folderId = original.notebooks[0]?.folderId ?? null;
  }

  const document = await db.document.create({
    data: {
      title: data.title,
      parserVersion: PARSER_VERSION,
      richText: richText as unknown as Prisma.InputJsonValue,
      pageSetup,
      blocks: {
        create: deriveBlocks(richText).map((d, order) => ({
          id: d.id,
          order,
          type: d.type,
          text: d.text,
          html: d.html,
          styles: d.styles as unknown as Prisma.InputJsonValue,
          links: d.links as unknown as Prisma.InputJsonValue,
          // User-authored, as every paragraph of a blank document.
          originalText: "",
        })),
      },
    },
    select: { id: true, title: true },
  });
  await attachDocument(data.notebookId, document.id);
  if (folderId) {
    await db.notebookDocument.update({
      where: { notebookId_documentId: { notebookId: data.notebookId, documentId: document.id } },
      data: { folderId },
    });
  }
  await bumpNotebook(data.notebookId);
  return NextResponse.json({ id: document.id, title: document.title });
}

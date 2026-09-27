import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpNotebook, documentAccess, notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { deriveBlocks, withoutSuggestions } from "@/lib/docs/blocks";
import {
  emptyRichText,
  INDEXED_NODE_TYPES,
  newBlockId,
  sanitizeRichText,
  withDocumentFigures,
  type RichNode,
} from "@/lib/docs/schema";
import { indexRowFields } from "@/lib/docs/sync";
import { serverT } from "@/lib/i18n/server";
import { attachDocument } from "@/lib/parse/attach";
import { PARSER_VERSION } from "@/lib/parse/types";
import { parseBody } from "@/lib/validate";

const createSchema = z.object({
  notebookId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  // File > Make a copy: the blank document or import to copy, and whether
  // its suggestions come with it.
  copyOf: z.string().min(1).optional(),
  suggestions: z.boolean().optional(),
});

/** A copy's rich text: every paragraph gets a fresh id (a block id is
    unique across documents), a link to one of its headings follows the
    heading, a figure object names its copy's media (`media` maps the
    original's media id to the copy's, filled here), and without its
    suggestions it reads as if each were rejected. */
function copyRichText(doc: RichNode, suggestions: boolean, media: Map<string, string>): RichNode | null {
  const ids = new Map<string, string>();
  const fresh = (node: RichNode): RichNode => {
    const out = { ...node, content: node.content?.map(fresh) };
    if (INDEXED_NODE_TYPES.has(node.type)) {
      const id = newBlockId();
      if (typeof node.attrs?.blockId === "string") ids.set(node.attrs.blockId, id);
      out.attrs = { ...node.attrs, blockId: id };
    }
    if (node.type === "figure" && typeof node.attrs?.mediaId === "string") {
      const mediaId = media.get(node.attrs.mediaId) ?? newBlockId();
      media.set(node.attrs.mediaId, mediaId);
      out.attrs = { ...out.attrs, mediaId };
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

/** The app's own images a figure's html names (lib/parse/ingest.ts claims
    them for the document whose parse captured them). */
const OWN_IMAGE = /(\/api\/images\/)([A-Za-z0-9_-]+)/g;

// A blank document (SPEC.md §15, §29): one the reader writes here. No file,
// no source, no parse: the document is rich text, one empty paragraph or a
// copy's (File > Make a copy), and its Block rows are the paragraph index
// derived from it. It opens in the page editor. Nothing to finish, so the
// response is the plain id and title, not an ingest stream.
//
// A copy takes the rich text and the page setup, never the notes,
// annotations, comments, or history. A copy of an import (§30) is a blank
// document too (importRev null) that keeps what its text draws from: its
// figures' media (FigureMedia rows of its own), the images those media
// hold that the import's parse captured, the PDF its figures' crops are cut
// from, its page labels, and its reference list.
export async function POST(req: Request) {
  const t = await serverT();
  const { data, error } = await parseBody(req, createSchema);
  if (error) return error;
  const notebook = await db.notebook.findUnique({ where: { id: data.notebookId } });
  if (!notebook) return NextResponse.json({ error: t("api.corpusNotFound") }, { status: 404 });
  const access = await notebookAccess(data.notebookId, "editor");
  if (access instanceof NextResponse) return access;

  let richText = emptyRichText(newBlockId());
  let kept: Pick<Prisma.DocumentCreateInput, "pageSetup" | "pageLabels" | "references"> = {};
  let folderId: string | null = null;
  const mediaIds = new Map<string, string>();
  let media: { id: string; html: string | null; caption: string; page: number | null; region: Prisma.JsonValue }[] = [];
  if (data.copyOf) {
    const source = await documentAccess(data.copyOf, "viewer");
    if (source instanceof NextResponse) return source;
    const original = await db.document.findUnique({
      where: { id: data.copyOf },
      select: {
        richText: true,
        pageSetup: true,
        pageLabels: true,
        references: true,
        notebooks: { where: { notebookId: data.notebookId }, select: { folderId: true } },
      },
    });
    if (!original) return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });
    const copied = original.richText ? copyRichText(original.richText as unknown as RichNode, data.suggestions === true, mediaIds) : null;
    if (!copied) return NextResponse.json({ error: t("api.notBlankDocument") }, { status: 400 });
    media = await db.figureMedia.findMany({
      where: { documentId: data.copyOf, id: { in: [...mediaIds.keys()] } },
      select: { id: true, html: true, caption: true, page: true, region: true },
    });
    // A figure without media stays out, as the save leaves it out.
    richText = withDocumentFigures(copied, new Map(media.map((m) => [mediaIds.get(m.id) ?? "", m])));
    const json = (value: Prisma.JsonValue) => (value === null ? undefined : (value as Prisma.InputJsonValue));
    kept = { pageSetup: json(original.pageSetup), pageLabels: json(original.pageLabels), references: json(original.references) };
    // The copy sits beside the original, as in Google Docs.
    folderId = original.notebooks[0]?.folderId ?? null;
  }

  const originalId = data.copyOf ?? null;
  const document = await db.$transaction(
    async (tx) => {
      const created = await tx.document.create({
        data: { title: data.title, parserVersion: PARSER_VERSION, richText: richText as unknown as Prisma.InputJsonValue, ...kept },
        select: { id: true, title: true },
      });
      // The images the import's parse captured go with the import: the copy
      // keeps its own.
      const imageIds = new Map<string, string>();
      const named = media.flatMap((m) => [...(m.html ?? "").matchAll(OWN_IMAGE)].map((match) => match[2]));
      if (originalId && named.length > 0) {
        const images = await tx.imageAsset.findMany({
          where: { id: { in: named }, documentId: originalId },
          select: { id: true, mimeType: true, size: true, data: true },
        });
        for (const { id, ...image } of images) {
          const copy = await tx.imageAsset.create({ data: { ...image, userId: access.user.id, documentId: created.id }, select: { id: true } });
          imageIds.set(id, copy.id);
        }
      }
      const rows = media.map((m) => ({
        id: mediaIds.get(m.id) ?? newBlockId(),
        documentId: created.id,
        html: m.html?.replace(OWN_IMAGE, (whole, path: string, id: string) => (imageIds.has(id) ? `${path}${imageIds.get(id)}` : whole)) ?? null,
        caption: m.caption,
        page: m.page,
        region: m.region ?? Prisma.DbNull,
      }));
      if (rows.length > 0) await tx.figureMedia.createMany({ data: rows });
      // A PDF figure is drawn as the crop of its page: the copy keeps the PDF.
      if (originalId && rows.some((m) => m.html === null && m.page !== null)) {
        await tx.$executeRaw`UPDATE "Document" SET "fileData" = (SELECT "fileData" FROM "Document" WHERE "id" = ${originalId}) WHERE "id" = ${created.id}`;
      }
      const html = new Map(rows.map((m) => [m.id, m.html]));
      await tx.block.createMany({
        data: deriveBlocks(richText).map((d, order) => ({
          ...indexRowFields(d, d.mediaId ? (html.get(d.mediaId) ?? null) : d.html),
          documentId: created.id,
          order,
          // User-authored, as every paragraph of a blank document.
          originalText: "",
        })),
      });
      return created;
    },
    { timeout: 60_000, maxWait: 15_000 },
  );
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

import { NextResponse } from "next/server";
import { z } from "zod";
import { documentBlocks, resolveAnchor, type ResolvedAnchor } from "@/lib/anchors/resolve";
import { bumpDocument, documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

const anchorSchema = z.object({
  blockId: z.string().min(1),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(0),
  quotedText: z.string().min(1).max(10_000),
  prefix: z.string().max(64),
  suffix: z.string().max(64),
});

const createSchema = z.object({
  fromDocumentId: z.string().min(1),
  toDocumentId: z.string().min(1),
  anchor: anchorSchema,
  toAnchor: anchorSchema.optional(), // the other end; absent = document-level link
});

// Link a text range in one document to another document. Recorded as a LINK_ADD
// edit so the Edits panel shows it.
export async function POST(req: Request) {
  const t = await serverT();
  const { data, error } = await parseBody(req, createSchema);
  if (error) return error;

  if (data.fromDocumentId === data.toDocumentId && !data.toAnchor) {
    return NextResponse.json({ error: t("api.linkSelfTarget") }, { status: 400 });
  }

  if (data.anchor.endOffset <= data.anchor.startOffset) {
    return NextResponse.json({ error: t("api.anchorOffsetsInvalid") }, { status: 400 });
  }

  const fromDocument = await db.document.findUnique({ where: { id: data.fromDocumentId } });
  if (!fromDocument) return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });
  const access = await documentAccess(data.fromDocumentId, "editor");
  if (access instanceof NextResponse) return access;

  // Both ends resolve through the ladder (SPEC.md §5): block id and offsets,
  // then the quote inside the block, then the quote across the document — a
  // re-parse gives every block a new id while an open reader still sends the
  // old ones. Provenance is non-negotiable (SPEC.md §1): the stored quote is
  // the text at the stored offsets, or the anchor is rejected.
  const anchor = resolveAnchor(await documentBlocks(data.fromDocumentId), data.anchor);
  if (!anchor) {
    return NextResponse.json({ error: t("api.anchorNotResolvedInDocument") }, { status: 400 });
  }

  let toAnchor: ResolvedAnchor | null = null;
  if (data.toAnchor) {
    if (data.toAnchor.endOffset <= data.toAnchor.startOffset) {
      return NextResponse.json({ error: t("api.anchorOffsetsInvalid") }, { status: 400 });
    }
    toAnchor = resolveAnchor(await documentBlocks(data.toDocumentId), data.toAnchor);
    if (!toAnchor) {
      return NextResponse.json({ error: t("api.anchorNotResolvedInDocument") }, { status: 400 });
    }
  }

  const toDocument = await db.document.findUnique({ where: { id: data.toDocumentId } });
  if (!toDocument) return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });

  const link = await db.$transaction(async (tx) => {
    const created = await tx.docLink.create({
      data: {
        createdById: access.user.id,
        fromDocumentId: data.fromDocumentId,
        fromBlockId: anchor.blockId,
        startOffset: anchor.startOffset,
        endOffset: anchor.endOffset,
        quotedText: anchor.quotedText,
        prefix: anchor.prefix,
        suffix: anchor.suffix,
        toDocumentId: data.toDocumentId,
        ...(toAnchor
          ? {
              toBlockId: toAnchor.blockId,
              toStartOffset: toAnchor.startOffset,
              toEndOffset: toAnchor.endOffset,
              toQuotedText: toAnchor.quotedText,
              toPrefix: toAnchor.prefix,
              toSuffix: toAnchor.suffix,
            }
          : {}),
      },
    });
    await tx.blockEdit.create({
      data: {
        documentId: data.fromDocumentId,
        blockId: anchor.blockId,
        kind: "LINK_ADD",
        meta: {
          linkId: created.id,
          toDocumentId: data.toDocumentId,
          toTitle: toDocument.title,
          quotedText: anchor.quotedText,
        },
        userId: access.user.id,
      },
    });
    return created;
  });
  await bumpDocument(data.fromDocumentId);
  return NextResponse.json(link, { status: 201 });
}

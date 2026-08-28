import { NextResponse } from "next/server";
import { z } from "zod";
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

  const block = await db.block.findUnique({ where: { id: data.anchor.blockId } });
  if (!block || block.documentId !== data.fromDocumentId) {
    return NextResponse.json({ error: t("api.blockNotInDocument") }, { status: 404 });
  }
  // Provenance is non-negotiable (SPEC.md §1): the quote must be the text at
  // those offsets, or the anchor is a lie and is rejected.
  if (
    data.anchor.endOffset > block.text.length ||
    block.text.slice(data.anchor.startOffset, data.anchor.endOffset) !== data.anchor.quotedText
  ) {
    return NextResponse.json({ error: t("api.anchorMismatch") }, { status: 400 });
  }

  if (data.toAnchor) {
    if (data.toAnchor.endOffset <= data.toAnchor.startOffset) {
      return NextResponse.json({ error: t("api.anchorOffsetsInvalid") }, { status: 400 });
    }
    const toBlock = await db.block.findUnique({ where: { id: data.toAnchor.blockId } });
    if (!toBlock || toBlock.documentId !== data.toDocumentId) {
      return NextResponse.json({ error: t("api.blockNotInTargetDocument") }, { status: 404 });
    }
    if (
      data.toAnchor.endOffset > toBlock.text.length ||
      toBlock.text.slice(data.toAnchor.startOffset, data.toAnchor.endOffset) !==
        data.toAnchor.quotedText
    ) {
      return NextResponse.json({ error: t("api.anchorMismatch") }, { status: 400 });
    }
  }

  const toDocument = await db.document.findUnique({ where: { id: data.toDocumentId } });
  if (!toDocument) return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });

  const link = await db.$transaction(async (tx) => {
    const created = await tx.docLink.create({
      data: {
        fromDocumentId: data.fromDocumentId,
        fromBlockId: data.anchor.blockId,
        startOffset: data.anchor.startOffset,
        endOffset: data.anchor.endOffset,
        quotedText: data.anchor.quotedText,
        prefix: data.anchor.prefix,
        suffix: data.anchor.suffix,
        toDocumentId: data.toDocumentId,
        ...(data.toAnchor
          ? {
              toBlockId: data.toAnchor.blockId,
              toStartOffset: data.toAnchor.startOffset,
              toEndOffset: data.toAnchor.endOffset,
              toQuotedText: data.toAnchor.quotedText,
              toPrefix: data.toAnchor.prefix,
              toSuffix: data.toAnchor.suffix,
            }
          : {}),
      },
    });
    await tx.blockEdit.create({
      data: {
        documentId: data.fromDocumentId,
        blockId: data.anchor.blockId,
        kind: "LINK_ADD",
        meta: {
          linkId: created.id,
          toDocumentId: data.toDocumentId,
          toTitle: toDocument.title,
          quotedText: data.anchor.quotedText,
        },
        userId: access.user.id,
      },
    });
    return created;
  });
  await bumpDocument(data.fromDocumentId);
  return NextResponse.json(link, { status: 201 });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
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
});

// Link a text range in one document to another document. Recorded as a LINK_ADD
// edit so the Edits panel shows it.
export async function POST(req: Request) {
  const { data, error } = await parseBody(req, createSchema);
  if (error) return error;

  if (data.fromDocumentId === data.toDocumentId) {
    return NextResponse.json({ error: "A document cannot link to itself" }, { status: 400 });
  }

  const fromDocument = await db.document.findUnique({ where: { id: data.fromDocumentId } });
  if (!fromDocument) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const toDocument = await db.document.findUnique({ where: { id: data.toDocumentId } });
  if (!toDocument) return NextResponse.json({ error: "Document not found" }, { status: 404 });

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
      },
    });
    return created;
  });
  return NextResponse.json(link, { status: 201 });
}

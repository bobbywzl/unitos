import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

const restoreSchema = z.object({ editId: z.string().min(1) });

// Restore a removed block from its BLOCK_REMOVE edit: same id, same text, same
// format, same position. Anchors on the block heal on the next render because
// the id and text come back; link ends are un-orphaned here when their quote
// still matches.
export async function POST(req: Request) {
  const t = await serverT();
  const { data, error } = await parseBody(req, restoreSchema);
  if (error) return error;

  const edit = await db.blockEdit.findUnique({ where: { id: data.editId } });
  if (!edit || edit.kind !== "BLOCK_REMOVE" || !edit.blockId || edit.before === null) {
    return NextResponse.json({ error: t("api.editNotRemovedParagraph") }, { status: 400 });
  }
  const existing = await db.block.findUnique({ where: { id: edit.blockId } });
  if (existing) {
    return NextResponse.json({ error: t("api.paragraphAlreadyBack") }, { status: 400 });
  }

  const meta = (edit.meta ?? {}) as {
    order?: number;
    type?: string;
    html?: string | null;
    originalText?: string | null;
  };
  const order = typeof meta.order === "number" ? meta.order : 0;
  const type = meta.type === "HEADING" || meta.type === "LIST" ? meta.type : "PARAGRAPH";
  const text = edit.before;

  const block = await db.$transaction(async (tx) => {
    await tx.block.updateMany({
      where: { documentId: edit.documentId, order: { gte: order } },
      data: { order: { increment: 1 } },
    });
    const created = await tx.block.create({
      data: {
        id: edit.blockId!,
        documentId: edit.documentId,
        order,
        type,
        html: meta.html ?? null,
        text,
        originalText: meta.originalText !== undefined ? meta.originalText : text,
      },
    });
    await tx.blockEdit.create({
      data: {
        documentId: edit.documentId,
        blockId: created.id,
        kind: "BLOCK_ADD",
        after: text,
        meta: { restoredFrom: edit.id },
      },
    });
    // Link ends on this block resolve again when their quote still matches.
    const links = await tx.docLink.findMany({
      where: { OR: [{ fromBlockId: created.id }, { toBlockId: created.id }] },
    });
    for (const link of links) {
      if (
        link.fromBlockId === created.id &&
        link.fromOrphaned &&
        text.slice(link.startOffset, link.endOffset) === link.quotedText
      ) {
        await tx.docLink.update({ where: { id: link.id }, data: { fromOrphaned: false } });
      }
      if (
        link.toBlockId === created.id &&
        link.toOrphaned &&
        link.toStartOffset !== null &&
        link.toEndOffset !== null &&
        text.slice(link.toStartOffset, link.toEndOffset) === link.toQuotedText
      ) {
        await tx.docLink.update({ where: { id: link.id }, data: { toOrphaned: false } });
      }
    }
    return created;
  });
  return NextResponse.json(block, { status: 201 });
}

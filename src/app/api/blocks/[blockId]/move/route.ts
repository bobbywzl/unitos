import { NextResponse } from "next/server";
import { z } from "zod";
import { followOrders } from "@/lib/block-order";
import { blockTakes, documentShape } from "@/lib/block-takes";
import { bumpDocument, documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { isRichTextDocument } from "@/lib/docs/server";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

const moveSchema = z.object({
  // The block it goes after; null = the document's start.
  afterBlockId: z.string().min(1).nullable(),
});

// Move a block after another block, or to the document's start (SPEC.md §7:
// the assistant's move_block). The blocks between shift by one, and the
// links that point at a block by its order follow it. The answer names the
// block it stood after before, so Undo moves it back. Only where a move
// cannot corrupt the document (lib/block-takes.ts); a document with rich
// text moves its blocks in the page editor.
export async function POST(req: Request, ctx: { params: Promise<{ blockId: string }> }) {
  const t = await serverT();
  const { blockId } = await ctx.params;
  const { data, error } = await parseBody(req, moveSchema);
  if (error) return error;

  const block = await db.block.findUnique({ where: { id: blockId }, select: { id: true, documentId: true, order: true, type: true } });
  if (!block) return NextResponse.json({ error: t("api.blockNotFound") }, { status: 404 });
  const access = await documentAccess(block.documentId, "editor");
  if (access instanceof NextResponse) return access;
  const after =
    data.afterBlockId === null
      ? null
      : await db.block.findUnique({ where: { id: data.afterBlockId }, select: { id: true, documentId: true, order: true, type: true } });
  if (data.afterBlockId !== null && (!after || after.documentId !== block.documentId)) {
    return NextResponse.json({ error: t("api.blockNotInDocument") }, { status: 404 });
  }
  if (after?.id === block.id || (await isRichTextDocument(block.documentId))) {
    return NextResponse.json({ error: t("api.blockNotMovable") }, { status: 400 });
  }

  const [shape, previous, first, next] = await Promise.all([
    documentShape(block.documentId),
    db.block.findFirst({ where: { documentId: block.documentId, order: { lt: block.order } }, orderBy: { order: "desc" }, select: { id: true } }),
    db.block.findFirst({ where: { documentId: block.documentId, id: { not: block.id } }, orderBy: { order: "asc" }, select: { order: true, type: true } }),
    after
      ? db.block.findFirst({ where: { documentId: block.documentId, order: { gt: after.order }, id: { not: block.id } }, orderBy: { order: "asc" }, select: { type: true } })
      : null,
  ]);
  const lands = after ? blockTakes.after(after.type, next?.type, shape) : blockTakes.start(first?.type, shape);
  if (!blockTakes.move(block.type, shape) || !lands) {
    return NextResponse.json({ error: t("api.blockNotMovable") }, { status: 400 });
  }

  // Where it lands: right after `after` (moving down, `after` shifts up one
  // into its place), or where the first block stands.
  const from = block.order;
  const to = after ? (after.order < from ? after.order + 1 : after.order) : Math.min(first?.order ?? from, from);
  if (to !== from) {
    // Up: the blocks from `to` to just above it shift down one. Down: the
    // blocks from just below it to `to` shift up one.
    const moved = (at: number) =>
      at === from ? to : to < from && at >= to && at < from ? at + 1 : to > from && at > from && at <= to ? at - 1 : at;
    await db.$transaction(async (tx) => {
      if (to < from) {
        await tx.block.updateMany({ where: { documentId: block.documentId, order: { gte: to, lt: from } }, data: { order: { increment: 1 } } });
      } else {
        await tx.block.updateMany({ where: { documentId: block.documentId, order: { gt: from, lte: to } }, data: { order: { decrement: 1 } } });
      }
      await tx.block.update({ where: { id: block.id }, data: { order: to } });
      await followOrders(tx, block.documentId, moved);
    });
    await bumpDocument(block.documentId);
  }
  return NextResponse.json({ ok: true, previousAfterBlockId: previous?.id ?? null });
}

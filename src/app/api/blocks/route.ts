import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseBody } from "@/lib/validate";

const createSchema = z.object({
  documentId: z.string().min(1),
  afterBlockId: z.string().min(1),
  text: z.string().max(50_000).optional(),
});

// Insert a paragraph after a block. User-authored blocks carry originalText ""
// so the whole paragraph paints as edited.
export async function POST(req: Request) {
  const { data, error } = await parseBody(req, createSchema);
  if (error) return error;

  const after = await db.block.findUnique({ where: { id: data.afterBlockId } });
  if (!after || after.documentId !== data.documentId) {
    return NextResponse.json({ error: "Block not found in this document" }, { status: 404 });
  }

  const block = await db.$transaction(async (tx) => {
    await tx.block.updateMany({
      where: { documentId: data.documentId, order: { gt: after.order } },
      data: { order: { increment: 1 } },
    });
    const created = await tx.block.create({
      data: {
        documentId: data.documentId,
        order: after.order + 1,
        type: "PARAGRAPH",
        // Empty until the user types; the editor shows a placeholder.
        text: data.text ?? "",
        originalText: "",
      },
    });
    await tx.blockEdit.create({
      data: {
        documentId: data.documentId,
        blockId: created.id,
        kind: "BLOCK_ADD",
        after: created.text,
      },
    });
    return created;
  });
  return NextResponse.json(block, { status: 201 });
}

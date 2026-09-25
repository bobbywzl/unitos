import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpDocument, documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { imageNode, insertAfterBlock, paragraphNode } from "@/lib/docs/ops";
import { newBlockId } from "@/lib/docs/schema";
import { editRichText, isRichTextDocument } from "@/lib/docs/server";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

const createSchema = z.object({
  documentId: z.string().min(1),
  afterBlockId: z.string().min(1),
  text: z.string().max(50_000).optional(),
  // A dropped image lands as a figure (SPEC.md §16): its html is the <figure>
  // the reader renders, its text the caption a chip, a search, and the digest
  // read. Absent = the paragraph the insert button adds.
  type: z.enum(["PARAGRAPH", "FIGURE"]).default("PARAGRAPH"),
  html: z.string().max(4_000).optional(),
});

// Insert a paragraph, or a figure for a dropped image, after a block.
// User-authored blocks carry originalText "" so the whole block paints as edited.
export async function POST(req: Request) {
  const t = await serverT();
  const { data, error } = await parseBody(req, createSchema);
  if (error) return error;

  const after = await db.block.findUnique({ where: { id: data.afterBlockId } });
  if (!after || after.documentId !== data.documentId) {
    return NextResponse.json({ error: t("api.blockNotInDocument") }, { status: 404 });
  }
  const access = await documentAccess(data.documentId, "editor");
  if (access instanceof NextResponse) return access;

  // A blank document is edited through its rich text (SPEC.md §29).
  if (await isRichTextDocument(data.documentId)) {
    const id = newBlockId();
    const node =
      data.type === "FIGURE" ? imageNode(data.html ?? "", data.text ?? "", id) : paragraphNode(data.text ?? "", id);
    if (!node) return NextResponse.json({ error: t("api.blockNotInDocument") }, { status: 400 });
    const result = await editRichText(data.documentId, access.user.id, (doc) =>
      insertAfterBlock(doc, data.afterBlockId, node),
    );
    if (!result.ok) return NextResponse.json({ error: t("api.blockNotInDocument") }, { status: 404 });
    return NextResponse.json(await db.block.findUnique({ where: { id } }), { status: 201 });
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
        type: data.type,
        // Empty until the user types; the editor shows a placeholder.
        text: data.text ?? "",
        html: data.html,
        originalText: "",
      },
    });
    await tx.blockEdit.create({
      data: {
        documentId: data.documentId,
        blockId: created.id,
        kind: "BLOCK_ADD",
        after: created.text,
        userId: access.user.id,
      },
    });
    return created;
  });
  await bumpDocument(data.documentId);
  return NextResponse.json(block, { status: 201 });
}

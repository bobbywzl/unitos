import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpDocument, documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { withListMarkers, type BlockKind } from "@/lib/block-kind";
import { followOrders } from "@/lib/block-order";
import { blockTakes, documentShape } from "@/lib/block-takes";
import { imageNode, insertAfterBlock, insertAtOrder, paragraphNode } from "@/lib/docs/ops";
import { newBlockId } from "@/lib/docs/schema";
import { editRichText, importSharedResponse, isRichTextDocument } from "@/lib/docs/server";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

const createSchema = z.object({
  documentId: z.string().min(1),
  // null: the document's start.
  afterBlockId: z.string().min(1).nullable(),
  text: z.string().max(50_000).optional(),
  // The new block's format (a heading, a list); absent = a paragraph. A list
  // takes its markers in its text (lib/block-kind.ts).
  kind: z.enum(["paragraph", "h1", "h2", "h3", "list", "numbered"]).optional(),
  // A dropped image lands as a figure (SPEC.md §16): its html is the <figure>
  // the reader renders, its text the caption a chip, a search, and the digest
  // read. Absent = the paragraph the insert button adds.
  type: z.enum(["PARAGRAPH", "FIGURE"]).default("PARAGRAPH"),
  html: z.string().max(4_000).optional(),
});

// Where a new block of each format stands: its type and its html.
const KIND_TO_BLOCK: Record<BlockKind, { type: "PARAGRAPH" | "HEADING" | "LIST"; html: string | null }> = {
  paragraph: { type: "PARAGRAPH", html: null },
  h1: { type: "HEADING", html: "<h1>" },
  h2: { type: "HEADING", html: "<h2>" },
  h3: { type: "HEADING", html: "<h3>" },
  list: { type: "LIST", html: null },
  numbered: { type: "LIST", html: null },
};

// Insert a paragraph, a heading, or a list, or a figure for a dropped image,
// after a block or at the document's start.
// User-authored blocks carry originalText "" so the whole block paints as edited.
export async function POST(req: Request) {
  const t = await serverT();
  const { data, error } = await parseBody(req, createSchema);
  if (error) return error;

  const after = data.afterBlockId === null ? null : await db.block.findUnique({ where: { id: data.afterBlockId } });
  if (after === null ? data.afterBlockId !== null : after.documentId !== data.documentId) {
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
    const afterBlockId = data.afterBlockId;
    const result = await editRichText(data.documentId, access.user.id, (doc) =>
      afterBlockId === null ? insertAtOrder(doc, 0, node) : insertAfterBlock(doc, afterBlockId, node),
    );
    if (!result.ok) {
      return result.reason === "shared" ? importSharedResponse(t) : NextResponse.json({ error: t("api.blockNotInDocument") }, { status: 404 });
    }
    return NextResponse.json(await db.block.findUnique({ where: { id } }), { status: 201 });
  }

  // A new block goes where it cannot corrupt the document (lib/block-takes.ts):
  // none in slides, sheets, or a video's or audio's document, and none
  // between two pages of a handwritten document.
  const [shape, neighbor] = await Promise.all([
    documentShape(data.documentId),
    db.block.findFirst({
      where: { documentId: data.documentId, ...(after ? { order: { gt: after.order } } : {}) },
      orderBy: { order: "asc" },
      select: { type: true, order: true },
    }),
  ]);
  if (after ? !blockTakes.after(after.type, neighbor?.type, shape) : !blockTakes.start(neighbor?.type, shape)) {
    return NextResponse.json({ error: t("api.blockInsertRefused") }, { status: 400 });
  }
  // The new block's place: right after `after`, or where the first block stands.
  const order = after ? after.order + 1 : (neighbor?.order ?? 0);
  const format = data.type === "PARAGRAPH" && data.kind ? KIND_TO_BLOCK[data.kind] : null;
  const text = data.kind === "list" || data.kind === "numbered" ? withListMarkers(data.text ?? "", data.kind) : (data.text ?? "");

  const block = await db.$transaction(async (tx) => {
    await tx.block.updateMany({
      where: { documentId: data.documentId, order: { gte: order } },
      data: { order: { increment: 1 } },
    });
    await followOrders(tx, data.documentId, (at) => (at >= order ? at + 1 : at));
    const created = await tx.block.create({
      data: {
        documentId: data.documentId,
        order,
        type: format?.type ?? data.type,
        // Empty until the user types; the editor shows a placeholder.
        text,
        html: format?.html ?? data.html,
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

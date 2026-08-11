import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseBody } from "@/lib/validate";

const patchSchema = z.object({
  text: z.string().min(1).max(50_000),
});

// Edit a block's text. TABLE and FIGURE content is sanitized html, not text, so they are
// not editable. block.html is left untouched — for HEADING it stores the level tag.
// The document glossary is left alone; term offsets re-resolve at render.
export async function PATCH(req: Request, ctx: { params: Promise<{ blockId: string }> }) {
  const { blockId } = await ctx.params;
  const { data, error } = await parseBody(req, patchSchema);
  if (error) return error;

  const block = await db.block.findUnique({ where: { id: blockId } });
  if (!block) return NextResponse.json({ error: "Block not found" }, { status: 404 });

  if (block.type === "TABLE" || block.type === "FIGURE") {
    return NextResponse.json({ error: "Only text blocks can be edited" }, { status: 400 });
  }

  if (data.text === block.text) return NextResponse.json(block);

  const [updated] = await db.$transaction([
    db.block.update({
      where: { id: blockId },
      // First edit freezes the original, so edited-vs-original coloring always
      // diffs against the text as parsed.
      data: {
        text: data.text,
        ...(block.originalText === null ? { originalText: block.text } : {}),
      },
    }),
    db.blockEdit.create({
      data: {
        documentId: block.documentId,
        blockId: block.id,
        kind: "TEXT_EDIT",
        before: block.text,
        after: data.text,
      },
    }),
  ]);
  return NextResponse.json(updated);
}

// Remove a block. Anchors on it re-resolve or orphan visibly (SPEC.md §5).
export async function DELETE(_req: Request, ctx: { params: Promise<{ blockId: string }> }) {
  const { blockId } = await ctx.params;
  const block = await db.block.findUnique({ where: { id: blockId } });
  if (!block) return NextResponse.json({ error: "Block not found" }, { status: 404 });
  if (block.type === "TABLE" || block.type === "FIGURE") {
    return NextResponse.json({ error: "Only text blocks can be removed" }, { status: 400 });
  }

  await db.$transaction([
    db.block.delete({ where: { id: blockId } }),
    db.blockEdit.create({
      data: {
        documentId: block.documentId,
        blockId: block.id,
        kind: "BLOCK_REMOVE",
        before: block.text,
      },
    }),
  ]);
  return NextResponse.json({ ok: true });
}

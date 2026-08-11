import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseBody } from "@/lib/validate";

const patchSchema = z
  .object({
    text: z.string().min(1).max(50_000).optional(),
    kind: z.enum(["paragraph", "h1", "h2", "h3"]).optional(),
  })
  .refine((d) => d.text !== undefined || d.kind !== undefined, {
    message: "text or kind is required",
  });

const KIND_TO_BLOCK: Record<string, { type: "PARAGRAPH" | "HEADING"; html: string | null }> = {
  paragraph: { type: "PARAGRAPH", html: null },
  h1: { type: "HEADING", html: "<h1>" },
  h2: { type: "HEADING", html: "<h2>" },
  h3: { type: "HEADING", html: "<h3>" },
};

function kindOf(type: string, html: string | null): string {
  if (type !== "HEADING") return "paragraph";
  const m = html?.match(/^<h([1-3])/);
  return m ? `h${m[1]}` : "h2";
}

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

  // Format change: heading level or paragraph, recorded as FORMAT.
  if (data.kind !== undefined && data.text === undefined) {
    const target = KIND_TO_BLOCK[data.kind];
    const from = kindOf(block.type, block.html);
    if (from === data.kind) return NextResponse.json(block);
    const [formatted] = await db.$transaction([
      db.block.update({
        where: { id: blockId },
        data: { type: target.type, html: target.html },
      }),
      db.blockEdit.create({
        data: {
          documentId: block.documentId,
          blockId: block.id,
          kind: "FORMAT",
          meta: { from, to: data.kind },
        },
      }),
    ]);
    return NextResponse.json(formatted);
  }

  if (data.text === undefined || data.text === block.text) return NextResponse.json(block);

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

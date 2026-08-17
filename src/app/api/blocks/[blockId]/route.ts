import { NextResponse } from "next/server";
import { z } from "zod";
import { diffSegments, remapAnchor, remapRange } from "@/lib/anchors/remap";
import { db } from "@/lib/db";
import { parseBody } from "@/lib/validate";

const patchSchema = z
  .object({
    text: z.string().max(50_000).optional(),
    kind: z.enum(["paragraph", "h1", "h2", "h3", "list", "numbered"]).optional(),
  })
  .refine((d) => d.text !== undefined || d.kind !== undefined, {
    message: "text or kind is required",
  });

const KIND_TO_BLOCK: Record<
  string,
  { type: "PARAGRAPH" | "HEADING" | "LIST"; html: string | null }
> = {
  paragraph: { type: "PARAGRAPH", html: null },
  h1: { type: "HEADING", html: "<h1>" },
  h2: { type: "HEADING", html: "<h2>" },
  h3: { type: "HEADING", html: "<h3>" },
  // Both list kinds store as LIST; the numbering lives in the text markers.
  list: { type: "LIST", html: null },
  numbered: { type: "LIST", html: null },
};

function kindOf(type: string, html: string | null, text: string): string {
  if (type === "LIST") return /^\s*\d{1,3}[.)]\s/.test(text) ? "numbered" : "list";
  if (type !== "HEADING") return "paragraph";
  const m = html?.match(/^<h([1-3])/);
  return m ? `h${m[1]}` : "h2";
}

type StyleSpan = { start: number; end: number; style: string; quotedText: string };

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

  const target = data.kind !== undefined ? KIND_TO_BLOCK[data.kind] : null;
  const fromKind = kindOf(block.type, block.html, block.text);
  const kindChanges = data.kind !== undefined && fromKind !== data.kind;

  // Format change without a text change: heading level, paragraph, or list kind,
  // recorded as FORMAT. List conversions send text too and take the path below.
  if (data.text === undefined || data.text === block.text) {
    if (!kindChanges || !target) return NextResponse.json(block);
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
          before: fromKind,
          after: data.kind,
          meta: { from: fromKind, to: data.kind },
        },
      }),
    ]);
    return NextResponse.json(formatted);
  }

  const newText = data.text;

  // Remap every anchor on this block through the edit, the way Google Docs
  // moves highlights while you type: shift, grow, shrink, or orphan visibly.
  const segments = diffSegments(block.text, newText);
  const [sources, links] = await Promise.all([
    db.source.findMany({ where: { blockId, orphaned: false } }),
    db.docLink.findMany({
      where: { OR: [{ fromBlockId: blockId }, { toBlockId: blockId }] },
    }),
  ]);

  const spans = (Array.isArray(block.styles) ? block.styles : []) as unknown as StyleSpan[];
  const nextSpans = spans.flatMap((s) => {
    const r = remapRange(segments, s.start, s.end);
    if (r.orphaned) return []; // the styled words are gone; the style goes with them
    return [{ ...s, start: r.start, end: r.end, quotedText: newText.slice(r.start, r.end) }];
  });

  const updated = await db.$transaction(async (tx) => {
    const saved = await tx.block.update({
      where: { id: blockId },
      // First edit freezes the original, so edited-vs-original coloring always
      // diffs against the text as parsed.
      data: {
        text: newText,
        styles: nextSpans,
        ...(kindChanges && target ? { type: target.type, html: target.html } : {}),
        ...(block.originalText === null ? { originalText: block.text } : {}),
      },
    });
    await tx.blockEdit.create({
      data: {
        documentId: block.documentId,
        blockId: block.id,
        kind: "TEXT_EDIT",
        before: block.text,
        after: newText,
      },
    });
    if (kindChanges && data.kind !== undefined) {
      await tx.blockEdit.create({
        data: {
          documentId: block.documentId,
          blockId: block.id,
          kind: "FORMAT",
          before: fromKind,
          after: data.kind,
          meta: { from: fromKind, to: data.kind },
        },
      });
    }
    for (const src of sources) {
      const r = remapAnchor(segments, newText, src);
      await tx.source.update({
        where: { id: src.id },
        data: {
          startOffset: r.startOffset,
          endOffset: r.endOffset,
          quotedText: r.quotedText,
          prefix: r.prefix,
          suffix: r.suffix,
          orphaned: r.orphaned,
        },
      });
    }
    for (const link of links) {
      if (link.fromBlockId === blockId && !link.fromOrphaned) {
        const r = remapAnchor(segments, newText, {
          startOffset: link.startOffset,
          endOffset: link.endOffset,
          quotedText: link.quotedText,
        });
        await tx.docLink.update({
          where: { id: link.id },
          data: {
            startOffset: r.startOffset,
            endOffset: r.endOffset,
            quotedText: r.quotedText,
            prefix: r.prefix,
            suffix: r.suffix,
            fromOrphaned: r.orphaned,
          },
        });
      }
      if (
        link.toBlockId === blockId &&
        !link.toOrphaned &&
        link.toStartOffset !== null &&
        link.toEndOffset !== null &&
        link.toQuotedText !== null
      ) {
        const r = remapAnchor(segments, newText, {
          startOffset: link.toStartOffset,
          endOffset: link.toEndOffset,
          quotedText: link.toQuotedText,
        });
        await tx.docLink.update({
          where: { id: link.id },
          data: {
            toStartOffset: r.startOffset,
            toEndOffset: r.endOffset,
            toQuotedText: r.quotedText,
            toPrefix: r.prefix,
            toSuffix: r.suffix,
            toOrphaned: r.orphaned,
          },
        });
      }
    }
    return saved;
  });
  return NextResponse.json(updated);
}

// Remove a block. Its anchors orphan visibly (SPEC.md §5); the Edits panel can
// restore the block from the recorded text, format, and position.
export async function DELETE(_req: Request, ctx: { params: Promise<{ blockId: string }> }) {
  const { blockId } = await ctx.params;
  const block = await db.block.findUnique({ where: { id: blockId } });
  if (!block) return NextResponse.json({ error: "Block not found" }, { status: 404 });
  if (block.type === "TABLE" || block.type === "FIGURE") {
    return NextResponse.json({ error: "Only text blocks can be removed" }, { status: 400 });
  }

  await db.$transaction([
    db.block.delete({ where: { id: blockId } }),
    db.source.updateMany({ where: { blockId }, data: { orphaned: true } }),
    db.docLink.updateMany({ where: { fromBlockId: blockId }, data: { fromOrphaned: true } }),
    db.docLink.updateMany({ where: { toBlockId: blockId }, data: { toOrphaned: true } }),
    db.blockEdit.create({
      data: {
        documentId: block.documentId,
        blockId: block.id,
        kind: "BLOCK_REMOVE",
        before: block.text,
        meta: {
          order: block.order,
          type: block.type,
          html: block.html,
          originalText: block.originalText,
        },
      },
    }),
  ]);
  return NextResponse.json({ ok: true });
}

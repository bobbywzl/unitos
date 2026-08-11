import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseBody } from "@/lib/validate";

const styleSchema = z.object({
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(0),
  style: z.enum(["bold", "italic"]),
});

type StyleSpan = { start: number; end: number; style: string; quotedText: string };

// Toggle an inline decoration span. Styling is a layer over the text, never
// markup inside it, so anchor offsets stay untouched (SPEC.md §5).
export async function POST(req: Request, ctx: { params: Promise<{ blockId: string }> }) {
  const { blockId } = await ctx.params;
  const { data, error } = await parseBody(req, styleSchema);
  if (error) return error;

  const block = await db.block.findUnique({ where: { id: blockId } });
  if (!block) return NextResponse.json({ error: "Block not found" }, { status: 404 });
  if (block.type === "TABLE" || block.type === "FIGURE") {
    return NextResponse.json({ error: "Only text blocks can be styled" }, { status: 400 });
  }
  if (data.endOffset <= data.startOffset || data.endOffset > block.text.length) {
    return NextResponse.json({ error: "Style offsets are invalid" }, { status: 400 });
  }

  const spans = (Array.isArray(block.styles) ? block.styles : []) as unknown as StyleSpan[];
  const existing = spans.findIndex(
    (s) => s.style === data.style && s.start === data.startOffset && s.end === data.endOffset,
  );
  const next =
    existing >= 0
      ? spans.filter((_, i) => i !== existing)
      : [
          ...spans,
          {
            start: data.startOffset,
            end: data.endOffset,
            style: data.style,
            quotedText: block.text.slice(data.startOffset, data.endOffset),
          },
        ];

  const updated = await db.block.update({ where: { id: blockId }, data: { styles: next } });
  return NextResponse.json(updated);
}

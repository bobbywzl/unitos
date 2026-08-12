import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sourceInputSchema } from "@/lib/anchors/input";
import { parseBody } from "@/lib/validate";

const createSchema = z.object({
  sectionId: z.string().min(1),
  content: z.string().min(1).max(50_000),
  source: sourceInputSchema.optional(),
  // Assistant-written notes carry their authorship, and land pending when the
  // user has not approved them one by one (Auto mode). Nothing enters notes
  // silently (SPEC.md §1).
  origin: z.enum(["assistant"]).optional(),
  pending: z.boolean().optional(),
});

// Manual notes, with an optional anchor (manual extract). Derived notes are created by /api/derive.
export async function POST(req: Request) {
  const { data, error } = await parseBody(req, createSchema);
  if (error) return error;

  const section = await db.section.findUnique({ where: { id: data.sectionId } });
  if (!section) return NextResponse.json({ error: "Section not found" }, { status: 404 });

  if (data.source) {
    const block = await db.block.findUnique({ where: { id: data.source.blockId } });
    if (!block || block.documentId !== data.source.documentId) {
      return NextResponse.json({ error: "Block not found" }, { status: 404 });
    }
    if (data.source.endOffset <= data.source.startOffset) {
      return NextResponse.json({ error: "Anchor offsets are invalid" }, { status: 400 });
    }
  }

  const count = await db.note.count({ where: { sectionId: data.sectionId } });
  const note = await db.note.create({
    data: {
      sectionId: data.sectionId,
      content: data.content,
      status: data.pending ? "PENDING" : "ACCEPTED",
      ...(data.origin === "assistant" ? { derivationType: "SYNTHESIS" as const } : {}),
      order: count,
      ...(data.source
        ? {
            sources: {
              create: {
                documentId: data.source.documentId,
                blockId: data.source.blockId,
                startOffset: data.source.startOffset,
                endOffset: data.source.endOffset,
                quotedText: data.source.quotedText,
                prefix: data.source.prefix,
                suffix: data.source.suffix,
              },
            },
          }
        : {}),
    },
    include: { sources: true },
  });
  return NextResponse.json(note, { status: 201 });
}

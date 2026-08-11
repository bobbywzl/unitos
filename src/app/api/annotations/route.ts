import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { annotationsSection } from "@/lib/derive/context";
import { parseBody } from "@/lib/validate";

const anchorSchema = z.object({
  blockId: z.string().min(1),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(0),
  quotedText: z.string().min(1).max(10_000),
  prefix: z.string().max(64),
  suffix: z.string().max(64),
});

const createSchema = z.object({
  notebookId: z.string().min(1),
  documentId: z.string().min(1),
  anchor: anchorSchema,
  color: z.enum(["clay", "sage", "gold"]).optional(),
  comment: z.string().max(10_000).optional(),
});

// Highlights and comments are notes in the hidden Annotations section.
// A highlight has a color and content = quotedText; a comment has color null and
// content = the comment text.
export async function POST(req: Request) {
  const { data, error } = await parseBody(req, createSchema);
  if (error) return error;

  const notebook = await db.notebook.findUnique({ where: { id: data.notebookId } });
  if (!notebook) return NextResponse.json({ error: "Notebook not found" }, { status: 404 });

  const document = await db.document.findUnique({ where: { id: data.documentId } });
  if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const section = await annotationsSection(data.notebookId);
  const order = await db.note.count({ where: { sectionId: section.id } });

  const comment = data.comment?.trim();
  const content = comment ? comment : data.anchor.quotedText.slice(0, 5000);
  const color = comment ? null : data.color ?? "clay";

  const note = await db.note.create({
    data: {
      sectionId: section.id,
      content,
      status: "ACCEPTED",
      color,
      order,
      sources: {
        create: {
          documentId: data.documentId,
          blockId: data.anchor.blockId,
          startOffset: data.anchor.startOffset,
          endOffset: data.anchor.endOffset,
          quotedText: data.anchor.quotedText,
          prefix: data.anchor.prefix,
          suffix: data.anchor.suffix,
        },
      },
    },
    include: { sources: true },
  });
  return NextResponse.json(note, { status: 201 });
}

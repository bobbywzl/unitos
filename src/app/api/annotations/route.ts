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
  color: z.enum(["clay", "sage", "gold", "plum"]).optional(),
  comment: z.string().max(10_000).optional(),
});

// Highlights and comments are notes in the hidden Annotations section.
// A highlight has a color and content = quotedText; a comment has color null and
// content = the comment text.
export async function POST(req: Request) {
  const { data, error } = await parseBody(req, createSchema);
  if (error) return error;

  if (data.comment !== undefined && !data.comment.trim()) {
    return NextResponse.json({ error: "Comment is empty" }, { status: 400 });
  }
  if (data.anchor.endOffset <= data.anchor.startOffset) {
    return NextResponse.json({ error: "Anchor offsets are invalid" }, { status: 400 });
  }

  const notebook = await db.notebook.findUnique({ where: { id: data.notebookId } });
  if (!notebook) return NextResponse.json({ error: "Notebook not found" }, { status: 404 });

  const attachment = await db.notebookDocument.findUnique({
    where: {
      notebookId_documentId: { notebookId: data.notebookId, documentId: data.documentId },
    },
  });
  if (!attachment) {
    return NextResponse.json({ error: "Document is not attached to this notebook" }, { status: 404 });
  }

  const block = await db.block.findUnique({ where: { id: data.anchor.blockId } });
  if (!block || block.documentId !== data.documentId) {
    return NextResponse.json({ error: "Block not found in this document" }, { status: 404 });
  }

  // Provenance is non-negotiable (SPEC.md §1): the quote must be the text at
  // those offsets, or the anchor is a lie and is rejected.
  if (
    data.anchor.endOffset > block.text.length ||
    block.text.slice(data.anchor.startOffset, data.anchor.endOffset) !== data.anchor.quotedText
  ) {
    return NextResponse.json(
      { error: "Anchor does not match the block text" },
      { status: 400 },
    );
  }

  const section = await annotationsSection(data.notebookId);
  const order = await db.note.count({ where: { sectionId: section.id } });

  // A highlight has a color; its content is the note when one was typed, else
  // the quote. A comment without a color stays a plain comment.
  const comment = data.comment?.trim();
  const content = comment ? comment : data.anchor.quotedText.slice(0, 5000);
  const color = data.color ?? (comment ? null : "clay");

  // The same highlight twice is one highlight, not two stacked cards.
  const duplicate = await db.note.findFirst({
    where: {
      sectionId: section.id,
      content,
      color,
      sources: {
        some: {
          blockId: data.anchor.blockId,
          startOffset: data.anchor.startOffset,
          endOffset: data.anchor.endOffset,
          orphaned: false,
        },
      },
    },
    include: { sources: true },
  });
  if (duplicate) return NextResponse.json(duplicate, { status: 200 });

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

import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { annotationsSection } from "@/lib/derive/context";
import { pageBlockText } from "@/lib/handwritten/pages";
import { serverT } from "@/lib/i18n/server";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { regionSchema, timeRangeSchema } from "@/lib/video/types";
import { videoAnchorFor } from "@/lib/video/anchor";
import { parseBody } from "@/lib/validate";

const anchorSchema = z.object({
  blockId: z.string().min(1),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(0),
  quotedText: z.string().min(1).max(10_000),
  prefix: z.string().max(64),
  suffix: z.string().max(64),
});

// A video annotation (SPEC.md §11): a time range, an optional drawn region,
// and the comment. The server picks the anchor block and the quoted text.
const videoSchema = z.object({
  startTime: z.number().min(0),
  endTime: z.number().min(0),
  region: regionSchema.optional(),
  comment: z.string().min(1).max(10_000),
});

// A page annotation (SPEC.md §14): a drawn region on a PAGE block and the
// comment. The server picks the quoted text.
const pageSchema = z.object({
  blockId: z.string().min(1),
  region: regionSchema,
  comment: z.string().min(1).max(10_000),
});

const createSchema = z
  .object({
    notebookId: z.string().min(1),
    documentId: z.string().min(1),
    anchor: anchorSchema.optional(),
    color: z.enum(["clay", "sage", "gold", "plum"]).optional(),
    comment: z.string().max(10_000).optional(),
    video: videoSchema.optional(),
    page: pageSchema.optional(),
  })
  .refine((d) => [d.anchor, d.video, d.page].filter(Boolean).length === 1, {
    message: "Provide exactly one of anchor, video, and page",
  });

// Highlights and comments are notes in the hidden Annotations section.
// A highlight has a color and content = quotedText; a comment has color null and
// content = the comment text. A video annotation is a comment whose source is a
// time range instead of a text span; a page annotation is a comment whose
// source is a drawn region on a PAGE block.
export async function POST(req: Request) {
  const t = await serverT();
  const { data, error } = await parseBody(req, createSchema);
  if (error) return error;

  if (data.comment !== undefined && !data.comment.trim()) {
    return NextResponse.json({ error: t("api.commentEmpty") }, { status: 400 });
  }

  const notebook = await db.notebook.findUnique({ where: { id: data.notebookId } });
  if (!notebook) return NextResponse.json({ error: t("api.corpusNotFound") }, { status: 404 });
  const access = await notebookAccess(data.notebookId, "editor");
  if (access instanceof NextResponse) return access;

  const attachment = await db.notebookDocument.findUnique({
    where: {
      notebookId_documentId: { notebookId: data.notebookId, documentId: data.documentId },
    },
  });
  if (!attachment) {
    return NextResponse.json({ error: t("api.documentNotAttachedToCorpus") }, { status: 404 });
  }

  if (data.page) return createPageAnnotation(data.notebookId, data.documentId, data.page, access.user.id, t);
  if (data.video) return createVideoAnnotation(data.notebookId, data.documentId, data.video, access.user.id, t);
  if (!data.anchor) return NextResponse.json({ error: t("api.anchorMissing") }, { status: 400 });
  if (data.anchor.endOffset <= data.anchor.startOffset) {
    return NextResponse.json({ error: t("api.anchorOffsetsInvalid") }, { status: 400 });
  }

  const block = await db.block.findUnique({ where: { id: data.anchor.blockId } });
  if (!block || block.documentId !== data.documentId) {
    return NextResponse.json({ error: t("api.blockNotInDocument") }, { status: 404 });
  }

  // Provenance is non-negotiable (SPEC.md §1): the quote must be the text at
  // those offsets, or the anchor is a lie and is rejected.
  if (
    data.anchor.endOffset > block.text.length ||
    block.text.slice(data.anchor.startOffset, data.anchor.endOffset) !== data.anchor.quotedText
  ) {
    return NextResponse.json({ error: t("api.anchorMismatch") }, { status: 400 });
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
      createdById: access.user.id,
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
  await bumpNotebook(data.notebookId);
  return NextResponse.json(note, { status: 201 });
}

// A page annotation: a comment note whose source carries the drawn region on
// a PAGE block (SPEC.md §14). The server picks the quoted text.
async function createPageAnnotation(
  notebookId: string,
  documentId: string,
  page: z.infer<typeof pageSchema>,
  createdById: string,
  t: TFunc,
) {
  const block = await db.block.findUnique({
    where: { id: page.blockId },
    select: { documentId: true, type: true, page: true },
  });
  if (!block || block.documentId !== documentId || block.type !== "PAGE" || block.page === null) {
    return NextResponse.json({ error: t("api.blockNotInDocument") }, { status: 404 });
  }

  const section = await annotationsSection(notebookId);
  const order = await db.note.count({ where: { sectionId: section.id } });
  const note = await db.note.create({
    data: {
      sectionId: section.id,
      content: page.comment.trim(),
      status: "ACCEPTED",
      createdById,
      order,
      sources: {
        create: {
          documentId,
          blockId: page.blockId,
          startOffset: 0,
          endOffset: 0,
          quotedText: pageBlockText(block.page),
          prefix: "",
          suffix: "",
          region: page.region,
        },
      },
    },
    include: { sources: true },
  });
  await bumpNotebook(notebookId);
  return NextResponse.json(note, { status: 201 });
}

// A video annotation: a comment note whose source carries the time range and
// the drawn region. The server picks the anchor block and the quoted text.
async function createVideoAnnotation(
  notebookId: string,
  documentId: string,
  video: z.infer<typeof videoSchema>,
  createdById: string,
  t: TFunc,
) {
  if (!timeRangeSchema.safeParse(video).success) {
    return NextResponse.json({ error: t("api.endBeforeStart") }, { status: 400 });
  }
  const asset = await db.videoAsset.findUnique({
    where: { documentId },
    select: { duration: true },
  });
  if (!asset) {
    return NextResponse.json({ error: t("api.noVideo") }, { status: 404 });
  }
  const { startTime } = video;
  let endTime = video.endTime;
  if (asset.duration !== null) {
    if (startTime >= asset.duration) {
      return NextResponse.json({ error: t("api.startPastVideoEnd") }, { status: 400 });
    }
    endTime = Math.min(endTime, asset.duration);
  }
  const anchor = await videoAnchorFor(documentId, startTime, endTime);
  if (!anchor) {
    return NextResponse.json({ error: t("api.noVideoBlock") }, { status: 404 });
  }

  const section = await annotationsSection(notebookId);
  const order = await db.note.count({ where: { sectionId: section.id } });
  const note = await db.note.create({
    data: {
      sectionId: section.id,
      content: video.comment.trim(),
      status: "ACCEPTED",
      createdById,
      order,
      sources: {
        create: {
          documentId,
          blockId: anchor.blockId,
          startOffset: 0,
          endOffset: 0,
          quotedText: anchor.quotedText,
          prefix: "",
          suffix: "",
          startTime,
          endTime,
          region: video.region,
        },
      },
    },
    include: { sources: true },
  });
  await bumpNotebook(notebookId);
  return NextResponse.json(note, { status: 201 });
}

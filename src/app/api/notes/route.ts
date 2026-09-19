import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpNotebook, sectionAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { sourceInputSchema } from "@/lib/anchors/input";
import { MAX_SEGMENTS, passageSources, resolvePassage } from "@/lib/anchors/passage";
import { documentBlocks, type ResolvedAnchor } from "@/lib/anchors/resolve";
import { serverT } from "@/lib/i18n/server";
import { normalizeNoteOrders } from "@/lib/order";
import { videoAnchorFor } from "@/lib/video/anchor";
import { timeRangeSchema } from "@/lib/video/types";
import { parseBody } from "@/lib/validate";

const createSchema = z
  .object({
    sectionId: z.string().min(1),
    content: z.string().min(1).max(50_000).optional(),
    // A note made of an annotation (SPEC.md §6): the annotation's text and
    // anchors are copied into the new note, and the annotation stays where
    // it is, still painted in the article. content is then not sent.
    fromAnnotationId: z.string().min(1).optional(),
    source: sourceInputSchema.optional(),
    // A selection over several blocks of the source's document
    // (lib/anchors/passage.ts): one anchor per block, the first being
    // `source`; every segment becomes a source of the note.
    segments: z.array(sourceInputSchema.omit({ documentId: true })).min(1).max(MAX_SEGMENTS).optional(),
    // A video source (SPEC.md §11): a time range; the server picks the anchor
    // block and the quoted text. Used by Find's "Add to notes".
    video: z
      .object({
        documentId: z.string().min(1),
        startTime: z.number().min(0),
        endTime: z.number().min(0),
      })
      .optional(),
    // Assistant-written notes carry their authorship, and land pending when the
    // user has not approved them one by one (Auto mode). Find, distill, ask,
    // and voice results always land pending. Nothing enters notes silently
    // (SPEC.md §1).
    origin: z.enum(["assistant", "find", "distill", "ask", "voice"]).optional(),
    pending: z.boolean().optional(),
    // A note written in a section's composer lands at the top of the section
    // (SPEC.md §6); everything else lands at the end.
    top: z.boolean().optional(),
  })
  .refine((d) => !(d.source && d.video), { message: "Provide source or video, not both" })
  .refine((d) => Boolean(d.content) !== Boolean(d.fromAnnotationId), {
    message: "Provide content or fromAnnotationId, not both",
  });

// Manual notes, with an optional anchor (manual extract). Derived notes are created by /api/derive.
export async function POST(req: Request) {
  const t = await serverT();
  const { data, error } = await parseBody(req, createSchema);
  if (error) return error;

  const section = await db.section.findUnique({ where: { id: data.sectionId } });
  if (!section) return NextResponse.json({ error: t("api.sectionNotFound") }, { status: 404 });
  const access = await sectionAccess(data.sectionId, "editor");
  if (access instanceof NextResponse) return access;

  // The source resolves through the ladder (SPEC.md §5): block id and offsets,
  // then the quote inside the block, then the quote across the document — a
  // re-parse gives every block a new id while an open reader still sends the
  // old ones.
  let sources: (ResolvedAnchor & { documentId: string })[] = [];
  if (data.source) {
    if (data.source.endOffset <= data.source.startOffset) {
      return NextResponse.json({ error: t("api.anchorOffsetsInvalid") }, { status: 400 });
    }
    const passage = resolvePassage(await documentBlocks(data.source.documentId), data.source, data.segments);
    if (passage.length === 0) {
      return NextResponse.json({ error: t("api.anchorNotResolvedInDocument") }, { status: 400 });
    }
    sources = passageSources(data.source.documentId, passage);
  }

  let videoSource: {
    documentId: string;
    blockId: string;
    quotedText: string;
    startTime: number;
    endTime: number;
  } | null = null;
  if (data.video) {
    if (!timeRangeSchema.safeParse(data.video).success) {
      return NextResponse.json({ error: t("api.endBeforeStart") }, { status: 400 });
    }
    const anchor = await videoAnchorFor(data.video.documentId, data.video.startTime, data.video.endTime);
    if (!anchor) {
      return NextResponse.json({ error: t("api.noVideoBlock") }, { status: 404 });
    }
    videoSource = {
      documentId: data.video.documentId,
      blockId: anchor.blockId,
      quotedText: anchor.quotedText,
      startTime: data.video.startTime,
      endTime: data.video.endTime,
    };
  }

  const ORIGIN_TYPE = {
    assistant: "SYNTHESIS",
    find: "FIND",
    distill: "DISTILL",
    ask: "ASK",
    voice: "VOICE",
  } as const;
  const derivationType = data.origin ? ORIGIN_TYPE[data.origin] : undefined;
  const alwaysPending = data.origin !== undefined && data.origin !== "assistant";

  // From an annotation: its text, and copies of its anchors, so the note and
  // the annotation stay anchored to the same words (SPEC.md §5).
  let content = data.content ?? "";
  let copiedSources: {
    documentId: string;
    blockId: string;
    startOffset: number;
    endOffset: number;
    quotedText: string;
    prefix: string;
    suffix: string;
    orphaned: boolean;
    startTime: number | null;
    endTime: number | null;
    region?: Prisma.InputJsonValue;
  }[] = [];
  if (data.fromAnnotationId) {
    const annotation = await db.note.findUnique({
      where: { id: data.fromAnnotationId },
      include: { sources: true, section: { select: { hidden: true, notebookId: true } } },
    });
    if (!annotation || !annotation.section.hidden || annotation.section.notebookId !== section.notebookId) {
      return NextResponse.json({ error: t("api.noteNotFound") }, { status: 404 });
    }
    content = annotation.content;
    copiedSources = annotation.sources.map((source) => ({
      documentId: source.documentId,
      blockId: source.blockId,
      startOffset: source.startOffset,
      endOffset: source.endOffset,
      quotedText: source.quotedText,
      prefix: source.prefix,
      suffix: source.suffix,
      orphaned: source.orphaned,
      startTime: source.startTime,
      endTime: source.endTime,
      ...(source.region === null ? {} : { region: source.region as Prisma.InputJsonValue }),
    }));
  }
  if (!content.trim()) return NextResponse.json({ error: t("api.validationFailed") }, { status: 400 });

  const count = await db.note.count({ where: { sectionId: data.sectionId } });
  const note = await db.note.create({
    data: {
      sectionId: data.sectionId,
      content,
      // Find, distill, ask, and voice output is AI output: it lands PENDING, no exceptions (SPEC.md §1).
      status: data.pending || alwaysPending ? "PENDING" : "ACCEPTED",
      ...(derivationType ? { derivationType } : {}),
      createdById: access.user.id,
      // Top: before every sibling; the normalize below makes the orders 0..n again.
      order: data.top ? -1 : count,
      ...(sources.length > 0 ? { sources: { create: sources } } : {}),
      ...(copiedSources.length > 0 ? { sources: { create: copiedSources } } : {}),
      ...(videoSource
        ? {
            sources: {
              create: {
                documentId: videoSource.documentId,
                blockId: videoSource.blockId,
                startOffset: 0,
                endOffset: 0,
                quotedText: videoSource.quotedText,
                prefix: "",
                suffix: "",
                startTime: videoSource.startTime,
                endTime: videoSource.endTime,
              },
            },
          }
        : {}),
    },
    include: { sources: true },
  });
  if (data.top) await normalizeNoteOrders(data.sectionId);
  await bumpNotebook(section.notebookId);
  return NextResponse.json(note, { status: 201 });
}

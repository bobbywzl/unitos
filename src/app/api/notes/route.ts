import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sourceInputSchema } from "@/lib/anchors/input";
import { serverT } from "@/lib/i18n/server";
import { videoAnchorFor } from "@/lib/video/anchor";
import { timeRangeSchema } from "@/lib/video/types";
import { parseBody } from "@/lib/validate";

const createSchema = z
  .object({
    sectionId: z.string().min(1),
    content: z.string().min(1).max(50_000),
    source: sourceInputSchema.optional(),
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
    // user has not approved them one by one (Auto mode). Find and distill
    // results always land pending. Nothing enters notes silently (SPEC.md §1).
    origin: z.enum(["assistant", "find", "distill"]).optional(),
    pending: z.boolean().optional(),
  })
  .refine((d) => !(d.source && d.video), { message: "Provide source or video, not both" });

// Manual notes, with an optional anchor (manual extract). Derived notes are created by /api/derive.
export async function POST(req: Request) {
  const t = await serverT();
  const { data, error } = await parseBody(req, createSchema);
  if (error) return error;

  const section = await db.section.findUnique({ where: { id: data.sectionId } });
  if (!section) return NextResponse.json({ error: t("api.sectionNotFound") }, { status: 404 });

  if (data.source) {
    const block = await db.block.findUnique({ where: { id: data.source.blockId } });
    if (!block || block.documentId !== data.source.documentId) {
      return NextResponse.json({ error: t("api.blockNotFound") }, { status: 404 });
    }
    if (data.source.endOffset <= data.source.startOffset) {
      return NextResponse.json({ error: t("api.anchorOffsetsInvalid") }, { status: 400 });
    }
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

  const derivationType =
    data.origin === "assistant"
      ? ("SYNTHESIS" as const)
      : data.origin === "find"
        ? ("FIND" as const)
        : data.origin === "distill"
          ? ("DISTILL" as const)
          : undefined;
  const count = await db.note.count({ where: { sectionId: data.sectionId } });
  const note = await db.note.create({
    data: {
      sectionId: data.sectionId,
      content: data.content,
      // Find and distill output is AI output: it lands PENDING, no exceptions (SPEC.md §1).
      status: data.pending || data.origin === "find" || data.origin === "distill" ? "PENDING" : "ACCEPTED",
      ...(derivationType ? { derivationType } : {}),
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
  return NextResponse.json(note, { status: 201 });
}

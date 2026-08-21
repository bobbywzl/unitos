import { anthropic } from "@ai-sdk/anthropic";
import { streamText, type ModelMessage } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  DERIVATION_MODEL,
  MAX_OUTPUT_TOKENS,
  STREAM_ERROR_TOKEN,
  STREAM_NOTE_TOKEN,
} from "@/lib/derive/config";
import {
  anchorContext,
  annotationsSection,
  documentPrefix,
  loadProfile,
  sectionSkeleton,
} from "@/lib/derive/context";
import { fetchFigureImage, figureContent, type FigureImage } from "@/lib/derive/figure";
import {
  extractOutputSchema,
  findOutputSchema,
  resolveSpan,
  salienceOutputSchema,
} from "@/lib/derive/json";
import { callForJson, modelErrorMessage } from "@/lib/derive/json-call";
import { promptTemplates } from "@/lib/prompts";
import type { PromptCtx } from "@/lib/prompts/types";
import { SUMMARY_DEPTHS, type SummaryLevels } from "@/lib/types";
import { videoAnchorFor } from "@/lib/video/anchor";
import {
  formatTimeRange,
  regionSchema,
  timeRangeSchema,
  type VideoFindMatch,
} from "@/lib/video/types";
import { parseBody } from "@/lib/validate";

export const maxDuration = 120;

// The one derivation pipeline (SPEC.md §4). Never fork per feature: new derivation =
// new prompt template + destination handler below.
const deriveSchema = z.object({
  type: z.enum(["EXPLAIN", "SIMPLIFY", "SALIENCE", "EXTRACT", "SUMMARIZE", "FIND"]),
  documentId: z.string().min(1),
  notebookId: z.string().min(1),
  anchor: z
    .object({
      blockId: z.string().min(1),
      startOffset: z.number().int().min(0),
      endOffset: z.number().int().min(0),
    })
    .optional(),
  targetSectionId: z.string().min(1).nullish(),
  depth: z.enum(SUMMARY_DEPTHS).optional(), // SUMMARIZE only
  query: z.string().min(1).max(500).optional(), // FIND only
  // EXPLAIN on a video moment (SPEC.md §11): the time range, the drawn region,
  // and the paused frame as a JPEG data URL when the client could capture it.
  video: z
    .object({
      startTime: z.number().min(0),
      endTime: z.number().min(0),
      region: regionSchema.optional(),
      frame: z
        .string()
        .startsWith("data:image/jpeg;base64,")
        .max(2_000_000)
        .optional(),
    })
    .optional(),
});

const ANCHOR_REQUIRED = new Set(["EXPLAIN", "SIMPLIFY", "EXTRACT"]);

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set. Derivations need it." },
      { status: 503 },
    );
  }

  const { data, error } = await parseBody(req, deriveSchema);
  if (error) return error;

  const template = promptTemplates[data.type];
  if (!template) {
    return NextResponse.json({ error: `${data.type} is not built yet` }, { status: 501 });
  }
  // A video anchor stands in for a text anchor on EXPLAIN (SPEC.md §11).
  if (ANCHOR_REQUIRED.has(data.type) && !data.anchor && !(data.type === "EXPLAIN" && data.video)) {
    return NextResponse.json({ error: `${data.type} requires an anchor` }, { status: 400 });
  }
  if (data.type === "FIND" && !data.query) {
    return NextResponse.json({ error: "FIND requires a query" }, { status: 400 });
  }
  if (data.video && !timeRangeSchema.safeParse(data.video).success) {
    return NextResponse.json({ error: "The end must be after the start" }, { status: 400 });
  }

  const attachment = await db.notebookDocument.findUnique({
    where: {
      notebookId_documentId: { notebookId: data.notebookId, documentId: data.documentId },
    },
  });
  if (!attachment) {
    return NextResponse.json({ error: "Document is not attached to this corpus" }, { status: 404 });
  }

  // 1. Load document blocks (the cached prompt prefix), profile, section skeleton.
  const document = await db.document.findUnique({
    where: { id: data.documentId },
    include: { blocks: { orderBy: { order: "asc" }, select: { id: true, type: true, text: true, startTime: true, endTime: true } } },
  });
  if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  const blockById = new Map(document.blocks.map((b) => [b.id, { id: b.id, text: b.text }]));

  let anchored: ReturnType<typeof anchorContext> = null;
  if (data.anchor) {
    anchored = anchorContext(
      document.blocks,
      data.anchor.blockId,
      data.anchor.startOffset,
      data.anchor.endOffset,
    );
    if (!anchored || !anchored.anchoredText.trim()) {
      return NextResponse.json({ error: "Anchor does not resolve in this document" }, { status: 400 });
    }
  }

  const [profile, skeleton] = await Promise.all([
    loadProfile(data.notebookId),
    sectionSkeleton(data.notebookId),
  ]);

  if (data.targetSectionId && !skeleton.some((s) => s.id === data.targetSectionId)) {
    return NextResponse.json({ error: "Target section not found" }, { status: 404 });
  }

  const depth = data.depth ?? "layman";
  const ctx: PromptCtx & { targetSectionId?: string | null } = {
    profile,
    documentTitle: document.title,
    anchoredText: anchored?.anchoredText ?? "",
    contextBefore: anchored?.contextBefore ?? "",
    contextAfter: anchored?.contextAfter ?? "",
    sectionSkeleton: skeleton,
    targetSectionId: data.targetSectionId,
    depth,
    query: data.query,
  };

  // FIND searches the transcript; without one there is nothing to search.
  const timedBlocks = document.blocks.filter(
    (b) => b.type === "TRANSCRIPT" && b.startTime !== null && b.endTime !== null,
  );
  if (data.type === "FIND" && timedBlocks.length === 0) {
    return NextResponse.json(
      { error: "Transcribe the video first — Find searches the transcript" },
      { status: 400 },
    );
  }

  // EXPLAIN on a video moment: the anchor is the time range; the frame rides
  // along as an image when the client could capture it.
  let videoAnchor: { blockId: string; quotedText: string } | null = null;
  let frameImage: Uint8Array | null = null;
  if (data.type === "EXPLAIN" && data.video) {
    videoAnchor = await videoAnchorFor(document.id, data.video.startTime, data.video.endTime);
    if (!videoAnchor) {
      return NextResponse.json({ error: "This document has no video block" }, { status: 400 });
    }
    if (data.video.frame) {
      frameImage = new Uint8Array(
        Buffer.from(data.video.frame.slice("data:image/jpeg;base64,".length), "base64"),
      );
      if (frameImage.length === 0) frameImage = null;
    }
    const excerpt = timedBlocks
      .filter((b) => b.startTime! < data.video!.endTime && b.endTime! > data.video!.startTime)
      .map((b) => b.text)
      .join(" ");
    ctx.video = {
      timeRange: formatTimeRange(data.video.startTime, data.video.endTime),
      transcriptExcerpt: excerpt.length > 1500 ? `${excerpt.slice(0, 1499)}…` : excerpt,
      hasFrame: frameImage !== null,
      hasRegion: Boolean(data.video.region),
    };
  }

  // EXPLAIN on a figure block: the model deciphers the visual. An image figure
  // attaches its image bytes (fetched here — a failed fetch degrades to
  // caption and context, never fails the request); an SVG chart attaches its
  // source; a video figure explains from caption and context only.
  let figureImage: FigureImage | null = null;
  if (data.type === "EXPLAIN" && data.anchor) {
    const anchoredBlock = await db.block.findUnique({
      where: { id: data.anchor.blockId },
      select: { type: true, html: true, text: true },
    });
    const figure = figureContent(anchoredBlock);
    if (figure) {
      if (figure.imageUrl) figureImage = await fetchFigureImage(figure.imageUrl, document.sourceUrl);
      ctx.figure = {
        // An image figure whose image could not be fetched is a plain figure:
        // the prompt must never claim an attachment that is not there.
        kind: figure.kind === "image" && !figureImage ? "figure" : figure.kind,
        caption: figure.caption,
        svgSource: figure.svgSource,
      };
    }
  }

  // 2. Template by type. The document is the cached prefix, byte-identical for every
  // derivation on this document (SPEC.md §2).
  const attachedImage = figureImage
    ? { bytes: figureImage.bytes, mediaType: figureImage.mediaType }
    : frameImage
      ? { bytes: frameImage, mediaType: "image/jpeg" }
      : null;
  const messages: ModelMessage[] = [
    {
      role: "system",
      content: documentPrefix(document.title, document.blocks, document.references),
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
    attachedImage
      ? {
          role: "user",
          content: [
            { type: "text", text: template(ctx) },
            { type: "image", image: attachedImage.bytes, mediaType: attachedImage.mediaType },
          ],
        }
      : { role: "user", content: template(ctx) },
  ];
  const model = anthropic(DERIVATION_MODEL[data.type]);
  const maxOutputTokens = MAX_OUTPUT_TOKENS[data.type];

  // 3 + 4. Stream or collect, then route by destination.
  // EXPLAIN, SIMPLIFY, and SUMMARIZE stream text. SALIENCE and EXTRACT return validated JSON.
  if (data.type === "EXPLAIN" || data.type === "SIMPLIFY" || data.type === "SUMMARIZE") {
    const result = streamText({
      model,
      maxOutputTokens,
      allowSystemInMessages: true,
      messages,
      onEnd: async ({ text, usage }) => {
        console.log(
          `[derive] ${data.type} cacheRead=${usage.inputTokenDetails.cacheReadTokens ?? 0} ` +
            `cacheWrite=${usage.inputTokenDetails.cacheWriteTokens ?? 0} ` +
            `output=${usage.outputTokens ?? 0}`,
        );
        // SUMMARIZE persists per notebook+document+depth, so reopening the
        // Summary tab does not re-pay tokens. Regenerate overwrites the depth.
        if (data.type === "SUMMARIZE" && text.trim()) {
          const where = {
            notebookId_documentId: { notebookId: data.notebookId, documentId: data.documentId },
          };
          const nd = await db.notebookDocument.findUnique({ where, select: { summaries: true } });
          const current = (nd?.summaries ?? {}) as SummaryLevels;
          await db.notebookDocument.update({
            where,
            data: { summaries: { ...current, [depth]: text } },
          });
        }
      },
      onError: (err) => {
        console.error("[derive] stream error:", err);
      },
    });
    // The stream commits HTTP 200 when it opens, so a failure after that
    // reports in-band: the stream ends with STREAM_ERROR_TOKEN + the reason,
    // and the client shows it. A failed stream persists nothing.
    // EXPLAIN and SIMPLIFY persist in the hidden Annotations section before the
    // stream closes, then the stream ends with STREAM_NOTE_TOKEN + the note id:
    // the client's refresh always finds the stored mark, and the card can
    // delete its annotation in place.
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let text = "";
        try {
          for await (const chunk of result.textStream) {
            text += chunk;
            controller.enqueue(encoder.encode(chunk));
          }
        } catch (err) {
          controller.enqueue(encoder.encode(`${STREAM_ERROR_TOKEN}${modelErrorMessage(err)}`));
          controller.close();
          return;
        }
        if ((data.type === "EXPLAIN" || data.type === "SIMPLIFY") && data.anchor && text.trim()) {
          try {
            const block = blockById.get(data.anchor.blockId);
            if (block) {
              const section = await annotationsSection(data.notebookId);
              const count = await db.note.count({ where: { sectionId: section.id } });
              const note = await db.note.create({
                data: {
                  sectionId: section.id,
                  content: text,
                  status: "ACCEPTED",
                  derivationType: data.type,
                  order: count,
                  sources: {
                    create: {
                      documentId: data.documentId,
                      blockId: data.anchor.blockId,
                      startOffset: data.anchor.startOffset,
                      endOffset: data.anchor.endOffset,
                      quotedText: block.text.slice(data.anchor.startOffset, data.anchor.endOffset),
                      prefix: block.text.slice(
                        Math.max(0, data.anchor.startOffset - 32),
                        data.anchor.startOffset,
                      ),
                      suffix: block.text.slice(data.anchor.endOffset, data.anchor.endOffset + 32),
                    },
                  },
                },
              });
              controller.enqueue(encoder.encode(`${STREAM_NOTE_TOKEN}${note.id}`));
            }
          } catch (err) {
            console.error("[derive] annotation save failed:", err);
            controller.enqueue(
              encoder.encode(`${STREAM_ERROR_TOKEN}The annotation did not save. Try again.`),
            );
          }
        }
        // A video EXPLAIN persists with its time anchor, so the explained
        // moment joins the overlay and the deck (SPEC.md §11).
        if (data.type === "EXPLAIN" && data.video && videoAnchor && text.trim()) {
          try {
            const section = await annotationsSection(data.notebookId);
            const count = await db.note.count({ where: { sectionId: section.id } });
            const note = await db.note.create({
              data: {
                sectionId: section.id,
                content: text,
                status: "ACCEPTED",
                derivationType: "EXPLAIN",
                order: count,
                sources: {
                  create: {
                    documentId: data.documentId,
                    blockId: videoAnchor.blockId,
                    startOffset: 0,
                    endOffset: 0,
                    quotedText: videoAnchor.quotedText,
                    prefix: "",
                    suffix: "",
                    startTime: data.video.startTime,
                    endTime: data.video.endTime,
                    region: data.video.region,
                  },
                },
              },
            });
            controller.enqueue(encoder.encode(`${STREAM_NOTE_TOKEN}${note.id}`));
          } catch (err) {
            console.error("[derive] annotation save failed:", err);
            controller.enqueue(
              encoder.encode(`${STREAM_ERROR_TOKEN}The annotation did not save. Try again.`),
            );
          }
        }
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // FIND: matches reference transcript blocks; resolve them to time ranges.
  // Renders as seekable cards — never persisted without the user (SPEC.md §11).
  if (data.type === "FIND") {
    const result = await callForJson({
      model,
      messages,
      maxOutputTokens,
      schema: findOutputSchema,
      label: "FIND",
    });
    if (!result.ok) {
      return NextResponse.json({ error: `Find failed. ${result.error}` }, { status: 422 });
    }
    const timedById = new Map(timedBlocks.map((b) => [b.id, b]));
    const matches: VideoFindMatch[] = [];
    for (const match of result.data.matches) {
      const blocks = match.blockIds
        .map((id) => timedById.get(id))
        .filter((b) => b !== undefined);
      if (blocks.length === 0) continue;
      const text = blocks.map((b) => b.text).join(" ");
      matches.push({
        startTime: Math.min(...blocks.map((b) => b.startTime!)),
        endTime: Math.max(...blocks.map((b) => b.endTime!)),
        explanation: match.explanation,
        quotedText: text.length > 240 ? `${text.slice(0, 239)}…` : text,
        blockIds: blocks.map((b) => b.id),
      });
    }
    return NextResponse.json({ ok: true, matches });
  }

  if (data.type === "SALIENCE") {
    const result = await callForJson({
      model,
      messages,
      maxOutputTokens,
      schema: salienceOutputSchema,
      label: "SALIENCE",
    });
    if (!result.ok) {
      return NextResponse.json({ error: `Salience failed. ${result.error}` }, { status: 422 });
    }
    const spans = result.data.spans
      .map((s) => resolveSpan(s, blockById))
      .filter((s) => s !== null);
    if (spans.length === 0) {
      return NextResponse.json({ error: "Salience returned no resolvable spans" }, { status: 422 });
    }
    await db.notebookDocument.update({
      where: {
        notebookId_documentId: { notebookId: data.notebookId, documentId: data.documentId },
      },
      data: { salience: spans },
    });
    return NextResponse.json({ ok: true, spanCount: spans.length });
  }

  // EXTRACT
  const result = await callForJson({
    model,
    messages,
    maxOutputTokens,
    schema: extractOutputSchema,
    label: "EXTRACT",
  });
  if (!result.ok) {
    return NextResponse.json({ error: `Extract failed. ${result.error}` }, { status: 422 });
  }
  const sectionId = data.targetSectionId ?? result.data.sectionId;
  if (!skeleton.some((s) => s.id === sectionId)) {
    return NextResponse.json({ error: "Extract proposed an unknown section" }, { status: 422 });
  }
  const spans = result.data.quotedSpans
    .map((s) => resolveSpan(s, blockById))
    .filter((s) => s !== null);
  if (spans.length === 0) {
    return NextResponse.json({ error: "Extract returned no resolvable spans" }, { status: 422 });
  }
  const count = await db.note.count({ where: { sectionId } });
  const note = await db.note.create({
    data: {
      sectionId,
      content: result.data.content,
      status: "PENDING", // user approves everything (SPEC.md §1)
      derivationType: "EXTRACT",
      order: count,
      sources: {
        createMany: {
          data: spans.map((s) => ({
            documentId: data.documentId,
            blockId: s.blockId,
            startOffset: s.start,
            endOffset: s.end,
            quotedText: s.quotedText,
            prefix: s.prefix,
            suffix: s.suffix,
          })),
        },
      },
    },
  });
  return NextResponse.json({ ok: true, noteId: note.id, sectionId }, { status: 201 });
}

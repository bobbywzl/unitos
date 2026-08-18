import { anthropic } from "@ai-sdk/anthropic";
import { streamText, type ModelMessage } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { DERIVATION_MODEL, MAX_OUTPUT_TOKENS, STREAM_ERROR_TOKEN } from "@/lib/derive/config";
import {
  anchorContext,
  annotationsSection,
  documentPrefix,
  loadProfile,
  sectionSkeleton,
} from "@/lib/derive/context";
import { fetchFigureImage, figureContent, type FigureImage } from "@/lib/derive/figure";
import { extractOutputSchema, resolveSpan, salienceOutputSchema } from "@/lib/derive/json";
import { callForJson, modelErrorMessage } from "@/lib/derive/json-call";
import { promptTemplates } from "@/lib/prompts";
import type { PromptCtx } from "@/lib/prompts/types";
import { SUMMARY_DEPTHS, type SummaryLevels } from "@/lib/types";
import { parseBody } from "@/lib/validate";

export const maxDuration = 120;

// The one derivation pipeline (SPEC.md §4). Never fork per feature: new derivation =
// new prompt template + destination handler below.
const deriveSchema = z.object({
  type: z.enum(["EXPLAIN", "SIMPLIFY", "SALIENCE", "EXTRACT", "SUMMARIZE"]),
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
  if (ANCHOR_REQUIRED.has(data.type) && !data.anchor) {
    return NextResponse.json({ error: `${data.type} requires an anchor` }, { status: 400 });
  }

  const attachment = await db.notebookDocument.findUnique({
    where: {
      notebookId_documentId: { notebookId: data.notebookId, documentId: data.documentId },
    },
  });
  if (!attachment) {
    return NextResponse.json({ error: "Document is not attached to this notebook" }, { status: 404 });
  }

  // 1. Load document blocks (the cached prompt prefix), profile, section skeleton.
  const document = await db.document.findUnique({
    where: { id: data.documentId },
    include: { blocks: { orderBy: { order: "asc" }, select: { id: true, type: true, text: true } } },
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
  };

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
  const messages: ModelMessage[] = [
    {
      role: "system",
      content: documentPrefix(document.title, document.blocks, document.references),
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
    figureImage
      ? {
          role: "user",
          content: [
            { type: "text", text: template(ctx) },
            { type: "image", image: figureImage.bytes, mediaType: figureImage.mediaType },
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
        // EXPLAIN and SIMPLIFY persist in the hidden Annotations section, so
        // the output is still there when the reader leaves and comes back.
        if ((data.type === "EXPLAIN" || data.type === "SIMPLIFY") && data.anchor && text.trim()) {
          const block = blockById.get(data.anchor.blockId);
          if (!block) return;
          const section = await annotationsSection(data.notebookId);
          const count = await db.note.count({ where: { sectionId: section.id } });
          await db.note.create({
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
        }
      },
      onError: (err) => {
        console.error("[derive] stream error:", err);
      },
    });
    // The stream commits HTTP 200 when it opens, so a failure after that
    // reports in-band: the stream ends with STREAM_ERROR_TOKEN + the reason,
    // and the client shows it. A failed stream persists nothing.
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of result.textStream) {
            controller.enqueue(encoder.encode(chunk));
          }
        } catch (err) {
          controller.enqueue(encoder.encode(`${STREAM_ERROR_TOKEN}${modelErrorMessage(err)}`));
        }
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
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

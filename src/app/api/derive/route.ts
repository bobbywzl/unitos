import { anthropic } from "@ai-sdk/anthropic";
import { streamText, type ModelMessage } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
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
  corpusSection,
  documentPrefix,
  loadProfile,
  renderBlockLines,
  sectionSkeleton,
} from "@/lib/derive/context";
import { fetchFigureImage, figureContent, type FigureImage } from "@/lib/derive/figure";
import {
  distillOutputSchema,
  extractOutputSchema,
  findOutputSchema,
  formalizeArticleSchema,
  formalizeNotesSchema,
  resolveSpan,
  salienceOutputSchema,
} from "@/lib/derive/json";
import { callForJson, modelErrorMessage } from "@/lib/derive/json-call";
import { serverT } from "@/lib/i18n/server";
import { promptTemplates } from "@/lib/prompts";
import { corpusDistillPrompt } from "@/lib/prompts/distill";
import type { PromptCtx } from "@/lib/prompts/types";
import {
  corpusDistillationList,
  distillationList,
  extractionList,
  FORMALIZE_FORMATS,
  formalizedArticle,
  SUMMARY_DEPTHS,
  type CorpusDistillation,
  type Distillation,
  type Extraction,
  type FormalizedArticle,
  type SummaryLevels,
} from "@/lib/types";
import { materializeArticle } from "@/lib/video/article-document";
import { videoAnchorFor } from "@/lib/video/anchor";
import { describeYouTubeClip } from "@/lib/video/gemini";
import {
  formatTimeRange,
  isAudioMime,
  regionSchema,
  timeRangeSchema,
  type VideoFindMatch,
} from "@/lib/video/types";
import { recordUsage, sdkTokens } from "@/lib/usage";
import { parseBody } from "@/lib/validate";

export const maxDuration = 120;

// The one derivation pipeline (SPEC.md §4). Never fork per feature: new derivation =
// new prompt template + destination handler below.
const deriveSchema = z
  .object({
  type: z.enum(["EXPLAIN", "SIMPLIFY", "SALIENCE", "EXTRACT", "DISTILL", "SUMMARIZE", "FIND", "FORMALIZE"]),
  // Absent only for corpus-scope DISTILL, which reads every document.
  documentId: z.string().min(1).optional(),
  // DISTILL only: "corpus" scans every document in the corpus (SPEC.md §13).
  scope: z.enum(["document", "corpus"]).optional(),
  notebookId: z.string().min(1),
  anchor: z
    .object({
      blockId: z.string().min(1),
      startOffset: z.number().int().min(0),
      endOffset: z.number().int().min(0),
    })
    .optional(),
  depth: z.enum(SUMMARY_DEPTHS).optional(), // SUMMARIZE only
  query: z.string().min(1).max(500).optional(), // FIND only
  question: z.string().min(1).max(500).optional(), // DISTILL only; anchor is optional focus
  format: z.enum(FORMALIZE_FORMATS).optional(), // FORMALIZE only
  sectionId: z.string().min(1).optional(), // FORMALIZE notes: where the notes land
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
  })
  .refine((d) => d.documentId || (d.type === "DISTILL" && d.scope === "corpus"), {
    message: "documentId is required",
  })
  .refine((d) => d.scope !== "corpus" || d.type === "DISTILL", {
    message: "scope corpus is DISTILL only",
  });

const ANCHOR_REQUIRED = new Set(["EXPLAIN", "SIMPLIFY", "EXTRACT"]);

export async function POST(req: Request) {
  const t = await serverT();
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: t("api.deriveNeedsKey") }, { status: 503 });
  }

  const { data, error } = await parseBody(req, deriveSchema);
  if (error) return error;
  // Every derivation persists something (annotation, layer, summary), so the
  // gate is editor — except FIND, which persists nothing and stays open to viewers.
  const access = await notebookAccess(data.notebookId, data.type === "FIND" ? "viewer" : "editor");
  if (access instanceof NextResponse) return access;
  const user = access.user;
  const usageMeta = {
    userId: user.id,
    feature: data.type.toLowerCase(),
    model: DERIVATION_MODEL[data.type],
  };

  const template = promptTemplates[data.type];
  if (!template) {
    return NextResponse.json({ error: t("api.typeNotBuilt", { type: data.type }) }, { status: 501 });
  }
  // A video anchor stands in for a text anchor on EXPLAIN (SPEC.md §11).
  if (ANCHOR_REQUIRED.has(data.type) && !data.anchor && !(data.type === "EXPLAIN" && data.video)) {
    return NextResponse.json({ error: t("api.typeRequiresAnchor", { type: data.type }) }, { status: 400 });
  }
  if (data.type === "FIND" && !data.query) {
    return NextResponse.json({ error: t("api.findRequiresQuery") }, { status: 400 });
  }
  if (data.type === "DISTILL" && !data.question?.trim()) {
    return NextResponse.json({ error: t("api.distillRequiresQuestion") }, { status: 400 });
  }
  if (data.type === "FORMALIZE" && !data.format) {
    return NextResponse.json({ error: t("api.formalizeRequiresFormat") }, { status: 400 });
  }
  if (data.video && !timeRangeSchema.safeParse(data.video).success) {
    return NextResponse.json({ error: t("api.endBeforeStart") }, { status: 400 });
  }

  // ── Corpus scope (SPEC.md §13): one question, every document ──────────────
  // The corpus rides as one cacheable system message, rendered like the
  // connect scan; quotes come back as block spans and the server maps each to
  // its document — block ids are unique across the corpus.
  if (data.type === "DISTILL" && data.scope === "corpus") {
    const attachments = await db.notebookDocument.findMany({
      where: { notebookId: data.notebookId },
      include: {
        document: {
          select: {
            id: true,
            title: true,
            blocks: {
              orderBy: { order: "asc" },
              select: { id: true, type: true, text: true, startTime: true, endTime: true },
            },
          },
        },
      },
    });
    const corpusDocs = attachments
      .map((a) => a.document)
      .filter((d) => d.blocks.some((b) => b.text.trim()));
    if (corpusDocs.length === 0) {
      return NextResponse.json({ error: t("api.corpusDistillNeedsDocuments") }, { status: 400 });
    }
    const profile = await loadProfile(data.notebookId);

    // Past the budget, later documents cut whole with a declared marker, never
    // silently (the digest discipline, SPEC.md §7).
    const PER_DOCUMENT = 100_000;
    const TOTAL = 450_000;
    const sections: string[] = [];
    const skipped: string[] = [];
    let used = 0;
    for (const doc of corpusDocs) {
      const lines = renderBlockLines(doc.blocks);
      const rendered = `[document ${doc.id}] "${doc.title}"` + "\n" +
        (lines.length > PER_DOCUMENT ? lines.slice(0, PER_DOCUMENT) : lines);
      if (used + rendered.length > TOTAL) {
        skipped.push(doc.title);
        continue;
      }
      used += rendered.length;
      sections.push(rendered);
    }
    const corpusText = [
      "You assist a reader dissecting a corpus of documents. Every document follows.",
      "Each document starts with its id as [document <id>]; each block starts with its id as [block <id>]. Block ids are unique across all documents. Reference block ids exactly as given.",
      "",
      sections.join("\n\n"),
      ...(skipped.length > 0 ? ["", `Documents cut for length (not shown): ${skipped.join("; ")}`] : []),
    ].join("\n");
    const corpusMessages: ModelMessage[] = [
      {
        role: "system",
        content: corpusText,
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      },
      { role: "user", content: corpusDistillPrompt({ profile, question: data.question!.trim() }) },
    ];
    const corpusBlockById = new Map(
      corpusDocs.flatMap((d) => d.blocks.map((b) => [b.id, { id: b.id, text: b.text }] as const)),
    );
    const docByBlock = new Map(
      corpusDocs.flatMap((d) => d.blocks.map((b) => [b.id, d.id] as const)),
    );
    const orderByBlock = new Map<string, number>();
    corpusDocs.forEach((d, di) =>
      d.blocks.forEach((b, bi) => orderByBlock.set(b.id, di * 1_000_000 + bi)),
    );

    // Same in-band streaming as document DISTILL: heartbeat spaces while the
    // model works, then the distillation JSON or the error token.
    const corpusEncoder = new TextEncoder();
    let corpusCancelled = false;
    let corpusHeartbeat: ReturnType<typeof setInterval> | null = null;
    const corpusStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (text: string) => {
          if (!corpusCancelled) controller.enqueue(corpusEncoder.encode(text));
        };
        corpusHeartbeat = setInterval(() => send(" "), 5_000);
        const fail = (message: string) => send(`${STREAM_ERROR_TOKEN}${message}`);
        try {
          const result = await callForJson({
            model: anthropic(DERIVATION_MODEL.DISTILL),
            messages: corpusMessages,
            maxOutputTokens: MAX_OUTPUT_TOKENS.DISTILL,
            schema: distillOutputSchema,
            label: "DISTILL:corpus",
            usage: usageMeta,
            abortSignal: req.signal,
          });
          if (corpusCancelled || req.signal.aborted) return;
          if (!result.ok) {
            fail(t("api.distillFailed", { reason: result.error }));
            return;
          }
          const quotes = result.data.quotes
            .map((q) => {
              const span = resolveSpan(q, corpusBlockById);
              const quoteDocumentId = span ? docByBlock.get(span.blockId) : undefined;
              return span && quoteDocumentId
                ? { ...span, caption: q.caption, documentId: quoteDocumentId }
                : null;
            })
            .filter((q) => q !== null)
            .sort(
              (a, b) =>
                (orderByBlock.get(a.blockId) ?? 0) - (orderByBlock.get(b.blockId) ?? 0) ||
                a.start - b.start,
            );
          if (quotes.length === 0) {
            fail(t("api.distillNoQuotes"));
            return;
          }
          const distillation: CorpusDistillation = {
            id: crypto.randomUUID(),
            question: data.question!.trim(),
            createdAt: new Date().toISOString(),
            createdById: user.id,
            quotes: quotes.map((q) => ({
              documentId: q.documentId,
              blockId: q.blockId,
              start: q.start,
              end: q.end,
              quotedText: q.quotedText,
              prefix: q.prefix,
              suffix: q.suffix,
              caption: q.caption,
            })),
          };
          if (corpusCancelled || req.signal.aborted) return;
          const notebookRow = await db.notebook.findUnique({
            where: { id: data.notebookId },
            select: { distillations: true },
          });
          await db.notebook.update({
            where: { id: data.notebookId },
            data: {
              // Keep the newest 20; the page deletes the rest one by one.
              distillations: [
                distillation,
                ...corpusDistillationList(notebookRow?.distillations),
              ].slice(0, 20),
            },
          });
          await bumpNotebook(data.notebookId);
          send(JSON.stringify({ ok: true, distillation }));
        } catch (err) {
          if (!corpusCancelled && !req.signal.aborted) {
            console.error("[derive] DISTILL:corpus failed:", err);
            fail(t("api.distillFailed", { reason: modelErrorMessage(err) }));
          }
        } finally {
          if (corpusHeartbeat) clearInterval(corpusHeartbeat);
          if (!corpusCancelled) controller.close();
        }
      },
      cancel() {
        corpusCancelled = true;
        if (corpusHeartbeat) clearInterval(corpusHeartbeat);
      },
    });
    return new Response(corpusStream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (!data.documentId) {
    return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });
  }
  const documentId = data.documentId;

  const attachment = await db.notebookDocument.findUnique({
    where: {
      notebookId_documentId: { notebookId: data.notebookId, documentId: documentId },
    },
  });
  if (!attachment) {
    return NextResponse.json({ error: t("api.documentNotAttachedToCorpus") }, { status: 404 });
  }

  // 1. Load document blocks (the cached prompt prefix), profile, section skeleton.
  const document = await db.document.findUnique({
    where: { id: documentId },
    include: { blocks: { orderBy: { order: "asc" }, select: { id: true, type: true, text: true, startTime: true, endTime: true } } },
  });
  if (!document) return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });
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
      return NextResponse.json({ error: t("api.anchorNotResolvedInDocument") }, { status: 400 });
    }
  }

  const [profile, skeleton] = await Promise.all([
    loadProfile(data.notebookId),
    sectionSkeleton(data.notebookId),
  ]);

  const depth = data.depth ?? "layman";
  const ctx: PromptCtx = {
    profile,
    documentTitle: document.title,
    anchoredText: anchored?.anchoredText ?? "",
    contextBefore: anchored?.contextBefore ?? "",
    contextAfter: anchored?.contextAfter ?? "",
    sectionSkeleton: skeleton,
    depth,
    query: data.query,
    question: data.question?.trim(),
    format: data.format,
  };

  // FIND searches the transcript; without one there is nothing to search.
  const timedBlocks = document.blocks.filter(
    (b) => b.type === "TRANSCRIPT" && b.startTime !== null && b.endTime !== null,
  );
  if (data.type === "FIND" && timedBlocks.length === 0) {
    return NextResponse.json({ error: t("api.findNeedsTranscript") }, { status: 400 });
  }
  // FORMALIZE rewrites the transcript; without one there is nothing to rewrite.
  if (data.type === "FORMALIZE" && timedBlocks.length === 0) {
    return NextResponse.json({ error: t("api.formalizeNeedsTranscript") }, { status: 400 });
  }

  // EXPLAIN on a video moment: the anchor is the time range; the frame rides
  // along as an image when the client could capture it. A YouTube frame cannot
  // be captured cross-origin, so Gemini watches the clip instead and its
  // description grounds the explanation (SPEC.md §11).
  let videoAnchor: { blockId: string; quotedText: string } | null = null;
  let frameImage: Uint8Array | null = null;
  if (data.type === "EXPLAIN" && data.video) {
    videoAnchor = await videoAnchorFor(document.id, data.video.startTime, data.video.endTime);
    if (!videoAnchor) {
      return NextResponse.json({ error: t("api.noVideoBlock") }, { status: 400 });
    }
    if (data.video.frame) {
      frameImage = new Uint8Array(
        Buffer.from(data.video.frame.slice("data:image/jpeg;base64,".length), "base64"),
      );
      if (frameImage.length === 0) frameImage = null;
    }
    // A YouTube frame comes from the storyboard sheets, which are small. Gemini
    // watches the same clip at full resolution, so the model gets two
    // independent looks at the moment: the actual cropped frame and a
    // description of it. They corroborate each other.
    const asset = await db.videoAsset.findUnique({
      where: { documentId: document.id },
      select: { kind: true, youtubeId: true, mimeType: true },
    });
    const previewFrame = asset?.kind === "YOUTUBE";
    let frameDescription: string | undefined;
    if (previewFrame && asset?.youtubeId && process.env.GEMINI_API_KEY) {
      frameDescription = await describeYouTubeClip(
        asset.youtubeId,
        data.video.startTime,
        data.video.endTime,
        data.video.region ?? null,
        { userId: usageMeta.userId, feature: "describe" },
      ).catch((err) => {
        console.warn("[derive] clip description failed:", err);
        return undefined;
      });
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
      previewFrame: previewFrame && frameImage !== null,
      frameDescription,
      audio: isAudioMime(asset?.mimeType ?? null),
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

  // EXPLAIN answers confusions, so it also sees the corpus: related passages
  // from the other documents, the reader's notes, and their annotations. Its
  // own system message after the cached prefix, so the prefix cache holds.
  const corpus =
    data.type === "EXPLAIN"
      ? await corpusSection(data.notebookId, documentId, anchored?.anchoredText ?? "")
      : null;

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
    ...(corpus
      ? [
          {
            role: "system" as const,
            content: corpus,
            providerOptions: { anthropic: { cacheControl: { type: "ephemeral" as const } } },
          },
        ]
      : []),
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
  // EXPLAIN, SIMPLIFY, and SUMMARIZE stream text. SALIENCE and DISTILL return validated JSON.
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
        recordUsage(usageMeta, sdkTokens(usage));
        // SUMMARIZE persists per notebook+document+depth, so reopening the
        // Summary tab does not re-pay tokens. Regenerate overwrites the depth.
        if (data.type === "SUMMARIZE" && text.trim()) {
          const where = {
            notebookId_documentId: { notebookId: data.notebookId, documentId: documentId },
          };
          const nd = await db.notebookDocument.findUnique({ where, select: { summaries: true } });
          const current = (nd?.summaries ?? {}) as SummaryLevels;
          await db.notebookDocument.update({
            where,
            data: { summaries: { ...current, [depth]: text } },
          });
          await bumpNotebook(data.notebookId);
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
                  createdById: user.id,
                  order: count,
                  sources: {
                    create: {
                      documentId: documentId,
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
              await bumpNotebook(data.notebookId);
              controller.enqueue(encoder.encode(`${STREAM_NOTE_TOKEN}${note.id}`));
            }
          } catch (err) {
            console.error("[derive] annotation save failed:", err);
            controller.enqueue(
              encoder.encode(`${STREAM_ERROR_TOKEN}${t("api.annotationNotSaved")}`),
            );
          }
        }
        // A video EXPLAIN persists with its time anchor, so the explained
        // moment joins the overlay and Visual (SPEC.md §11).
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
                createdById: user.id,
                order: count,
                sources: {
                  create: {
                    documentId: documentId,
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
            await bumpNotebook(data.notebookId);
            controller.enqueue(encoder.encode(`${STREAM_NOTE_TOKEN}${note.id}`));
          } catch (err) {
            console.error("[derive] annotation save failed:", err);
            controller.enqueue(
              encoder.encode(`${STREAM_ERROR_TOKEN}${t("api.annotationNotSaved")}`),
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
      usage: usageMeta,
    });
    if (!result.ok) {
      return NextResponse.json({ error: t("api.findFailed", { reason: result.error }) }, { status: 422 });
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
      usage: usageMeta,
    });
    if (!result.ok) {
      return NextResponse.json({ error: t("api.salienceFailed", { reason: result.error }) }, { status: 422 });
    }
    const spans = result.data.spans
      .map((s) => resolveSpan(s, blockById))
      .filter((s) => s !== null);
    if (spans.length === 0) {
      return NextResponse.json({ error: t("api.salienceNoSpans") }, { status: 422 });
    }
    await db.notebookDocument.update({
      where: {
        notebookId_documentId: { notebookId: data.notebookId, documentId: documentId },
      },
      data: { salience: spans },
    });
    await bumpNotebook(data.notebookId);
    return NextResponse.json({ ok: true, spanCount: spans.length });
  }

  // EXTRACT: the highlighted phrase's topic → the passages across the document
  // that reveal it, stored on the attachment as a labeled layer. Spans resolve
  // against the real block text; spans overlapping the origin or each other
  // drop — the origin is already marked, and stacked marks read as one.
  if (data.type === "EXTRACT") {
    const result = await callForJson({
      model,
      messages,
      maxOutputTokens,
      schema: extractOutputSchema,
      label: "EXTRACT",
      usage: usageMeta,
    });
    if (!result.ok) {
      return NextResponse.json({ error: t("api.extractFailed", { reason: result.error }) }, { status: 422 });
    }
    const origin = resolveSpan(
      {
        blockId: data.anchor!.blockId,
        start: data.anchor!.startOffset,
        end: data.anchor!.endOffset,
      },
      blockById,
    );
    if (!origin) {
      return NextResponse.json({ error: t("api.anchorNotResolvedInDocument") }, { status: 400 });
    }
    const orderByBlock = new Map(document.blocks.map((b, i) => [b.id, i]));
    const spans: NonNullable<ReturnType<typeof resolveSpan>>[] = [];
    for (const span of result.data.spans
      .map((s) => resolveSpan(s, blockById))
      .filter((s) => s !== null)
      .sort(
        (a, b) =>
          (orderByBlock.get(a.blockId) ?? 0) - (orderByBlock.get(b.blockId) ?? 0) ||
          a.start - b.start,
      )) {
      const overlapsOrigin =
        span.blockId === origin.blockId && span.start < origin.end && span.end > origin.start;
      const overlapsKept = spans.some(
        (s) => s.blockId === span.blockId && span.start < s.end && span.end > s.start,
      );
      if (!overlapsOrigin && !overlapsKept) spans.push(span);
    }
    if (spans.length === 0) {
      return NextResponse.json({ error: t("api.extractNoSpans") }, { status: 422 });
    }
    const toSpan = (s: NonNullable<ReturnType<typeof resolveSpan>>) => ({
      blockId: s.blockId,
      start: s.start,
      end: s.end,
      quotedText: s.quotedText,
      prefix: s.prefix,
      suffix: s.suffix,
    });
    const extraction: Extraction = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      createdById: user.id,
      origin: toSpan(origin),
      spans: spans.map(toSpan),
    };
    await db.notebookDocument.update({
      where: {
        notebookId_documentId: { notebookId: data.notebookId, documentId: documentId },
      },
      data: {
        // Oldest first — the index gives the label. Keep the newest 20.
        extractions: [...extractionList(attachment.extractions), extraction].slice(-20),
      },
    });
    await bumpNotebook(data.notebookId);
    return NextResponse.json({ ok: true, extraction }, { status: 201 });
  }

  // FORMALIZE: the transcript rewritten (SPEC.md §11). format article stores
  // {title, markdown} on the attachment and renders under the transcript —
  // Regenerate overwrites, like summaries. format notes lands one PENDING note
  // per topic, each with a time source resolved from the topic's transcript
  // blocks — nothing enters notes without the user (SPEC.md §1). The model
  // call holds the connection for minutes on a long transcript, so the
  // response streams heartbeat spaces and ends with the payload JSON or
  // STREAM_ERROR_TOKEN + the reason, the DISTILL pattern.
  if (data.type === "FORMALIZE") {
    const format = data.format!;
    const formalizeEncoder = new TextEncoder();
    let formalizeCancelled = false;
    let formalizeHeartbeat: ReturnType<typeof setInterval> | null = null;
    const formalizeStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (text: string) => {
          if (!formalizeCancelled) controller.enqueue(formalizeEncoder.encode(text));
        };
        formalizeHeartbeat = setInterval(() => send(" "), 5_000);
        const fail = (message: string) => send(`${STREAM_ERROR_TOKEN}${message}`);
        try {
          if (format === "article") {
            const result = await callForJson({
              model,
              messages,
              maxOutputTokens,
              schema: formalizeArticleSchema,
              label: "FORMALIZE:article",
              usage: usageMeta,
              abortSignal: req.signal,
            });
            if (formalizeCancelled || req.signal.aborted) return;
            if (!result.ok) {
              fail(t("api.formalizeFailed", { reason: result.error }));
              return;
            }
            const article: FormalizedArticle = {
              title: result.data.title.trim(),
              markdown: result.data.markdown.trim(),
              createdAt: new Date().toISOString(),
              createdById: user.id,
            };
            // The article becomes a document in the corpus (SPEC.md §11):
            // parsed into blocks so every reader tool works on it. Regenerate
            // rewrites the same document — its id carries over from the stored
            // article.
            const attachment = await db.notebookDocument.findUnique({
              where: {
                notebookId_documentId: { notebookId: data.notebookId, documentId: documentId },
              },
              select: { formalized: true },
            });
            const previous = formalizedArticle(attachment?.formalized ?? null);
            article.documentId = await materializeArticle(data.notebookId, {
              ...article,
              documentId: previous?.documentId,
            });
            await db.notebookDocument.update({
              where: {
                notebookId_documentId: { notebookId: data.notebookId, documentId: documentId },
              },
              data: { formalized: { article } },
            });
            await bumpNotebook(data.notebookId);
            send(JSON.stringify({ ok: true, article }));
            return;
          }

          const result = await callForJson({
            model,
            messages,
            maxOutputTokens,
            schema: formalizeNotesSchema,
            label: "FORMALIZE:notes",
            usage: usageMeta,
            abortSignal: req.signal,
          });
          if (formalizeCancelled || req.signal.aborted) return;
          if (!result.ok) {
            fail(t("api.formalizeFailed", { reason: result.error }));
            return;
          }
          // Where the notes land: the requested section, else the first
          // visible section, else a new "Notes" section.
          let section = data.sectionId
            ? await db.section.findFirst({
                where: { id: data.sectionId, notebookId: data.notebookId, hidden: false },
              })
            : null;
          if (!section) {
            section = await db.section.findFirst({
              where: { notebookId: data.notebookId, hidden: false },
              orderBy: { order: "asc" },
            });
          }
          if (!section) {
            section = await db.section.create({
              data: { notebookId: data.notebookId, title: "Notes", order: 0 },
            });
          }
          // Every note cites its span of the recording: the topic's blocks
          // give the time range; a topic with no resolvable blocks anchors to
          // the whole recording on the VIDEO block.
          const timedById = new Map(timedBlocks.map((b) => [b.id, b]));
          const videoBlock = document.blocks.find((b) => b.type === "VIDEO") ?? null;
          const lastEnd = Math.max(...timedBlocks.map((b) => b.endTime!));
          let order = await db.note.count({ where: { sectionId: section.id } });
          let noteCount = 0;
          for (const topic of result.data.topics) {
            const blocks = topic.blockIds
              .map((id) => timedById.get(id))
              .filter((b) => b !== undefined);
            const anchorBlock = blocks[0] ?? videoBlock;
            if (!anchorBlock) continue;
            const startTime = blocks.length > 0 ? Math.min(...blocks.map((b) => b.startTime!)) : 0;
            const endTime = blocks.length > 0 ? Math.max(...blocks.map((b) => b.endTime!)) : lastEnd;
            const excerpt = blocks.map((b) => b.text).join(" ").trim();
            const quotedText =
              excerpt.length > 240
                ? `${excerpt.slice(0, 239)}…`
                : excerpt || formatTimeRange(startTime, endTime);
            await db.note.create({
              data: {
                sectionId: section.id,
                content: `**${topic.heading.trim()}**\n\n${topic.bullets.map((b) => `- ${b.trim()}`).join("\n")}`,
                status: "PENDING",
                derivationType: "FORMALIZE",
                createdById: user.id,
                order: order++,
                sources: {
                  create: {
                    documentId: documentId,
                    blockId: anchorBlock.id,
                    startOffset: 0,
                    endOffset: 0,
                    quotedText,
                    prefix: "",
                    suffix: "",
                    startTime,
                    endTime,
                  },
                },
              },
            });
            noteCount++;
          }
          if (noteCount === 0) {
            fail(t("api.formalizeNoTopics"));
            return;
          }
          await bumpNotebook(data.notebookId);
          send(JSON.stringify({ ok: true, noteCount, sectionTitle: section.title }));
        } catch (err) {
          if (!formalizeCancelled && !req.signal.aborted) {
            console.error("[derive] FORMALIZE failed:", err);
            fail(t("api.formalizeFailed", { reason: modelErrorMessage(err) }));
          }
        } finally {
          if (formalizeHeartbeat) clearInterval(formalizeHeartbeat);
          if (!formalizeCancelled) controller.close();
        }
      },
      cancel() {
        formalizeCancelled = true;
        if (formalizeHeartbeat) clearInterval(formalizeHeartbeat);
      },
    });
    return new Response(formalizeStream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // DISTILL: question → the quotes that answer it. Every span resolves against
  // the real block text (clamped, dropped when empty) before anything persists,
  // so the page always shows verbatim article text. The distillation stores on
  // the attachment, newest first; quotes only reach notes through the page's
  // "Add to notes", which lands them PENDING (SPEC.md §1).
  // The model call holds one connection for minutes, and a silent connection
  // dies at idle proxies — the client sees "Failed to fetch". So the response
  // streams a heartbeat space while the model works, then ends with the
  // payload: the distillation JSON, or STREAM_ERROR_TOKEN + the reason
  // (the same in-band pattern the text streams use).
  // Cancel aborts the request: the model call stops with it, and a cancelled
  // run never persists — the reader edits the question and runs again.
  const encoder = new TextEncoder();
  let cancelled = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => {
        if (!cancelled) controller.enqueue(encoder.encode(text));
      };
      heartbeat = setInterval(() => send(" "), 5_000);
      const fail = (message: string) => send(`${STREAM_ERROR_TOKEN}${message}`);
      try {
        const result = await callForJson({
          model,
          messages,
          maxOutputTokens,
          schema: distillOutputSchema,
          label: "DISTILL",
          usage: usageMeta,
          abortSignal: req.signal,
        });
        if (cancelled || req.signal.aborted) return;
        if (!result.ok) {
          fail(t("api.distillFailed", { reason: result.error }));
          return;
        }
        const orderByBlock = new Map(document.blocks.map((b, i) => [b.id, i]));
        const quotes = result.data.quotes
          .map((q) => {
            const span = resolveSpan(q, blockById);
            return span ? { ...span, caption: q.caption } : null;
          })
          .filter((q) => q !== null)
          .sort(
            (a, b) =>
              (orderByBlock.get(a.blockId) ?? 0) - (orderByBlock.get(b.blockId) ?? 0) ||
              a.start - b.start,
          );
        if (quotes.length === 0) {
          fail(t("api.distillNoQuotes"));
          return;
        }
        const distillation: Distillation = {
          id: crypto.randomUUID(),
          question: data.question!.trim(),
          createdAt: new Date().toISOString(),
          createdById: user.id,
          quotes: quotes.map((q) => ({
            blockId: q.blockId,
            start: q.start,
            end: q.end,
            quotedText: q.quotedText,
            prefix: q.prefix,
            suffix: q.suffix,
            caption: q.caption,
          })),
        };
        if (cancelled || req.signal.aborted) return;
        await db.notebookDocument.update({
          where: {
            notebookId_documentId: { notebookId: data.notebookId, documentId: documentId },
          },
          data: {
            // Keep the newest 20; the page deletes the rest one by one.
            distillations: [distillation, ...distillationList(attachment.distillations)].slice(0, 20),
          },
        });
        await bumpNotebook(data.notebookId);
        send(JSON.stringify({ ok: true, distillation }));
      } catch (err) {
        if (!cancelled && !req.signal.aborted) {
          console.error("[derive] DISTILL failed:", err);
          fail(t("api.distillFailed", { reason: modelErrorMessage(err) }));
        }
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
      if (heartbeat) clearInterval(heartbeat);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

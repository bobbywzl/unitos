import { anthropic } from "@ai-sdk/anthropic";
import { streamText, type ModelMessage } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveAnchor } from "@/lib/anchors/resolve";
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
import { comparisonMarkdown } from "@/lib/derive/analysis";
import { figureContent, figureVisual, renderFigurePage, type FigureImage } from "@/lib/derive/figure";
import {
  compareOutputSchema,
  distillOutputSchema,
  extractOutputSchema,
  findOutputSchema,
  formalizeArticleSchema,
  formalizeNotesSchema,
  resolveSpan,
  salienceOutputSchema,
} from "@/lib/derive/json";
import { callForJson, modelErrorMessage } from "@/lib/derive/json-call";
import { cropPageRegion, pageBlockText, renderPdfPage } from "@/lib/handwritten/pages";
import { parseRegion } from "@/lib/video/types";
import { currentLang, serverT } from "@/lib/i18n/server";
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
import { landingSection } from "@/lib/derive/landing";
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

// FORMALIZE holds the connection for minutes on a long transcript (heartbeat
// stream); 120 s would kill it mid-call.
export const maxDuration = 300;

// The one derivation pipeline (SPEC.md §4). Never fork per feature: new derivation =
// new prompt template + destination handler below.
const deriveSchema = z
  .object({
  type: z.enum([
    "EXPLAIN",
    "SIMPLIFY",
    "SALIENCE",
    "EXTRACT",
    "DISTILL",
    "SUMMARIZE",
    "FIND",
    "FORMALIZE",
    "ASK",
    "COMPARE",
    "ANALYZE",
  ]),
  // Absent only for corpus-scope DISTILL, which reads every document, and for
  // COMPARE, which names its two documents in documentIds.
  documentId: z.string().min(1).optional(),
  // COMPARE only: the two documents, both attached to the project.
  documentIds: z.array(z.string().min(1)).length(2).optional(),
  // DISTILL only: "corpus" scans every document in the corpus (SPEC.md §13).
  scope: z.enum(["document", "corpus"]).optional(),
  notebookId: z.string().min(1),
  anchor: z
    .object({
      blockId: z.string().min(1),
      startOffset: z.number().int().min(0),
      endOffset: z.number().int().min(0),
      // The quote selectors (SPEC.md §5): when the block id or the offsets no
      // longer match — a re-parse gave the blocks new ids, an edit moved the
      // words — the quote re-finds the selection in the document.
      quotedText: z.string().max(10_000).optional(),
      prefix: z.string().max(64).optional(),
      suffix: z.string().max(64).optional(),
    })
    .optional(),
  depth: z.enum(SUMMARY_DEPTHS).optional(), // SUMMARIZE only
  query: z.string().min(1).max(500).optional(), // FIND only
  question: z.string().min(1).max(500).optional(), // DISTILL and ASK; DISTILL's anchor is optional focus
  format: z.enum(FORMALIZE_FORMATS).optional(), // FORMALIZE only
  sectionId: z.string().min(1).optional(), // FORMALIZE notes, COMPARE: where the notes land
  // EXPLAIN on a video moment (SPEC.md §11): the time range, the drawn region,
  // and the paused frame as a JPEG data URL when the client could capture it.
  // ASK: the time range the question is about.
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
  // EXPLAIN on a handwritten page (SPEC.md §16): Circle & ask. The PAGE block,
  // the drawn region, and the reader's question when one was typed. The server
  // renders the page and the circled part from the stored PDF.
  page: z
    .object({
      blockId: z.string().min(1),
      region: regionSchema,
      question: z.string().min(1).max(500).optional(),
    })
    .optional(),
  })
  .refine(
    (d) =>
      d.documentId ||
      (d.type === "DISTILL" && d.scope === "corpus") ||
      (d.type === "COMPARE" && d.documentIds),
    { message: "documentId is required" },
  )
  .refine((d) => d.type !== "COMPARE" || (d.documentIds && d.documentIds[0] !== d.documentIds[1]), {
    message: "COMPARE needs two different documents",
  })
  .refine((d) => d.scope !== "corpus" || d.type === "DISTILL", {
    message: "scope corpus is DISTILL only",
  })
  .refine((d) => !(d.video && d.page), {
    message: "Provide video or page, not both",
  })
  .refine((d) => !(d.anchor && d.page), {
    message: "Provide anchor or page, not both",
  })
  .refine((d) => !d.page || d.type === "EXPLAIN", {
    message: "page is EXPLAIN only",
  });

const ANCHOR_REQUIRED = new Set(["EXPLAIN", "SIMPLIFY", "EXTRACT", "ANALYZE"]);

// A model call that holds one connection for minutes dies at idle proxies, so
// the response streams a heartbeat space while the model works and ends with
// the payload JSON or STREAM_ERROR_TOKEN + the reason — the DISTILL pattern.
// Cancel aborts the request: a cancelled run persists nothing.
function heartbeatResponse(
  req: Request,
  run: () => Promise<{ ok: true } & Record<string, unknown>>,
  failure: (reason: string) => string,
): Response {
  const encoder = new TextEncoder();
  let cancelled = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => {
        if (!cancelled) controller.enqueue(encoder.encode(text));
      };
      heartbeat = setInterval(() => send(" "), 5_000);
      try {
        const payload = await run();
        if (cancelled || req.signal.aborted) return;
        send(JSON.stringify(payload));
      } catch (err) {
        if (!cancelled && !req.signal.aborted) {
          console.error("[derive] run failed:", err);
          send(`${STREAM_ERROR_TOKEN}${failure(modelErrorMessage(err))}`);
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
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

// A failed JSON call throws with the reason; heartbeatResponse reports it.
class DeriveFailure extends Error {}

export async function POST(req: Request) {
  const t = await serverT();
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: t("api.deriveNeedsKey") }, { status: 503 });
  }

  const { data, error } = await parseBody(req, deriveSchema);
  if (error) return error;
  // Every derivation persists something (annotation, layer, summary), so the
  // gate is editor — except FIND and ASK, which persist nothing and stay open
  // to viewers.
  const access = await notebookAccess(
    data.notebookId,
    data.type === "FIND" || data.type === "ASK" ? "viewer" : "editor",
  );
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
  // A video or page anchor stands in for a text anchor on EXPLAIN (SPEC.md §11, §16).
  if (
    ANCHOR_REQUIRED.has(data.type) &&
    !data.anchor &&
    !(data.type === "EXPLAIN" && (data.video || data.page))
  ) {
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
  if (data.type === "ASK" && (!data.question?.trim() || !data.video)) {
    return NextResponse.json({ error: t("api.askRequiresRangeAndQuestion") }, { status: 400 });
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
      {
        role: "user",
        content: corpusDistillPrompt({
          profile,
          lang: await currentLang(),
          question: data.question!.trim(),
        }),
      },
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

  // ── COMPARE (SPEC.md §4): two documents, read whole ────────────────────────
  // Both documents ride as one cacheable system message under their ids, the
  // corpus DISTILL rendering; the points come back citing block spans, and the
  // server resolves each against the real text before one PENDING note lands
  // with a source per span — nothing enters notes without the reader.
  if (data.type === "COMPARE") {
    const [firstId, secondId] = data.documentIds!;
    const attachments = await db.notebookDocument.findMany({
      where: { notebookId: data.notebookId, documentId: { in: [firstId, secondId] } },
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
    const first = attachments.find((a) => a.documentId === firstId)?.document;
    const second = attachments.find((a) => a.documentId === secondId)?.document;
    if (!first || !second) {
      return NextResponse.json({ error: t("api.documentNotAttachedToCorpus") }, { status: 404 });
    }
    if (!first.blocks.some((b) => b.text.trim()) || !second.blocks.some((b) => b.text.trim())) {
      return NextResponse.json({ error: t("api.compareNeedsText") }, { status: 400 });
    }
    const profile = await loadProfile(data.notebookId);
    const PER_DOCUMENT = 220_000;
    const renderDoc = (doc: typeof first) => {
      const lines = renderBlockLines(doc.blocks);
      return (
        `[document ${doc.id}] "${doc.title}"` +
        "\n" +
        (lines.length > PER_DOCUMENT
          ? `${lines.slice(0, PER_DOCUMENT)}\n\n(document cut for length)`
          : lines)
      );
    };
    const compareText = [
      "You assist a reader comparing two documents of a project. Both follow.",
      "Each document starts with its id as [document <id>]; each block starts with its id as [block <id>]. Block ids are unique across both documents. Reference block ids exactly as given.",
      "",
      renderDoc(first),
      "",
      renderDoc(second),
    ].join("\n");
    const compareMessages: ModelMessage[] = [
      {
        role: "system",
        content: compareText,
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      },
      {
        role: "user",
        content: template({
          profile,
          lang: await currentLang(),
          documentTitle: first.title,
          anchoredText: "",
          contextBefore: "",
          contextAfter: "",
          sectionSkeleton: await sectionSkeleton(data.notebookId),
          compare: {
            first: { id: first.id, title: first.title },
            second: { id: second.id, title: second.title },
          },
        }),
      },
    ];
    const compareBlockById = new Map(
      [...first.blocks, ...second.blocks].map((b) => [b.id, { id: b.id, text: b.text }] as const),
    );
    const docByBlock = new Map<string, string>([
      ...first.blocks.map((b) => [b.id, first.id] as const),
      ...second.blocks.map((b) => [b.id, second.id] as const),
    ]);
    return heartbeatResponse(
      req,
      async () => {
        const result = await callForJson({
          model: anthropic(DERIVATION_MODEL.COMPARE),
          messages: compareMessages,
          maxOutputTokens: MAX_OUTPUT_TOKENS.COMPARE,
          schema: compareOutputSchema,
          label: "COMPARE",
          usage: usageMeta,
          abortSignal: req.signal,
        });
        if (!result.ok) throw new DeriveFailure(result.error);
        // Every span resolves against the real block text; a point keeps only
        // its resolved spans, and a point with none still stands as text.
        const resolvePoints = (points: { point: string; spans: { blockId: string; start: number; end: number }[] }[]) =>
          points.map((p) => ({
            point: p.point.trim(),
            spans: p.spans
              .map((span) => {
                const resolved = resolveSpan(span, compareBlockById);
                const documentId = resolved ? docByBlock.get(resolved.blockId) : undefined;
                return resolved && documentId ? { ...resolved, documentId } : null;
              })
              .filter((span) => span !== null),
          }));
        const comparison = {
          agreements: resolvePoints(result.data.agreements),
          disagreements: resolvePoints(result.data.disagreements),
          onlyFirst: resolvePoints(result.data.onlyFirst),
          onlySecond: resolvePoints(result.data.onlySecond),
        };
        const total =
          comparison.agreements.length +
          comparison.disagreements.length +
          comparison.onlyFirst.length +
          comparison.onlySecond.length;
        if (total === 0) throw new DeriveFailure(t("api.compareNoPoints"));
        const content = comparisonMarkdown(comparison, { first: first.title, second: second.title }, t);
        // One source per distinct span, the first document's first, capped so
        // the card stays readable.
        const seen = new Set<string>();
        const sources: { documentId: string; blockId: string; start: number; end: number; quotedText: string; prefix: string; suffix: string }[] = [];
        for (const list of [comparison.agreements, comparison.disagreements, comparison.onlyFirst, comparison.onlySecond]) {
          for (const point of list) {
            for (const span of point.spans) {
              const key = `${span.blockId}:${span.start}:${span.end}`;
              if (seen.has(key) || sources.length >= 24) continue;
              seen.add(key);
              sources.push(span);
            }
          }
        }
        const section = await landingSection(data.notebookId, data.sectionId, t("reader.defaultSectionTitle"));
        const order = await db.note.count({ where: { sectionId: section.id } });
        const note = await db.note.create({
          data: {
            sectionId: section.id,
            content,
            status: "PENDING",
            derivationType: "COMPARE",
            createdById: user.id,
            order,
            sources: {
              create: sources.map((span) => ({
                documentId: span.documentId,
                blockId: span.blockId,
                startOffset: span.start,
                endOffset: span.end,
                quotedText: span.quotedText,
                prefix: span.prefix,
                suffix: span.suffix,
              })),
            },
          },
        });
        await bumpNotebook(data.notebookId);
        return { ok: true, noteId: note.id, sectionTitle: section.title, pointCount: total };
      },
      (reason) => t("api.compareFailed", { reason }),
    );
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

  // The anchor resolves through the ladder (SPEC.md §5): block id and offsets,
  // then the quote inside the block, then the quote across the document. A
  // re-parse gives every block a new id while an open reader still sends the
  // old ones; the quote carries the selection across.
  const anchor = data.anchor ? resolveAnchor(document.blocks, data.anchor) : null;
  let anchored: ReturnType<typeof anchorContext> = null;
  if (data.anchor) {
    anchored = anchor
      ? anchorContext(document.blocks, anchor.blockId, anchor.startOffset, anchor.endOffset)
      : null;
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
    lang: await currentLang(),
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
  if ((data.type === "FIND" || data.type === "ASK") && timedBlocks.length === 0) {
    return NextResponse.json({ error: t("api.findNeedsTranscript") }, { status: 400 });
  }
  // ASK: the question is about a time range (SPEC.md §11). The range's lines
  // repeat in the prompt; the whole transcript stays the cached prefix, so
  // the answer can say where else the recording deals with it.
  if (data.type === "ASK" && data.video) {
    const asset = await db.videoAsset.findUnique({
      where: { documentId: document.id },
      select: { mimeType: true },
    });
    const excerpt = timedBlocks
      .filter((b) => b.startTime! < data.video!.endTime && b.endTime! > data.video!.startTime)
      .map((b) => `[${formatTimeRange(b.startTime!, b.endTime!)}] ${b.text}`)
      .join("\n");
    ctx.video = {
      timeRange: formatTimeRange(data.video.startTime, data.video.endTime),
      transcriptExcerpt: excerpt.length > 60_000 ? `${excerpt.slice(0, 59_999)}…` : excerpt,
      hasFrame: false,
      hasRegion: false,
      audio: isAudioMime(asset?.mimeType ?? null),
    };
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
  // source; a PDF figure attaches its rendered page; a video figure explains
  // from caption and context only.
  let figureImage: FigureImage | null = null;
  // ANALYZE reads a FIGURE or TABLE block (SPEC.md §4): the anchored block,
  // with its visual when one can be produced.
  let analyzedBlock: { id: string; type: string; text: string } | null = null;
  if ((data.type === "EXPLAIN" || data.type === "ANALYZE") && anchor) {
    const anchoredBlock = await db.block.findUnique({
      where: { id: anchor.blockId },
      select: { type: true, html: true, text: true, page: true, region: true },
    });
    if (data.type === "ANALYZE") {
      if (!anchoredBlock || (anchoredBlock.type !== "FIGURE" && anchoredBlock.type !== "TABLE")) {
        return NextResponse.json({ error: t("api.analyzeNeedsFigureOrTable") }, { status: 400 });
      }
      analyzedBlock = { id: anchor.blockId, type: anchoredBlock.type, text: anchoredBlock.text };
      if (anchoredBlock.type === "TABLE") {
        // The markup carries the cells; a PDF table's page region rides along
        // so the model can check the markup against the print.
        const region = parseRegion(anchoredBlock.region);
        const image =
          anchoredBlock.page !== null && region
            ? await renderFigurePage(document.id, anchoredBlock.page, region)
            : null;
        figureImage = image;
        ctx.table = {
          html: (anchoredBlock.html ?? anchoredBlock.text).slice(0, 60_000),
          hasImage: image !== null,
        };
      }
    }
    const figure = figureContent(anchoredBlock);
    if (figure && anchoredBlock) {
      const visual = await figureVisual(figure, anchoredBlock, document.id, document.sourceUrl);
      figureImage = visual?.image ?? null;
      ctx.figure = {
        // The prompt must never claim an attachment that is not there: a
        // figure with an attached visual is an image figure; one without
        // degrades to a plain figure (unless it is SVG or video).
        kind: visual ? "image" : figure.kind === "image" ? "figure" : figure.kind,
        caption: figure.caption,
        svgSource: figure.svgSource,
        page: visual?.page ?? false,
      };
    }
  }

  // EXPLAIN on a handwritten page (SPEC.md §16): Circle & ask. The server
  // renders the page and the circled part from the stored PDF and attaches
  // both — the page carries the context, the crop carries the circled spot.
  let pageAnchor: { blockId: string; quotedText: string; region: unknown } | null = null;
  const pageImages: Uint8Array[] = [];
  if (data.type === "EXPLAIN" && data.page) {
    const pageBlock = await db.block.findUnique({
      where: { id: data.page.blockId },
      select: { documentId: true, type: true, page: true },
    });
    if (
      !pageBlock ||
      pageBlock.documentId !== documentId ||
      pageBlock.type !== "PAGE" ||
      pageBlock.page === null
    ) {
      return NextResponse.json({ error: t("api.blockNotInDocument") }, { status: 404 });
    }
    if (!document.fileData) {
      return NextResponse.json({ error: t("api.noStoredPdf") }, { status: 400 });
    }
    const pageImage = await renderPdfPage(new Uint8Array(document.fileData), pageBlock.page);
    pageImages.push(pageImage);
    const crop = await cropPageRegion(pageImage, data.page.region);
    if (crop) pageImages.push(crop);
    pageAnchor = {
      blockId: data.page.blockId,
      quotedText: pageBlockText(pageBlock.page),
      region: data.page.region,
    };
    ctx.page = {
      number: pageBlock.page,
      hasCrop: crop !== null,
      question: data.page.question,
    };
  }

  // EXPLAIN answers confusions and ANALYZE links a figure or table to the
  // rest of the project, so both see the corpus: related passages from the
  // other documents, the reader's notes, and their annotations. Its own
  // system message after the cached prefix, so the prefix cache holds. The
  // whole block's text scores the related passages for ANALYZE: a table
  // selection alone is a few cells.
  const corpus =
    data.type === "EXPLAIN" || data.type === "ANALYZE"
      ? await corpusSection(
          data.notebookId,
          documentId,
          analyzedBlock?.text || (anchored?.anchoredText ?? ""),
        )
      : null;
  ctx.corpus = corpus !== null;

  // 2. Template by type. The document is the cached prefix, byte-identical for every
  // derivation on this document (SPEC.md §2).
  const attachedImages: { bytes: Uint8Array; mediaType: string }[] = figureImage
    ? [{ bytes: figureImage.bytes, mediaType: figureImage.mediaType }]
    : frameImage
      ? [{ bytes: frameImage, mediaType: "image/jpeg" }]
      : pageImages.map((bytes) => ({ bytes, mediaType: "image/png" }));
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
    attachedImages.length > 0
      ? {
          role: "user",
          content: [
            { type: "text", text: template(ctx) },
            ...attachedImages.map((i) => ({
              type: "image" as const,
              image: i.bytes,
              mediaType: i.mediaType,
            })),
          ],
        }
      : { role: "user", content: template(ctx) },
  ];
  const model = anthropic(DERIVATION_MODEL[data.type]);
  const maxOutputTokens = MAX_OUTPUT_TOKENS[data.type];

  // 3 + 4. Stream or collect, then route by destination.
  // EXPLAIN, SIMPLIFY, ANALYZE, SUMMARIZE, and ASK stream text. SALIENCE and
  // DISTILL return validated JSON.
  if (
    data.type === "EXPLAIN" ||
    data.type === "SIMPLIFY" ||
    data.type === "ANALYZE" ||
    data.type === "SUMMARIZE" ||
    data.type === "ASK"
  ) {
    const result = streamText({
      model,
      maxOutputTokens,
      allowSystemInMessages: true,
      messages,
      // Stop aborts the model call too (SPEC.md §6), not just the response.
      abortSignal: req.signal,
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
    // EXPLAIN, SIMPLIFY, and ANALYZE persist in the hidden Annotations section
    // before the stream closes, then the stream ends with STREAM_NOTE_TOKEN +
    // the note id: the client's refresh always finds the stored mark, and the
    // card can delete its annotation in place.
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
          // Stopped by the reader: nobody is listening, and nothing persists.
          if (req.signal.aborted) return;
          try {
            controller.enqueue(encoder.encode(`${STREAM_ERROR_TOKEN}${modelErrorMessage(err)}`));
            controller.close();
          } catch {
            // The reader left before the reason could be sent.
          }
          return;
        }
        if (
          (data.type === "EXPLAIN" || data.type === "SIMPLIFY" || data.type === "ANALYZE") &&
          anchor &&
          text.trim()
        ) {
          try {
            const block = blockById.get(anchor.blockId);
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
                      blockId: anchor.blockId,
                      startOffset: anchor.startOffset,
                      endOffset: anchor.endOffset,
                      quotedText: anchor.quotedText,
                      prefix: anchor.prefix,
                      suffix: anchor.suffix,
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
        // A page EXPLAIN persists with its page anchor, so the circled spot
        // stays marked on the page (SPEC.md §16).
        if (data.type === "EXPLAIN" && data.page && pageAnchor && text.trim()) {
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
                    blockId: pageAnchor.blockId,
                    startOffset: 0,
                    endOffset: 0,
                    quotedText: pageAnchor.quotedText,
                    prefix: "",
                    suffix: "",
                    region: pageAnchor.region as object,
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
      abortSignal: req.signal,
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
      abortSignal: req.signal,
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
      abortSignal: req.signal,
    });
    if (!result.ok) {
      return NextResponse.json({ error: t("api.extractFailed", { reason: result.error }) }, { status: 422 });
    }
    const origin = resolveSpan(
      {
        blockId: anchor!.blockId,
        start: anchor!.startOffset,
        end: anchor!.endOffset,
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
          const section = await landingSection(
            data.notebookId,
            data.sectionId,
            t("reader.defaultSectionTitle"),
          );
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

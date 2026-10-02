import type { ConversionStatus } from "@prisma/client";
import type { ModelMessage } from "ai";
import { z } from "zod";
import { bumpDocument } from "@/lib/collab";
import { db } from "@/lib/db";
import { HANDWRITTEN_EFFORT, SCAN_EFFORT } from "@/lib/derive/config";
import { featureCall, featureConfigured } from "@/lib/feature-models";
import { callForJson } from "@/lib/derive/json-call";
import { PAGE_IMAGE_WIDTH, renderPdfPage, renderPdfPagesJpeg } from "@/lib/handwritten/pages";
import { texError } from "@/lib/katex";
import { convertPrompt } from "@/lib/prompts/convert";
import { scanPrompt } from "@/lib/prompts/scan";
import { fixTexPrompt } from "@/lib/prompts/fix-tex";
import { refreshSkeleton } from "@/lib/graph/skeleton";
import { tableHtml } from "@/lib/replica";

// The conversion job (SPEC.md §16): guards, page rendering, the model batches,
// and the text block writes. Conversion starts on its own when a handwritten
// document is added — the text is the point — and
// /api/documents/[documentId]/convert runs the same job for Retry and Convert
// again. Pages convert in batches that run together, so the wall clock is
// about one batch; one failed batch fails the run with its reason — a partial
// text never lands silently.
export type ConversionResult =
  | { ok: true; blocks: number }
  | { ok: false; status: number; error: string };

const BATCH_PAGES = 6;
const BATCH_CONCURRENCY = 3;
const MAX_PAGES = 60;
/** The pages a conversion or a scan's read reads; the rest is declared cut. */
export const CONVERT_MAX_PAGES = MAX_PAGES;
const CONVERT_STALE_MS = 10 * 60 * 1000;

/** A PENDING older than 10 minutes is a dead run and may start again. */
export function conversionIsStale(status: ConversionStatus, startedAt: Date | null): boolean {
  return (
    status === "PENDING" && (startedAt === null || Date.now() - startedAt.getTime() > CONVERT_STALE_MS)
  );
}

const convertedBlockSchema = z.object({
  type: z.enum(["HEADING", "PARAGRAPH", "LIST", "TABLE", "EQUATION"]),
  level: z.number().int().min(1).max(3).optional(),
  page: z.number().int().min(1),
  text: z.string().min(1).max(8000),
});
const convertOutputSchema = z.object({ blocks: z.array(convertedBlockSchema).max(150) });
type ConvertedBlock = z.infer<typeof convertedBlockSchema>;

const MAX_TEX_REPAIRS = 60;
const fixTexOutputSchema = z.object({
  fixes: z.array(z.object({ index: z.number().int().min(0), text: z.string().min(1).max(8000) })).max(MAX_TEX_REPAIRS),
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Every line of a LIST carries its marker in the text ("- ", "N. ") — the
// reader's list convention. A line the model left unmarked gets "- ".
function normalizeList(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const indent = /^\s*/.exec(line)![0];
      const body = line.slice(indent.length);
      if (!body || /^(-|\d{1,3}[.)])\s/.test(body)) return line;
      return `${indent}- ${body}`;
    })
    .join("\n");
}

function toBlockRow(b: ConvertedBlock): {
  type: "HEADING" | "PARAGRAPH" | "LIST" | "TABLE" | "EQUATION";
  text: string;
  html: string | null;
  page: number;
} {
  if (b.type === "HEADING") {
    const level = b.level ?? 2;
    return { type: b.type, text: b.text, html: `<h${level}>${escapeHtml(b.text)}</h${level}>`, page: b.page };
  }
  if (b.type === "LIST") return { type: b.type, text: normalizeList(b.text), html: null, page: b.page };
  if (b.type === "TABLE") return { type: b.type, text: b.text, html: tableHtml(b.text), page: b.page };
  return { type: b.type, text: b.text, html: null, page: b.page };
}

type BlockRow = ReturnType<typeof toBlockRow>;

// TeX verification (SPEC.md §16): every EQUATION block must render in KaTeX
// before it lands. The failures go back to the model once with the parser's
// error; a fix that parses replaces the text, anything else stays as written —
// the reader shows raw TeX, never invented content. Best effort: a failed
// repair call never fails the conversion.
async function repairEquations(
  rows: BlockRow[],
  userId: string | null,
): Promise<{ failed: number; fixed: number }> {
  const broken = rows
    .map((row, index) => ({ row, index, error: row.type === "EQUATION" ? texError(row.text) : null }))
    .filter((e): e is { row: BlockRow; index: number; error: string } => e.error !== null)
    .slice(0, MAX_TEX_REPAIRS);
  if (broken.length === 0) return { failed: 0, fixed: 0 };
  const messages: ModelMessage[] = [
    {
      role: "user",
      content: fixTexPrompt({
        equations: broken.map((b, i) => ({ index: i, tex: b.row.text, error: b.error })),
      }),
    },
  ];
  const convertCall = await featureCall("convert", HANDWRITTEN_EFFORT);
  const result = await callForJson({
    model: convertCall.model,
    messages,
    maxOutputTokens: 32768,
    providerOptions: convertCall.providerOptions,
    schema: fixTexOutputSchema,
    label: "CONVERT_FIX_TEX",
    usage: { userId, feature: "convert", model: convertCall.modelId },
  });
  if (!result.ok) {
    console.warn(`[convert] TeX repair failed, keeping raw TeX: ${result.error}`);
    return { failed: broken.length, fixed: 0 };
  }
  let fixed = 0;
  for (const fix of result.data.fixes) {
    const target = broken[fix.index];
    const text = fix.text.trim();
    if (!target || texError(text) !== null) continue;
    rows[target.index] = { ...target.row, text };
    fixed++;
  }
  return { failed: broken.length, fixed };
}

export type TranscribedBlock = BlockRow;

// A scan's read (SPEC.md §16) runs inside the add, against the add's time
// limit: small batches, every batch at once (the page cap makes 15 at most),
// each sent as soon as its pages are drawn.
const SCAN_BATCH_PAGES = 4;
const SCAN_TIME_UP = "The time to read the pages ran out";

type PageImageInput = { page: number; image: Uint8Array; mediaType: "image/png" | "image/jpeg" };

/** A read that may fail before anything awaits it: the failure is held for
    the allSettled that judges every read, never thrown unhandled. */
function handled<T>(read: Promise<T>): Promise<T> {
  read.catch(() => {});
  return read;
}

/** The pages read into text blocks (SPEC.md §16), the words verbatim: kind
    handwritten for notes and drawings, scan for printed or typed pages
    whose text layer is missing. Pages render to images and transcribe in
    batches that run together; one failed batch, or one page that does not
    render, fails the read with its reason — a partial text never lands
    silently. Past MAX_PAGES the cut is declared in a final paragraph.
    signal aborts the model calls; onPages reports the pages read so far.
    Throws on failure. */
export async function transcribePages(
  bytes: Uint8Array,
  pages: number[],
  opts: {
    userId: string | null;
    kind: "handwritten" | "scan";
    signal?: AbortSignal;
    onPages?: (done: number, total: number) => void;
  },
): Promise<TranscribedBlock[]> {
  const { userId, kind, signal, onPages } = opts;
  const usePages = pages.slice(0, MAX_PAGES);
  const pageCount = pages.length;
  let read = 0;

  async function readBatch(batch: PageImageInput[]): Promise<ConvertedBlock[]> {
    const first = batch[0].page;
    const last = batch[batch.length - 1].page;
    const range = { firstPage: first, lastPage: last, pageCount };
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: kind === "scan" ? scanPrompt(range) : convertPrompt(range) },
          ...batch.map(({ image, mediaType }) => ({ type: "file" as const, data: image, mediaType })),
        ],
      },
    ];
    const convertCall = await featureCall("convert", kind === "scan" ? SCAN_EFFORT : HANDWRITTEN_EFFORT);
    const result = await callForJson({
      model: convertCall.model,
      messages,
      maxOutputTokens: 65536, // dense pages transcribe long
      providerOptions: convertCall.providerOptions,
      schema: convertOutputSchema,
      label: kind === "scan" ? "SCAN" : "CONVERT",
      usage: { userId, feature: "convert", model: convertCall.modelId },
      abortSignal: signal,
    });
    if (!result.ok) {
      throw new Error(signal?.aborted ? SCAN_TIME_UP : `Pages ${first}-${last} did not convert: ${result.error}`);
    }
    read += batch.length;
    onPages?.(read, usePages.length);
    // A page number outside the batch is a model slip; clamp into the batch.
    const inBatch = new Set(batch.map((b) => b.page));
    return result.data.blocks.map((b) => ({ ...b, page: inBatch.has(b.page) ? b.page : first }));
  }

  let results: ConvertedBlock[][];
  if (kind === "scan") {
    // One open of the PDF draws the pages in order; a batch goes to the
    // model as soon as its pages are drawn.
    const reads: Promise<ConvertedBlock[]>[] = [];
    let batch: PageImageInput[] = [];
    const drawn = new Set<number>();
    await renderPdfPagesJpeg(bytes, usePages, PAGE_IMAGE_WIDTH, async (page, image) => {
      if (signal?.aborted) return false;
      drawn.add(page);
      batch.push({ page, image, mediaType: "image/jpeg" });
      if (batch.length === SCAN_BATCH_PAGES) {
        reads.push(handled(readBatch(batch)));
        batch = [];
      }
    });
    if (batch.length > 0) reads.push(handled(readBatch(batch)));
    // Every read settles before the outcome is judged: none runs on unseen.
    const settled = await Promise.allSettled(reads);
    if (signal?.aborted) throw new Error(SCAN_TIME_UP);
    const missing = usePages.find((page) => !drawn.has(page));
    if (missing !== undefined) throw new Error(`Page ${missing} did not render`);
    const failed = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason));
    results = settled.map((r) => (r as PromiseFulfilledResult<ConvertedBlock[]>).value);
  } else {
    const batches: number[][] = [];
    for (let i = 0; i < usePages.length; i += BATCH_PAGES) {
      batches.push(usePages.slice(i, i + BATCH_PAGES));
    }
    // Batches run together (BATCH_CONCURRENCY at a time); results keep batch order.
    results = new Array<ConvertedBlock[]>(batches.length);
    let next = 0;
    const worker = async () => {
      for (;;) {
        const index = next++;
        if (index >= batches.length) return;
        const images: PageImageInput[] = [];
        for (const page of batches[index]) {
          images.push({ page, image: await renderPdfPage(bytes, page, PAGE_IMAGE_WIDTH), mediaType: "image/png" });
        }
        results[index] = await readBatch(images);
      }
    };
    await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, batches.length) }, () => worker()));
  }

  const rows = results.flat().map(toBlockRow).filter((b) => b.text.trim().length > 0);
  if (rows.length === 0) throw new Error("No text found on the pages");
  const repair = await repairEquations(rows, userId);
  if (repair.failed > 0) {
    console.log(`[convert] ${repair.fixed}/${repair.failed} equations repaired`);
  }
  // Past the page cap, the cut is declared, never silent (SPEC.md §7 discipline).
  if (pageCount > MAX_PAGES) {
    rows.push({
      type: "PARAGRAPH",
      text: `[Conversion stopped at page ${MAX_PAGES} of ${pageCount}.]`,
      html: null,
      page: MAX_PAGES,
    });
  }
  return rows;
}

export async function runConversion(
  documentId: string,
  userId: string | null = null,
): Promise<ConversionResult> {
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: {
      handwritten: true,
      fileData: true,
      conversionStatus: true,
      conversionStartedAt: true,
      blocks: {
        where: { type: "PAGE" },
        orderBy: { order: "asc" },
        select: { page: true },
      },
    },
  });
  if (!document) return { ok: false, status: 404, error: "Document not found" };
  if (!document.handwritten) {
    return { ok: false, status: 400, error: "This document is not handwritten" };
  }
  if (!document.fileData) {
    return { ok: false, status: 400, error: "This document has no stored PDF" };
  }
  if (!(await featureConfigured("convert"))) {
    return { ok: false, status: 503, error: "Set ANTHROPIC_API_KEY. Conversion needs it." };
  }
  const pages = document.blocks.map((b) => b.page).filter((p): p is number => p !== null);
  if (pages.length === 0) {
    return { ok: false, status: 400, error: "This document has no pages" };
  }
  // A PENDING older than 10 minutes is a dead run (the function timed out or
  // crashed before writing FAILED) and may start again.
  const running =
    document.conversionStatus === "PENDING" &&
    document.conversionStartedAt !== null &&
    Date.now() - document.conversionStartedAt.getTime() < CONVERT_STALE_MS;
  if (running) {
    return { ok: false, status: 409, error: "Conversion is already running" };
  }

  // The run's stamp: its text lands only while the document is still these
  // pages and this run is still its conversion.
  const startedAt = new Date();
  await db.document.update({
    where: { id: documentId },
    data: { conversionStatus: "PENDING", conversionError: null, conversionStartedAt: startedAt },
  });
  // Every status change bumps: open workspaces see the run start, the text
  // land, or the failure — whoever started it.
  await bumpDocument(documentId);

  try {
    const rows = await transcribePages(new Uint8Array(document.fileData), pages, { userId, kind: "handwritten" });
    const usePages = pages.slice(0, MAX_PAGES);

    const written = await db.$transaction(async (tx) => {
      // A shape switch or a re-parse while the pages converted (SPEC.md §16):
      // the document is no longer these pages, or another run converts them,
      // and this text is not written.
      const [current] = await tx.$queryRaw<{ handwritten: boolean; conversionStartedAt: Date | null }[]>`
        SELECT "handwritten", "conversionStartedAt" FROM "Document" WHERE "id" = ${documentId} FOR UPDATE`;
      if (!current?.handwritten || current.conversionStartedAt?.getTime() !== startedAt.getTime()) return false;
      // Convert again redoes the text: previous converted blocks go, the PAGE
      // blocks stay — page anchors never move. Anchors on replaced text blocks
      // re-resolve by quote or orphan visibly (SPEC.md §5). The text goes
      // after the last page's order: a page removed leaves a gap in the
      // orders, never text among the pages.
      await tx.block.deleteMany({ where: { documentId, type: { not: "PAGE" } } });
      const lastPage = await tx.block.findFirst({ where: { documentId, type: "PAGE" }, orderBy: { order: "desc" }, select: { order: true } });
      const afterPages = (lastPage?.order ?? -1) + 1;
      await tx.block.createMany({
        data: rows.map((b, i) => ({
          documentId,
          order: afterPages + i,
          type: b.type,
          text: b.text,
          html: b.html,
          page: b.page,
        })),
      });
      await tx.document.update({
        where: { id: documentId },
        data: { conversionStatus: "READY", conversionError: null },
      });
      return true;
    });
    if (!written) return { ok: false, status: 409, error: "The document changed while its pages converted" };
    await bumpDocument(documentId);
    console.log(`[convert] ${documentId}: ${rows.length} blocks from ${usePages.length} pages`);
    // The converted text is the document's text: its skeleton builds now
    // (SPEC.md §22). A failure here is the skeleton's, never the conversion's.
    await refreshSkeleton(documentId, userId).catch((err: unknown) => console.warn("[convert] skeleton failed:", err));
    return { ok: true, blocks: rows.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Conversion failed";
    console.error("[convert] failed:", err);
    // Only this run's failure: a document that changed shape since keeps its state.
    await db.document.updateMany({
      where: { id: documentId, conversionStartedAt: startedAt },
      data: { conversionStatus: "FAILED", conversionError: message },
    });
    await bumpDocument(documentId);
    return { ok: false, status: 502, error: message };
  }
}

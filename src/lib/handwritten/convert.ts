import { anthropic } from "@ai-sdk/anthropic";
import type { ConversionStatus } from "@prisma/client";
import type { ModelMessage } from "ai";
import { z } from "zod";
import { bumpDocument } from "@/lib/collab";
import { db } from "@/lib/db";
import { CONVERT_MODEL } from "@/lib/derive/config";
import { callForJson } from "@/lib/derive/json-call";
import { PAGE_IMAGE_WIDTH, renderPdfPage } from "@/lib/handwritten/pages";
import { convertPrompt } from "@/lib/prompts/convert";

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

// Table html with the invisible cell separators the PDF parse uses, so the
// table's DOM text equals block text exactly — text anchors inside tables
// depend on this (SPEC.md §5). The first row renders as the header row.
function tableHtml(text: string): string {
  const rows = text.split("\n").map((r) => r.split("\t"));
  const rowHtml = (cells: string[], tag: "td" | "th", rowIdx: number) =>
    `<tr>${cells
      .map((c, cellIdx) => {
        const last = cellIdx === cells.length - 1;
        const gap = last
          ? rowIdx === rows.length - 1
            ? ""
            : '<span class="cell-gap">\n</span>'
          : '<span class="cell-gap">\t</span>';
        return `<${tag}>${escapeHtml(c)}${gap}</${tag}>`;
      })
      .join("")}</tr>`;
  if (rows.length === 1) return `<table><tbody>${rowHtml(rows[0], "td", 0)}</tbody></table>`;
  return (
    "<table>" +
    `<thead>${rowHtml(rows[0], "th", 0)}</thead>` +
    `<tbody>${rows.slice(1).map((r, i) => rowHtml(r, "td", i + 1)).join("")}</tbody>` +
    "</table>"
  );
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
  if (!process.env.ANTHROPIC_API_KEY) {
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

  await db.document.update({
    where: { id: documentId },
    data: { conversionStatus: "PENDING", conversionError: null, conversionStartedAt: new Date() },
  });
  // Every status change bumps: open workspaces see the run start, the text
  // land, or the failure — whoever started it.
  await bumpDocument(documentId);

  try {
    const bytes = new Uint8Array(document.fileData);
    const usePages = pages.slice(0, MAX_PAGES);
    const pageCount = pages.length;

    const batches: number[][] = [];
    for (let i = 0; i < usePages.length; i += BATCH_PAGES) {
      batches.push(usePages.slice(i, i + BATCH_PAGES));
    }

    // Batches run together (BATCH_CONCURRENCY at a time); results keep batch order.
    const results = new Array<ConvertedBlock[]>(batches.length);
    let next = 0;
    const worker = async () => {
      for (;;) {
        const index = next++;
        if (index >= batches.length) return;
        const batch = batches[index];
        const images: { page: number; image: Uint8Array }[] = [];
        for (const page of batch) {
          images.push({ page, image: await renderPdfPage(bytes, page, PAGE_IMAGE_WIDTH) });
        }
        const messages: ModelMessage[] = [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: convertPrompt({
                  firstPage: batch[0],
                  lastPage: batch[batch.length - 1],
                  pageCount,
                }),
              },
              ...images.map(({ image }) => ({
                type: "image" as const,
                image,
                mediaType: "image/png",
              })),
            ],
          },
        ];
        const result = await callForJson({
          model: anthropic(CONVERT_MODEL),
          messages,
          maxOutputTokens: 32768, // dense pages transcribe long
          schema: convertOutputSchema,
          label: "CONVERT",
          usage: { userId, feature: "convert", model: CONVERT_MODEL },
        });
        if (!result.ok) {
          throw new Error(
            `Pages ${batch[0]}-${batch[batch.length - 1]} did not convert: ${result.error}`,
          );
        }
        // A page number outside the batch is a model slip; clamp into the batch.
        results[index] = result.data.blocks.map((b) => ({
          ...b,
          page: batch.includes(b.page) ? b.page : batch[0],
        }));
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(BATCH_CONCURRENCY, batches.length) }, () => worker()),
    );

    const rows = results.flat().map(toBlockRow).filter((b) => b.text.trim().length > 0);
    if (rows.length === 0) throw new Error("No text found on the pages");
    // Past the page cap, the cut is declared, never silent (SPEC.md §7 discipline).
    if (pageCount > MAX_PAGES) {
      rows.push({
        type: "PARAGRAPH",
        text: `[Conversion stopped at page ${MAX_PAGES} of ${pageCount}.]`,
        html: null,
        page: MAX_PAGES,
      });
    }

    await db.$transaction(async (tx) => {
      // Convert again redoes the text: previous converted blocks go, the PAGE
      // blocks stay — page anchors never move. Anchors on replaced text blocks
      // re-resolve by quote or orphan visibly (SPEC.md §5).
      await tx.block.deleteMany({ where: { documentId, type: { not: "PAGE" } } });
      await tx.block.createMany({
        data: rows.map((b, i) => ({
          documentId,
          order: pages.length + i,
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
    });
    await bumpDocument(documentId);
    console.log(`[convert] ${documentId}: ${rows.length} blocks from ${usePages.length} pages`);
    return { ok: true, blocks: rows.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Conversion failed";
    console.error("[convert] failed:", err);
    await db.document.update({
      where: { id: documentId },
      data: { conversionStatus: "FAILED", conversionError: message },
    });
    await bumpDocument(documentId);
    return { ok: false, status: 502, error: message };
  }
}

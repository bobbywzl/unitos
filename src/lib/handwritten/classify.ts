import type { ModelMessage } from "ai";
import { z } from "zod";
import { HANDWRITTEN_EFFORT } from "@/lib/derive/config";
import { featureCall, featureConfigured } from "@/lib/feature-models";
import { callForJson } from "@/lib/derive/json-call";
import { CLASSIFY_IMAGE_WIDTH, renderPdfPage } from "@/lib/handwritten/pages";
import type { ParsedBlock } from "@/lib/parse/types";
import { classifyPrompt } from "@/lib/prompts/classify";

// Import PDF classification (SPEC.md §16): article, scan, or handwritten. A
// PDF whose text layer yielded article-scale text that reads like language is
// an article without a model call. Below that — or when the text layer is
// junk — the model reads sample page images and judges: a scan is printed or
// typed pages whose text layer is missing or garbled, read off the page
// images into text; handwritten is notes and drawings, kept as pages. Without
// a key or on failure, the character yield and the junk check decide alone.
export type PdfKind = "article" | "scan" | "handwritten";

// A typeset page carries thousands of characters; slides still carry hundreds.
const ARTICLE_CHARS_PER_PAGE = 250;
// Keyless fallback: almost no text layer reads as handwritten.
const FALLBACK_HANDWRITTEN_CHARS_PER_PAGE = 40;
const SAMPLE_PAGES = 3;

// Junk detection: handwriting apps embed garbled recognition output as the
// text layer ("rightrightfracleftleft…"), which passes the character yield
// while carrying no readable text. Real prose almost never runs 25+ ASCII
// letters and digits without a break; URLs and paths carry separators, and
// CJK text carries no spaces at all — neither counts. Past the share
// threshold the text layer is junk.
const JUNK_TOKEN_CHARS = 25;
const JUNK_SHARE = 0.15;

export function junkTextLayer(blocks: ParsedBlock[]): boolean {
  let total = 0;
  let junk = 0;
  for (const block of blocks) {
    total += block.text.length;
    for (const run of block.text.match(/[A-Za-z0-9]+/g) ?? []) {
      if (run.length >= JUNK_TOKEN_CHARS) junk += run.length;
    }
  }
  return total > 0 && junk / total >= JUNK_SHARE;
}

const classifyOutputSchema = z.object({ kind: z.enum(["article", "scan", "handwritten"]) });

/** The text layer holds next to no text, or junk: a parse of it is an empty
    document. A re-parse to computer text reads such a PDF off its page
    images instead (SPEC.md §16). */
export function textLayerEmpty(blocks: ParsedBlock[], pageCount: number): boolean {
  const textChars = blocks.reduce((n, b) => n + b.text.length, 0);
  return junkTextLayer(blocks) || textChars / Math.max(1, pageCount) < FALLBACK_HANDWRITTEN_CHARS_PER_PAGE;
}

// pages: the PDF's pages the document holds, 1-based: every page, or the
// pages the reader chose at the add (SPEC.md §15). blocks are theirs.
export async function classifyPdf(
  bytes: Uint8Array,
  blocks: ParsedBlock[],
  pages: number[],
  userId: string | null,
): Promise<PdfKind> {
  const pageCount = pages.length;
  const textChars = blocks.reduce((n, b) => n + b.text.length, 0);
  const perPage = textChars / Math.max(1, pageCount);
  const junk = junkTextLayer(blocks);
  if (perPage >= ARTICLE_CHARS_PER_PAGE && !junk) return "article";

  const fallback: PdfKind =
    junk || perPage < FALLBACK_HANDWRITTEN_CHARS_PER_PAGE ? "handwritten" : "article";
  if (!(await featureConfigured("classify")) || pageCount === 0) return fallback;

  // Sample pages: first, middle, last.
  const samples = [...new Set([pages[0], pages[Math.max(0, Math.ceil(pageCount / 2) - 1)], pages[pageCount - 1]])].slice(
    0,
    SAMPLE_PAGES,
  );
  const images: Uint8Array[] = [];
  for (const page of samples) {
    try {
      images.push(await renderPdfPage(bytes, page, CLASSIFY_IMAGE_WIDTH));
    } catch (err) {
      console.warn(`[handwritten] classify render failed (page ${page}):`, err);
    }
  }
  if (images.length === 0) return fallback;

  const messages: ModelMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: classifyPrompt({ pageCount, textChars, junk }) },
        ...images.map((image) => ({ type: "file" as const, data: image, mediaType: "image/png" })),
      ],
    },
  ];
  const classifyCall = await featureCall("classify", HANDWRITTEN_EFFORT);
  const result = await callForJson({
    model: classifyCall.model,
    messages,
    maxOutputTokens: 16384,
    providerOptions: classifyCall.providerOptions,
    schema: classifyOutputSchema,
    label: "CLASSIFY",
    usage: { userId, feature: "classify", model: classifyCall.modelId },
  });
  return result.ok ? result.data.kind : fallback;
}

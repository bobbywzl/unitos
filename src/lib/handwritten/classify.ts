import type { ModelMessage } from "ai";
import { z } from "zod";
import { CLASSIFY_MODEL } from "@/lib/derive/config";
import { callForJson } from "@/lib/derive/json-call";
import { CLASSIFY_IMAGE_WIDTH, renderPdfPage } from "@/lib/handwritten/pages";
import { kimi, kimiConfigured } from "@/lib/kimi";
import type { ParsedBlock } from "@/lib/parse/types";
import { classifyPrompt } from "@/lib/prompts/classify";

// Import PDF classification (SPEC.md §16): article or handwritten. A PDF whose
// text layer yielded article-scale text that reads like language is an article
// without a model call. Below that — or when the text layer is junk — the
// model reads sample page images and judges. Without a key or on failure, the
// character yield and the junk check decide alone.
export type PdfKind = "article" | "handwritten";

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

const classifyOutputSchema = z.object({ kind: z.enum(["article", "handwritten"]) });

export async function classifyPdf(
  bytes: Uint8Array,
  blocks: ParsedBlock[],
  pageCount: number,
  userId: string | null,
): Promise<PdfKind> {
  const textChars = blocks.reduce((n, b) => n + b.text.length, 0);
  const perPage = textChars / Math.max(1, pageCount);
  const junk = junkTextLayer(blocks);
  if (perPage >= ARTICLE_CHARS_PER_PAGE && !junk) return "article";

  const fallback: PdfKind =
    junk || perPage < FALLBACK_HANDWRITTEN_CHARS_PER_PAGE ? "handwritten" : "article";
  if (!kimiConfigured()) return fallback;

  // Sample pages: first, middle, last.
  const samples = [...new Set([1, Math.max(1, Math.ceil(pageCount / 2)), pageCount])].slice(
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
  const result = await callForJson({
    model: kimi(CLASSIFY_MODEL),
    messages,
    maxOutputTokens: 16384,
    schema: classifyOutputSchema,
    label: "CLASSIFY",
    usage: { userId, feature: "classify", model: CLASSIFY_MODEL },
  });
  return result.ok ? result.data.kind : fallback;
}

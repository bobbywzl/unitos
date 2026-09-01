import { anthropic } from "@ai-sdk/anthropic";
import type { ModelMessage } from "ai";
import { z } from "zod";
import { CLASSIFY_MODEL } from "@/lib/derive/config";
import { callForJson } from "@/lib/derive/json-call";
import { CLASSIFY_IMAGE_WIDTH, renderPdfPage } from "@/lib/handwritten/pages";
import type { ParsedBlock } from "@/lib/parse/types";
import { classifyPrompt } from "@/lib/prompts/classify";

// Import PDF classification (SPEC.md §16): article or handwritten. A PDF whose
// text layer yielded article-scale text is an article without a model call.
// Below that, the model reads sample page images and judges. Without a key or
// on failure, the character yield decides alone.
export type PdfKind = "article" | "handwritten";

// A typeset page carries thousands of characters; slides still carry hundreds.
const ARTICLE_CHARS_PER_PAGE = 250;
// Keyless fallback: almost no text layer reads as handwritten.
const FALLBACK_HANDWRITTEN_CHARS_PER_PAGE = 40;
const SAMPLE_PAGES = 3;

const classifyOutputSchema = z.object({ kind: z.enum(["article", "handwritten"]) });

export async function classifyPdf(
  bytes: Uint8Array,
  blocks: ParsedBlock[],
  pageCount: number,
  userId: string | null,
): Promise<PdfKind> {
  const textChars = blocks.reduce((n, b) => n + b.text.length, 0);
  const perPage = textChars / Math.max(1, pageCount);
  if (perPage >= ARTICLE_CHARS_PER_PAGE) return "article";

  const fallback: PdfKind =
    perPage < FALLBACK_HANDWRITTEN_CHARS_PER_PAGE ? "handwritten" : "article";
  if (!process.env.ANTHROPIC_API_KEY) return fallback;

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
        { type: "text", text: classifyPrompt({ pageCount, textChars }) },
        ...images.map((image) => ({ type: "image" as const, image, mediaType: "image/png" })),
      ],
    },
  ];
  const result = await callForJson({
    model: anthropic(CLASSIFY_MODEL),
    messages,
    maxOutputTokens: 2048,
    schema: classifyOutputSchema,
    label: "CLASSIFY",
    usage: { userId, feature: "classify", model: CLASSIFY_MODEL },
  });
  return result.ok ? result.data.kind : fallback;
}

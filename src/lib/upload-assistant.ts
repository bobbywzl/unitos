import { anthropic } from "@ai-sdk/anthropic";
import { JSDOM } from "jsdom";
import type { ModelMessage } from "ai";
import { z } from "zod";
import { UPLOAD_MODEL } from "@/lib/derive/config";
import { callForJson } from "@/lib/derive/json-call";
import { currentLang, serverT } from "@/lib/i18n/server";
import type { OnIngestProgress } from "@/lib/parse/ingest";
import { pageEstimate, SPLIT_ASK_PAGES, splitPartCount } from "@/lib/parse/split";
import { fetchPageHtml, parseHtmlContent } from "@/lib/parse/url";
import { uploadInstructionsPrompt } from "@/lib/prompts/upload-instructions";
import { uploadReviewPrompt } from "@/lib/prompts/upload-review";

// The upload assistant's server side (SPEC.md §14). review: fetch the page in
// a private sandbox — the page never touches the reader's browser — parse it
// exactly as ingest would, and report how the content should be added: what it
// is, which linked pages are parts of the same work, whether to split, and an
// answer to each upload instruction. check: answer the instructions alone.
// Both are advisory; ingest itself never depends on them.

const EXCERPT_HEAD_CHARS = 6_000;
const EXCERPT_TAIL_CHARS = 1_500;
const MAX_LINK_CANDIDATES = 60;
const MAX_PAGES = 30;
// The model may propose a split below the always-ask threshold, but never for
// content this short.
const SPLIT_MODEL_FLOOR_PAGES = 15;

export type InstructionReply = { instruction: string; willFollow: boolean; reply: string };

export type UploadReview = {
  title: string | null;
  kind: "article" | "index" | "other";
  summary: string;
  advice: string[];
  chars: number;
  blockCount: number;
  figures: number;
  equations: number;
  pageEstimate: number;
  pasteThisPage: boolean;
  pages: { url: string; title: string; recommended: boolean }[];
  splitProposed: boolean;
  splitReason: string;
  splitParts: number;
  replies: InstructionReply[];
  feasible: string;
};

export type InstructionCheck = { replies: InstructionReply[]; feasible: string };

const replySchema = z.object({
  instruction: z.string().min(1).max(600),
  willFollow: z.boolean(),
  reply: z.string().min(1).max(600),
});

const reviewSchema = z.object({
  kind: z.enum(["article", "index", "other"]),
  summary: z.string().max(800),
  advice: z.array(z.string().min(1).max(400)).max(6),
  pages: z
    .array(
      z.object({
        link: z.number().int().min(1),
        title: z.string().max(200),
        recommended: z.boolean(),
      }),
    )
    .max(60),
  pasteThisPage: z.boolean(),
  split: z.object({ recommended: z.boolean(), reason: z.string().max(400) }),
  replies: z.array(replySchema).max(16).optional(),
  feasible: z.string().max(2_000).optional(),
});

const checkSchema = z.object({
  replies: z.array(replySchema).max(16),
  feasible: z.string().max(2_000),
});

type LinkCandidate = { url: string; text: string };

function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// Assets and files the URL ingest cannot read as an article.
const NON_PAGE_RX =
  /\.(png|jpe?g|gif|svg|webp|avif|ico|css|js|json|xml|zip|gz|mp4|webm|mov|mp3|m4a|wav|flac|ogg|pdf|woff2?)(\?|$)/i;

function hostOf(url: URL): string {
  return url.host.replace(/^www\./, "");
}

/** Same-site linked pages from the raw HTML, in document order, deduped —
    harvested before any pruning, because a series' table of contents often
    lives in the navigation the content walk drops. */
export function harvestLinks(rawHtml: string, url: string): LinkCandidate[] {
  const dom = new JSDOM(rawHtml, { url });
  const base = new URL(url);
  const selfPath = base.pathname.replace(/\/$/, "");
  const seen = new Map<string, LinkCandidate>();
  for (const a of dom.window.document.querySelectorAll("a[href]")) {
    if (seen.size >= MAX_LINK_CANDIDATES) break;
    let target: URL;
    try {
      target = new URL(a.getAttribute("href") ?? "", base);
    } catch {
      continue;
    }
    if (target.protocol !== "https:" && target.protocol !== "http:") continue;
    if (hostOf(target) !== hostOf(base)) continue;
    if (NON_PAGE_RX.test(target.pathname)) continue;
    target.hash = "";
    if (target.pathname.replace(/\/$/, "") === selfPath && target.search === base.search) continue;
    const clean = target.toString();
    const text =
      normalizeText(a.textContent ?? "").slice(0, 120) ||
      decodeURIComponent(target.pathname.split("/").filter(Boolean).pop() ?? "");
    const existing = seen.get(clean);
    // The first named occurrence wins; a later, longer text fills an empty one.
    if (!existing) seen.set(clean, { url: clean, text });
    else if (!existing.text && text) existing.text = text;
  }
  return [...seen.values()];
}

function excerpt(texts: string[], budget: number): string {
  const parts: string[] = [];
  let used = 0;
  for (const text of texts) {
    if (used >= budget) break;
    const slice = text.slice(0, budget - used);
    parts.push(slice);
    used += slice.length + 1;
  }
  return parts.join("\n");
}

// The last blocks, in reading order.
function tailExcerpt(texts: string[], budget: number): string {
  const parts: string[] = [];
  let used = 0;
  for (let i = texts.length - 1; i >= 0 && used < budget; i--) {
    const slice = texts[i].slice(Math.max(0, texts[i].length - (budget - used)));
    parts.unshift(slice);
    used += slice.length + 1;
  }
  return parts.join("\n");
}

/** Review a URL before anything is saved. Never throws on model trouble: a
    failed or keyless model call degrades to the parsed facts, with instructions
    answered honestly as uncheckable. */
export async function reviewUpload(
  url: string,
  instructions: string,
  userId: string | null,
  onProgress?: OnIngestProgress,
): Promise<UploadReview> {
  const lang = await currentLang();
  const t = await serverT();

  onProgress?.("fetch");
  const rawHtml = await fetchPageHtml(url);
  onProgress?.("extract");
  const parsed = await parseHtmlContent(rawHtml, url);
  const links = harvestLinks(rawHtml, url);

  const chars = parsed.blocks.reduce((n, b) => n + b.text.length, 0);
  const pages = pageEstimate(chars);
  const texts = parsed.blocks.map((b) => b.text);
  const review: UploadReview = {
    title: parsed.title,
    kind: "article",
    summary: "",
    advice: [],
    chars,
    blockCount: parsed.blocks.length,
    figures: parsed.blocks.filter((b) => b.type === "FIGURE").length,
    equations: parsed.blocks.filter((b) => b.type === "EQUATION").length,
    pageEstimate: pages,
    pasteThisPage: true,
    pages: [],
    splitProposed: pages >= SPLIT_ASK_PAGES,
    splitReason: "",
    splitParts: splitPartCount(chars),
    replies: instructions
      ? [{ instruction: instructions, willFollow: false, reply: t("api.instructionsUnchecked") }]
      : [],
    feasible: "",
  };
  if (!process.env.ANTHROPIC_API_KEY) return review;

  onProgress?.("review");
  const prompt = uploadReviewPrompt({
    lang,
    url,
    title: parsed.title,
    pageEstimate: pages,
    blockCount: parsed.blocks.length,
    figures: review.figures,
    equations: review.equations,
    excerptHead: excerpt(texts, EXCERPT_HEAD_CHARS),
    excerptTail:
      chars > EXCERPT_HEAD_CHARS + EXCERPT_TAIL_CHARS
        ? tailExcerpt(texts, EXCERPT_TAIL_CHARS)
        : "",
    links: links.map((l, i) => `[link ${i + 1}] "${l.text}" — ${l.url}`).join("\n"),
    instructions,
  });
  const messages: ModelMessage[] = [{ role: "user", content: prompt }];
  const result = await callForJson({
    model: anthropic(UPLOAD_MODEL),
    messages,
    maxOutputTokens: 8192,
    schema: reviewSchema,
    label: "UPLOAD_REVIEW",
    usage: { userId, feature: "upload", model: UPLOAD_MODEL },
  });
  if (!result.ok) {
    console.warn("[upload] review model call failed:", result.error);
    return review;
  }

  // Pages resolve by link number against the real harvested links — a page the
  // model invented does not exist and drops (SPEC.md §4 discipline).
  const seenUrls = new Set<string>();
  for (const page of result.data.pages) {
    if (review.pages.length >= MAX_PAGES) break;
    const candidate = links[page.link - 1];
    if (!candidate || seenUrls.has(candidate.url)) continue;
    seenUrls.add(candidate.url);
    review.pages.push({
      url: candidate.url,
      title: normalizeText(page.title) || candidate.text || candidate.url,
      recommended: page.recommended,
    });
  }
  review.kind = result.data.kind;
  review.summary = result.data.summary;
  review.advice = result.data.advice;
  review.pasteThisPage = result.data.pasteThisPage;
  review.splitProposed =
    review.splitProposed ||
    (result.data.split.recommended && pages >= SPLIT_MODEL_FLOOR_PAGES);
  review.splitReason = result.data.split.reason;
  review.replies = result.data.replies ?? review.replies;
  review.feasible = result.data.feasible ?? "";
  return review;
}

/** Answer upload instructions without a page review — the check before a PDF
    or a re-stated URL upload. Video is deterministic: nothing in a media
    ingest can follow upload instructions, and the assistant says so. */
export async function checkInstructions(
  kind: "url" | "pdf" | "video",
  instructions: string,
  userId: string | null,
): Promise<InstructionCheck> {
  if (!instructions) return { replies: [], feasible: "" };
  const t = await serverT();
  if (kind === "video") {
    return {
      replies: [{ instruction: instructions, willFollow: false, reply: t("api.instructionsVideo") }],
      feasible: "",
    };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      replies: [
        { instruction: instructions, willFollow: false, reply: t("api.instructionsUnchecked") },
      ],
      feasible: "",
    };
  }
  const lang = await currentLang();
  const messages: ModelMessage[] = [
    { role: "user", content: uploadInstructionsPrompt({ lang, kind, instructions }) },
  ];
  const result = await callForJson({
    model: anthropic(UPLOAD_MODEL),
    messages,
    maxOutputTokens: 4096,
    schema: checkSchema,
    label: "UPLOAD_INSTRUCTIONS",
    usage: { userId, feature: "upload", model: UPLOAD_MODEL },
  });
  if (!result.ok) {
    console.warn("[upload] instruction check failed:", result.error);
    return {
      replies: [
        { instruction: instructions, willFollow: false, reply: t("api.instructionsUnchecked") },
      ],
      feasible: "",
    };
  }
  return result.data;
}

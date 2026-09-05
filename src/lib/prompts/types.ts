import type { Lang } from "@/lib/i18n/config";
import type { FormalizeFormat, SummaryDepth } from "@/lib/types";

// Context passed to every prompt template. Templates are one file per DerivationType,
// each exporting a single function (ctx) => string (CLAUDE.md).
// The reader's context comes from the Context tab: stored as ReaderProfile globally,
// as notebook.profile when a work overrides it. Any field may be empty.
export type ReaderProfileCtx = {
  background: string;
  purpose: string;
  application: string;
} | null;

export type PromptCtx = {
  profile: ReaderProfileCtx;
  // The reader's UI language. Assistant-voice output (explanations, captions,
  // summaries, answers) is written in it; content rewrites (SIMPLIFY,
  // FORMALIZE) keep the content's language instead.
  lang: Lang;
  documentTitle: string;
  // Anchored selection with surrounding context (±2 blocks), for selection-level derivations.
  anchoredText: string;
  contextBefore: string;
  contextAfter: string;
  // Section skeleton of the notebook.
  sectionSkeleton: { id: string; title: string; parentTitle: string | null }[];
  // The reader's question, for DISTILL.
  question?: string;
  // Summary depth, for SUMMARIZE.
  depth?: SummaryDepth;
  // Set when EXPLAIN targets a figure block: the model deciphers the visual.
  // kind image: the image is attached to the message. kind svg: the chart's SVG
  // source is in svgSource. kind video: the model only has caption and context.
  figure?: {
    kind: "image" | "svg" | "video" | "figure";
    caption: string;
    svgSource?: string;
    // The attached image is the PDF page the figure sits on, not the figure alone.
    page?: boolean;
  };
  // Set when EXPLAIN targets a moment of a video or audio document (SPEC.md
  // §11). hasFrame: the paused frame is attached to the message; hasRegion:
  // the reader circled a spot and the frame is cropped toward it.
  // previewFrame: the attached frame is a small storyboard preview, not a
  // full-resolution capture. frameDescription: a vision model watched the same
  // clip at full resolution and this is what it saw. audio: an audio document
  // — no frame exists; the transcript is everything.
  video?: {
    timeRange: string; // "0:12–0:31"
    transcriptExcerpt: string; // transcript at that range; "" = none
    hasFrame: boolean;
    hasRegion: boolean;
    previewFrame?: boolean;
    frameDescription?: string;
    audio?: boolean;
  };
  // Set when EXPLAIN targets a circled spot on a handwritten page (SPEC.md
  // §16): Circle & ask. The page image is attached; hasCrop: the circled part
  // is attached too, enlarged. question: what the reader typed; absent = explain.
  page?: { number: number; hasCrop: boolean; question?: string };
  // The search, for FIND.
  query?: string;
  // The destination shape, for FORMALIZE: a formal article for publishing, or
  // personal bullet-point notes.
  format?: FormalizeFormat;
  // Set for COMPARE: the two documents, both rendered above under their ids.
  compare?: { first: { id: string; title: string }; second: { id: string; title: string } };
  // Set when ANALYZE targets a TABLE block: the table's markup is in html;
  // hasImage: the table's rendered page region is attached as well.
  table?: { html: string; hasImage: boolean };
  // Set for ANALYZE: whether corpus context follows the document (the
  // reader's other documents, notes, and annotations), so the prompt asks
  // for links to it only when it is there.
  corpus?: boolean;
};

// The one style line every template carries (CLAUDE.md rule 7). The tools
// read beside the article, in a card: every sentence has to earn its place.
export const STYLE_RULE =
  "Style: short sentences, plain words, one point per sentence. No preamble, no filler, no closing summary. Say only what the reader needs.";

// The one language line appended to assistant-voice templates. Repeated exact
// wording across templates (CLAUDE.md rule 3).
export function answerLanguage(lang: Lang): string {
  return lang === "zh" ? "Answer in Chinese (简体中文)." : "Answer in English.";
}

// The language name for JSON-field instructions ("Write captions in …").
export function languageName(lang: Lang): string {
  return lang === "zh" ? "Chinese (简体中文)" : "English";
}

export function profileLines(profile: ReaderProfileCtx): string {
  const fields = profile
    ? (
        [
          ["Background", profile.background],
          ["Purpose", profile.purpose],
          ["Application", profile.application],
        ] as const
      ).filter(([, value]) => value.trim() !== "")
    : [];
  if (fields.length === 0) {
    return "Reader context: not set. Assume a technically literate generalist.";
  }
  return ["Reader context:", ...fields.map(([label, value]) => `- ${label}: ${value}`)].join("\n");
}

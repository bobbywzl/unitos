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
  // VISUALIZE (SPEC.md §20): the reader was told the picture may not be
  // accurate and confirmed. The model draws its best picture anyway.
  confirmed?: boolean;
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
  // The model can search the web (SPEC.md §7): EXPLAIN, ANALYZE, and ASK
  // carry WEB_LINES when it is set.
  web?: boolean;
};

// The one style line every template carries (CLAUDE.md rule 7). The tools
// read beside the article, in a card: every sentence has to earn its place.
export const STYLE_RULE =
  "Style: work the whole answer out before you write a word; write only the result. Say the answer first, then the reasoning that earns it. Short sentences, one point per sentence, the plainest words that say it — words anyone would know, not the field's, unless the material's own term is the one the reader needs. No idioms, no preamble, no filler, no restating the question, no closing summary, no headings for a short answer. Use technical language only where the material does. Then, when there is one, name in one or two lines the thing most likely to trip the reader up here — a term, a step, a wrong assumption, a gap in the material — and clear it.";

// The one core line every template that explains or answers carries (an
// explanation, an analysis, an answer of the assistant): the reader asked to
// understand, so the answer finds what the words really say and says that,
// briefly — neither a gloss that restates the words nor an essay. Repeated
// exact wording across templates (CLAUDE.md rule 7).
export const CORE_RULE =
  "Core: before you write, find the core: what the words really say and why it matters here, read in the light of the whole document. Open with the core in one or two sentences, in plain words. Then give only what the reader needs to hold it: the reasoning step it rests on, the term or the step they would miss, the link to another part of the document that changes how it reads, the limit or the other reading where there is one. Combine the material: when the document, another document of the project, and the reader's notes speak to the same point, make it one point and cite each, never a paragraph each. Every sentence adds a reason, a link, or a consequence the reader did not have; a sentence that restates the words or the core is deleted.";

// The length line of an answer that explains: the shortest answer that
// carries the core and its reasoning.
export const ANSWER_LENGTH =
  "Length: the shortest answer that carries the core and its reasoning. A lookup (a name, a number, a place in the document) takes one to three sentences. A question of meaning, argument, or interpretation usually takes 80 to 200 words; go longer only when the reader asks for detail or the reasoning needs more steps. Use markdown: short paragraphs, bold for the one or two key terms, no headings.";

// The connection line every template that reads the reader's notes and
// annotations carries: what the reader already wrote is named where it bears
// on the answer, so the answer joins their previous work. Repeated exact
// wording across templates (CLAUDE.md rule 7).
export const CONNECTION_RULE =
  'Connection to previous work: when one of the reader\'s notes or annotations bears on this — it says the same thing, disagrees, extends it, or asks the question this answers — end with one short paragraph that opens with the bold label "Connection to your work:" (in the answer\'s language) and names each in a few words with its tag, [note <id>], and says how it connects. At most three, the strongest first. A note or annotation that only shares a word is not a connection. None bears on this: leave the paragraph out; never force one.';

// The one grounding line every assistant-voice template carries: what the
// tool says rests on the document, and the reader can check it. Repeated
// exact wording across templates (CLAUDE.md rule 7).
export const GROUNDING_RULE =
  "Grounding: every claim rests on the document. Cite the block a claim rests on as [block <id>], exactly as tagged above; the tag renders as a link the reader can click. Never add a fact the document does not state. When the document does not answer, say so in one sentence, then say what the document does say about it.";

// The one specificity line every assistant-voice template carries: the
// output is about this document, not about documents like it. Repeated
// exact wording across templates (CLAUDE.md rule 7).
export const SPECIFICITY_RULE =
  "Specificity: name the number, the term, the entity, the mechanism, the finding. Before you answer, read each sentence you wrote: a sentence that could be written about any other document on this subject is deleted. A sentence that restates the passage in other words is deleted.";

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

// The web rules every assistant surface that can search carries (SPEC.md
// §7): the material first, the web to check it and fill what it lacks,
// every web source cited. Repeated exact wording across templates.
export const WEB_LINES = [
  "You can search the web. Use it to verify the factual claims the material and your answer rest on against outside sources, and to add what the material lacks. Rules:",
  "1. Answer from the material first; the web checks it. Never present a web result as if it came from the material.",
  "2. Cite every web source you use as a markdown link at the point it supports, with the page title as the link text.",
  "3. When the web contradicts the material, say so plainly and show both sides.",
  '4. End with a section titled "Web sources" listing every web page you relied on as a markdown link, one per line. Leave the section out when you used none.',
];

// The reader's notes as the assistant reads them (SPEC.md §7): every note
// whole, up to NOTE_CHARS each, until the budget runs out; a cut is declared,
// never silent. "section: note", one note per paragraph; with its id, the
// note opens with its tag, [note <id>], so the answer can cite it
// (CONNECTION_RULE). An annotation passes its kind as sectionTitle.
const NOTE_CHARS = 3000;
export const READER_NOTES_BUDGET = 40_000;

export function readerNotesText(
  notes: { id?: string; sectionTitle: string; content: string }[],
  budget = READER_NOTES_BUDGET,
): string {
  if (notes.length === 0) return "none yet";
  const out: string[] = [];
  let left = budget;
  for (const n of notes) {
    const content = n.content.length > NOTE_CHARS ? `${n.content.slice(0, NOTE_CHARS)} [cut]` : n.content;
    const rendered = `${n.id ? `[note ${n.id}] ` : ""}${n.sectionTitle}: ${content}`;
    if (rendered.length > left) break;
    left -= rendered.length;
    out.push(rendered);
  }
  const cut = notes.length - out.length;
  return [...out, ...(cut > 0 ? [`[${cut} more note${cut === 1 ? "" : "s"} not shown]`] : [])].join("\n\n");
}

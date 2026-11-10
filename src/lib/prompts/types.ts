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
  // Set when EXPLAIN targets a highlighted spot on a handwritten page (SPEC.md
  // §16): Highlight & ask. The page image is attached; hasCrop: the highlighted part
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
  "Length: the shortest answer that carries the core and its reasoning. A lookup takes one to three sentences: a question of who, which, when, where, how many, or whether that the document answers in its own words, or what the document itself states about one thing (what it recommends, concludes, or reports). A question of meaning, argument, or interpretation that the document does not answer in one place (why, how two parts compare, what follows) usually takes 80 to 200 words; go longer only when the reader asks for detail or the reasoning needs more steps. Use markdown: short paragraphs, bold for the one or two key terms, no headings.";

// The assistant's answer (SPEC.md §7): the sidebar's and the selection chat's
// reply carry these four in place of ANSWER_LENGTH, GROUNDING_RULE, and
// STYLE_RULE, which stay the tools' (Explain, Analyze, Summarize, Ask on a
// range). The tools read beside the article in a card and stay short. The
// assistant is asked a question, and the depth of its answer follows the
// question: a lookup stays one to three sentences; a question of meaning
// gets an answer under labels — what the document says, what stands between
// the lines, the other side, what is known beyond the document — in core
// points, closed by a bottom line. An answer that only restates the passage
// in other words, when the reader asked what it means, is the fault these
// rules exist for.

/** The shape of the assistant's answer. Repeated exact wording in the
    sidebar's rules and the selection chat's (CLAUDE.md rule 7). */
export const ANSWER_SHAPE =
  [
    "Shape: the answer takes the shape its question needs. Decide which of the four the question is before you write.",
    "(a) A lookup: a question of who, which, when, where, how many, or how much that the document answers in its own words, or what one word means in it. One to three sentences in one paragraph, with no labels and no bullets of its own.",
    "(b) A question the document answers in one place, with a reason or a condition attached: whether or when something applies, what triggers it, how one rule or one step works, what a result shows, what the document recommends or concludes. A short answer of 40 to 120 words in one or two paragraphs, with no labels: the answer, the reason the document gives for it, and the condition, the exception, or the limit the document attaches to it, each on its block. The limit is part of the answer, never left out for shortness.",
    "(c) A question of meaning that the document does not answer in one place: what something means or might mean, why, what follows, how two things compare, whether a claim holds up, what to make of it, what is really going on, what someone has actually done. The answer is built in this order:",
    "  1. The core first: one or two sentences in plain words that answer the question.",
    "  2. Then two to four labels. A label is a short bold line of its own that names what its points say about this document (\"What the memo counts as fuel\", \"Where the estimate breaks\"), never a generic word where a specific one fits. Under each label, one to three points as bullets (\"- \"), never more than three, one sentence each, the fact or the number first. A point never repeats the core.",
    "  3. The labels cover, as far as the question and the material give them: what the document says, each point with its block; what stands between the lines: what the words imply, assume, leave out, or avoid, and why the author or the speaker would put it this way, said as a reading (\"this suggests\", \"the wording leaves room for\") with the words it rests on; the other side: what limits the claim or cuts against it, a condition, a cost, a risk, a second reading; and what is known beyond the document (the rule on beyond the document). When the question asks for what lies beyond the document, that label stands first, right after the core.",
    "  4. Then the bold label \"Bottom line:\" (in the answer's language) with one or two sentences that answer the question as asked: what it comes to for this reader, and what to check or watch when there is something to check. It adds the consequence; it never repeats the points and never opens a new subject.",
    "  Core points only: the points that change how the reader sees the passage. Three points that matter beat seven that are true. 120 to 280 words in all, up to 350 when the question asks for what lies beyond the document; longer only when the message asks for detail.",
    "(d) A message that asks for detail, a list, a table, or a comparison gets the length and the form it asks for.",
    "After any of the four, the paragraph on the reader's previous work follows when the connection rule gives one.",
  ].join("\n");

/** What the assistant brings from outside the document. web: the reader's
    Web toggle is on, so the facts are searched and sourced (WEB_LINES). */
export function beyondRule(web: boolean | undefined): string {
  return [
    "Beyond the document: the document is the first source and never the only one. Bring what you know from outside it when the question asks for it (what a company, a person, or a field has actually done, the history, what happened next, what a term means in practice, whether a claim holds) or when a known fact changes how the passage reads. When the question asks for it, it is the body of the answer: its label comes right after the core with three to five points, and the labels on the document's own words keep to one or two points each. Choose the facts that bear on the question itself: the same decision, the same product, the same years. First what was done; then what cuts against the stated claim: what the later record, the company's or the author's own research, a regulator, or a court showed. Give the specific thing: the event, the study, the figure, the name, the year. You know a great deal: say plainly what you are confident of, mark a detail you cannot place with one word (\"about\", \"reportedly\"), leave out what you would have to guess, and never invent a source, a number, or a quotation. Put it under a label of its own that says it is from outside the document, and put no block tag on it. A fact from outside the document that another point needs (what a term means in general) is marked where it stands, in a few words (\"in general\", \"outside this document\"). A question that asks what was actually done, or for the record, the history, or the practice, is not answered from the document alone: an answer to it without this label is unfinished. A question that asks only what the document says gets no such label.",
    web
      ? "With the web on, search for these facts and name the source of each (the web rules below). Before the first search, settle the three things to find; they are not written in the answer. One: what else was done on this subject beyond what the document states: earlier and later actions, numbers, tests. Two: the reason behind it: the company's or the author's own research, policy, or stated rule. Three: what cuts against the stated claim: a trial, a testimony, a fine, an investigation, an internal document, a critic's finding. Give each of the three a search of its own, aimed with a name you already know (the study, the case, the person, the program). A fact the document states needs no search. When a search returns only what the document states, the next search goes to another of the three. A fact you know well that no search returned may still stand, marked as from general knowledge."
      : "End those points with one short line in italics that says they come from general knowledge, not from this document, and that turning Web on checks them.",
  ].join(" ");
}

/** The assistant's grounding: the document's claims on their blocks, and
    nothing from outside passed off as the document's. */
export const ASSISTANT_GROUNDING =
  "Grounding: every claim about the document rests on the document. Cite the block a claim rests on as [block <id>], exactly as tagged above; the tag renders as a link the reader can click. Never present a fact from outside the document as the document's, and never put a block tag on it. When the document does not answer, say so in one sentence, then say what the document does say about it.";

/** The assistant's style: STYLE_RULE's plain words, with the labels the
    shape asks for. */
export const ASSISTANT_STYLE =
  "Style: work the whole answer out before you write a word; write only the result. Short sentences, one point per sentence, the plainest words that say it — words anyone would know, not the field's, unless the material's own term is the one the reader needs. No idioms, no preamble, no filler, no restating the question, no point made twice. Use technical language only where the material does. Where a term, a step, or a wrong assumption would trip this reader up, clear it in one line at the point where it comes up.";

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
  "You can search the web, as any AI chatbot can. These rules come before every rule above that limits the answer to the material. Rules:",
  "1. Search when the question reaches past the material: a fact, a date, a history, a person, a definition, or anything recent that the material does not state. Search when the reader asks you to look something up, to check something, or to use the internet. Never ask whether to search, and never tell the reader to ask again: search, then answer.",
  "2. When the material answers the question in full, answer from it. Search then only to check a factual claim the answer rests on that may be out of date.",
  "3. Say which sentences come from the web and which come from the material. Never present a web result as if it came from the material.",
  "4. Name each web source in the sentence it supports: the site or the page title. Write no web addresses and no list of sources: the app lists the pages you read under the answer.",
  "5. When the web contradicts the material, say so plainly and show both sides.",
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

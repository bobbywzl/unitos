// Recommended links (SPEC.md §13): two passes. The scan reads a newly added
// document whole against the project's other documents whole, with the
// reader's notes and background as project context, and proposes links
// between exact passages. The check then reads one pair of documents whole
// and keeps only the links that hold. Output is JSON; every quote must be a
// verbatim substring of its named block or the link is dropped.

import type { Lang } from "@/lib/i18n/config";
import { languageName, profileLines, type ReaderProfileCtx } from "@/lib/prompts/types";

export type ConnectCtx = {
  lang: Lang;
  profile: ReaderProfileCtx;
  documentBlocks: string; // the new document, rendered as [block <id>] lines
  others: string; // the project's other documents: [document <id>] + block lines
  notes: string; // the reader's notes across the project, [note <id>] lines; "" = none
};

// What a link is, for both passes: one exact rule set, repeated word for word.
const LINK_RULES = [
  "A link holds only when both passages say the same specific thing: the same claim, the same finding, the same number or result, the same named method, entity, or event, or one passage's direct contradiction of the other. The two passages must be readable side by side as evidence of that one connection.",
  "A link does not hold on topic alone. Two documents about the same field, the same broad subject, or the same kind of thing do not connect. A shared common word, a shared generic phrase, or a passing mention does not connect.",
  "Titles are not shown and are not a signal: two documents with similar titles but unrelated content do not connect, and two with unrelated titles but the same specific claim do.",
  "The reader's notes and background say what the reader is working on. A connection that matters to that work ranks above one that does not; a connection that does not hold is never proposed because of them.",
];

function notesSection(notes: string): string[] {
  return notes
    ? ["The reader's notes across the project. Each starts with its id as [note <id>]:", "", notes]
    : ["The reader has no notes in the project yet."];
}

export function connectPrompt(ctx: ConnectCtx): string {
  return [
    "A reader just added a document to their project. Find where it connects to the documents already there. Video transcripts count like any text. Judge only the content below — the article text or transcript.",
    "",
    profileLines(ctx.profile),
    "",
    "The new document, whole. Each block starts with its id as [block <id>].",
    "",
    ctx.documentBlocks,
    "",
    "The project's other documents, whole. Each starts with its id as [document <id>], then its blocks:",
    "",
    ctx.others,
    "",
    ...notesSection(ctx.notes),
    "",
    "What a link is:",
    ...LINK_RULES.map((rule, i) => `${i + 1}. ${rule}`),
    "",
    "Rules:",
    "1. Propose at most 8 links, strongest first. Fewer is better than weak ones. No link is a valid answer.",
    "2. Before you propose a link, check it against the whole of both documents: the passage on each side must carry the connection on its own, and nothing else in either document must contradict the reading.",
    "3. fromQuote is a verbatim substring of the named block in the new document. toQuote is a verbatim substring of the named block in the named other document. Copy exactly — no paraphrase, no ellipsis.",
    "4. Keep quotes short and pointed: the phrase that carries the connection, 8 to 200 characters.",
    `5. reason: one plain sentence naming the specific thing both passages say, under 140 characters, in ${languageName(ctx.lang)}. Name the claim, number, method, entity, or event itself, never "both discuss" or "related to". No preamble.`,
    "6. Use block and document ids exactly as given.",
    "",
    'Return ONLY JSON: {"links": [{"fromBlockId": string, "fromQuote": string, "toDocumentId": string, "toBlockId": string, "toQuote": string, "reason": string}]}',
  ].join("\n");
}

export type ConnectVerifyCtx = {
  lang: Lang;
  profile: ReaderProfileCtx;
  documentBlocks: string; // the new document, whole
  otherId: string;
  otherBlocks: string; // the one other document, whole
  notes: string;
  candidates: { index: number; fromQuote: string; toQuote: string; reason: string }[];
};

export function connectVerifyPrompt(ctx: ConnectVerifyCtx): string {
  return [
    "A scan proposed links between two documents of a reader's project. Check every proposed link against both documents, whole, and keep only the links that hold.",
    "",
    profileLines(ctx.profile),
    "",
    "The new document, whole. Each block starts with its id as [block <id>].",
    "",
    ctx.documentBlocks,
    "",
    `The other document, whole [document ${ctx.otherId}]:`,
    "",
    ctx.otherBlocks,
    "",
    ...notesSection(ctx.notes),
    "",
    "What a link is:",
    ...LINK_RULES.map((rule, i) => `${i + 1}. ${rule}`),
    "",
    "The proposed links. Each has an index, the quote in the new document, the quote in the other document, and the scan's reason:",
    ...ctx.candidates.flatMap((c) => [
      "",
      `[${c.index}]`,
      `new document: "${c.fromQuote}"`,
      `other document: "${c.toQuote}"`,
      `reason: ${c.reason}`,
    ]),
    "",
    "Rules:",
    "1. For every proposed link, read the passage around each quote in its document. keep is true only when the link holds by the rules above and nothing else in either document contradicts it.",
    `2. reason: for a kept link, one plain sentence naming the specific thing both passages say, under 140 characters, in ${languageName(ctx.lang)}. Rewrite the scan's reason when it is vague or wrong. For a dropped link, one short sentence saying why it does not hold.`,
    "3. Answer for every index once. Never add a link.",
    "",
    'Return ONLY JSON: {"links": [{"index": number, "keep": boolean, "reason": string}]}',
  ].join("\n");
}

// Recommended links (SPEC.md §13): scan a newly added document against the
// corpus's other documents for shared concepts, quotes, and keywords, and
// propose links between exact passages. Output is JSON; every quote must be a
// verbatim substring of its named block or the link is dropped.

import type { Lang } from "@/lib/i18n/config";
import { languageName } from "@/lib/prompts/types";

export type ConnectCtx = {
  lang: Lang;
  documentTitle: string;
  documentBlocks: string; // the new document, rendered as [block <id>] lines
  others: string; // the corpus's other documents: [document <id>] "title" + block lines
};

export function connectPrompt(ctx: ConnectCtx): string {
  return [
    "A reader just added a document to their corpus. Find where it connects to the documents already there: the same concept, the same claim or its contradiction, a shared quote, a shared keyword used in the same sense. Video transcripts count like any text.",
    "",
    `The new document: "${ctx.documentTitle}". Each block starts with its id as [block <id>].`,
    "",
    ctx.documentBlocks,
    "",
    "The corpus's other documents. Each starts with its id as [document <id>], then its blocks:",
    "",
    ctx.others,
    "",
    "Rules:",
    "1. Propose at most 8 links, strongest first. Fewer is better than weak ones.",
    "2. fromQuote is a verbatim substring of the named block in the new document. toQuote is a verbatim substring of the named block in the named other document. Copy exactly — no paraphrase, no ellipsis.",
    "3. Keep quotes short and pointed: the phrase that carries the connection, 8 to 200 characters.",
    `4. reason: one plain sentence naming the connection, under 140 characters, in ${languageName(ctx.lang)}. No preamble.`,
    "5. Use block and document ids exactly as given.",
    "",
    'Return ONLY JSON: {"links": [{"fromBlockId": string, "fromQuote": string, "toDocumentId": string, "toBlockId": string, "toQuote": string, "reason": string}]}',
  ].join("\n");
}

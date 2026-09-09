import { languageName, profileLines, type PromptCtx } from "@/lib/prompts/types";

// DISTILL: the reader asks one question; the model scans the whole document and
// returns the quotes that answer it, each with a caption (SPEC.md §4). Output
// contract is strict JSON; the route resolves every span before anything persists.
export function distillPrompt(ctx: PromptCtx): string {
  return [
    profileLines(ctx.profile),
    "",
    `The reader wants "${ctx.documentTitle}" distilled against one question. The full document is above.`,
    "",
    `Question: ${ctx.question ?? ""}`,
    ...(ctx.anchoredText
      ? ["", "The reader highlighted this passage when asking; treat it as the starting point, not the boundary:", ctx.anchoredText]
      : []),
    "",
    "Read the question first. Say to yourself what it asks, and what facets it has. Then scan the entire document with the question in mind, and pull the quotes that answer it.",
    "1. quotes: 2 to 10 verbatim spans, from anywhere in the document.",
    "2. Each span is one contiguous character range inside one block. Cut it to what answers the question: a phrase, one sentence, several sentences, or a whole paragraph. Do not pad a phrase out to its sentence, and do not cut a paragraph that answers as one argument.",
    "3. start and end are character offsets into that block's text as given above. Use block ids exactly as they appear in [block <id>] markers.",
    "4. Every quote answers the question in a different way: a different facet, a different mechanism, a different piece of evidence, or a different side. Before adding a quote, check the quotes already chosen. If one of them already says the same core point, drop the new one, or keep only the stronger of the two. Never pull two quotes that answer the question the same way.",
    "5. Order quotes as they appear in the document.",
    `6. caption: one sentence per quote, two at most, in ${languageName(ctx.lang)}. Plain words, no filler. Say exactly how the quote answers the question. If the quote answers only one facet of the question, name that facet and say the quote answers that facet only. A caption must stand on its own: name the subject, never write "the question" or "this quote".`,
    "7. Fewer, stronger quotes beat many weak ones. Skip anything that does not bear on the question. Skip anything that only repeats a point another quote already makes.",
    "",
    'Return ONLY JSON: {"quotes": [{"blockId": "<id>", "start": 0, "end": 42, "caption": "<text>"}, ...]}',
  ].join("\n");
}

// Corpus-scope DISTILL (SPEC.md §13): the reader asks the whole corpus one
// question; the model scans every document and returns the quotes that answer
// it, each cited to its document. The documents ride in the system message,
// rendered like the connect scan: [document <id>] "title" then block lines.
export function corpusDistillPrompt(ctx: {
  profile: PromptCtx["profile"];
  lang: PromptCtx["lang"];
  question: string;
}): string {
  return [
    profileLines(ctx.profile),
    "",
    "The reader wants their whole project distilled against one question. Every document is above, each starting with [document <id>] and its title, its blocks each starting with [block <id>].",
    "",
    `Question: ${ctx.question}`,
    "",
    "Read the question first. Say to yourself what it asks, and what facets it has. Then scan every document with the question in mind, and pull the quotes that answer it.",
    "1. quotes: 2 to 12 verbatim spans, from anywhere in the project. Video transcripts count like any text.",
    "2. Each span is one contiguous character range inside one block. Cut it to what answers the question: a phrase, one sentence, several sentences, or a whole paragraph. Do not pad a phrase out to its sentence, and do not cut a paragraph that answers as one argument.",
    "3. start and end are character offsets into that block's text as given above. Use block ids exactly as they appear in [block <id>] markers — block ids are unique across all documents.",
    "4. Every quote answers the question in a different way: a different facet, a different mechanism, a different piece of evidence, or a different side. Before adding a quote, check the quotes already chosen. If one of them already says the same core point, drop the new one, or keep only the stronger of the two. Never pull two quotes that answer the question the same way, even from two documents.",
    "5. Where documents answer together — agree, disagree, extend each other — pull from each, so the answer spans the project, not one document.",
    "6. Order quotes by document as listed, then by position.",
    `7. caption: one sentence per quote, two at most, in ${languageName(ctx.lang)}. Plain words, no filler. Say exactly how the quote answers the question, and how it sits against the other documents. If the quote answers only one facet of the question, name that facet and say the quote answers that facet only. A caption must stand on its own: name the subject, never write "the question" or "this quote".`,
    "8. Fewer, stronger quotes beat many weak ones. Skip documents with nothing to say. Skip anything that only repeats a point another quote already makes.",
    "",
    'Return ONLY JSON: {"quotes": [{"blockId": "<id>", "start": 0, "end": 42, "caption": "<text>"}, ...]}',
  ].join("\n");
}

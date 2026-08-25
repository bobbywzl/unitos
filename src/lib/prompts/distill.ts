import { profileLines, type PromptCtx } from "@/lib/prompts/types";

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
    "Scan the entire document and pull the quotes that answer the question.",
    "1. quotes: 3 to 12 verbatim spans — the most important sentences and paragraphs, from anywhere in the document.",
    "2. Each span is one contiguous character range inside one block: a full sentence up to a full paragraph.",
    "3. start and end are character offsets into that block's text as given above. Use block ids exactly as they appear in [block <id>] markers.",
    "4. Order quotes as they appear in the document.",
    "5. caption: 1 to 2 sentences per quote. State how the quote answers the question and how it sits in the context of the whole document. A caption must stand on its own: name the subject, never write \"the question\" or \"this quote\".",
    "6. Fewer, stronger quotes beat many weak ones. Skip anything that does not bear on the question.",
    "",
    'Return ONLY JSON: {"quotes": [{"blockId": "<id>", "start": 0, "end": 42, "caption": "<text>"}, ...]}',
  ].join("\n");
}

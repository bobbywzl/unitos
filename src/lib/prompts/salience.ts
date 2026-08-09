import { profileLines, type PromptCtx } from "@/lib/prompts/types";

// SALIENCE: highlight layer over the whole document, persisted per notebook (SPEC.md §4).
export function saliencePrompt(ctx: PromptCtx): string {
  return [
    profileLines(ctx.profile),
    "",
    `Mark the most salient spans of "${ctx.documentTitle}" for this reader. The full document is above.`,
    "",
    "Salient means: load-bearing claims, key results, definitions the rest depends on,",
    "and passages that matter for the reader's purpose.",
    "",
    "Rules:",
    "1. 10 to 40 spans for a typical document. Fewer for short documents.",
    "2. Each span is a contiguous character range inside one block.",
    "3. start and end are character offsets into that block's text as given above.",
    "4. Spans are short: a clause or sentence, not whole paragraphs.",
    "5. Use block ids exactly as they appear in [block <id>] markers.",
    "",
    'Return ONLY JSON: {"spans": [{"blockId": "<id>", "start": 0, "end": 42}, ...]}',
  ].join("\n");
}

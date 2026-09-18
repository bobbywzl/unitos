import { profileLines, type PromptCtx } from "@/lib/prompts/types";

// SALIENCE: highlight layer over the whole document, persisted per notebook (SPEC.md §4).
// What makes the layer worth having: a reader who reads only the marked
// spans knows what the document claims, what it found, and what it rests on.
export function saliencePrompt(ctx: PromptCtx): string {
  return [
    profileLines(ctx.profile),
    "",
    `Mark the most salient spans of "${ctx.documentTitle}" for this reader. The full document is above.`,
    "",
    "Read the whole document first. Then mark the spans a reader must not miss.",
    "Salient means, in this order: the document's main claim; each finding, with its number; a definition the rest depends on; a condition or a limit the document puts on its own claim; a passage that matters for the reader's purpose above.",
    "Not salient: framing, background the reader already has, repetition of a point already marked, headings, references, an example that adds nothing to the claim it illustrates.",
    "",
    "Rules:",
    "1. 10 to 40 spans for a typical document. Fewer for a short document. Cover the whole document, not just its opening: a finding in the last section counts as much as one in the first.",
    "2. Each span is one contiguous character range inside one block.",
    "3. start and end are character offsets into that block's text as given above.",
    "4. Spans are short: a clause or one sentence, never a whole paragraph. Cut a span to the words that carry the claim or the number.",
    "5. Spans never overlap. Two spans that make the same point: keep one.",
    "6. Use block ids exactly as they appear in [block <id>] markers.",
    "",
    'Return ONLY JSON: {"spans": [{"blockId": "<id>", "start": 0, "end": 42}, ...]}',
  ].join("\n");
}

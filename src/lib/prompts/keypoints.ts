import { languageName, profileLines, type PromptCtx } from "@/lib/prompts/types";

// KEYPOINTS — the reader's Distill (SPEC.md §4): the model reads the whole
// document, thinks through what it actually establishes, and writes its most
// important points as bullets. Every bullet is anchored to the verbatim span
// it comes from, so the distilled page jumps to the words behind it. Output
// contract is strict JSON; the route resolves every span before anything
// persists.
export function keypointsPrompt(ctx: PromptCtx): string {
  return [
    profileLines(ctx.profile),
    "",
    `The reader wants "${ctx.documentTitle}" distilled into its most important points. The full document is above.`,
    "",
    "Read the whole document before writing anything. Think through what it actually establishes: the question it answers, the claims it makes, the evidence and numbers behind them, the mechanism it explains, the limits it admits, and what follows from it. Then write the points that a careful reader would keep.",
    "1. points: 5 to 20 bullets, in document order. One point per bullet. The count follows the document: a short piece gets few, a long one gets more, and padding is worse than leaving a weak point out.",
    `2. text: the point in ${languageName(ctx.lang)}, one sentence, two at most. Plain words, concrete. Keep every number that carries a finding. State what the document claims; never add claims of your own. A bullet must stand on its own: name the subject, never write "the author" or "this section".`,
    "3. Each bullet cites the verbatim span it comes from: one contiguous character range inside one block, a full sentence up to a full paragraph. start and end are character offsets into that block's text as given above. Use block ids exactly as they appear in [block <id>] markers.",
    "4. Cover the whole document, not just its opening. Skip framing, repetition, and asides.",
    "5. Most important beats most numerous. A point that changes what the reader believes outranks one that only informs.",
    "",
    'Return ONLY JSON: {"points": [{"text": "<text>", "blockId": "<id>", "start": 0, "end": 42}, ...]}',
  ].join("\n");
}

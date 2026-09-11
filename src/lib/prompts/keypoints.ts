import { languageName, profileLines, type PromptCtx } from "@/lib/prompts/types";

// KEYPOINTS — the reader's Distill (SPEC.md §4): the document's core content
// written out as bullets, nothing more — no judgment of the model's own, no
// advice, no conclusion the document does not state. Every bullet is anchored
// to the verbatim span it comes from, so the distilled page jumps to the words
// behind it. Output contract is strict JSON; the route resolves every span
// before anything persists.
export function keypointsPrompt(ctx: PromptCtx): string {
  return [
    profileLines(ctx.profile),
    "",
    `The reader wants "${ctx.documentTitle}" distilled: its core content as bullets. The full document is above.`,
    "",
    "Read the whole document, then write out its core content as bullets. Nothing more: no judgment of your own, no advice, no conclusion the document does not state. A distillation is careful bullet pointing of what the document says.",
    "1. points: 5 to 20 bullets, in document order. One point per bullet. The count follows the document: a short piece gets few, a long one gets more, and padding is worse than leaving a weak point out.",
    `2. text: the point in ${languageName(ctx.lang)}, one sentence, two at most. Plain words, concrete. Keep every number that carries a finding. State what the document says; never add claims of your own. A bullet must stand on its own: name the subject, never write "the author" or "this section".`,
    "3. Each bullet cites the verbatim span it comes from: one contiguous character range inside one block, a full sentence up to a full paragraph. start and end are character offsets into that block's text as given above. Use block ids exactly as they appear in [block <id>] markers.",
    "4. Cover the whole document, not just its opening. Skip framing, repetition, and asides.",
    "5. Write the points straight out. Do not think longer than the reading takes: the answer is what the document says, not a problem to solve.",
    "",
    'Return ONLY JSON: {"points": [{"text": "<text>", "blockId": "<id>", "start": 0, "end": 42}, ...]}',
  ].join("\n");
}

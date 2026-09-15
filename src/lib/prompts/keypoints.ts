import { languageName, profileLines, type PromptCtx } from "@/lib/prompts/types";

// KEYPOINTS — the reader's Distill (SPEC.md §4): the document's core content
// written out as bullets, nothing more — no judgment of the model's own, no
// advice, no conclusion the document does not state. Every bullet is anchored
// to the verbatim span it comes from, so the distilled page jumps to the words
// behind it. Output contract is strict JSON; the route resolves every span
// before anything persists.
// What makes the distillation worth reading: a reader who reads the bullets
// alone knows what the document claims, what it found, how, and with what
// limits, and could say so with the document's own numbers.
export function keypointsPrompt(ctx: PromptCtx): string {
  return [
    profileLines(ctx.profile),
    "",
    `The reader wants "${ctx.documentTitle}" distilled: its core content as bullets. The full document is above.`,
    "",
    "Read the whole document, then write out its core content as bullets. Nothing more: no judgment of your own, no advice, no conclusion the document does not state. A distillation is careful bullet pointing of what the document says.",
    "1. points: 5 to 20 bullets, in document order. One point per bullet. The count follows the document: a short piece gets few, a long one gets more, and padding is worse than leaving a weak point out.",
    `2. text: the point in ${languageName(ctx.lang)}, one sentence, two at most. Plain words, concrete. State the claim itself, not that a claim is made: "Default payments buy the top ten to twenty points of share", never "The document discusses default payments". Keep every number that carries a finding, as printed. A bullet must stand on its own: name the subject, never write "the author" or "this section".`,
    "3. What a point is: the document's main claim; a finding, with its number; the method or the evidence a finding rests on; a definition the argument depends on; a condition or a limit the document puts on its claim; the conclusion the document draws. What a point is not: framing, background the document takes from elsewhere, repetition, an aside, a heading.",
    "4. Each bullet cites the verbatim span it comes from: one contiguous character range inside one block, a full sentence up to a full paragraph. start and end are character offsets into that block's text as given above. Use block ids exactly as they appear in [block <id>] markers. A bullet whose words the document does not carry is not a point: leave it out.",
    "5. Cover the whole document, not just its opening. A finding in the last section counts as much as one in the first.",
    "6. Write the points straight out. Do not think longer than the reading takes: the answer is what the document says, not a problem to solve.",
    "",
    'Return ONLY JSON: {"points": [{"text": "<text>", "blockId": "<id>", "start": 0, "end": 42}, ...]}',
  ].join("\n");
}

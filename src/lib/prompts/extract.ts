import { profileLines, type PromptCtx } from "@/lib/prompts/types";

// EXTRACT: the reader highlighted a phrase; the model finds the passages
// across the whole document most revealing about its topic (SPEC.md §4).
// Output contract is strict JSON; the route resolves every span before
// anything persists.
export function extractPrompt(ctx: PromptCtx): string {
  return [
    profileLines(ctx.profile),
    "",
    `The reader highlighted a passage in "${ctx.documentTitle}". The full document is above.`,
    "",
    "Context before the highlight:",
    ctx.contextBefore || "(start of document)",
    "",
    "Highlighted passage:",
    ctx.anchoredText,
    "",
    "Context after the highlight:",
    ctx.contextAfter || "(end of document)",
    "",
    "Identify the topic the highlighted passage focuses on, in the context of the whole document. Then mark the passages across the document that reveal the most about that topic.",
    "1. spans: 3 to 15 verbatim spans, from anywhere in the document.",
    "2. Each span is one contiguous character range inside one block: a full sentence, at most two.",
    "3. start and end are character offsets into that block's text as given above. Use block ids exactly as they appear in [block <id>] markers.",
    "4. Skip the highlighted passage itself — it is already marked.",
    "5. Most revealing beats most numerous. Skip sentences that merely mention the topic.",
    "",
    'Return ONLY JSON: {"spans": [{"blockId": "<id>", "start": 0, "end": 42}, ...]}',
  ].join("\n");
}

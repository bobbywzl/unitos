import { languageName, profileLines, type PromptCtx } from "@/lib/prompts/types";

// FIND: the video content reader (SPEC.md §11). The reader asks for something;
// the model returns the transcript blocks where the video deals with it. The
// server resolves the blocks to time ranges; the pane renders seekable cards.
export function findPrompt(ctx: PromptCtx): string {
  return [
    profileLines(ctx.profile),
    "",
    `The reader is searching the video "${ctx.documentTitle}". The full timed transcript is above; every transcript block is tagged [block <id>] (TRANSCRIPT <start>s–<end>s).`,
    "",
    "Their search:",
    ctx.query ?? "",
    "",
    "Find the parts of the video that answer it.",
    "1. Return up to 5 matches, best first. A match is one contiguous run of transcript blocks where the video deals with the search.",
    `2. For each match, list the exact block ids it spans, in order, and explain in 1–3 sentences, in ${languageName(ctx.lang)}, what that part says and why it answers the search. Quote key phrases from the transcript.`,
    "3. No real match: return an empty list. Never stretch a weak match.",
    'Return ONLY JSON: {"matches": [{"blockIds": ["<id>", "…"], "explanation": "…"}]}',
  ].join("\n");
}

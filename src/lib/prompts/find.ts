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
    `2. For each match, list the exact block ids it spans, in order, and explain in one or two sentences, in ${languageName(ctx.lang)}, what that part says and why it answers the search. State what is said, with the speaker's own key phrase quoted: "Says the default is bought, not earned: 'the floor is earned'", never "Discusses defaults".`,
    "3. A match is one stretch where the video deals with the search; a passing mention is not a match. No real match: return an empty list. Never stretch a weak match.",
    "4. Two matches that say the same thing: keep the fuller one.",
    'Return ONLY JSON: {"matches": [{"blockIds": ["<id>", "…"], "explanation": "…"}]}',
  ].join("\n");
}

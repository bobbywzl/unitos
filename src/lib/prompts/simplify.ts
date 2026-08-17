import { profileLines, type PromptCtx } from "@/lib/prompts/types";

// SIMPLIFY: layman rewrite in a bubble beside the article. Ephemeral, never persisted (SPEC.md §4).
export function simplifyPrompt(ctx: PromptCtx): string {
  return [
    profileLines(ctx.profile),
    "",
    `The reader selected a passage from "${ctx.documentTitle}". The full document is above.`,
    "",
    "Selected passage:",
    ctx.anchoredText,
    "",
    "Rewrite the passage so a reader with no training in this field understands it on first read.",
    "1. Use everyday words. Replace every technical term with plain language, or define it in the sentence where it first appears.",
    "2. Keep every claim and number. Do not drop content or add content.",
    "3. Word it intuitively: say what happens before you say why it matters. A short analogy is fine when it makes the meaning clearer.",
    "Return only the rewritten passage as plain text. No preamble, no markdown headings.",
  ].join("\n");
}

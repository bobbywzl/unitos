import { profileLines, type PromptCtx } from "@/lib/prompts/types";
import { splitSentences } from "@/lib/sentences";

// SIMPLIFY: layman rewrite in a bubble beside the article, one source marker per
// rewritten sentence so the bubble mirrors each sentence back to the original
// text. Persisted in the Annotations section (SPEC.md §4, §6).
export function simplifyPrompt(ctx: PromptCtx): string {
  const numbered = splitSentences(ctx.anchoredText)
    .map((s, i) => `[${i + 1}] ${s.text}`)
    .join("\n");
  return [
    profileLines(ctx.profile),
    "",
    `The reader selected a passage from "${ctx.documentTitle}". The full document is above.`,
    "",
    "Selected passage, split into numbered sentences:",
    numbered,
    "",
    "Rewrite the passage so a reader with no training in this field understands it on first read.",
    "1. Use everyday words. Replace every technical term with plain language, or define it in the sentence where it first appears.",
    "2. Keep every claim and number. Do not drop content or add content.",
    "3. Word it intuitively: say what happens before you say why it matters. A short analogy is fine when it makes the meaning clearer.",
    "4. After each rewritten sentence, append a source marker naming the numbered original sentences it restates: [[1]] or [[2,3]]. Every rewritten sentence gets exactly one marker with at least one number. Use only the numbers above.",
    "Return only the rewritten passage as plain text with the markers. No preamble, no markdown headings.",
  ].join("\n");
}

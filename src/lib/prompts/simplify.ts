import { profileLines, type PromptCtx } from "@/lib/prompts/types";
import { splitSentences } from "@/lib/sentences";

// SIMPLIFY: layman rewrite in a bubble beside the article, one source marker per
// rewritten sentence so the bubble mirrors each sentence back to the original
// text. Persisted in the Annotations section (SPEC.md §4, §6).
// What makes the rewrite worth reading: the reader understands the passage
// on the first read and could explain it to someone else. So the rewrite
// says what the passage says in words the reader already has, keeps every
// claim and number, and never adds a claim the passage does not make.
export function simplifyPrompt(ctx: PromptCtx): string {
  const numbered = splitSentences(ctx.anchoredText)
    .map((s, i) => `[${i + 1}] ${s.text}`)
    .join("\n");
  return [
    profileLines(ctx.profile),
    "",
    `The reader selected a passage from "${ctx.documentTitle}". The full document is above.`,
    "",
    "Context before the selection:",
    ctx.contextBefore || "(start of document)",
    "",
    "Selected passage, split into numbered sentences:",
    numbered,
    "",
    "Context after the selection:",
    ctx.contextAfter || "(end of document)",
    "",
    "Rewrite the passage so a reader with no training in this field understands it on first read.",
    "1. Before you write, read the passage in its context above and say to yourself what it claims and what each term means in this document. A term the document defines elsewhere is rewritten with that definition, not a general one.",
    "2. Use everyday words. Replace every technical term with plain language, or define it in the sentence where it first appears. A symbol or a formula is written as what it does.",
    "3. Keep every claim, every number, every named entity, and every condition. Do not drop content and do not add content: no example, no analogy, no explanation the passage does not carry, unless the reader context says the reader needs one word defined.",
    "4. Word it intuitively: say what happens before you say why it matters. A short analogy is fine when it makes the meaning clearer and adds no claim of its own.",
    "5. After each rewritten sentence, append a source marker naming the numbered original sentences it restates: [[1]] or [[2,3]]. Every rewritten sentence gets exactly one marker with at least one number. Use only the numbers above. Every numbered sentence is restated by at least one rewritten sentence.",
    "6. Write in the passage's language.",
    "7. Keep the rewrite close to the original's length: short sentences, plain words, no filler. Never open with \"In other words\" or \"This passage\"; open with the content.",
    "Return only the rewritten passage as plain text with the markers. No preamble, no markdown headings.",
  ].join("\n");
}

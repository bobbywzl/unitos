import type { SummaryDepth } from "@/lib/types";
import {
  answerLanguage,
  GROUNDING_RULE,
  profileLines,
  SPECIFICITY_RULE,
  STYLE_RULE,
  type PromptCtx,
} from "@/lib/prompts/types";

// SUMMARIZE: document-level output for the Assistant panel's Recommended
// section. One output per depth, persisted on NotebookDocument.summaries
// (SPEC.md §4).
// What makes a summary worth reading: a reader who reads it alone can say
// what the document found, with its numbers, and why that matters at their
// depth; and nothing in it could have been written without this document.
const DEPTH_RULES: Record<SummaryDepth, string[]> = {
  layman: [
    "Task: layman summary.",
    "1. Write for a reader with no training in this field. Highly simple, intuitive, condensed: the core of what the document is about.",
    "2. Use everyday words. Replace every technical term with plain language, or define it in the sentence where it first appears.",
    "3. Lead with what the document found and why it matters, in two sentences. Then how the authors got there, in plain steps. Then the one limit or condition the document puts on its own claim, when it states one.",
    "4. A short analogy is fine when it makes a mechanism clearer. Never trade accuracy for simplicity: a simplified number is still the document's number.",
    "5. Keep it under 180 words.",
  ],
  professional: [
    "Task: professional summary.",
    "1. Write for a practitioner in this field.",
    "2. Use the document's own terminology — the industry wording the author uses. Do not simplify.",
    "3. Cover, in this order: the question the document answers; the method or the evidence; the findings, each with its number; the limits the document states; how the findings relate to established work, as the document itself frames it.",
    "4. Keep it under 400 words.",
  ],
};

export function summarizePrompt(ctx: PromptCtx): string {
  return [
    profileLines(ctx.profile),
    "",
    `Work on the document "${ctx.documentTitle}". The full document is above.`,
    "",
    "Read the whole document before you write: the findings are often in the last sections, not the opening.",
    ...DEPTH_RULES[ctx.depth ?? "layman"],
    "",
    "Keep every number that carries a finding. State what the document claims; do not add claims of your own.",
    "Use markdown. Start with the content: no title, no line that says what the summary is.",
    GROUNDING_RULE,
    SPECIFICITY_RULE,
    STYLE_RULE,
    answerLanguage(ctx.lang),
  ].join("\n");
}

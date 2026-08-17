import type { SummaryDepth } from "@/lib/types";
import { profileLines, type PromptCtx } from "@/lib/prompts/types";

// SUMMARIZE: document-level summary shown in the Summary tab of the side panel.
// One summary per depth, persisted on NotebookDocument.summaries (SPEC.md §4).
const DEPTH_RULES: Record<SummaryDepth, string[]> = {
  layman: [
    "Depth: layman.",
    "1. Write for a reader with no training in this field.",
    "2. Use everyday words. Replace every technical term with plain language, or define it in the sentence where it first appears.",
    "3. Lead with what the document found and why it matters. Then how the authors got there, in plain steps.",
    "4. A short analogy is fine when it makes a mechanism clearer. Never trade accuracy for simplicity.",
    "5. Keep it under 300 words.",
  ],
  intermediate: [
    "Depth: intermediate.",
    "1. Write for a reader who knows the basics of this field but not its specialist vocabulary.",
    "2. Use standard field terms. Define the specialized ones in the sentence where they first appear.",
    "3. Cover the question, the method, the findings, and the limits.",
    "4. Keep it under 450 words.",
  ],
  professional: [
    "Depth: professional.",
    "1. Write for a practitioner in this field.",
    "2. Use the document's own terminology. Do not simplify.",
    "3. Cover the question, the method, the findings, the limits, and how the findings relate to established work.",
    "4. Keep it under 600 words.",
  ],
};

export function summarizePrompt(ctx: PromptCtx): string {
  return [
    profileLines(ctx.profile),
    "",
    `Summarize the document "${ctx.documentTitle}". The full document is above.`,
    "",
    ...DEPTH_RULES[ctx.depth ?? "layman"],
    "",
    "Keep every number that carries a finding. State what the document claims; do not add claims of your own.",
    "Use markdown: a one-paragraph overview, then short headed sections. Start with the overview, no preamble.",
  ].join("\n");
}

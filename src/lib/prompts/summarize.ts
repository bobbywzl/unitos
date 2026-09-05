import type { SummaryDepth } from "@/lib/types";
import { answerLanguage, profileLines, STYLE_RULE, type PromptCtx } from "@/lib/prompts/types";

// SUMMARIZE: document-level output for the Assistant panel's Recommended
// section. One output per depth, persisted on NotebookDocument.summaries
// (SPEC.md §4). Depth "insights" is Insiders Insights; "layman" and
// "professional" are summaries.
const DEPTH_RULES: Record<SummaryDepth, string[]> = {
  insights: [
    "Task: Insiders Insights.",
    "Extract the insights only an industry insider could take from this document: findings that are specific, nuanced, technical, or company-specific — things an outsider would not learn from general news coverage.",
    "1. Every insight must come from the document. Never invent, extrapolate, or pad.",
    "2. Skip anything an outsider could learn from a general news article about this topic.",
    "3. Quality over quantity. One real insight beats five weak ones.",
    "4. If the document carries no insider insight — it is general coverage, or it reveals nothing deep about the industry or company — say exactly that in one or two sentences and stop. Declaring insufficiency is a correct answer, never a failure.",
    "5. Format: a markdown list, one insight per item — a bold one-line finding, then one sentence on why it matters to someone in this industry, two at most.",
    "6. Keep it under 300 words.",
  ],
  layman: [
    "Task: layman summary.",
    "1. Write for a reader with no training in this field. Highly simple, intuitive, condensed: the core of what the document is about.",
    "2. Use everyday words. Replace every technical term with plain language, or define it in the sentence where it first appears.",
    "3. Lead with what the document found and why it matters. Then how the authors got there, in plain steps.",
    "4. A short analogy is fine when it makes a mechanism clearer. Never trade accuracy for simplicity.",
    "5. Keep it under 180 words.",
  ],
  professional: [
    "Task: professional summary.",
    "1. Write for a practitioner in this field.",
    "2. Use the document's own terminology — the industry wording the author uses. Do not simplify.",
    "3. Cover the question, the method, the findings, the limits, and how the findings relate to established work.",
    "4. Keep it under 400 words.",
  ],
};

export function summarizePrompt(ctx: PromptCtx): string {
  return [
    profileLines(ctx.profile),
    "",
    `Work on the document "${ctx.documentTitle}". The full document is above.`,
    "",
    ...DEPTH_RULES[ctx.depth ?? "layman"],
    "",
    "Keep every number that carries a finding. State what the document claims; do not add claims of your own.",
    "Use markdown. Start with the content.",
    STYLE_RULE,
    answerLanguage(ctx.lang),
  ].join("\n");
}

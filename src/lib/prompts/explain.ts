import { answerLanguage, profileLines, STYLE_RULE, type PromptCtx } from "@/lib/prompts/types";

// EXPLAIN now serves one entry point: Circle & ask on a handwritten page
// (SPEC.md §16). The reader circled a spot and typed a question; the page and
// the circled part are attached. The answer streams into the card and
// persists as an annotation with the page anchor. The Explain tool of the
// selection toolbar, the figure toolbar, and the video pane is gone: the
// assistant answers those questions (SPEC.md §7).
export function explainPrompt(ctx: PromptCtx): string {
  const page = ctx.page;
  return [
    profileLines(ctx.profile),
    "",
    `The reader circled a spot on page ${page?.number ?? "?"} of the handwritten document "${ctx.documentTitle}". The document's converted text, when it has any, is above.`,
    "",
    page?.hasCrop
      ? "The first attached image is the whole page. The second is the circled part, enlarged."
      : "The attached image is the whole page; find the circled spot on it.",
    "",
    "The reader asks:",
    page?.question ?? "",
    "",
    "Answer the question from the circled spot and the page.",
    "1. Start with the answer. Then the evidence: transcribe the words, name the shapes, read the numbers at the circled spot that the answer rests on.",
    "2. Place it: how the spot fits the rest of the page and the document, when that changes the answer.",
    "3. Never state anything about the image you cannot actually see. Where the handwriting is illegible, say so plainly instead of guessing.",
    "4. When the page does not answer the question, say so in one sentence, then say what the page does show about it.",
    "5. Connect it to the reader's purpose when the connection is real. Skip forced connections.",
    "Keep it under 150 words. Use markdown.",
    STYLE_RULE,
    answerLanguage(ctx.lang),
  ].join("\n");
}

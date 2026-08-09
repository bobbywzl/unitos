import { profileLines, type PromptCtx } from "@/lib/prompts/types";

// EXPLAIN: annotation bubble in the reader rail. Persisted as a note in the hidden
// Annotations section (SPEC.md §4).
export function explainPrompt(ctx: PromptCtx): string {
  return [
    profileLines(ctx.profile),
    "",
    `The reader selected a passage from "${ctx.documentTitle}". The full document is above.`,
    "",
    "Context before the selection:",
    ctx.contextBefore || "(start of document)",
    "",
    "Selected passage:",
    ctx.anchoredText,
    "",
    "Context after the selection:",
    ctx.contextAfter || "(end of document)",
    "",
    "Explain the selected passage for this reader.",
    "1. State what the passage claims or does in one sentence.",
    "2. Explain the parts the reader is least likely to know, given their background.",
    "3. Connect the passage to their purpose when the connection is real. Skip forced connections.",
    "Keep it under 200 words. Use markdown. Start with the explanation, no preamble.",
  ].join("\n");
}

import { profileLines, type PromptCtx } from "@/lib/prompts/types";

// SIMPLIFY: inline replacement in the reader. Ephemeral, never persisted (SPEC.md §4).
export function simplifyPrompt(ctx: PromptCtx): string {
  return [
    profileLines(ctx.profile),
    "",
    `The reader selected a passage from "${ctx.documentTitle}". The full document is above.`,
    "",
    "Selected passage:",
    ctx.anchoredText,
    "",
    "Rewrite the passage in plain language for this reader.",
    "1. Keep every claim and number. Do not drop content or add content.",
    "2. Replace jargon the reader may not know. Keep terms their background covers.",
    "3. Match the passage's length within reason. Shorter is fine, longer is not.",
    "Return only the rewritten passage as plain text. No preamble, no markdown headings.",
  ].join("\n");
}

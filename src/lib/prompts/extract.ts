import { profileLines, type PromptCtx } from "@/lib/prompts/types";

// EXTRACT: pending note in a section (SPEC.md §4). Output contract is strict JSON.
export function extractPrompt(ctx: PromptCtx & { targetSectionId?: string | null }): string {
  const skeleton = ctx.sectionSkeleton
    .map((s) => `- ${s.id}: ${s.parentTitle ? `${s.parentTitle} / ` : ""}${s.title}`)
    .join("\n");
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
    "Notebook sections:",
    skeleton || "(no sections yet)",
    "",
    "Write a note that captures what this passage contributes, for this reader's purpose.",
    "1. The note must be useful when read months later without the document open.",
    "2. State the finding or claim concretely. Include numbers when the passage has them.",
    "3. 1 to 4 sentences of markdown.",
    ctx.targetSectionId
      ? `4. Use sectionId "${ctx.targetSectionId}".`
      : "4. Pick the best-fitting sectionId from the list above.",
    "5. quotedSpans: 1 to 3 short verbatim spans that ground the note. Use block ids and",
    "   character offsets into the block text exactly as given above.",
    "",
    'Return ONLY JSON: {"sectionId": "<id>", "content": "<markdown>", "quotedSpans": [{"blockId": "<id>", "start": 0, "end": 42}]}',
  ].join("\n");
}

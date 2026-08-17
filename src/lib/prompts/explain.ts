import { profileLines, type PromptCtx } from "@/lib/prompts/types";

// EXPLAIN: annotation bubble in the reader rail. Persisted as a note in the hidden
// Annotations section (SPEC.md §4).
// Figure variant: the reader circled a figure; the model deciphers the visual.
export function explainPrompt(ctx: PromptCtx): string {
  if (ctx.figure) {
    return [
      profileLines(ctx.profile),
      "",
      `The reader asked about a figure in "${ctx.documentTitle}". The full document is above.`,
      "",
      "Figure caption:",
      ctx.figure.caption || "(no caption)",
      "",
      ...(ctx.figure.kind === "image" ? ["The figure's image is attached.", ""] : []),
      ...(ctx.figure.svgSource ? ["The figure is this SVG chart:", ctx.figure.svgSource, ""] : []),
      ...(ctx.figure.kind === "video"
        ? ["The figure is a video you cannot watch. Work from the caption and the document.", ""]
        : []),
      "Decipher what this visualization shows for this reader.",
      "1. Say what kind of visual it is and what it depicts, in one sentence.",
      "2. Read out the concrete content: axes, series, numbers, trends, comparisons — whatever is actually visible. Never invent values you cannot see.",
      "3. State the takeaway the document draws from it, tied to their purpose when the connection is real.",
      "Keep it under 200 words. Use markdown. Start with the explanation, no preamble.",
    ].join("\n");
  }
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
    "When you point at another part of the document, cite its block tag exactly as written above ([block <id>]) — the tag renders as a link the reader can click.",
    "Keep it under 200 words. Use markdown. Start with the explanation, no preamble.",
  ].join("\n");
}

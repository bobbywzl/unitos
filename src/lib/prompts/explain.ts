import { profileLines, type PromptCtx } from "@/lib/prompts/types";

// EXPLAIN: annotation bubble in the reader rail. Persisted as a note in the hidden
// Annotations section (SPEC.md §4).
// Figure variant: the reader circled a figure; the model deciphers the visual.
// Video variant: the reader marked a moment of a video document (SPEC.md §11);
// the paused frame is attached when the client could capture it.
export function explainPrompt(ctx: PromptCtx): string {
  if (ctx.video) {
    return [
      profileLines(ctx.profile),
      "",
      `The reader marked ${ctx.video.timeRange} of the video "${ctx.documentTitle}". The full timed transcript is above.`,
      "",
      ctx.video.hasRegion && ctx.video.hasFrame
        ? "They circled a spot on the frame; the attached image is cropped toward it."
        : ctx.video.hasFrame
          ? "The attached image is the frame at that moment."
          : ctx.video.frameDescription
            ? [
                "A vision model watched that clip. On screen:",
                ctx.video.frameDescription,
                "Treat this description as what is visible; the frame itself is not attached.",
              ].join("\n")
            : "No frame is attached. Work from the transcript.",
      "",
      "Transcript at that range:",
      ctx.video.transcriptExcerpt || "(no transcript for this range)",
      "",
      "Explain what is happening at this moment for this reader.",
      "1. Say what the moment shows or claims in one sentence.",
      "2. Read out the concrete content of the frame — text, numbers, diagrams, whatever is actually visible. Never invent what you cannot see.",
      "3. Tie it to the surrounding discussion using the timed transcript, and to their purpose when the connection is real.",
      "Keep it under 200 words, in flowing prose — no headings, no numbered sections. Start with the explanation, no preamble.",
    ].join("\n");
  }
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

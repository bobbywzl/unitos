import { answerLanguage, profileLines, type PromptCtx } from "@/lib/prompts/types";

// EXPLAIN: annotation bubble in the reader rail. Persisted as a note in the hidden
// Annotations section (SPEC.md §4).
// Figure variant: the reader circled a figure; the model deciphers the visual.
// Video variant: the reader marked a moment of a video document (SPEC.md §11);
// the paused frame is attached when the client could capture it.
export function explainPrompt(ctx: PromptCtx): string {
  if (ctx.video?.audio) {
    return [
      profileLines(ctx.profile),
      "",
      `The reader marked ${ctx.video.timeRange} of the audio "${ctx.documentTitle}". The full timed transcript is above.`,
      "",
      "Transcript at that range:",
      ctx.video.transcriptExcerpt || "(no transcript for this range)",
      "",
      "Explain this moment for this reader.",
      "1. Start with what is said at this moment: the claim, the point, the example.",
      "2. Then place it: what the recording is arguing here and how this moment fits what came before and after, using the timed transcript.",
      "3. Connect it to the reader's purpose when the connection is real.",
      "Keep it under 200 words, in flowing prose — no headings, no numbered sections. Start with the explanation, no preamble.",
      answerLanguage(ctx.lang),
    ].join("\n");
  }
  if (ctx.video) {
    const sight = [
      ctx.video.hasFrame
        ? ctx.video.hasRegion
          ? `The attached image IS the video frame at this moment, cropped to the shape they drew${ctx.video.previewFrame ? " — a small preview frame, so read only what is legible in it" : ""}.`
          : `The attached image IS the video frame at this moment${ctx.video.previewFrame ? " — a small preview frame, so read only what is legible in it" : ""}.`
        : ctx.video.hasRegion
          ? "No frame could be captured, and they drew a shape on one you cannot see."
          : "No frame could be captured.",
      ...(ctx.video.frameDescription
        ? [
            "",
            "A second model watched this clip at full resolution and reported what is on screen:",
            ctx.video.frameDescription,
          ]
        : []),
    ].join("\n");

    return [
      profileLines(ctx.profile),
      "",
      `The reader marked ${ctx.video.timeRange} of the video "${ctx.documentTitle}". The full timed transcript is above.`,
      "",
      sight,
      "",
      "Transcript at that range:",
      ctx.video.transcriptExcerpt || "(no transcript for this range)",
      "",
      "Explain this moment for this reader.",
      ctx.video.hasRegion
        ? "1. Start with what they marked: say what is inside the shape, from the image. Name the objects, read any legible text or numbers, describe the chart or diagram."
        : "1. Start with what is on screen at this moment, from the image.",
      "2. Then place it: what the video is saying here, using the timed transcript, and how the visual and the words fit together.",
      "3. Never state anything about the image you cannot actually see. Where the frame is too small or unclear to be sure, say so plainly instead of guessing. If the image and the description disagree, trust the image and say what you see.",
      "4. Connect it to the reader's purpose when the connection is real.",
      "Keep it under 200 words, in flowing prose — no headings, no numbered sections. Start with the explanation, no preamble.",
      answerLanguage(ctx.lang),
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
      "When corpus context follows the document — other documents' passages, the reader's notes, highlights, comments — reference what clarifies this figure by name and draw the analogy explicitly.",
      "Keep it under 200 words. Use markdown. Start with the explanation, no preamble.",
      answerLanguage(ctx.lang),
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
    "When corpus context follows the document — other documents' passages, the reader's notes, highlights, comments — reference what clarifies the passage by name and draw the analogy explicitly.",
    "Keep it under 200 words. Use markdown. Start with the explanation, no preamble.",
    answerLanguage(ctx.lang),
  ].join("\n");
}

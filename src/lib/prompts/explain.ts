import {
  answerLanguage,
  GROUNDING_RULE,
  profileLines,
  SPECIFICITY_RULE,
  STYLE_RULE,
  type PromptCtx,
} from "@/lib/prompts/types";

// EXPLAIN: the Explain tool. The answer streams into the card beside the
// article and persists as a note in the hidden Annotations section
// (SPEC.md §4). One template, one variant per entry point:
// - Text: the reader selected a passage; the model explains it.
// - Figure: the reader circled a figure; the model deciphers the visual.
// - Video: the reader marked a moment of a video document (SPEC.md §11);
//   the paused frame is attached when the client could capture it.
// - Audio: the reader marked a moment of an audio document; no frame.
// - Page: the reader circled a spot on a handwritten page (SPEC.md §16);
//   the page and the circled part are attached. With a question typed
//   (Circle & ask's Ask) the model answers it; without one (Explain) the
//   model explains the spot.
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
      "3. Connect it to the reader's purpose when the connection is real. Skip forced connections.",
      "Keep it under 150 words, in flowing prose: no headings, no numbered sections. Start with the explanation.",
      SPECIFICITY_RULE,
      STYLE_RULE,
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
      "4. Connect it to the reader's purpose when the connection is real. Skip forced connections.",
      "Keep it under 150 words, in flowing prose: no headings, no numbered sections. Start with the explanation.",
      SPECIFICITY_RULE,
      STYLE_RULE,
      answerLanguage(ctx.lang),
    ].join("\n");
  }
  if (ctx.page) {
    const page = ctx.page;
    return [
      profileLines(ctx.profile),
      "",
      `The reader circled a spot on page ${page.number} of the handwritten document "${ctx.documentTitle}". The document's converted text, when it has any, is above.`,
      "",
      page.hasCrop
        ? "The first attached image is the whole page. The second is the circled part, enlarged."
        : "The attached image is the whole page; find the circled spot on it.",
      "",
      ...(page.question
        ? [
            "The reader asks:",
            page.question,
            "",
            "Answer the question from the circled spot and the page.",
            "1. Start with the answer. Then the evidence: transcribe the words, name the shapes, read the numbers at the circled spot that the answer rests on.",
            "2. Place it: how the spot fits the rest of the page and the document, when that changes the answer.",
          ]
        : [
            "Explain the circled spot for this reader.",
            "1. Start with what is written or drawn there: transcribe the words, name the shapes, read the numbers.",
            "2. Then place it: how the spot fits the rest of the page and the document.",
          ]),
      "3. Never state anything about the image you cannot actually see. Where the handwriting is illegible, say so plainly instead of guessing.",
      page.question
        ? "4. When the page does not answer the question, say so in one sentence, then say what the page does show about it."
        : "4. Explain the parts the reader is least likely to know, given their background.",
      "5. Connect it to the reader's purpose when the connection is real. Skip forced connections.",
      "Keep it under 150 words. Use markdown. Start with the answer.",
      SPECIFICITY_RULE,
      STYLE_RULE,
      answerLanguage(ctx.lang),
    ].join("\n");
  }
  if (ctx.figure) {
    return [
      profileLines(ctx.profile),
      "",
      `The reader asked about a figure in "${ctx.documentTitle}". The full document is above.`,
      ctx.corpus
        ? "Project context follows the document: passages from the reader's other documents, their notes, and their annotations."
        : "No other material of the project is available.",
      "",
      "Figure caption:",
      ctx.figure.caption || "(no caption)",
      "",
      ...(ctx.figure.kind === "image"
        ? [
            ctx.figure.page
              ? "The PDF page the figure sits on is attached. Find the figure on it by its caption; read only that figure."
              : "The figure's image is attached.",
            "",
          ]
        : []),
      ...(ctx.figure.svgSource ? ["The figure is this SVG chart:", ctx.figure.svgSource, ""] : []),
      ...(ctx.figure.kind === "figure" || ctx.figure.kind === "video"
        ? ["No image of the figure is available. Work from the caption and the document, and say so in the first line.", ""]
        : []),
      "Decipher what this visualization shows for this reader.",
      "1. Say what kind of visual it is and what it depicts, in one sentence.",
      "2. Read out the concrete content: axes, series, numbers, trends, comparisons — whatever is actually visible. Never state a value you cannot see.",
      "3. State the takeaway the document draws from it, citing the claim as [block <id>], tied to the reader's purpose when the connection is real.",
      ...(ctx.corpus
        ? ["4. Where the project context clarifies this figure, name the document or the note and draw the connection explicitly."]
        : []),
      "Keep it under 150 words. Use markdown. Start with the explanation.",
      SPECIFICITY_RULE,
      STYLE_RULE,
      answerLanguage(ctx.lang),
    ].join("\n");
  }
  return [
    profileLines(ctx.profile),
    "",
    `The reader selected a passage from "${ctx.documentTitle}". The full document is above.`,
    ctx.corpus
      ? "Project context follows the document: passages from the reader's other documents, their notes, and their annotations."
      : "No other material of the project is available.",
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
    "1. Before you write, read the passage in its context above and say to yourself what it claims and what each term means in this document. A term the document defines elsewhere is explained with that definition, not a general one.",
    "2. State what the passage claims or does in one sentence.",
    "3. Explain the parts the reader is least likely to know, given their background: the term, the mechanism, the step the passage skips. Say what the passage assumes the reader already knows.",
    "4. Connect the passage to the document's argument: what came before that it rests on, what comes after that rests on it, cited as [block <id>].",
    ctx.corpus
      ? "5. Where the project context clarifies the passage — another document's passage, a note, a highlight — name it and draw the connection explicitly. Skip forced connections."
      : "5. Connect the passage to the reader's purpose when the connection is real. Skip forced connections.",
    "Keep it under 150 words. Use markdown. Start with the explanation.",
    GROUNDING_RULE,
    SPECIFICITY_RULE,
    STYLE_RULE,
    answerLanguage(ctx.lang),
  ].join("\n");
}

import { profileLines, type PromptCtx } from "@/lib/prompts/types";

// FORMALIZE (SPEC.md §11): the video or audio transcript rewritten as
// something readable. format article: a formal article for publishing the
// ideas — stored on the attachment, rendered under the transcript. format
// notes: personal bullet-point notes grouped by topic, each topic citing the
// transcript blocks it covers — landed as PENDING notes with time sources.
export function formalizePrompt(ctx: PromptCtx): string {
  const shared = [
    profileLines(ctx.profile),
    "",
    `The document "${ctx.documentTitle}" is a spoken recording. Its timed transcript is above; every transcript block is tagged [block <id>] (TRANSCRIPT <start>s–<end>s).`,
    "",
  ];
  if (ctx.format === "article") {
    return [
      ...shared,
      "Rewrite the transcript as a formal article, ready to publish.",
      "1. Give it a title and section headings. Open with the piece's point; end when the argument ends.",
      "2. Full paragraphs of clean written prose. No speech artifacts: no filler, no false starts, no timestamps, no speaker labels.",
      "3. Keep every substantive idea, claim, number, and example. Keep the speaker's order unless a small reorder makes the argument clearer.",
      "4. Never invent content. Everything in the article comes from the transcript.",
      "5. Write in the transcript's language.",
      'Return ONLY JSON: {"title": "…", "markdown": "…"}. markdown is the article body (## section headings; no # title line — the title field carries it).',
    ].join("\n");
  }
  return [
    ...shared,
    "Distill the transcript into personal bullet-point notes the reader will come back to.",
    "1. Group the content into topics, in transcript order. One topic = one coherent stretch of the recording.",
    "2. heading: the topic in a few words. bullets: the points that matter — claims, numbers, examples, decisions — one point per bullet, one line each, short and concrete.",
    "3. blockIds: the transcript block ids that topic covers, in order, exactly as given.",
    "4. Never invent content. Write in the transcript's language.",
    'Return ONLY JSON: {"topics": [{"heading": "…", "bullets": ["…"], "blockIds": ["…"]}]}',
  ].join("\n");
}

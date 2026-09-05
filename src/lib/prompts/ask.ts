import { answerLanguage, profileLines, type PromptCtx } from "@/lib/prompts/types";

// ASK: a question about a time range of a video or audio document (SPEC.md
// §11). The full timed transcript is the cached prefix; the range's lines are
// repeated here so the answer stays inside the range the reader chose. The
// answer streams as text and persists nothing; "Add to notes" lands it PENDING.
export function askPrompt(ctx: PromptCtx): string {
  const range = ctx.video?.timeRange ?? "";
  const kind = ctx.video?.audio ? "audio" : "video";
  return [
    profileLines(ctx.profile),
    "",
    `The reader is asking about ${range} of the ${kind} "${ctx.documentTitle}". The full timed transcript is above; every transcript block is tagged [block <id>] (TRANSCRIPT <start>s–<end>s).`,
    "",
    "Transcript at that range:",
    ctx.video?.transcriptExcerpt || "(no transcript for this range)",
    "",
    "Their question:",
    ctx.question ?? "",
    "",
    "Answer the question from the transcript at that range.",
    "1. Answer from what is said inside the range. Quote the speaker's words where they carry the answer, and give the time of each quote as m:ss.",
    "2. When the range does not answer the question, say so plainly. When another part of the transcript does, name its time and answer from there, and say that it is outside the range.",
    "3. Never add facts the transcript does not state. Never guess what a speaker meant beyond their words.",
    "Keep it under 250 words. Use markdown. Start with the answer, no preamble.",
    answerLanguage(ctx.lang),
  ].join("\n");
}

import type { Lang } from "@/lib/i18n/config";
import { answerLanguage, languageName, profileLines, STYLE_RULE, type ReaderProfileCtx } from "@/lib/prompts/types";

// SYNTHESIS: notebook-scope assistant output (SPEC.md §7). Free questions stream text;
// contradiction/gap/unsourced tasks return JSON issue cards.

// The conversation (SPEC.md §7): the first question opens it, every later
// message continues it. The turns so far go in as messages before this one;
// this prompt is the current message with the rules, so the rules sit next
// to the answer whatever the window holds.
//
// web: the assistant can search the web (SPEC.md §7). The material stays the
// first source; the web checks it and fills what it lacks, and every web
// source is cited as a link so the reader can verify it.
//
// files and images: what the reader attached to this message. A file's text
// is in the prompt; an image is a part of the same message.
export function synthesisAskPrompt(params: {
  profile: ReaderProfileCtx;
  lang: Lang;
  scopeLabel: string;
  question: string;
  web?: boolean;
  continued?: boolean;
  files?: { name: string; text?: string }[];
  imageCount?: number;
}): string {
  const files = params.files ?? [];
  const imageCount = params.imageCount ?? 0;
  return [
    profileLines(params.profile),
    "",
    `Scope: ${params.scopeLabel}. The material is above.`,
    ...(params.continued
      ? [
          "",
          "This message continues the conversation above. Answer it in the conversation's context. Never repeat what an earlier answer already said; add to it.",
        ]
      : []),
    ...(files.length > 0
      ? [
          "",
          "The reader attached these files to this message:",
          ...files.flatMap((f) => [
            `=== file: ${f.name} ===`,
            f.text ?? "(text not sent)",
            "=== end of file ===",
          ]),
        ]
      : []),
    ...(imageCount > 0
      ? [
          "",
          `The reader attached ${imageCount === 1 ? "one image" : `${imageCount} images`} to this message. The images are in this message.`,
        ]
      : []),
    "",
    params.question
      ? `Question: ${params.question}`
      : "The reader sent the attachments without a question. Say what they contain and how they relate to the material.",
    "",
    "Answer from the material above. Reference notes by their [note <id>] markers and",
    "blocks by their [block <id>] markers when they ground a claim. Say plainly when the",
    "material does not answer the question. Use markdown. Start with the answer.",
    "Keep it under 250 words unless the question needs more.",
    ...(files.length > 0 || imageCount > 0
      ? [
          "An attached file or image is material too: answer from it together with the material above, and name the file when you cite it.",
        ]
      : []),
    STYLE_RULE,
    ...(params.web
      ? [
          "",
          "You can search the web. Use it to verify the factual claims the material and your answer rest on against outside sources, and to add what the material lacks. Rules:",
          "1. Answer from the material first; the web checks it. Never present a web result as if it came from the material.",
          "2. Cite every web source you use as a markdown link at the point it supports, with the page title as the link text.",
          "3. When the web contradicts the material, say so plainly and show both sides.",
          "4. End with a section titled \"Web sources\" listing every web page you relied on as a markdown link, one per line. Leave the section out when you used none.",
        ]
      : []),
    answerLanguage(params.lang),
  ].join("\n");
}

// An earlier message of the reader, as the conversation replays it: the
// message, then each attachment it carried by name. A file's text was read
// when it was sent — its answer holds what mattered — so the name stands for
// it. An image still in the window rides beside this text as a part; one
// past the window is named here instead.
export function synthesisHistoryTurn(turn: {
  content: string;
  files?: { name: string }[];
  images?: { name?: string; shown: boolean }[];
}): string {
  const lines = [turn.content.trim() || "(no text)"];
  for (const f of turn.files ?? []) lines.push(`[attached file: ${f.name}]`);
  for (const img of turn.images ?? []) {
    lines.push(
      img.shown
        ? `[attached image${img.name ? `: ${img.name}` : ""}]`
        : `[attached image${img.name ? `: ${img.name}` : ""} — not shown again]`,
    );
  }
  return lines.join("\n");
}

const TASK_INSTRUCTIONS: Record<"contradictions" | "gaps" | "unsourced", string> = {
  contradictions: [
    "Find notes that contradict each other: incompatible claims, numbers that disagree,",
    "or conclusions that cannot both hold. Each issue lists the conflicting note ids.",
  ].join("\n"),
  gaps: [
    "Find gaps: sections that are thin for the reader's purpose, claims that lack support,",
    "and questions the notes raise but never answer. Each issue lists the related note ids",
    "(empty list when a gap is about a section with no notes; name the section in the issue).",
  ].join("\n"),
  unsourced: [
    "Find accepted notes with no source anchors (marked \"sources: none\") that state factual",
    "claims. Each issue lists the unsourced note ids.",
  ].join("\n"),
};

export function synthesisTaskPrompt(params: {
  profile: ReaderProfileCtx;
  lang: Lang;
  task: "contradictions" | "gaps" | "unsourced";
}): string {
  return [
    profileLines(params.profile),
    "",
    "The project is above: its documents, its notes (pending ones marked), and every annotation and layer on them.",
    "",
    TASK_INSTRUCTIONS[params.task],
    "",
    "Rules:",
    "1. Only report real issues. An empty list is a valid answer.",
    `2. issue: one sentence naming the problem. explanation: one or two sentences with the evidence. Write both in ${languageName(params.lang)}.`,
    "3. Use note ids exactly as they appear in [note <id>] markers.",
    `4. ${STYLE_RULE}`,
    "",
    'Return ONLY JSON: {"issues": [{"noteIds": ["<id>"], "issue": "<sentence>", "explanation": "<sentences>"}]}',
  ].join("\n");
}

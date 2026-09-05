import type { Lang } from "@/lib/i18n/config";
import { answerLanguage, languageName, profileLines, type ReaderProfileCtx } from "@/lib/prompts/types";

// SYNTHESIS: notebook-scope assistant output (SPEC.md §7). Free questions stream text;
// contradiction/gap/unsourced tasks return JSON issue cards.

// web: the assistant can search the web (SPEC.md §7). The material stays the
// first source; the web checks it and fills what it lacks, and every web
// source is cited as a link so the reader can verify it.
export function synthesisAskPrompt(params: {
  profile: ReaderProfileCtx;
  lang: Lang;
  scopeLabel: string;
  question: string;
  web?: boolean;
}): string {
  return [
    profileLines(params.profile),
    "",
    `Scope: ${params.scopeLabel}. The material is above.`,
    "",
    `Question: ${params.question}`,
    "",
    "Answer from the material above. Reference notes by their [note <id>] markers and",
    "blocks by their [block <id>] markers when they ground a claim. Say plainly when the",
    "material does not answer the question. Use markdown. No preamble.",
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
    `2. issue: one sentence naming the problem. explanation: 1-3 sentences with the evidence. Write both in ${languageName(params.lang)}.`,
    "3. Use note ids exactly as they appear in [note <id>] markers.",
    "",
    'Return ONLY JSON: {"issues": [{"noteIds": ["<id>"], "issue": "<sentence>", "explanation": "<sentences>"}]}',
  ].join("\n");
}

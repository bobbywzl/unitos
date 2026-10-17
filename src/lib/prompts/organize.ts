import type { Lang } from "@/lib/i18n/config";
import { languageName, profileLines, type ReaderProfileCtx } from "@/lib/prompts/types";

// Save as note (SPEC.md §7, `/api/notes/organize`): an answer of the
// assistant, or a tool's output, organized into one note of the project. The
// open document, when there is one, is the cached system prefix; the passages
// the answer cites from other documents follow it. This is the user message.
// The note lands PENDING: the reader reads it over and accepts it. Not in
// promptTemplates: the route is the notes', not /api/derive.
export type OrganizeCtx = {
  profile: ReaderProfileCtx;
  lang: Lang;
  // What made the answer: the assistant, or a tool (Explain, Analyze, …).
  origin: string;
  // What the reader asked; "" when a tool ran on a selection.
  question: string;
  // The selection a tool ran on, when it ran on one.
  selection: string;
  answer: string;
  sections: { id: string; title: string; parentTitle: string | null }[];
  // The section the note lands in unless the answer plainly belongs in another.
  defaultSection: { id: string; title: string };
  // True when the open document is above.
  hasDocument: boolean;
  // Passages the answer cites from documents other than the open one.
  citedPassages: { blockId: string; documentTitle: string; text: string }[];
};

export function organizePrompt(ctx: OrganizeCtx): string {
  return [
    `The reader saved an answer of ${ctx.origin} as a note. Organize the answer into one note of their project. The note lands pending: the reader reads it over and accepts it.`,
    "",
    profileLines(ctx.profile),
    "",
    ctx.hasDocument ? "The open document is above." : "No document is open.",
    ...(ctx.citedPassages.length > 0
      ? [
          "",
          "Passages the answer cites from other documents (block id — document: text):",
          ...ctx.citedPassages.map((p) => `[block ${p.blockId}] — ${p.documentTitle}: ${p.text}`),
        ]
      : []),
    "",
    `Sections in the project (id — title):\n${ctx.sections.length > 0 ? ctx.sections.map((s) => `${s.id} — ${s.parentTitle ? `${s.parentTitle} / ` : ""}${s.title}`).join("\n") : "none yet"}`,
    "",
    ...(ctx.selection ? ["The selection the answer is about:", ctx.selection, ""] : []),
    ...(ctx.question ? ["The reader's question:", ctx.question, ""] : []),
    "The answer:",
    ctx.answer,
    "",
    "Rules:",
    "1. One note. Its first line is a title: \"# \" and a few words that name what the note is about, not \"Answer\" or \"Note\".",
    "2. Organize the answer into the reader's own study note: the key points, each a short heading (\"## \") or a bold lead line, with the reasoning that supports it under it. Keep every point, every step of the reasoning, every example, and every link the answer gives. Drop only the answer's preamble, its repetition, and lines addressed to the reader (\"Would you like…\").",
    "3. Under each point, put the document's words that support it as quote lines: \"> \" and the exact words, copied from the block the answer cites as [block <id>]. A quote is one contiguous verbatim span of one block, at most three sentences. List each quote in quotes with its blockId, exactly as given: 30 quotes at most. Never invent a quote and never change its words.",
    "4. Never add a fact, a number, a name, or a claim the answer does not make. Never drop a caveat the answer gives. A web source the answer links stays as its markdown link.",
    "5. Replace every [block <id>] and [note <id>] tag with the words it points to or remove it: the note never shows an id.",
    "6. The markup: \"# \" for the title, \"## \" for a heading, \"- \" for a bullet, \"1. \" for a numbered item, \"> \" for a quote, **bold**, *italic*.",
    `7. Where the note goes: section ${ctx.defaultSection.id} (${ctx.defaultSection.title}) unless the answer plainly belongs in another section of the list (its id). Never a new section.`,
    `8. Write in the answer's language. When the answer mixes languages, write in ${languageName(ctx.lang)}; a quote keeps its own language.`,
    "",
    'Return ONLY JSON: {"notes": [{"content": "<markdown>", "sectionId": "<id>", "quotes": [{"blockId": "<id>", "quote": "<verbatim>"}]}], "warnings": ["<sentence>"]}',
  ].join("\n");
}

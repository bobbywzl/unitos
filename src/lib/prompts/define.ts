import { answerLanguage, profileLines, type PromptCtx } from "@/lib/prompts/types";

// DEFINE: the Define tool, the first row of the text toolbar when the
// selection is one word or one phrase (SPEC.md §6). The definition streams
// into the toolbar under the row and persists nothing (SPEC.md §4). What
// makes it worth reading: the reader knows what the word means in this
// sentence without leaving the text. A definition is one sentence, two at
// most, like a glossary definition (lib/glossary.ts), so it carries no
// STYLE_RULE: that rule's closing line names what trips the reader up, and
// the second sentence here already does that job.
export function definePrompt(ctx: PromptCtx): string {
  return [
    profileLines(ctx.profile),
    "",
    `The reader selected a word or a phrase in "${ctx.documentTitle}". The full document is above.`,
    "",
    "Context before the selection:",
    ctx.contextBefore || "(start of document)",
    "",
    "Selected word or phrase:",
    ctx.anchoredText,
    "",
    "Context after the selection:",
    ctx.contextAfter || "(end of document)",
    "",
    "Define the selected word or phrase for this reader.",
    "1. Before you write, read the sentence it sits in and work out what it means there. When the document defines it, use the document's definition, not a general one. Spell out an acronym or an abbreviation first. Define a symbol or a variable by what it stands for in this document. For a name — a person, a company, a place, a product — say who or what it is and its role in this document.",
    "2. Write what it means in this sentence in one sentence, in plain words: no word harder than the one defined, and never the word itself.",
    "3. When its everyday meaning is different from its meaning here, add one sentence with the everyday meaning. Otherwise stop after the first sentence.",
    "4. Pitch it at the reader's background: a reader who knows the field gets the precise sense, a reader who does not gets everyday words.",
    'Keep it under 40 words. Plain text: no markdown, no heading, no list. Start with the meaning: no preamble, never repeat the selection, never open with "In this context" or "Here".',
    answerLanguage(ctx.lang),
  ].join("\n");
}

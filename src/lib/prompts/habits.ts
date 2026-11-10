// HABITS: the asks under "You often ask" in the assistant panel (SPEC.md §7).
// One call reads how the reader asks and writes up to three asks for the
// project that is open. Not a derivation — nothing lands in a note — so it is
// not in promptTemplates.
export type HabitsCtx = {
  project: string;
  // The open document's title; null when no document is open.
  document: string | null;
  // The titles of the project's other documents.
  documents: string[];
  // The reader's asks in this project, newest first.
  asksHere: string[];
  // The reader's asks in their other projects, newest first.
  asksElsewhere: string[];
  // "Chinese" or "English": the language of the panel.
  language: string;
};

// An ask is one row of the panel, one line long: about 42 characters fit.
export const HABIT_MAX_CHARS = 42;
export const HABIT_MAX_CHARS_ZH = 20;

export function habitsPrompt(ctx: HabitsCtx): string {
  const list = (asks: string[]) => (asks.length === 0 ? "(none)" : asks.map((a, i) => `${i + 1}. ${a}`).join("\n"));
  return [
    "A reader works in a reading app. They ask an assistant about the documents of a project.",
    "",
    `The open project: ${ctx.project}`,
    `The open document: ${ctx.document ?? "(none)"}`,
    `The project's other documents: ${ctx.documents.length === 0 ? "(none)" : ctx.documents.join("; ")}`,
    "",
    "The reader's asks in this project, newest first:",
    list(ctx.asksHere),
    "",
    "The reader's asks in their other projects, newest first:",
    list(ctx.asksElsewhere),
    "",
    "Write the asks this reader is most likely to make again in the open project. The app shows each ask as a button; a press sends it to the assistant about the open document.",
    "1. Find the reader's habits. A habit is a way of asking that shows in two asks or more: what they ask for (a meaning, a reason, a comparison, a check of their own reading, a summary), the form they ask for (one sentence, plain words, a list), and the angle they take (the business, the cause, the evidence, the numbers).",
    "2. Write one ask per habit, at most 3 asks. Weigh the asks in this project above the asks in other projects.",
    "3. Each ask is general: it works on the whole open document, not on one passage. Do not copy a name, a term, or a fact from one passage. Do not copy a subject from another project.",
    "4. Each ask fits the open project: name its subject where that makes the ask clearer. Take the subject from the project's name and its documents' titles only.",
    "5. Keep the reader's form in the ask: if they ask for one plain sentence, the ask says one plain sentence.",
    `6. Each ask is short: at most ${HABIT_MAX_CHARS} characters in English, at most ${HABIT_MAX_CHARS_ZH} characters in Chinese. It shows on one line of a narrow panel, and a longer ask is cut. No quotation marks. No trailing period.`,
    `7. Write the asks in ${ctx.language}.`,
    "8. The app already offers a layman summary and a professional summary of the document. Do not write either.",
    "9. No two asks do the same job. Fewer asks is right when there are fewer habits. No habit: return an empty list.",
    "",
    'Return ONLY JSON: {"habits": [{"kind": "<the habit in two or three words>", "ask": "<the ask>"}]}',
  ].join("\n");
}

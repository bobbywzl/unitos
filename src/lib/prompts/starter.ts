// STARTER: the question the assistant bar shows in its empty box (SPEC.md
// §7). One question about the selected words; Tab puts it in the box. Not a
// derivation — nothing lands in a note — so it is not in promptTemplates.
export type StarterCtx = {
  /** The document's title. */
  title: string;
  /** The selected words. */
  quote: string;
  /** The words right before and right after the selection, for what it refers to. */
  before: string;
  after: string;
};

// The question has to fit the bar's box on two lines.
export const STARTER_MAX_CHARS = 60;
export const STARTER_MAX_CHARS_ZH = 24;

export function starterPrompt(ctx: StarterCtx): string {
  return [
    `A reader selected words in a document titled "${ctx.title}".`,
    "",
    "The words before the selection:",
    ctx.before || "(none)",
    "",
    "The selected words:",
    ctx.quote,
    "",
    "The words after the selection:",
    ctx.after || "(none)",
    "",
    "Write the one question this reader most likely wants to ask about the selected words.",
    `1. At most 9 words and ${STARTER_MAX_CHARS} characters. In Chinese at most ${STARTER_MAX_CHARS_ZH} characters.`,
    "2. Write the question in the language of the selected words.",
    "3. Ask about what the selected words leave open: an example, a reason, a number, a meaning, a consequence. Never ask what the selected words already state.",
    '4. Name the thing the question is about in the selection\'s own terms: "What are examples of these tools?", not "Can you explain this?".',
    "5. A question the reader would type, in the reader's voice. No quotation marks, no markdown.",
    "",
    'Return ONLY JSON: {"question": "<the question>"}',
  ].join("\n");
}

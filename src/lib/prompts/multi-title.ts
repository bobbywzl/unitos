// The title of a multi upload (SPEC.md §22): one short phrase that says what
// this set of documents is about, written when the multi upload is made.
// Not a derivation — nothing lands in a note — so it is not in
// promptTemplates.
export type MultiTitleCtx = { members: { title: string; opening: string }[] };

// The title has to fit the document list's row and the page header.
export const MULTI_TITLE_MAX_CHARS = 48;
export const MULTI_TITLE_MAX_CHARS_ZH = 16;

export function multiTitlePrompt(ctx: MultiTitleCtx): string {
  const listed = ctx.members
    .map((m, i) => `[member ${i + 1}] "${m.title}"\n${m.opening}`)
    .join("\n\n");
  return [
    "Below are the members of a multi upload: documents a reader put on one page to read together. Each member is listed with its title and its opening.",
    "",
    listed,
    "",
    "Write the multi upload's title: one short phrase that says what these documents are about together, so the reader knows which multi upload it is from the phrase alone.",
    `1. At most 6 words and ${MULTI_TITLE_MAX_CHARS} characters. In Chinese at most ${MULTI_TITLE_MAX_CHARS_ZH} characters.`,
    "2. Write the title in the members' language. When the members differ, use the language most of them share.",
    '3. Name what the members share — the subject, the question, the company, the method — not that they are documents: "Transformer scaling limits", not "Papers about transformers".',
    "4. Keep the members' own key terms. No quotation marks, no trailing period, no markdown.",
    "",
    'Return ONLY JSON: {"title": "<phrase>"}',
  ].join("\n");
}

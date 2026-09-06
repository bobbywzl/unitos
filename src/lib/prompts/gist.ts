// GIST: the phrase a collapsed note or annotation shows in place of its first
// words (SPEC.md §6). One call writes the gist for every note in the batch;
// the answer is JSON keyed by note id. Not a derivation — nothing lands in a
// note — so it is not in promptTemplates.
export type GistCtx = { notes: { id: string; text: string }[] };

// The phrase has to fit the collapsed row beside the note's id and its source
// count: about five words in English, fourteen characters in Chinese.
export const GIST_MAX_CHARS = 30;
export const GIST_MAX_CHARS_ZH = 14;

export function gistPrompt(ctx: GistCtx): string {
  const listed = ctx.notes.map((n) => `[note ${n.id}]\n${n.text}`).join("\n\n");
  return [
    "Below are notes a reader wrote or saved while reading. Each note is listed under its id.",
    "",
    listed,
    "",
    "For each note, write its gist: one short phrase that says what the note says, so the reader knows which note it is from the phrase alone.",
    `1. At most 5 words and ${GIST_MAX_CHARS} characters. In Chinese at most ${GIST_MAX_CHARS_ZH} characters.`,
    "2. Write the gist in the note's own language.",
    '3. State the note\'s point, not its topic: "Defaults bought, floor earned", not "Note about defaults".',
    "4. Keep the note's own key terms and numbers. No quotation marks, no trailing period, no markdown.",
    "5. One gist per id. Use the ids exactly as listed.",
    "",
    'Return ONLY JSON: {"gists": [{"id": "<note id>", "gist": "<phrase>"}]}',
  ].join("\n");
}

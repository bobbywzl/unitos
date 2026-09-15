import type { Lang } from "@/lib/i18n/config";

// MERGE: several notes rewritten as one note (SPEC.md §6). The reader drags a
// note onto another, holds, and picks Merge with AI; this writes the note that
// takes their place: the key points of every note, structured, each with the
// quotes that support it under it. Not a derivation — nothing new is read
// from a document, the reader's own notes are rewritten — so it is not in
// promptTemplates.
export type MergeCtx = {
  // The reader's UI language, used only when the notes carry no language of
  // their own. A merged note keeps the notes' language.
  lang: Lang;
  // The target first, then the notes merged into it, in the order they merge.
  notes: { id: string; text: string }[];
};

export function mergePrompt(ctx: MergeCtx): string {
  const listed = ctx.notes.map((n) => `[note ${n.id}]\n${n.text}`).join("\n\n");
  return [
    "Below are notes a reader wrote or saved while reading. Each note is listed under its id. The first note is the one the others merge into.",
    "",
    listed,
    "",
    "Write the one note that takes their place: the key points of every note, structured, each supported by the quotes that back it.",
    "1. Read every note and extract its key points. A key point is one claim, finding, or idea. A point in only one note stays; a point in several notes is written once.",
    "2. Structure the note. First line: a title as a level-one heading (`# Title`) that names what the notes are about; keep the first note's title when it has one. Then one section per key point: a level-two heading (`## `) that states the point in one line, then one to three sentences that summarize the point in the reader's own words, terms, and numbers.",
    "3. Place the quotes. A quote is a run of lines starting with `> `. Put every quote from the notes directly under the key point it supports, as blockquote lines, exactly as written — same words, same punctuation, same line breaks. Never rewrite, shorten, or drop a quote. Never write a quote the notes do not hold. A quote that supports no point goes under the point it is closest to.",
    "4. Order the key points so the note reads as one line of thought: the first note's order first, the other notes' points where they belong in it.",
    "5. Keep every image, link, and checklist item from the notes, under the point it belongs to.",
    `6. Write in the notes' own language${ctx.lang === "zh" ? " (Chinese when the notes are in Chinese)" : ""}.`,
    "7. No preamble, no heading naming the merge, no commentary on what you did. The note is the whole answer.",
    "",
    'Return ONLY JSON: {"note": "<the merged note in markdown>"}',
  ].join("\n");
}

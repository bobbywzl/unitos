import type { Lang } from "@/lib/i18n/config";

// MERGE: several notes rewritten as one note (SPEC.md §6). The reader drags a
// note onto another, holds, and picks Merge with AI; this writes the note that
// takes their place. Not a derivation — nothing new is read from a document,
// the reader's own notes are rewritten — so it is not in promptTemplates.
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
    "Write the one note that takes their place.",
    "1. Keep every point. A point in only one note stays; a point in several notes is written once.",
    "2. Keep the reader's own words, terms, numbers, and quotes exactly as written. Do not paraphrase what is already clear.",
    "3. Order the points so the note reads as one note: the first note's line of thought first, the others' points where they belong in it.",
    "4. Keep the notes' markdown — headings, lists, quotes, checklists, images, links — and keep every image and link.",
    `5. Write in the notes' own language${ctx.lang === "zh" ? " (Chinese when the notes are in Chinese)" : ""}.`,
    "6. No preamble, no heading naming the merge, no commentary on what you did. The note is the whole answer.",
    "",
    'Return ONLY JSON: {"note": "<the merged note in markdown>"}',
  ].join("\n");
}

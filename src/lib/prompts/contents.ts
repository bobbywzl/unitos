// The contents of a document (SPEC.md §26): the parts a reader jumps
// between, each with the block it starts at. One call over the whole
// document. The model reads the document under the cached prefix
// (documentPrefix) and names a part by the id of its first block — a
// block id copied from a [block <id>] marker resolves against the stored
// blocks, and one that does not is dropped. Titles are the document's own
// headings where it has them, and a short phrase the model writes where it
// does not; they read in the document's language, never translated.

export type ContentsCtx = {
  // How many blocks the document has: the ceiling on parts.
  blockCount: number;
  maxParts: number;
};

export function contentsPrompt(ctx: ContentsCtx): string {
  return [
    "Write the contents of this document: the parts a reader jumps between, in reading order.",
    "1. Segment the whole document. The first part starts at the first content block after the title; the last part runs to the end. No block is in two parts, and no content block is left out of every part.",
    "2. Where the document has headings, a part starts at a heading and its title is that heading, copied as written. Nested headings are level 2 parts under their level 1 part.",
    "3. Where the document has no heading for a stretch of text, segment it by what the text does — the setup, the method, a finding, an example, the conclusion — and write a title of at most 8 words that says what the part is about, in the document's language.",
    "4. A part is at least three blocks unless a heading makes it shorter. Never make a part of a figure, a table, or a reference list alone; a reference list is one part titled as the document titles it.",
    `5. blockId: the id of the part's first block, copied exactly from its [block <id>] marker. At most ${ctx.maxParts} parts for ${ctx.blockCount} blocks; a short document has few parts, and a document under 6 blocks has none.`,
    "6. level: 1 for a top-level part, 2 for a part inside it. No deeper.",
    "Do not think longer than the reading takes: this is a reading of where the parts begin, not a problem to solve.",
    'Return ONLY JSON: {"parts": [{"title": "<title>", "blockId": "<id>", "level": 1}]}',
  ].join("\n");
}

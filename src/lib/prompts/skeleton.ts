// The skeleton of a document (SPEC.md §22): the document collapsed for
// Stitch. One call per window of the document. The model reads the window
// under the cached prefix (documentPrefix over the window's blocks) and
// writes one line per block — every claim and number kept, the wording
// dropped — one summary per part of the contents that starts in the
// window, and, in the first window, the document's gist. A block id is
// copied from its [block <id>] marker; a line whose id names no block is
// dropped, and a block the model skips reads as its own first words.

export type SkeletonPartCtx = { blockId: string; title: string };

export type SkeletonCtx = {
  // The parts of the contents that start in this window, in order.
  parts: SkeletonPartCtx[];
  // The window's place: 1 of n. The gist is written in window 1 only.
  window: number;
  windows: number;
  blockCount: number;
};

export function skeletonPrompt(ctx: SkeletonCtx): string {
  const partList =
    ctx.parts.length > 0
      ? ctx.parts.map((p) => `[part ${p.blockId}] "${p.title}"`).join("; ")
      : "(none: the whole document is one part)";
  return [
    ctx.windows > 1
      ? `Above is window ${ctx.window} of ${ctx.windows} of the document: ${ctx.blockCount} blocks. The other windows are read in calls of their own.`
      : `Above is the whole document: ${ctx.blockCount} blocks.`,
    "Write the document's skeleton: what a second reader needs to know what every block says, at a tenth of the length.",
    "1. lines: one line per block above, in order, every block. blockId copied exactly from the block's [block <id>] marker. text: what the block says, at most 40 words — every claim, every number, every name and term as printed, nothing added, nothing judged. A heading is its text as written. A figure or a table is its caption plus the numbers it shows. A transcript line is what was said. A reference entry is its first author and year. Write in the document's language.",
    `2. parts: one summary per part listed here, for the parts that start in this window: ${partList}. blockId copied from the part's tag. summary: what the part says, one to three sentences, in the document's language, the main claims and numbers kept.`,
    ctx.window === 1
      ? "3. gist: one sentence, at most 30 words, in the document's language: what the whole document is and claims."
      : "3. gist: an empty string. It is written with window 1.",
    "Do not think longer than the reading takes: this is a reading, not a problem to solve. Copy numbers and terms; do not round or rename.",
    'Return ONLY JSON: {"gist": "…", "parts": [{"blockId": "<id>", "summary": "…"}], "lines": [{"blockId": "<id>", "text": "…"}]}',
  ].join("\n");
}

// The skeleton of a document (SPEC.md §22): the document collapsed for
// Stitch. One call per window of the document. The model reads the window
// under the cached prefix (documentPrefix over the window's blocks) and
// writes one line per block — every claim and number kept, the wording
// dropped — one summary per part of the contents that starts in the
// window, and, in the first window, the document's gist. The answer is a
// list of {blockId, text} by default; with SKELETON_KEYED it is JSON keyed
// by block number ({"1": "…"}: COST4-08, a fifth fewer output tokens). The
// parser takes both forms. The keyed form is on (ANS5, round 5): the
// first builds log their coverage (lib/graph/skeleton.ts
// logSkeletonCoverage) to judge it on the real model. The window's
// blocks are numbered 1..n in their [block <n>] markers (lib/graph/
// skeleton.ts maps each number back to the stored id): a line whose number
// names no block is dropped, and a block the model skips reads as its own
// first words.

// blockId: the number of the part's first block in the window.
// COST4-08: the keyed answer form, a fifth fewer output tokens. On; turn it
// off again when the coverage log shows the model skipping more blocks
// in it than in the list form (more than 2 points under).
export const SKELETON_KEYED = true;

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
    SKELETON_KEYED
      ? "1. lines: one line per block above, in order, every block, keyed by the block's number, copied from its [block <n>] marker. The line: what the block says, at most 40 words, or one word in ten for a block over 400 words — every claim, every number, every name and term as printed, nothing added, nothing judged. Every proper name in the block (a person, a work, a place) goes in its line, past the word count if it must: a reader looks for a name, and a name not in the line is never found. A heading is its text as written. A figure or a table is its caption plus the numbers it shows. A transcript line is what was said. A reference entry is its first author and year. Write in the document's language."
      : "1. lines: one line per block above, in order, every block. blockId: the block's number, copied from its [block <n>] marker. text: what the block says, at most 40 words, or one word in ten for a block over 400 words — every claim, every number, every name and term as printed, nothing added, nothing judged. Every proper name in the block (a person, a work, a place) goes in its line, past the word count if it must: a reader looks for a name, and a name not in the line is never found. A heading is its text as written. A figure or a table is its caption plus the numbers it shows. A transcript line is what was said. A reference entry is its first author and year. Write in the document's language.",
    SKELETON_KEYED
      ? `2. parts: one summary per part listed here, for the parts that start in this window: ${partList}, keyed by the number in the part's tag. The summary: what the part says, one to three sentences, in the document's language, the main claims and numbers kept.`
      : `2. parts: one summary per part listed here, for the parts that start in this window: ${partList}. blockId: the number in the part's tag. summary: what the part says, one to three sentences, in the document's language, the main claims and numbers kept.`,
    ctx.window === 1
      ? "3. gist: one sentence, at most 30 words, in the document's language: what the whole document is and claims."
      : "3. gist: an empty string. It is written with window 1.",
    "Do not think longer than the reading takes: this is a reading, not a problem to solve. Copy numbers and terms; do not round or rename.",
    SKELETON_KEYED
      ? 'Return ONLY JSON: {"gist": "…", "parts": {"1": "…"}, "lines": {"1": "…", "2": "…"}}'
      : 'Return ONLY JSON: {"gist": "…", "parts": [{"blockId": "1", "summary": "…"}], "lines": [{"blockId": "1", "text": "…"}, {"blockId": "2", "text": "…"}]}',
  ].join("\n");
}

// Collapse (SPEC.md §28): every block of the document to its core — what
// the block really says, in plain words, at a tenth to a third of its
// length. One call per window of blocks. The model reads the whole
// document under the cached prefix (documentPrefix), so a core is written
// in the light of the whole document: what the block serves in it, then
// the one thing it says, then plain words. A block id is copied from its
// [block <id>] marker; a core whose id names no block is dropped, and a
// block the model skips shows as it is.

export type CollapseBlockCtx = {
  blockId: string;
  type: string;
  // The block's length in words, and the ceiling the core must stay under.
  words: number;
  maxWords: number;
};

export type CollapseCtx = {
  blocks: CollapseBlockCtx[];
  // The window's place: 1 of n.
  window: number;
  windows: number;
};

export function collapsePrompt(ctx: CollapseCtx): string {
  const list = ctx.blocks
    .map((b) => `[block ${b.blockId}] (${b.type}, ${b.words} words → at most ${b.maxWords} words)`)
    .join("\n");
  return [
    "Above is the whole document. Collapse the blocks listed below to their cores: what each block really says, in plain words, as short as it can be without losing the point. The reader will read the cores in place of the blocks, in order, as the article.",
    ctx.windows > 1
      ? `This is window ${ctx.window} of ${ctx.windows}: collapse the blocks listed here only. The other windows are collapsed in calls of their own.`
      : "Collapse every block listed here.",
    "For every listed block, in order:",
    "1. Ask what the block serves in the whole document: the claim it makes, the evidence it gives, the step it takes, the example it shows, or the ground it lays for what comes next. The core says that, and nothing the block only mentions on the way.",
    "2. Ask what the block is really trying to say — the one thing the reader must take from it. Say that first. Keep a number, a name, or a term only when the point rests on it, written as printed.",
    "3. Write it in plain, simple words, the way you would explain it to a smart reader outside the field. Complete sentences. No jargon the point does not need; a term the document is about stays and reads as itself.",
    "4. Length: a tenth of the block for a long block, a third at most; the ceiling for each block is given. A long paragraph becomes two or three sentences at most; a short paragraph one sentence; a sentence stays one shorter sentence. Never longer than the block.",
    "5. A FIGURE: one or two sentences on what it shows and why the document shows it, from its caption and the text around it. A TABLE: one or two sentences on what the table says — the pattern, the comparison, the biggest number. An EQUATION: one sentence saying what it states in words, the symbols named as what they stand for. A LIST: its point in one or two sentences. A CODE block: what the code does, in one sentence. A TRANSCRIPT line: what was said, in one short sentence. A SLIDE: what the slide says, in one or two sentences. A SHEET: what the rows hold, in one sentence.",
    "6. Write in the document's language. Copy nothing from the block except the terms and numbers the point rests on.",
    "The blocks:",
    list,
    "blockId: copied exactly from the block's [block <id>] marker. One core per listed block, every listed block, no other block.",
    'Return ONLY JSON: {"cores": [{"blockId": "<id>", "text": "…"}]}',
  ].join("\n");
}

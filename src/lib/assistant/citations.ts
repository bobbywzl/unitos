// The figures of an answer against the blocks it tags (SPEC.md §7). The
// model tags a sentence with the blocks it read the claim in, and misses:
// a figure tagged to the block beside the one that holds it, or to none.
// The reader clicks the chip and lands on a passage without the number.
// This pass runs on the answer once the model is done: for every sentence,
// every figure that stands in none of the sentence's tagged blocks gets the
// tag of the block of the reading that holds it, right after the figure.
// A figure is a number of three digits or more, a decimal, or a percent:
// a count the model made ("three exercises") is no figure of the text, and
// a small number stands in too many blocks to be matched.
//
// Which block, when several hold the figure: the one nearest a block the
// sentence tags, within three blocks of it (the model read the right place
// and tagged the block beside it); else the one block that holds it; else
// none. The pass adds tags and never removes one: a tag the model put is
// its claim, kept.

const BLOCK_TAG = /\[block ([a-zA-Z0-9-]+)\]/g;
const FIGURE = /\d[\d,]*(?:\.\d+)?%?/g;
const NEAR = 3;

export type ReadBlock = { id: string; text: string };

/** The blocks of a digest document's tagged text, in order: each
    `[block <id>]` with the text up to the next tag, its type label dropped. */
export function blocksOfTaggedText(text: string): ReadBlock[] {
  const out: ReadBlock[] = [];
  const tags = [...text.matchAll(BLOCK_TAG)];
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    const from = (tag.index ?? 0) + tag[0].length;
    const to = i + 1 < tags.length ? (tags[i + 1].index ?? text.length) : text.length;
    const body = text.slice(from, to).replace(/^\s*\([^)\n]*\)/, "");
    out.push({ id: tag[1], text: body.trim() });
  }
  return out;
}

/** Whether `text` holds the figure as a number of its own: "40,000" in
    "quoted 40,000 dollars", not "400" in "1,400" or "4,000". */
function holds(text: string, figure: string): boolean {
  const plain = text.replace(/(\d),(?=\d{3}\b)/g, "$1");
  const rx = new RegExp(`(?<![\\d.,])${figure.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\d]|\\.\\d)`);
  return rx.test(plain);
}

/** A figure worth matching: three digits or more, a decimal, or a percent. */
function matchable(figure: string): boolean {
  if (figure.endsWith("%") || figure.includes(".")) return true;
  return figure.replace(/,/g, "").length >= 3;
}

/** The sentences of `text` as [start, end) spans: a sentence ends at a
    full stop, a question or exclamation mark followed by a space, unless a
    tag follows the mark, or at a line end. */
function sentences(text: string): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  const rx = /[.!?。！？](?=\s+(?!\[block ))|\n/g;
  for (const m of text.matchAll(rx)) {
    const end = (m.index ?? 0) + m[0].length;
    if (end > start) out.push([start, end]);
    start = end;
  }
  if (start < text.length) out.push([start, text.length]);
  return out;
}

/** `text` with a tag added after each figure that no tagged block of its
    sentence holds, when one block of `read` holds it (see the file's head).
    `shown`, when given, limits the blocks to the ones the model read. */
export function retagFigures(text: string, read: ReadBlock[], shown?: Set<string> | null): string {
  const blocks = shown ? read.filter((b) => shown.has(b.id)) : read;
  if (blocks.length === 0) return text;
  const order = new Map(blocks.map((b, k) => [b.id, k]));
  const byId = new Map(blocks.map((b) => [b.id, b]));
  // Tags blanked, so a digit of an id is no figure and offsets hold.
  const plain = text.replace(BLOCK_TAG, (tag) => " ".repeat(tag.length));
  const inserts: { at: number; tag: string }[] = [];
  for (const [start, end] of sentences(text)) {
    const sentence = text.slice(start, end);
    const tagged = [...sentence.matchAll(BLOCK_TAG)].map((m) => m[1]).filter((id) => byId.has(id));
    const taggedText = tagged.map((id) => byId.get(id)!.text).join("\n");
    for (const m of plain.slice(start, end).matchAll(FIGURE)) {
      const figure = m[0].replace(/[,.]$/, "");
      if (!matchable(figure)) continue;
      // The figure stands in a tagged block, or in the text the pass put a
      // tag on already this sentence: nothing to add.
      if (tagged.length > 0 && holds(taggedText, figure.replace(/,/g, ""))) continue;
      const bare = figure.replace(/,/g, "");
      const holders = blocks.filter((b) => !tagged.includes(b.id) && holds(b.text, bare));
      let pick: ReadBlock | null = null;
      if (holders.length === 1) pick = holders[0];
      else if (holders.length > 1 && tagged.length > 0) {
        const near = holders
          .map((b) => ({ b, d: Math.min(...tagged.map((id) => Math.abs((order.get(id) ?? 0) - (order.get(b.id) ?? 0)))) }))
          .filter((x) => x.d <= NEAR)
          .sort((a, b) => a.d - b.d);
        if (near.length > 0 && (near.length === 1 || near[0].d < near[1].d)) pick = near[0].b;
      }
      if (!pick) continue;
      const at = start + (m.index ?? 0) + figure.length;
      // The tag goes after the figure's unit when one follows ("40,000
      // dollars", "15 percent"), so the chip does not split the amount.
      const unit = /^((?:\s+|-)(?:percent|per cent|dollars?|euros?|pounds?|yuan|million|billion|thousand|trillion|points?|years?|months?|weeks?|days?|hours?|minutes?|seconds?|people|cases|pages|words|times)\b)/i.exec(text.slice(at));
      inserts.push({ at: at + (unit?.[1].length ?? 0), tag: ` [block ${pick.id}]` });
      tagged.push(pick.id);
    }
  }
  if (inserts.length === 0) return text;
  let out = text;
  for (const ins of inserts.sort((a, b) => b.at - a.at)) out = out.slice(0, ins.at) + ins.tag + out.slice(ins.at);
  return out;
}

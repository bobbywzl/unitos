// A gathered quote at sentence bounds (SPEC.md §13, Add to note; WALK5-10):
// a passage the graph shows is a window cut at word edges, so a quote taken
// from it starts and stops mid-sentence. Pure helpers: the Find route widens
// its passage with quoteSpan, and a Stitch answer's cited passage, cut to a
// length, ends at its last whole sentence with sentencePrefix.

/** A block this short is quoted whole. */
export const QUOTE_WHOLE_MAX = 400;
/** A quote at sentence bounds this long or longer falls back to the window. */
export const QUOTE_MAX = 800;
/** A quote shorter than this takes in the next sentence, then the one before.
    A CJK character counts as 4: it carries about a word. */
const QUOTE_MIN = 80;
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/g;
const weight = (s: string) => s.length + 3 * (s.match(CJK)?.length ?? 0);

// A sentence ends at . ! ? or … followed by a space or the end (a closing
// quote mark or bracket may stand between), or at 。！？ (Chinese has no
// space after them). "3.5" is not an end; nor is a . before a lowercase
// word ("e.g. of") or after a title ("Dr. Rée").
const END = /[.!?…]+["'”’)\]]*(?=\s|$)|[。！？]+["'”’)\]）」』]*/g;
const TITLE = /(?:^|[\s(])(?:Mr|Mrs|Ms|Dr|Prof|St|Sr|Jr|vs|cf|viz|No|Vol|pp?|ch|ed|al|e\.g|i\.e)\.$/i;
function notEnd(text: string, at: number, end: number): boolean {
  if (text[end - 1] !== ".") return false;
  if (TITLE.test(text.slice(Math.max(0, at - 6), at + 1))) return true;
  return /^\s+[a-z]/.test(text.slice(end, end + 3));
}

type Span = { start: number; end: number };

/** The text's sentences, each trimmed of the spaces around it. */
function sentences(text: string): Span[] {
  const out: Span[] = [];
  let from = 0;
  const push = (to: number) => {
    let s = from;
    let e = to;
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    if (e > s) out.push({ start: s, end: e });
    from = to;
  };
  for (const m of text.matchAll(END)) if (!notEnd(text, m.index, m.index + m[0].length)) push(m.index + m[0].length);
  push(text.length);
  return out;
}

/** The quote for the words at [start, end) of a block: the whole block when it
    is short; else the sentence or sentences that hold them, with the next
    sentence (then the one before) while the quote is under QUOTE_MIN chars;
    the given window when those sentences run to QUOTE_MAX chars or more. */
export function quoteSpan(text: string, start: number, end: number): Span {
  if (text.trim().length <= QUOTE_WHOLE_MAX) return sentenceBounds(text, 0, text.length);
  const all = sentences(text);
  let first = all.findIndex((s) => s.end > start);
  let last = all.findIndex((s) => s.end >= end);
  if (first === -1 || last === -1) return { start, end };
  while (weight(text.slice(all[first].start, all[last].end)) < QUOTE_MIN) {
    if (last + 1 < all.length) last++;
    else if (first > 0) first--;
    else break;
  }
  const span = { start: all[first].start, end: all[last].end };
  return span.end - span.start >= QUOTE_MAX ? { start, end } : span;
}

/** [start, end) without the spaces at its edges. */
function sentenceBounds(text: string, start: number, end: number): Span {
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return { start, end };
}

/** The head of a text that was cut to a length: up to its last whole
    sentence; up to the last word edge when the first sentence runs past the
    cut. A text not cut (shorter than the cut) is returned whole. */
export function sentencePrefix(text: string, cut: number): string {
  const trimmed = text.trim();
  if (text.length < cut) return trimmed;
  const all = sentences(text);
  // The last sentence ran past the cut unless the text ends a sentence.
  const whole = all.filter((s, i) => i < all.length - 1 || /[.!?…。！？]["'”’)\]）」』]*$/.test(text.slice(0, s.end)));
  if (whole.length > 0) return text.slice(all[0].start, whole[whole.length - 1].end);
  const space = trimmed.lastIndexOf(" ");
  return space > cut / 2 ? trimmed.slice(0, space) : trimmed;
}

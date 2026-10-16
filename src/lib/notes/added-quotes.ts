import { matchInTextLoose } from "@/lib/anchors/match";
import { coveredSourceIds, quotesOf } from "@/lib/notes/quote-sources";

// A quote an edit adds to a note gets its source (SPEC.md §6): the note's
// assistant's change, applied and saved, or a quote pasted in whole. The
// quote's words are found in the note's document and become a source, so
// the quote points back like a quote Add to notes wrote. A quote the edit
// only grew or cut — typing, one save at a time — gets none: its words are
// the reader's, not yet the document's. Nothing here deletes a source.

// A quote this short matches too much to be anchored on its own.
const MIN_QUOTE = 12;
// A quote may skip words: each piece between ellipses is anchored alone.
const ELLIPSIS = /\s*(?:\.\.\.|…|\[\.\.\.\]|\[…\])\s*/;
// Sources one quote gets, at most (a passage over several blocks).
const MAX_PER_QUOTE = 40;

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** The quotes `after` holds that `before` did not, whole: no quote of
    `before` is the same, holds it, or sits in it, and no source of the note
    covers it. */
export function addedQuotes(before: string, after: string, sources: { id: string; quotedText: string }[]): string[] {
  const was = quotesOf(before).map(normalize).filter(Boolean);
  const out: string[] = [];
  for (const quote of quotesOf(after)) {
    const q = normalize(quote);
    if (q.length < MIN_QUOTE) continue;
    if (was.some((w) => w === q || w.includes(q) || q.includes(w))) continue;
    if (coveredSourceIds(`> ${quote.replace(/\n/g, "\n> ")}`, sources).size > 0) continue;
    out.push(quote);
  }
  return out;
}

export type QuoteAnchor = {
  blockId: string;
  startOffset: number;
  endOffset: number;
  quotedText: string;
  prefix: string;
  suffix: string;
};

/** The anchors of one quote in the blocks: the whole quote in one block,
    else each paragraph, else each piece between ellipses, found on its own.
    A piece no block holds is left without a source. */
export function anchorsOfQuote(quote: string, blocks: { id: string; text: string }[]): QuoteAnchor[] {
  const find = (words: string): QuoteAnchor | null => {
    const selector = { quotedText: words.trim(), prefix: "", suffix: "" };
    if (selector.quotedText.length < MIN_QUOTE) return null;
    for (const block of blocks) {
      const hit = matchInTextLoose(block.text, selector);
      if (!hit) continue;
      return {
        blockId: block.id,
        startOffset: hit.start,
        endOffset: hit.end,
        quotedText: block.text.slice(hit.start, hit.end),
        prefix: block.text.slice(Math.max(0, hit.start - 32), hit.start),
        suffix: block.text.slice(hit.end, hit.end + 32),
      };
    }
    return null;
  };
  // Markdown emphasis and quote marks around the words are the note's, not
  // the document's.
  const bare = (text: string) => text.replace(/[*_`]/g, "").trim().replace(/^["“]|["”]$/g, "");
  const whole = find(bare(quote.replace(/\n+/g, " ")));
  if (whole) return [whole];
  const anchors: QuoteAnchor[] = [];
  const seen = new Set<string>();
  for (const paragraph of quote.split(/\n+/)) {
    const pieces = [bare(paragraph), ...bare(paragraph).split(ELLIPSIS)];
    const one = find(pieces[0]);
    for (const anchor of one ? [one] : pieces.slice(1).map(find)) {
      if (!anchor) continue;
      const key = `${anchor.blockId}:${anchor.startOffset}:${anchor.endOffset}`;
      if (seen.has(key)) continue;
      seen.add(key);
      anchors.push(anchor);
    }
  }
  return anchors.slice(0, MAX_PER_QUOTE);
}

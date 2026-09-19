import type { SourceChip } from "@/lib/types";

// A quote in a note and the source it came from (SPEC.md §6). A highlight
// added to notes, or dropped into one, lands as blockquote lines and a
// source that carries the quoted text. The rendered quote points back to
// the reader by that source, so the note needs no row of document chips
// under it for the sources its quotes already name; only a source no quote
// covers (a note the assistant wrote and paraphrased) keeps its chip.

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** The source a quote came from: its quoted text is the quote, or sits in
    it, or the quote sits in it (a passage over several blocks quotes each
    block; a source is one block's span). Null when no source matches. */
export function sourceOfQuote(quote: string, sources: SourceChip[]): SourceChip | null {
  const q = normalize(quote);
  if (q.length < 8) return null;
  let best: SourceChip | null = null;
  for (const source of sources) {
    const s = normalize(source.quotedText);
    if (s.length < 8) continue;
    if (s === q || q.includes(s) || s.includes(q)) {
      // The longest match wins: a short source inside a long quote is
      // weaker than a source that is the quote.
      if (!best || s.length > normalize(best.quotedText).length) best = source;
    }
  }
  return best;
}

/** The quotes of a note's body: each run of "> " lines as one quote, a bare
    ">" line a paragraph break inside it. */
export function quotesOf(body: string): string[] {
  const quotes: string[] = [];
  let open: string[] | null = null;
  for (const line of body.split("\n")) {
    const m = /^\s*>\s?(.*)$/.exec(line);
    if (m) {
      (open ??= []).push(m[1]);
    } else if (open) {
      quotes.push(open.join("\n"));
      open = null;
    }
  }
  if (open) quotes.push(open.join("\n"));
  return quotes;
}

/** The ids of the sources a note's quotes cover. */
export function coveredSourceIds(body: string, sources: { id: string; quotedText: string }[]): Set<string> {
  const covered = new Set<string>();
  const chips = sources.map((s) => ({ id: s.id, quotedText: s.quotedText, documentId: "", documentTitle: "", orphaned: false }));
  for (const quote of quotesOf(body)) {
    const source = sourceOfQuote(quote, chips);
    if (source) covered.add(source.id);
    // A passage over several blocks: every block's source it holds.
    for (const s of sources) {
      const n = normalize(s.quotedText);
      if (n.length >= 8 && normalize(quote).includes(n)) covered.add(s.id);
    }
  }
  return covered;
}

/** The sources a note's quotes do not cover: the chips still worth showing. */
export function uncoveredSources(body: string, sources: SourceChip[]): SourceChip[] {
  const covered = coveredSourceIds(body, sources);
  return sources.filter((s) => !covered.has(s.id));
}

/** The sources whose quote an edit removed from the note: covered by a
    quote in the text before, by none in the text after (SPEC.md §6). They
    go with the quote, so the mark in the reader stops pointing at a note
    that no longer holds the words. A source no quote ever covered stays. */
export function sourcesLeftByQuotes(
  before: string,
  after: string,
  sources: { id: string; quotedText: string }[],
): string[] {
  const was = coveredSourceIds(before, sources);
  const is = coveredSourceIds(after, sources);
  return [...was].filter((id) => !is.has(id));
}

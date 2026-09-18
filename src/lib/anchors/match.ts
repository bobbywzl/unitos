// Quote matching for anchor resolution (SPEC.md §5).
// Primary anchor is blockId + offsets; these functions re-find a quote when that fails.

export type QuoteSelector = {
  quotedText: string;
  prefix: string;
  suffix: string;
};

export type QuoteHit = { start: number; end: number };

function contextScore(text: string, start: number, end: number, s: QuoteSelector): number {
  let score = 0;
  const before = text.slice(Math.max(0, start - s.prefix.length), start);
  const after = text.slice(end, end + s.suffix.length);
  for (let i = 1; i <= Math.min(before.length, s.prefix.length); i++) {
    if (before[before.length - i] === s.prefix[s.prefix.length - i]) score++;
    else break;
  }
  for (let i = 0; i < Math.min(after.length, s.suffix.length); i++) {
    if (after[i] === s.suffix[i]) score++;
    else break;
  }
  return score;
}

// Exact occurrences of the quote, best-scored by surrounding context.
export function findQuote(text: string, s: QuoteSelector): QuoteHit | null {
  if (!s.quotedText) return null;
  let best: { hit: QuoteHit; score: number } | null = null;
  let from = 0;
  for (;;) {
    const idx = text.indexOf(s.quotedText, from);
    if (idx === -1) break;
    const hit = { start: idx, end: idx + s.quotedText.length };
    const score = contextScore(text, hit.start, hit.end, s);
    if (!best || score > best.score) best = { hit, score };
    from = idx + 1;
  }
  return best ? best.hit : null;
}

// Whitespace-tolerant match: collapse runs of whitespace on both sides, map indices back.
export function findQuoteNormalized(text: string, s: QuoteSelector): QuoteHit | null {
  return findFolded(text, s, false);
}

// Typography-tolerant match: whitespace collapsed as above, and the characters
// a model rewrites when it copies a quote folded to one form — curly quotes to
// straight, every dash to "-", the ellipsis to three dots, case ignored. A
// model that quotes the words right but retypes the punctuation still lands on
// the passage it quoted.
export function findQuoteLoose(text: string, s: QuoteSelector): QuoteHit | null {
  return findFolded(text, s, true);
}

// The characters a copied quote comes back with changed. A character folding to
// "" is dropped from the folded text.
const FOLD: Record<string, string> = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201A": "'",
  "\u201B": "'",
  "\u2032": "'",
  "\u201C": '"',
  "\u201D": '"',
  "\u201E": '"',
  "\u2033": '"',
  "\u2010": "-",
  "\u2011": "-",
  "\u2012": "-",
  "\u2013": "-",
  "\u2014": "-",
  "\u2015": "-",
  "\u2212": "-",
  "\u2026": "...",
  "\u00AD": "",
  "\u200B": "",
  "\uFEFF": "",
};

// The text folded for matching, with the original index of every folded
// character: map[i] is where folded character i came from.
function fold(text: string, loose: boolean): { text: string; map: number[] } {
  const map: number[] = [];
  let folded = "";
  let inSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (!inSpace && folded.length > 0) {
        folded += " ";
        map.push(i);
      }
      inSpace = true;
      continue;
    }
    inSpace = false;
    const replacement = loose ? (FOLD[ch] ?? ch).toLowerCase() : ch;
    for (const c of replacement) {
      folded += c;
      map.push(i);
    }
  }
  return { text: folded, map };
}

// Match on the folded text, then map the hit back to the original indices.
function findFolded(text: string, s: QuoteSelector, loose: boolean): QuoteHit | null {
  const haystack = fold(text, loose);
  const quote = fold(s.quotedText, loose).text.trim();
  if (!quote) return null;
  const hit = findQuote(haystack.text, {
    quotedText: quote,
    prefix: fold(s.prefix, loose).text.trim(),
    suffix: fold(s.suffix, loose).text.trim(),
  });
  if (!hit) return null;
  const start = haystack.map[hit.start];
  const lastIdx = haystack.map[Math.min(hit.end - 1, haystack.map.length - 1)];
  if (start === undefined || lastIdx === undefined) return null;
  return { start, end: lastIdx + 1 };
}

// Resolution ladder for one block's text.
export function matchInText(text: string, s: QuoteSelector): QuoteHit | null {
  return findQuote(text, s) ?? findQuoteNormalized(text, s);
}

// The same ladder with the typography-tolerant rung at the end. Used for
// quotes a model copied, never for anchors the reader captured.
export function matchInTextLoose(text: string, s: QuoteSelector): QuoteHit | null {
  return matchInText(text, s) ?? findQuoteLoose(text, s);
}

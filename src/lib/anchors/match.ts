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
  const map: number[] = []; // normalized index -> original index
  let normalized = "";
  let inSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (!inSpace && normalized.length > 0) {
        normalized += " ";
        map.push(i);
      }
      inSpace = true;
    } else {
      normalized += ch;
      map.push(i);
      inSpace = false;
    }
  }
  const normalizeQuote = (q: string) => q.replace(/\s+/g, " ").trim();
  const quote = normalizeQuote(s.quotedText);
  if (!quote) return null;
  const hit = findQuote(normalized, {
    quotedText: quote,
    prefix: normalizeQuote(s.prefix),
    suffix: normalizeQuote(s.suffix),
  });
  if (!hit) return null;
  const start = map[hit.start];
  const lastIdx = map[Math.min(hit.end - 1, map.length - 1)];
  return { start, end: lastIdx + 1 };
}

// Resolution ladder for one block's text.
export function matchInText(text: string, s: QuoteSelector): QuoteHit | null {
  return findQuote(text, s) ?? findQuoteNormalized(text, s);
}

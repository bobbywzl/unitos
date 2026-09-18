// A ranker for Stitch's select pass (SPEC.md §22): the skeleton lines of a
// project, scored against the command with BM25, so a select call over a
// project too large to read whole reads the lines most likely to bear on
// the command. No model, no index: the lines are tokenized on the spot,
// which is fast at the sizes a project reaches. Latin script tokenizes by
// word, CJK by character bigram, so a Chinese command finds Chinese lines.

const K1 = 1.2;
const B = 0.75;

const WORD = /[\p{L}\p{N}]+/gu;
const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/u;

/** The tokens of a text: lowercased words of two or more characters, and
    every CJK character as itself and with its neighbour. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const m of text.toLowerCase().matchAll(WORD)) {
    const word = m[0];
    if (!CJK.test(word)) {
      if (word.length >= 2) out.push(word);
      continue;
    }
    const chars = [...word];
    for (let i = 0; i < chars.length; i++) {
      out.push(chars[i]);
      if (i + 1 < chars.length) out.push(chars[i] + chars[i + 1]);
    }
  }
  return out;
}

/** Every item scored against the query, highest first. An item with no
    term in common scores 0 and sorts last, in the given order. */
export function rank<T>(items: T[], textOf: (item: T) => string, query: string): { item: T; score: number }[] {
  const terms = new Set(tokenize(query));
  if (terms.size === 0 || items.length === 0) return items.map((item) => ({ item, score: 0 }));
  const docs = items.map((item) => tokenize(textOf(item)));
  const avg = docs.reduce((sum, d) => sum + d.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const d of docs) {
    for (const term of new Set(d)) if (terms.has(term)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const n = docs.length;
  const scored = items.map((item, i) => {
    const d = docs[i];
    const tf = new Map<string, number>();
    for (const term of d) if (terms.has(term)) tf.set(term, (tf.get(term) ?? 0) + 1);
    let score = 0;
    for (const [term, f] of tf) {
      const idf = Math.log(1 + (n - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5));
      score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.length) / avg)));
    }
    return { item, score, i };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map(({ item, score }) => ({ item, score }));
}

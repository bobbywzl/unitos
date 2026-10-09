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

// The command's function words (ANS9-05): every line shares them, so as
// query terms they rank lines that bear on nothing ("the, are, these, what"
// took 19% of a 200-document cut). Dropped from the query with
// RankOptions.stop. "when" and "not" stay: dates and negations matter to a
// contradictions command. lib/graph/search.ts drops the same words from the
// index query.
export const STOP_WORDS = new Set(
  "what which who whom whose where why how does do did is are was were has have had be been the a an and or of in on to for from with about at by as into than then i my me we our you your he his she her they their it its this that these those can could would will should say says said".split(" "),
);

/** The query term that every year matches (ANS9-01): a line that carries a
    year (1000–2099) also holds this term when the query asks for it
    (RankOptions.extra), so a contradictions or date command lifts the dated
    lines into the cut though no command says a year. */
export const YEAR_TERM = "#year";
const YEAR = /^(?:1[0-9]{3}|20[0-9]{2})$/;

export type RankOptions = {
  // Drop the query's function words (STOP_WORDS).
  stop?: boolean;
  // Terms added to the query's: YEAR_TERM.
  extra?: string[];
};

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
export function rank<T>(items: T[], textOf: (item: T) => string, query: string, options: RankOptions = {}): { item: T; score: number }[] {
  const terms = new Set([...tokenize(query).filter((t) => !options.stop || !STOP_WORDS.has(t)), ...(options.extra ?? [])]);
  if (terms.size === 0 || items.length === 0) return items.map((item) => ({ item, score: 0 }));
  const years = terms.has(YEAR_TERM);
  const docs = items.map((item) => {
    const d = tokenize(textOf(item));
    if (years) {
      const n = d.length;
      for (let i = 0; i < n; i++) if (YEAR.test(d[i])) d.push(YEAR_TERM);
    }
    return d;
  });
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

/** Reciprocal rank fusion of ranked lists of keys (best first): a key's
    score is the sum over the lists that hold it of 1 / (k + its rank),
    highest first; ties keep the first list's order. A key high in two
    lists beats one high in one, and a key only one list holds still
    places (STITCH_INDEX: the skeleton lines' rank fused with the blocks'
    full-text rank). */
export function fuseRanks(lists: string[][], k = 60): { key: string; score: number }[] {
  const scores = new Map<string, { score: number; i: number }>();
  let order = 0;
  for (const list of lists) {
    list.forEach((key, rank) => {
      const s = scores.get(key);
      if (s) s.score += 1 / (k + rank + 1);
      else scores.set(key, { score: 1 / (k + rank + 1), i: order++ });
    });
  }
  return [...scores.entries()].sort((a, b) => b[1].score - a[1].score || a[1].i - b[1].i).map(([key, s]) => ({ key, score: s.score }));
}

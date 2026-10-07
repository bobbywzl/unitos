// Find across the project (SPEC.md §13): a word match over the project's
// block text, no model call. Latin script matches at a word start ("pity"
// finds "pitying", not "spity"); a word shorter than FIND_PREFIX_MIN matches
// only whole ("of" finds "of", not "often"); a query with CJK characters
// matches as a substring, since Chinese has no spaces between words. Pure
// helpers: the route runs the SQL.

export const FIND_MIN = 2;
export const FIND_MAX = 100;
export const FIND_PREFIX_MIN = 3; // a shorter word matches only whole (COST4-02)
export const FIND_SNIPPETS = 1; // passages per document in the first answer
export const FIND_TOP = 30; // documents with a passage in the first answer; the rest send counts (COST4-02)
export const FIND_MORE = 10; // passages per "+ N more"
const AROUND = 80; // characters each side of the match

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/;

export function isCjk(q: string): boolean {
  return CJK.test(q);
}

/** The query as one run of words: trimmed, inner whitespace one space. */
export function normalizeQuery(q: string): string {
  return q.replace(/\s+/g, " ").trim();
}

// A query that starts with a letter or a digit matches at a word start; one
// that starts with punctuation ("§22", "“pity”", "$5") matches wherever it
// stands, since no word starts before it (REV3-11).
const WORD_HEAD = /^[\p{L}\p{N}_]/u;
const WORD_TAIL = /[\p{L}\p{N}_]$/u;

/** A word query too short to match as a word start: it matches only whole. */
function wholeWord(q: string): boolean {
  return q.length < FIND_PREFIX_MIN && !isCjk(q) && WORD_HEAD.test(q) && WORD_TAIL.test(q);
}

/** A Postgres ARE pattern that matches q at a word start, case aside; a
    short word matches only whole. */
export function wordStartPattern(q: string): string {
  const escaped = q.replace(/[\\^$.|?*+()[\]{}]/g, "\\$&");
  if (!WORD_HEAD.test(q)) return escaped;
  return wholeWord(q) ? `\\m${escaped}\\M` : `\\m${escaped}`;
}

/** An ILIKE pattern that matches q anywhere, with % _ \ taken literally. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, "\\$&")}%`;
}

function escapeJs(q: string): string {
  return q.replace(/[\\^$.|?*+()[\]{}/]/g, "\\$&");
}

/** Where q first matches in text by the same rule as the SQL: at a word
    start (no letter or digit before it), or anywhere for CJK. */
export function firstMatch(text: string, q: string): { start: number; end: number } | null {
  const re =
    isCjk(q) || !WORD_HEAD.test(q)
      ? new RegExp(escapeJs(q), "iu")
      : new RegExp(
          `(?<![\\p{L}\\p{N}_])(?=[\\p{L}\\p{N}_])${escapeJs(q)}${wholeWord(q) ? "(?![\\p{L}\\p{N}_])" : ""}`,
          "iu",
        );
  const m = re.exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

/** The passage a find row shows: the match with AROUND characters each side,
    cut at word edges where it can be, and the match's place in it. */
export function snippet(text: string, q: string): { text: string; start: number; end: number } {
  const hit = firstMatch(text, q) ?? { start: 0, end: 0 };
  let from = Math.max(0, hit.start - AROUND);
  let to = Math.min(text.length, hit.end + AROUND);
  if (from > 0) {
    const space = text.indexOf(" ", from);
    if (space !== -1 && space < hit.start) from = space + 1;
  }
  if (to < text.length) {
    const space = text.lastIndexOf(" ", to);
    if (space > hit.end) to = space;
  }
  const head = from > 0 ? "…" : "";
  const tail = to < text.length ? "…" : "";
  return {
    text: `${head}${text.slice(from, to)}${tail}`,
    start: head.length + hit.start - from,
    end: head.length + hit.end - from,
  };
}

export type FindPassage = { blockId: string; text: string; start: number; end: number };
/** A document past the first FIND_TOP has its count and no passage; its
    passages come from the documentId + after call. */
export type FindDocument = { id: string; count: number; passages: FindPassage[] };
export type FindResult = { q: string; documents: FindDocument[] };

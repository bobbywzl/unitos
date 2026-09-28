// Words and glyphs, normalized the same way on both sides of every metric.

/** A word: a run of letters, digits, and marks, or one CJK character alone
    (Chinese and Japanese set no spaces between words). Soft hyphens and
    zero-width characters stay inside a word and drop in `normWord`. */
const WORD_RE =
  /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}]|(?:(?![\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}])[\p{L}\p{N}\p{M}\u00AD\u200B-\u200D\u2060\uFEFF])+/gu;

export type Word = { w: string; start: number; end: number };

/** One word as the metrics compare it: NFKC (ligatures, full-width forms,
    Kangxi radicals), lower case, soft hyphens and zero-width characters out.
    A dotless ı and a combining acute are í: TeX sets í so ("Domínguez"),
    the parse composes the two, and pdftotext keeps them apart. */
export function normWord(word: string): string {
  return word.replace(/\u0131\u0301/g, "\u00ED").normalize("NFKC").toLowerCase().replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, "");
}

/** The words of a text with their offsets in it. */
export function wordsOf(text: string): Word[] {
  const out: Word[] = [];
  for (const m of text.matchAll(WORD_RE)) {
    const w = normWord(m[0]);
    if (w) out.push({ w, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** A text as a line check compares it: NFKC, quotes and dashes unified,
    soft hyphens and zero-width characters out, spaces collapsed, lower case. */
export function normText(text: string): string {
  return text
    .replace(/\u0131\u0301/g, "\u00ED")
    .normalize("NFKC")
    .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/[‘’‚‛′‵]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—―−⁃]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// ── Garbled glyphs ──────────────────────────────────────────────────────────

/** What a garbled glyph looks like in extracted text. The TeX symbol fonts'
    leftovers: CMSY draws ≠ ∉ as a negation slash (its code is "6") over the
    relation, ↦ as \mapstochar ("7") and →, and the long arrows as two glyphs. */
const GARBLES: { kind: string; re: RegExp }[] = [
  { kind: "control character", re: /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu },
  { kind: "replacement character", re: /\uFFFD/gu },
  { kind: "private-use character", re: /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu },
  { kind: "lone combining mark", re: /(?<![\p{L}\p{N}\p{M}])\p{M}/gu },
  { kind: "accent apart from its letter", re: /[´¨ˆ˜˙ˇ˘˚¸˛](?=\p{L})|(?<=\p{L})[´¨ˆ˜˙ˇ˘˚¸˛]/gu },
  // Not a 6 that stands after a relation or an operator, a space between (a
  // fraction read flat: "σ = 6 = 1.5").
  { kind: "negation slash read as 6", re: /(?<![\d.,+\-−*/^_=(\[{]\s?)6\s?[=∈∋⊂⊃⊆⊇≡∼≈≃≅≤≥<>|∥⊢⊨≺≻⪯⪰∃]/gu },
  { kind: "maps-to read as 7→", re: /7(?:→|−+→)/gu },
  { kind: "long arrow in two glyphs", re: /=⇒|⇐=|⇐⇒|←−|−→/gu },
];

export type Garble = { kind: string; at: number; match: string };

/** The garbled glyphs of a text, each with its kind and offset. */
export function garblesOf(text: string): Garble[] {
  const out: Garble[] = [];
  for (const { kind, re } of GARBLES) {
    for (const m of text.matchAll(re)) out.push({ kind, at: m.index, match: m[0] });
  }
  return out.sort((a, b) => a.at - b.at);
}

// ── Lines that are furniture ────────────────────────────────────────────────

/** A line that is only a page number: "12", "12.", "xii", "- 12 -", "Page 3",
    "Page 3 of 12", "3 of 12", "3/12". */
export const PAGE_NUMBER_RE = /^[-–— ]*(?:(?:page|p\.)\s*)?(?:\d{1,4}|[ivxlc]{1,7})\.?(?:\s*(?:of|\/)\s*\d{1,4})?[-–— ]*$/i;

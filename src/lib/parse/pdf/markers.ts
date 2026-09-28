// List markers: what opens a list item at the start of a line, read by family
// and value so that a list's items can be checked to follow one another.

import type { Run } from "@/lib/parse/pdf/types";

export const BULLET_RE = /^\s*([•▪◦‣●·*-]|\d{1,2}[.)]|\([a-z\d]{1,3}\)|[ivx]{1,4}[.)])\s+/i;
export const GLYPH_BULLET_RE = /^\s*[•▪◦‣●·*-]\s+/;

// bullet: a glyph (•, ◦, ▪, a dash, Word's Courier "o"); box: a checkbox
// (☐, ☑, ☒); arabic "1." "1)" "(1)"; alpha "a." "(a)"; upperAlpha "A."
// "(A)"; roman "i." "(iv)"; upperRoman "I." "(II)"; legal "1.1" "2.3.1";
// prefixed "A-1." "B-10." (an exhibit's items); cite "[12]" "[Bil95]".
export type MarkerFamily =
  | "bullet"
  | "box"
  | "arabic"
  | "alpha"
  | "upperAlpha"
  | "roman"
  | "upperRoman"
  | "legal"
  | "prefixed"
  | "cite";

export type Marker = {
  // As printed: "(a)", "1.", "•", "☐", "1.1", "[12]", "*15".
  text: string;
  family: MarkerFamily;
  // The printed form around the value: "(x)", "x.", "x)", "x).", "x",
  // "[x]"; a legal number's is its parent ("2." for "2.3"), a prefixed
  // number's its prefix ("B-x." for "B-10.").
  shape: string;
  // The item's number: 3 for "c", "iii", "3", "2.3", "[3]"; 0 for a bullet, a
  // box, and an author-year label.
  value: number;
  // The characters the marker and the spaces after it take in the line.
  length: number;
  checked: boolean;
};

// A glyph bullet opens an item before words; a dash or an asterisk only with
// a space after it ("-5 °C" and "*15" are words). A glyph alone on its line
// is no item: a proof's end mark (□) after a display read as an empty list.
const BULLET_GLYPH_RE = /^([•▪◦‣●○■□◆❖➢➤►✓✔])\s*(?=\S)/;
const BULLET_WORD_RE = /^([-–—*·∙])\s+/;
// Word's second-level bullet: a letter "o" set in Courier New before words
// that are not monospace (a report's nested items read as lines of text).
const COURIER_O_RE = /^o\s+(?=\S)/;
const BOX_RE = /^([☐☑☒])\s+/;
const CITE_RE = /^\[(\d{1,3}|[A-Z][A-Za-z+'’-]{0,15}\d{2,4}[a-z]?)\]\s+/;
// "1.1", "2.3.1." — a legal number opens an item only before a capital or a
// quote: "3.5 million" is words.
const LEGAL_RE = /^((?:\d{1,2}\.)+)(\d{1,2})\.?\s+(?=[\p{Lu}“"'‘])/u;
// "A-1.", "B-10.": a letter and a number, the items of an exhibit's parts.
const PREFIXED_RE = /^([A-Z]{1,2}-)(\d{1,3})\.\s+(?=\S)/;
const PARENS_RE = /^\(([a-zA-Z]{1,5}|\d{1,3})\)\s+/;
const CLOSED_RE = /^([a-zA-Z]{1,5}|\d{1,3})(\)\.|[.)])\s+/;
// A number alone before the words, set apart by its style (a bold exercise
// number over regular text), with a star for a hard exercise: "*15".
const BARE_RE = /^(\*?)(\d{1,3})\s+/;

const ROMAN_RE = /^(x{0,3})(ix|iv|v?i{0,3})$/;

function romanValue(s: string): number {
  const m = ROMAN_RE.exec(s);
  if (!m || s.length === 0) return 0;
  const ones: Record<string, number> = { "": 0, i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9 };
  return m[1].length * 10 + ones[m[2]];
}

// A counter's family and value: "c" → alpha 3, "iv" → roman 4, "IV" →
// upperRoman 4, "12" → arabic 12. A letter that is also a numeral ("i",
// "v", "x") reads as a numeral here; readMarker's `after` settles it.
function counter(s: string): { family: MarkerFamily; value: number } | null {
  if (/^\d+$/.test(s)) return { family: "arabic", value: Number(s) };
  const lower = s.toLowerCase();
  const upper = s === s.toUpperCase();
  if (s !== lower && !upper) return null;
  const roman = romanValue(lower);
  if (roman > 0) return { family: upper ? "upperRoman" : "roman", value: roman };
  if (s.length === 1) return { family: upper ? "upperAlpha" : "alpha", value: lower.charCodeAt(0) - 96 };
  return null;
}

// The letter reading of a one-letter numeral: "(i)" after "(h)" is the ninth
// letter, "(v)" after "(u)" the twenty-second.
function asLetter(m: Marker): Marker | null {
  if (m.family !== "roman" && m.family !== "upperRoman") return null;
  const letter = m.text.replace(/[^a-zA-Z]/g, "");
  if (letter.length !== 1) return null;
  return { ...m, family: m.family === "roman" ? "alpha" : "upperAlpha", value: letter.toLowerCase().charCodeAt(0) - 96 };
}

/** The marker that opens this line, if any. `after` is the marker of the
    item before it in the same list, for the one-letter numerals. */
export function readMarker(line: { text: string; runs: Run[] }, after?: Marker | null): Marker | null {
  const lead = /^\s*/.exec(line.text)?.[0].length ?? 0;
  const text = line.text.slice(lead);
  const make = (m: RegExpExecArray, family: MarkerFamily, shape: string, value: number, checked = false): Marker => ({
    text: m[0].trim(),
    family,
    shape,
    value,
    length: lead + m[0].length,
    checked,
  });
  let m: RegExpExecArray | null;
  if ((m = BOX_RE.exec(text))) return make(m, "box", "", 0, m[1] !== "☐");
  if ((m = BULLET_GLYPH_RE.exec(text)) || (m = BULLET_WORD_RE.exec(text))) return make(m, "bullet", "", 0);
  if ((m = COURIER_O_RE.exec(text)) && setApart(line, lead, 1, "mono")) return make(m, "bullet", "", 0);
  if ((m = CITE_RE.exec(text))) return make(m, "cite", "[x]", /^\d+$/.test(m[1]) ? Number(m[1]) : 0);
  if ((m = LEGAL_RE.exec(text))) return make(m, "legal", m[1], Number(m[2]));
  if ((m = PREFIXED_RE.exec(text))) return make(m, "prefixed", `${m[1]}x.`, Number(m[2]));
  let found: Marker | null = null;
  if ((m = PARENS_RE.exec(text))) {
    const c = counter(m[1]);
    if (c) found = make(m, c.family, "(x)", c.value);
  } else if ((m = CLOSED_RE.exec(text))) {
    const c = counter(m[1]);
    // "A." and "I." open initials as often as items ("A. Vaswani"); a
    // capital letter needs the item before it, or to open its family.
    if (c) found = make(m, c.family, `x${m[2]}`, c.value);
  } else if ((m = BARE_RE.exec(text)) && setApart(line, lead, m[0].trimEnd().length, "bold")) {
    found = make(m, "arabic", m[1] ? "*x" : "x", Number(m[2]));
  }
  if (!found) return null;
  const letter = asLetter(found);
  if (letter && after && follows(after, letter) && !follows(after, found)) return letter;
  if (letter && found.value !== 1 && !(after && follows(after, found))) return letter;
  return found;
}

// A marker set apart by its style: its own run in a style (bold, monospace)
// the words after it do not share.
function setApart(line: { text: string; runs: Run[] }, from: number, length: number, flag: "bold" | "mono"): boolean {
  const first = line.runs.find((r) => r.end > from);
  if (!first || !first[flag] || first.start > from) return false;
  const next = line.runs.find((r) => r.start >= from + length && line.text.slice(r.start, r.end).trim() !== "");
  return first.end <= from + length + 1 && next !== undefined && !next[flag];
}

/** The next marker continues the list of `prev`: the same family and shape
    and the next value. Bullets, boxes, and author-year labels always do. */
export function follows(prev: Marker, next: Marker): boolean {
  if (prev.family !== next.family || prev.shape !== next.shape) return false;
  if (next.family === "bullet" || next.family === "box") return true;
  if (next.family === "cite") return prev.value === 0 ? next.value === 0 : next.value === prev.value + 1;
  return next.value === prev.value + 1;
}

/** A bullet glyph or a box: no word starts with one, so it opens an item
    wherever a line starts with it. A dash or an asterisk may be words. */
export function isGlyphMarker(m: Marker): boolean {
  return m.family === "box" || (m.family === "bullet" && !/^[-–—*·∙]$/.test(m.text));
}

/** The marker opens its family's sequence: "1.", "(a)", "i.", "[1]". */
export function opensSequence(m: Marker): boolean {
  return m.family === "bullet" || m.family === "box" || (m.family === "cite" && m.value <= 1) || m.value === 1;
}

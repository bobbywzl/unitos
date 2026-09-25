// Google Docs' list presets (SPEC.md §29, typing): the 17 prefixes that start
// a list when a space follows them, and the glyphs each numbered preset
// draws level by level. A list keeps its preset in the `listStyle`
// attribute (data-list-style), named as the Google Docs API names presets;
// null is the default: ● ○ ■ for bullets, 1. a. i. for numbers. The
// toolbar area draws the presets its palettes offer; typing.css draws the
// ones only a typed prefix reaches.

export type ListStyle =
  | "BULLET_DASH"
  | "BULLET_PLUS"
  | "NUMBERED_DECIMAL_ALPHA_ROMAN_PARENS"
  | "NUMBERED_DECIMAL_ALPHA_ROMAN_TWO_PARENS"
  | "NUMBERED_DECIMAL_ALPHA_ROMAN_PERIOD_PARENS"
  | "NUMBERED_ZERODECIMAL_ALPHA_ROMAN"
  | "NUMBERED_ALPHA_ROMAN_DECIMAL"
  | "NUMBERED_ALPHA_ROMAN_DECIMAL_PARENS"
  | "NUMBERED_ALPHA_ROMAN_DECIMAL_TWO_PARENS"
  | "NUMBERED_UPPERALPHA_ALPHA_ROMAN"
  | "NUMBERED_UPPERALPHA_ALPHA_ROMAN_PARENS"
  | "NUMBERED_UPPERALPHA_ALPHA_ROMAN_TWO_PARENS"
  | "NUMBERED_UPPERROMAN_UPPERALPHA_DECIMAL";

type ListKind = "bulletList" | "orderedList" | "taskList";

const PREFIXES: { re: RegExp; type: ListKind; style: ListStyle | null }[] = [
  { re: /^\*$/, type: "bulletList", style: null },
  { re: /^•$/, type: "bulletList", style: null },
  { re: /^-$/, type: "bulletList", style: "BULLET_DASH" },
  { re: /^\+$/, type: "bulletList", style: "BULLET_PLUS" },
  { re: /^\[\]$/, type: "taskList", style: null },
  { re: /^1\.$/, type: "orderedList", style: null },
  { re: /^1\)$/, type: "orderedList", style: "NUMBERED_DECIMAL_ALPHA_ROMAN_PARENS" },
  { re: /^\(1\)$/, type: "orderedList", style: "NUMBERED_DECIMAL_ALPHA_ROMAN_TWO_PARENS" },
  { re: /^1\.\)$/, type: "orderedList", style: "NUMBERED_DECIMAL_ALPHA_ROMAN_PERIOD_PARENS" },
  { re: /^01\.$/, type: "orderedList", style: "NUMBERED_ZERODECIMAL_ALPHA_ROMAN" },
  { re: /^a\.$/, type: "orderedList", style: "NUMBERED_ALPHA_ROMAN_DECIMAL" },
  { re: /^a\)$/, type: "orderedList", style: "NUMBERED_ALPHA_ROMAN_DECIMAL_PARENS" },
  { re: /^\(a\)$/, type: "orderedList", style: "NUMBERED_ALPHA_ROMAN_DECIMAL_TWO_PARENS" },
  { re: /^A\.$/, type: "orderedList", style: "NUMBERED_UPPERALPHA_ALPHA_ROMAN" },
  { re: /^A\)$/, type: "orderedList", style: "NUMBERED_UPPERALPHA_ALPHA_ROMAN_PARENS" },
  { re: /^\(A\)$/, type: "orderedList", style: "NUMBERED_UPPERALPHA_ALPHA_ROMAN_TWO_PARENS" },
  { re: /^I\.$/, type: "orderedList", style: "NUMBERED_UPPERROMAN_UPPERALPHA_DECIMAL" },
];

/** The list a typed prefix starts, or null. */
export function listForPrefix(prefix: string): { type: ListKind; style: ListStyle | null } | null {
  const hit = PREFIXES.find((p) => p.re.test(prefix));
  return hit ? { type: hit.type, style: hit.style } : null;
}

type Counter = "decimal" | "decimal-leading-zero" | "lower-alpha" | "upper-alpha" | "lower-roman" | "upper-roman";
/** One level's glyph: the counter and the text around it. */
export type Glyph = { counter: Counter; before: string; after: string };

const g = (counter: Counter, before: string, after: string): Glyph => ({ counter, before, after });
const P = (c: Counter) => g(c, "", ".");
const R = (c: Counter) => g(c, "", ")");
const RR = (c: Counter) => g(c, "(", ")");
const PR = (c: Counter) => g(c, "", ".)");

const DEC = "decimal";
const LA = "lower-alpha";
const UA = "upper-alpha";
const LR = "lower-roman";
const UR = "upper-roman";

/** The default numbered list: 1. a. i. on every three levels. */
export const DEFAULT_NUMBER_GLYPHS: Glyph[] = [P(DEC), P(LA), P(LR), P(DEC), P(LA), P(LR), P(DEC), P(LA), P(LR)];

/** Each numbered preset's glyphs, levels 1 to 9. */
export const STYLE_GLYPHS: Partial<Record<ListStyle, Glyph[]>> = {
  NUMBERED_DECIMAL_ALPHA_ROMAN_PARENS: [R(DEC), R(LA), R(LR), RR(DEC), RR(LA), RR(LR), P(DEC), P(LA), P(LR)],
  NUMBERED_DECIMAL_ALPHA_ROMAN_TWO_PARENS: [RR(DEC), RR(LA), RR(LR), R(DEC), R(LA), R(LR), P(DEC), P(LA), P(LR)],
  NUMBERED_DECIMAL_ALPHA_ROMAN_PERIOD_PARENS: [PR(DEC), PR(LA), PR(LR), RR(DEC), RR(LA), RR(LR), P(DEC), P(LA), P(LR)],
  NUMBERED_ZERODECIMAL_ALPHA_ROMAN: [P("decimal-leading-zero"), P(LA), P(LR), P(DEC), P(LA), P(LR), P(DEC), P(LA), P(LR)],
  NUMBERED_ALPHA_ROMAN_DECIMAL: [P(LA), P(LR), P(DEC), P(LA), P(LR), P(DEC), P(LA), P(LR), P(DEC)],
  NUMBERED_ALPHA_ROMAN_DECIMAL_PARENS: [R(LA), R(LR), R(DEC), RR(LA), RR(LR), RR(DEC), P(LA), P(LR), P(DEC)],
  NUMBERED_ALPHA_ROMAN_DECIMAL_TWO_PARENS: [RR(LA), RR(LR), RR(DEC), R(LA), R(LR), R(DEC), P(LA), P(LR), P(DEC)],
  NUMBERED_UPPERALPHA_ALPHA_ROMAN: [P(UA), P(LA), P(LR), P(DEC), P(LA), P(LR), P(DEC), P(LA), P(LR)],
  NUMBERED_UPPERALPHA_ALPHA_ROMAN_PARENS: [R(UA), R(LA), R(LR), RR(DEC), RR(LA), RR(LR), P(DEC), P(LA), P(LR)],
  NUMBERED_UPPERALPHA_ALPHA_ROMAN_TWO_PARENS: [RR(UA), RR(LA), RR(LR), R(DEC), R(LA), R(LR), P(DEC), P(LA), P(LR)],
  NUMBERED_UPPERROMAN_UPPERALPHA_DECIMAL: [P(UR), P(UA), P(DEC), R(LA), RR(DEC), RR(LA), RR(LR), RR(LA), RR(LR)],
};

function roman(n: number): string {
  const table: [number, string][] = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let out = "";
  let rest = Math.max(1, Math.min(3999, n));
  for (const [value, letters] of table) {
    while (rest >= value) {
      out += letters;
      rest -= value;
    }
  }
  return out;
}

function latin(n: number): string {
  let out = "";
  let rest = Math.max(1, n);
  while (rest > 0) {
    rest -= 1;
    out = String.fromCharCode(97 + (rest % 26)) + out;
    rest = Math.floor(rest / 26);
  }
  return out;
}

function counterText(counter: Counter, n: number): string {
  switch (counter) {
    case "decimal":
      return String(n);
    case "decimal-leading-zero":
      return n < 10 ? `0${n}` : String(n);
    case "lower-alpha":
      return latin(n);
    case "upper-alpha":
      return latin(n).toUpperCase();
    case "lower-roman":
      return roman(n);
    case "upper-roman":
      return roman(n).toUpperCase();
  }
}

/** The label item `n` of a numbered list draws at `level` (0-based). */
export function listLabel(style: string | null, level: number, n: number): string {
  const glyphs = (style && STYLE_GLYPHS[style as ListStyle]) || DEFAULT_NUMBER_GLYPHS;
  const glyph = glyphs[Math.max(0, Math.min(8, level))];
  return `${glyph.before}${counterText(glyph.counter, n)}${glyph.after}`;
}

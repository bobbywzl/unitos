// Google Docs' list presets (SPEC.md §29, typing): the 17 prefixes that start
// a list when a space follows them, and the glyphs each preset draws level
// by level. A list keeps its preset in the `listPreset` attribute
// (data-list-preset); none means the default: ● ○ ■ for bullets, 1. a. i.
// for numbers. typing.css draws the glyphs.

export type ListPreset =
  | "dash"
  | "plus"
  | "decimal-latinlower-romanlower-parentheses"
  | "decimal-latinlower-romanlower-two-parentheses"
  | "decimal-latinlower-romanlower-period-parentheses"
  | "decimalzero-latinlower-romanlower"
  | "latinlower-romanlower-decimal-period"
  | "latinlower-romanlower-decimal-parentheses"
  | "latinlower-romanlower-decimal-two-parentheses"
  | "latinupper-latinlower-romanlower"
  | "latinupper-latinlower-romanlower-parentheses"
  | "latinupper-latinlower-romanlower-two-parentheses"
  | "romanupper-latinupper-decimal";

export const LIST_PRESETS: readonly ListPreset[] = [
  "dash",
  "plus",
  "decimal-latinlower-romanlower-parentheses",
  "decimal-latinlower-romanlower-two-parentheses",
  "decimal-latinlower-romanlower-period-parentheses",
  "decimalzero-latinlower-romanlower",
  "latinlower-romanlower-decimal-period",
  "latinlower-romanlower-decimal-parentheses",
  "latinlower-romanlower-decimal-two-parentheses",
  "latinupper-latinlower-romanlower",
  "latinupper-latinlower-romanlower-parentheses",
  "latinupper-latinlower-romanlower-two-parentheses",
  "romanupper-latinupper-decimal",
];

type ListKind = "bulletList" | "orderedList" | "taskList";

const PREFIXES: { re: RegExp; type: ListKind; preset: ListPreset | null }[] = [
  { re: /^\*$/, type: "bulletList", preset: null },
  { re: /^•$/, type: "bulletList", preset: null },
  { re: /^-$/, type: "bulletList", preset: "dash" },
  { re: /^\+$/, type: "bulletList", preset: "plus" },
  { re: /^\[\]$/, type: "taskList", preset: null },
  { re: /^1\.$/, type: "orderedList", preset: null },
  { re: /^1\)$/, type: "orderedList", preset: "decimal-latinlower-romanlower-parentheses" },
  { re: /^\(1\)$/, type: "orderedList", preset: "decimal-latinlower-romanlower-two-parentheses" },
  { re: /^1\.\)$/, type: "orderedList", preset: "decimal-latinlower-romanlower-period-parentheses" },
  { re: /^01\.$/, type: "orderedList", preset: "decimalzero-latinlower-romanlower" },
  { re: /^a\.$/, type: "orderedList", preset: "latinlower-romanlower-decimal-period" },
  { re: /^a\)$/, type: "orderedList", preset: "latinlower-romanlower-decimal-parentheses" },
  { re: /^\(a\)$/, type: "orderedList", preset: "latinlower-romanlower-decimal-two-parentheses" },
  { re: /^A\.$/, type: "orderedList", preset: "latinupper-latinlower-romanlower" },
  { re: /^A\)$/, type: "orderedList", preset: "latinupper-latinlower-romanlower-parentheses" },
  { re: /^\(A\)$/, type: "orderedList", preset: "latinupper-latinlower-romanlower-two-parentheses" },
  { re: /^I\.$/, type: "orderedList", preset: "romanupper-latinupper-decimal" },
];

/** The list a typed prefix starts, or null. */
export function presetForPrefix(prefix: string): { type: ListKind; preset: ListPreset | null } | null {
  const hit = PREFIXES.find((p) => p.re.test(prefix));
  return hit ? { type: hit.type, preset: hit.preset } : null;
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
export const PRESET_GLYPHS: Partial<Record<ListPreset, Glyph[]>> = {
  "decimal-latinlower-romanlower-parentheses": [R(DEC), R(LA), R(LR), RR(DEC), RR(LA), RR(LR), P(DEC), P(LA), P(LR)],
  "decimal-latinlower-romanlower-two-parentheses": [RR(DEC), RR(LA), RR(LR), R(DEC), R(LA), R(LR), P(DEC), P(LA), P(LR)],
  "decimal-latinlower-romanlower-period-parentheses": [PR(DEC), PR(LA), PR(LR), RR(DEC), RR(LA), RR(LR), P(DEC), P(LA), P(LR)],
  "decimalzero-latinlower-romanlower": [P("decimal-leading-zero"), P(LA), P(LR), P(DEC), P(LA), P(LR), P(DEC), P(LA), P(LR)],
  "latinlower-romanlower-decimal-period": [P(LA), P(LR), P(DEC), P(LA), P(LR), P(DEC), P(LA), P(LR), P(DEC)],
  "latinlower-romanlower-decimal-parentheses": [R(LA), R(LR), R(DEC), RR(LA), RR(LR), RR(DEC), P(LA), P(LR), P(DEC)],
  "latinlower-romanlower-decimal-two-parentheses": [RR(LA), RR(LR), RR(DEC), R(LA), R(LR), R(DEC), P(LA), P(LR), P(DEC)],
  "latinupper-latinlower-romanlower": [P(UA), P(LA), P(LR), P(DEC), P(LA), P(LR), P(DEC), P(LA), P(LR)],
  "latinupper-latinlower-romanlower-parentheses": [R(UA), R(LA), R(LR), RR(DEC), RR(LA), RR(LR), P(DEC), P(LA), P(LR)],
  "latinupper-latinlower-romanlower-two-parentheses": [RR(UA), RR(LA), RR(LR), R(DEC), R(LA), R(LR), P(DEC), P(LA), P(LR)],
  "romanupper-latinupper-decimal": [P(UR), P(UA), P(DEC), R(LA), RR(DEC), RR(LA), RR(LR), RR(LA), RR(LR)],
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
export function listLabel(preset: ListPreset | null, level: number, n: number): string {
  const glyphs = (preset && PRESET_GLYPHS[preset]) || DEFAULT_NUMBER_GLYPHS;
  const glyph = glyphs[Math.max(0, Math.min(8, level))];
  return `${glyph.before}${counterText(glyph.counter, n)}${glyph.after}`;
}

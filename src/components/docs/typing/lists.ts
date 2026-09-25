import type { Node as PMNode } from "@tiptap/pm/model";

// Google Docs' list detection (SPEC.md §29, typing): the 17 prefixes that
// start a list when a space follows them, and the label a numbered list gives
// its next item, so a typed "4." continues a list. A list keeps its preset
// in `listStyle`, as the Google Docs API names it; null is the default.

export function isList(node: PMNode | null | undefined): boolean {
  return node?.type.name === "bulletList" || node?.type.name === "orderedList" || node?.type.name === "taskList";
}

export function isListItem(node: PMNode | null | undefined): boolean {
  return node?.type.name === "listItem" || node?.type.name === "taskItem";
}

type ListKind = "bulletList" | "orderedList" | "taskList";

const PREFIXES: Record<string, [ListKind, string | null]> = {
  "*": ["bulletList", null],
  "•": ["bulletList", null],
  "-": ["bulletList", "BULLET_DASH"],
  "+": ["bulletList", "BULLET_PLUS"],
  "[]": ["taskList", null],
  "1.": ["orderedList", null],
  "1)": ["orderedList", "NUMBERED_DECIMAL_ALPHA_ROMAN_PARENS"],
  "(1)": ["orderedList", "NUMBERED_DECIMAL_ALPHA_ROMAN_TWO_PARENS"],
  "1.)": ["orderedList", "NUMBERED_DECIMAL_ALPHA_ROMAN_PERIOD_PARENS"],
  "01.": ["orderedList", "NUMBERED_ZERODECIMAL_ALPHA_ROMAN"],
  "a.": ["orderedList", "NUMBERED_ALPHA_ROMAN_DECIMAL"],
  "a)": ["orderedList", "NUMBERED_ALPHA_ROMAN_DECIMAL_PARENS"],
  "(a)": ["orderedList", "NUMBERED_ALPHA_ROMAN_DECIMAL_TWO_PARENS"],
  "A.": ["orderedList", "NUMBERED_UPPERALPHA_ALPHA_ROMAN"],
  "A)": ["orderedList", "NUMBERED_UPPERALPHA_ALPHA_ROMAN_PARENS"],
  "(A)": ["orderedList", "NUMBERED_UPPERALPHA_ALPHA_ROMAN_TWO_PARENS"],
  "I.": ["orderedList", "NUMBERED_UPPERROMAN_UPPERALPHA_DECIMAL"],
};

/** The list a typed prefix starts, or null. */
export function listForPrefix(prefix: string): { type: ListKind; style: string | null } | null {
  const hit = Object.hasOwn(PREFIXES, prefix) ? PREFIXES[prefix] : null;
  return hit ? { type: hit[0], style: hit[1] } : null;
}

/** The first level's label of each numbered preset: its first label, split
    around the counter. */
const LABELS: Record<string, [string, string, string]> = {
  NUMBERED_DECIMAL_ALPHA_ROMAN_PARENS: ["", "1", ")"],
  NUMBERED_DECIMAL_ALPHA_ROMAN_TWO_PARENS: ["(", "1", ")"],
  NUMBERED_DECIMAL_ALPHA_ROMAN_PERIOD_PARENS: ["", "1", ".)"],
  NUMBERED_ZERODECIMAL_ALPHA_ROMAN: ["", "01", "."],
  NUMBERED_ALPHA_ROMAN_DECIMAL: ["", "a", "."],
  NUMBERED_ALPHA_ROMAN_DECIMAL_PARENS: ["", "a", ")"],
  NUMBERED_ALPHA_ROMAN_DECIMAL_TWO_PARENS: ["(", "a", ")"],
  NUMBERED_UPPERALPHA_ALPHA_ROMAN: ["", "A", "."],
  NUMBERED_UPPERALPHA_ALPHA_ROMAN_PARENS: ["", "A", ")"],
  NUMBERED_UPPERALPHA_ALPHA_ROMAN_TWO_PARENS: ["(", "A", ")"],
  NUMBERED_UPPERROMAN_UPPERALPHA_DECIMAL: ["", "I", "."],
};

const ROMAN: [number, string][] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

/** Item `n`'s counter in the style of the first one: 1, 01, a, A, or I. */
function counter(first: string, n: number): string {
  if (first === "01") return String(n).padStart(2, "0");
  if (first === "I") {
    let out = "";
    let rest = n;
    for (const [value, letters] of ROMAN) {
      for (; rest >= value; rest -= value) out += letters;
    }
    return out;
  }
  if (first === "a" || first === "A") {
    let out = "";
    for (let rest = n; rest > 0; rest = Math.floor((rest - 1) / 26)) out = String.fromCharCode(97 + ((rest - 1) % 26)) + out;
    return first === "A" ? out.toUpperCase() : out;
  }
  return String(n);
}

/** The label item `n` of a numbered list's first level shows: "4." for 4. */
export function listLabel(style: string | null, n: number): string {
  const [before, first, after] = (style && LABELS[style]) || ["", "1", "."];
  return before + counter(first, n) + after;
}

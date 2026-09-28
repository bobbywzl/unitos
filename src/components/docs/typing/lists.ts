import type { Node as PMNode } from "@tiptap/pm/model";

// Google Docs' list detection (SPEC.md §29, typing): the 17 prefixes that
// start a list when a space follows them, each with the preset it starts
// (components/docs/toolbar/lists.ts), as the Google Docs API names it; null
// is the default. A typed label that goes on a numbered list ("4." after 3)
// continues it (typing/autocorrect.ts).

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

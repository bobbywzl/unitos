import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";

// Google Docs' list presets (SPEC.md §29): the glyphs a list draws level by
// level. A list keeps its preset in the `listStyle` attribute
// (data-list-style), named as the Google Docs API names presets; null is
// the default preset of its type — ● ○ ■ for a bulleted list, 1. a. i. for
// a numbered list, a struck-through line for a ticked checklist item. The
// preset lives on the outermost list: one list, one preset, as in Docs; a
// nested list draws its level of it. css/toolbar.css draws every preset,
// the palettes' and the ones only a typed prefix reaches (typing/lists.ts).

export type ListKind = "bulletList" | "orderedList" | "taskList";

type Counter = "decimal" | "decimal-leading-zero" | "lower-alpha" | "upper-alpha" | "lower-roman" | "upper-roman";

/** One level's glyph: a bullet character, or a counter with its text. */
type Glyph = { bullet: string } | { counter: Counter; before: string; after: string } | { nested: true };

export type ListPreset = {
  /** The listStyle value; null is the type's default preset. */
  style: string | null;
  kind: ListKind;
  /** Levels 1 to 9. */
  levels: Glyph[];
};

const b = (chars: string): Glyph[] => [...chars].map((bullet) => ({ bullet }));
const P = (counter: Counter): Glyph => ({ counter, before: "", after: "." });
const R = (counter: Counter): Glyph => ({ counter, before: "", after: ")" });
const RR = (counter: Counter): Glyph => ({ counter, before: "(", after: ")" });
const DEC = "decimal";
const LA = "lower-alpha";
const UA = "upper-alpha";
const LR = "lower-roman";
const UR = "upper-roman";

/** The bulleted list palette, row by row (3 × 2). */
export const BULLET_PRESETS: ListPreset[] = [
  { style: null, kind: "bulletList", levels: b("●○■●○■●○■") },
  { style: "BULLET_DIAMONDX_ARROW3D_SQUARE", kind: "bulletList", levels: b("❖➢■●◆➢■●◆") },
  { style: "BULLET_CHECKBOX", kind: "bulletList", levels: b("❏❏❏❏❏❏❏❏❏") },
  { style: "BULLET_ARROW_DIAMOND_DISC", kind: "bulletList", levels: b("➔◆●○◆●○◆●") },
  { style: "BULLET_STAR_CIRCLE_SQUARE", kind: "bulletList", levels: b("★○■●○■●○■") },
  { style: "BULLET_ARROW3D_CIRCLE_SQUARE", kind: "bulletList", levels: b("➢○■●○■●○■") },
];

/** The numbered list palette, row by row (3 × 2). */
export const NUMBER_PRESETS: ListPreset[] = [
  { style: null, kind: "orderedList", levels: [P(DEC), P(LA), P(LR), P(DEC), P(LA), P(LR), P(DEC), P(LA), P(LR)] },
  {
    style: "NUMBERED_DECIMAL_ALPHA_ROMAN_PARENS",
    kind: "orderedList",
    levels: [R(DEC), R(LA), R(LR), RR(DEC), RR(LA), RR(LR), P(DEC), P(LA), P(LR)],
  },
  { style: "NUMBERED_DECIMAL_NESTED", kind: "orderedList", levels: Array.from({ length: 9 }, () => ({ nested: true }) as const) },
  {
    style: "NUMBERED_UPPERALPHA_ALPHA_ROMAN",
    kind: "orderedList",
    levels: [P(UA), P(LA), P(LR), P(DEC), P(LA), P(LR), P(DEC), P(LA), P(LR)],
  },
  {
    style: "NUMBERED_UPPERROMAN_UPPERALPHA_DECIMAL",
    kind: "orderedList",
    levels: [P(UR), P(UA), P(DEC), R(LA), RR(DEC), RR(LA), RR(LR), RR(LA), RR(LR)],
  },
  {
    style: "NUMBERED_ZERODECIMAL_ALPHA_ROMAN",
    kind: "orderedList",
    levels: [P("decimal-leading-zero"), P(LA), P(LR), P(DEC), P(LA), P(LR), P(DEC), P(LA), P(LR)],
  },
];

/** The checklist palette (2 × 1). */
export const CHECKLIST_PRESETS: { style: string | null; label: "docs.checklistStrike" | "docs.checklistNoStrike" }[] = [
  { style: null, label: "docs.checklistStrike" },
  { style: "CHECKLIST_NO_STRIKETHROUGH", label: "docs.checklistNoStrike" },
];

function roman(n: number): string {
  const table: [number, string][] = [
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let out = "";
  let rest = Math.max(1, Math.min(39, n));
  for (const [value, letters] of table) {
    while (rest >= value) {
      out += letters;
      rest -= value;
    }
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
      return String.fromCharCode(96 + Math.max(1, Math.min(26, n)));
    case "upper-alpha":
      return String.fromCharCode(64 + Math.max(1, Math.min(26, n)));
    case "lower-roman":
      return roman(n);
    case "upper-roman":
      return roman(n).toUpperCase();
  }
}

/** The five rows a palette tile draws: levels 1, 2, 2, 3, 1, each with its
    glyph (1., a., b., i., 2.). */
export function tileRows(preset: ListPreset): { level: number; glyph: string }[] {
  const rows = [
    { level: 0, n: 1, path: [1] },
    { level: 1, n: 1, path: [1, 1] },
    { level: 1, n: 2, path: [1, 2] },
    { level: 2, n: 1, path: [1, 2, 1] },
    { level: 0, n: 2, path: [2] },
  ];
  return rows.map(({ level, n, path }) => {
    const g = preset.levels[level];
    if ("bullet" in g) return { level, glyph: g.bullet };
    if ("nested" in g) return { level, glyph: `${path.join(".")}.` };
    return { level, glyph: `${g.before}${counterText(g.counter, n)}${g.after}` };
  });
}

/** The outermost list of the kind around the selection's start, if any. */
function outermostList(state: EditorState, kind: ListKind): { node: PMNode; pos: number } | null {
  const $from = state.selection.$from;
  let found: { node: PMNode; pos: number } | null = null;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === kind) found = { node: $from.node(d), pos: $from.before(d) };
  }
  return found;
}

/** The preset of the list of the kind around the selection: null is the
    default, undefined is no such list. */
export function currentListStyle(state: EditorState, kind: ListKind): string | null | undefined {
  const list = outermostList(state, kind);
  if (!list) return undefined;
  const style = list.node.attrs.listStyle;
  return typeof style === "string" ? style : null;
}

/** Pick a preset: the list around the selection takes it (as a whole, as
    in Docs), a list of another type becomes this type, and paragraphs
    outside a list become one. */
export function applyListPreset(editor: Editor, kind: ListKind, style: string | null): void {
  const toggle = { bulletList: "toggleBulletList", orderedList: "toggleOrderedList", taskList: "toggleTaskList" } as const;
  if (!outermostList(editor.state, kind)) editor.chain().focus()[toggle[kind]]().run();
  const list = outermostList(editor.state, kind);
  if (!list) return;
  const type = list.node.type;
  const tr = editor.state.tr.setNodeMarkup(list.pos, type, { ...list.node.attrs, listStyle: style });
  // Lists nested inside take no preset of their own.
  list.node.descendants((child, offset) => {
    if (child.type === type && child.attrs.listStyle) {
      tr.setNodeMarkup(list.pos + 1 + offset, undefined, { ...child.attrs, listStyle: null });
    }
    return true;
  });
  editor.view.dispatch(tr);
  editor.commands.focus();
}

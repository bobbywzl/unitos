import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Command, EditorState } from "@tiptap/pm/state";
import { isList } from "@/components/docs/typing/lists";
import { formatParts, listLevelsOf, type ListCounter, type ListLevel } from "@/lib/docs/schema";

// Google Docs' lists (SPEC.md §29). Each of a list's nine nesting levels
// draws a bullet, or a counter in its glyph format: the text around the
// numbers, "%0." "(%1)" "%0.%1." (%k is level k's number), as the Google
// Docs API has it. A preset is nine levels, named as the API names it. The
// outermost list keeps its preset in `listStyle` (null is its kind's
// default), or, when its levels are no preset's (an import's "a)." or
// "[12]"), the levels themselves in `listLevels`; a nested list draws its
// level of the outermost list's (css/toolbar.css). Restart numbering and
// Continue previous numbering set a numbered list's `start`.

type ListKind = "bulletList" | "orderedList" | "taskList";

export type ListPreset = {
  /** The listStyle value; null is the type's default preset. */
  style: string | null;
  kind: ListKind;
  /** Levels 1 to 9. */
  levels: ListLevel[];
};

/** A level's glyph at level k. */
type LevelAt = (k: number) => ListLevel;

const bullets = (chars: string): ListLevel[] => [...chars].map((bullet) => ({ bullet }));
const numbered = (...levels: LevelAt[]): ListLevel[] => levels.map((at, k) => at(k));
const shaped =
  (shape: string) =>
  (counter: ListCounter): LevelAt =>
  (k) => ({ counter, format: shape.replace("x", `%${k}`) });
const P = shaped("x.");
const R = shaped("x)");
const RR = shaped("(x)");
const DR = shaped("x.)");
/** 1. 1.1. 1.1.1.: each level's number after the numbers above it. */
const NESTED: LevelAt = (k) => ({ counter: "decimal", format: `${Array.from({ length: k + 1 }, (_, j) => `%${j}`).join(".")}.` });
const DEC = "decimal";
const LA = "lower-alpha";
const UA = "upper-alpha";
const LR = "lower-roman";
const UR = "upper-roman";

/** The bulleted list palette, row by row (3 × 2). */
export const BULLET_PRESETS: ListPreset[] = [
  { style: null, kind: "bulletList", levels: bullets("●○■●○■●○■") },
  { style: "BULLET_DIAMONDX_ARROW3D_SQUARE", kind: "bulletList", levels: bullets("❖➢■●◆➢■●◆") },
  { style: "BULLET_CHECKBOX", kind: "bulletList", levels: bullets("❏❏❏❏❏❏❏❏❏") },
  { style: "BULLET_ARROW_DIAMOND_DISC", kind: "bulletList", levels: bullets("➔◆●○◆●○◆●") },
  { style: "BULLET_STAR_CIRCLE_SQUARE", kind: "bulletList", levels: bullets("★○■●○■●○■") },
  { style: "BULLET_ARROW3D_CIRCLE_SQUARE", kind: "bulletList", levels: bullets("➢○■●○■●○■") },
];

/** The numbered list palette, row by row (3 × 2). */
export const NUMBER_PRESETS: ListPreset[] = [
  { style: null, kind: "orderedList", levels: numbered(P(DEC), P(LA), P(LR), P(DEC), P(LA), P(LR), P(DEC), P(LA), P(LR)) },
  {
    style: "NUMBERED_DECIMAL_ALPHA_ROMAN_PARENS",
    kind: "orderedList",
    levels: numbered(R(DEC), R(LA), R(LR), RR(DEC), RR(LA), RR(LR), P(DEC), P(LA), P(LR)),
  },
  { style: "NUMBERED_DECIMAL_NESTED", kind: "orderedList", levels: numbered(...Array.from({ length: 9 }, () => NESTED)) },
  {
    style: "NUMBERED_UPPERALPHA_ALPHA_ROMAN",
    kind: "orderedList",
    levels: numbered(P(UA), P(LA), P(LR), P(DEC), P(LA), P(LR), P(DEC), P(LA), P(LR)),
  },
  {
    style: "NUMBERED_UPPERROMAN_UPPERALPHA_DECIMAL",
    kind: "orderedList",
    levels: numbered(P(UR), P(UA), P(DEC), R(LA), RR(DEC), RR(LA), RR(LR), RR(LA), RR(LR)),
  },
  {
    style: "NUMBERED_ZERODECIMAL_ALPHA_ROMAN",
    kind: "orderedList",
    levels: numbered(P("decimal-leading-zero"), P(LA), P(LR), P(DEC), P(LA), P(LR), P(DEC), P(LA), P(LR)),
  },
];

/** The presets a typed prefix gives (typing/lists.ts) that the palettes do
    not show. */
export const TYPED_PRESETS: ListPreset[] = [
  { style: "BULLET_DASH", kind: "bulletList", levels: bullets("---------") },
  { style: "BULLET_PLUS", kind: "bulletList", levels: bullets("+++++++++") },
  { style: "NUMBERED_DECIMAL_ALPHA_ROMAN_TWO_PARENS", kind: "orderedList", levels: numbered(RR(DEC), RR(LA), RR(LR), R(DEC), R(LA), R(LR), P(DEC), P(LA), P(LR)) },
  { style: "NUMBERED_DECIMAL_ALPHA_ROMAN_PERIOD_PARENS", kind: "orderedList", levels: numbered(DR(DEC), DR(LA), DR(LR), RR(DEC), RR(LA), RR(LR), P(DEC), P(LA), P(LR)) },
  { style: "NUMBERED_ALPHA_ROMAN_DECIMAL", kind: "orderedList", levels: numbered(P(LA), P(LR), P(DEC), P(LA), P(LR), P(DEC), P(LA), P(LR), P(DEC)) },
  { style: "NUMBERED_ALPHA_ROMAN_DECIMAL_PARENS", kind: "orderedList", levels: numbered(R(LA), R(LR), R(DEC), RR(LA), RR(LR), RR(DEC), P(LA), P(LR), P(DEC)) },
  { style: "NUMBERED_ALPHA_ROMAN_DECIMAL_TWO_PARENS", kind: "orderedList", levels: numbered(RR(LA), RR(LR), RR(DEC), R(LA), R(LR), R(DEC), P(LA), P(LR), P(DEC)) },
  { style: "NUMBERED_UPPERALPHA_ALPHA_ROMAN_PARENS", kind: "orderedList", levels: numbered(R(UA), R(LA), R(LR), RR(DEC), RR(LA), RR(LR), P(DEC), P(LA), P(LR)) },
  { style: "NUMBERED_UPPERALPHA_ALPHA_ROMAN_TWO_PARENS", kind: "orderedList", levels: numbered(RR(UA), RR(LA), RR(LR), R(DEC), R(LA), R(LR), P(DEC), P(LA), P(LR)) },
];

const PRESETS = [...BULLET_PRESETS, ...NUMBER_PRESETS, ...TYPED_PRESETS];

/** A bulleted or numbered list's preset by its listStyle; the default for
    none or an unknown one. */
export function listPreset(ordered: boolean, style: unknown): ListPreset {
  const presets = ordered ? NUMBER_PRESETS : BULLET_PRESETS;
  return PRESETS.find((p) => p.kind === presets[0].kind && p.style === (style ?? null)) ?? presets[0];
}

/** A list's nine levels: its own (listLevels), else its preset's
    (listStyle), else its kind's default. */
export function levelsOf(list: { type: string; attrs?: Record<string, unknown> | null }): ListLevel[] {
  return listLevelsOf(list.attrs?.listLevels) ?? listPreset(list.type === "orderedList", list.attrs?.listStyle).levels;
}

/** Two levels that draw alike. */
export function sameLevel(a: ListLevel, b: ListLevel): boolean {
  return "bullet" in a ? "bullet" in b && a.bullet === b.bullet : "counter" in b && a.counter === b.counter && a.format === b.format;
}

/** Two lists that draw alike: the same preset and the same own levels. */
export function sameFormat(a: PMNode, b: PMNode): boolean {
  return (a.attrs.listStyle ?? null) === (b.attrs.listStyle ?? null) && (a.attrs.listLevels ?? null) === (b.attrs.listLevels ?? null);
}

/** The checklist palette (2 × 1). */
export const CHECKLIST_PRESETS: { style: string | null; label: "docs.checklistStrike" | "docs.checklistNoStrike" }[] = [
  { style: null, label: "docs.checklistStrike" },
  { style: "CHECKLIST_NO_STRIKETHROUGH", label: "docs.checklistNoStrike" },
];

// ── Markers ────────────────────────────────────────────────────────────────

const ROMAN: [number, string][] = [
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

/** Number n as the counter style draws it: 28 → "28", "28", "ab", "AB",
    "xxviii", "XXVIII" (letters go on "y", "z", "aa"; numerals up to 3999). */
export function counterText(counter: ListCounter, n: number): string {
  if (counter === "decimal") return String(n);
  if (counter === "decimal-leading-zero") return n >= 0 && n < 10 ? `0${n}` : String(n);
  if (counter === "lower-alpha" || counter === "upper-alpha") {
    let out = "";
    for (let rest = n; rest > 0; rest = Math.floor((rest - 1) / 26)) out = String.fromCharCode(97 + ((rest - 1) % 26)) + out;
    if (!out) return String(n);
    return counter === "upper-alpha" ? out.toUpperCase() : out;
  }
  if (n < 1 || n > 3999) return String(n);
  let out = "";
  let rest = n;
  for (const [value, letters] of ROMAN) {
    for (; rest >= value; rest -= value) out += letters;
  }
  return counter === "upper-roman" ? out.toUpperCase() : out;
}

/** The marker a level draws for a line whose numbers, from the outermost
    level down, are `numbers` (its own last): each %k its number. */
export function levelMarker(level: ListLevel, numbers: number[]): string {
  if ("bullet" in level) return level.bullet;
  return level.format.replace(/%([0-8])/g, (_, k: string) => counterText(level.counter, numbers[Number(k)] ?? 1));
}

/** The level a line draws `depth` levels into the outermost list `outer`:
    the outer list's when it is of the line's kind (a number or a bullet),
    else the default's (a numbered list inside a bulleted one). */
export function lineLevel(outer: { type: string; attrs?: Record<string, unknown> | null } | null, depth: number, numbered: boolean): ListLevel {
  const k = Math.max(0, Math.min(depth, 8));
  const own = outer ? levelsOf(outer)[k] : undefined;
  if (own && "counter" in own === numbered) return own;
  return (numbered ? NUMBER_PRESETS : BULLET_PRESETS)[0].levels[k];
}

/** The marker the page draws before a numbered line: `outer` is the
    outermost list around it, `numbers` the line's number at each level from
    there down, its own last ([2, 3]: the third line of the list under the
    outer list's second line). */
export function listMarker(outer: { type: string; attrs?: Record<string, unknown> | null } | null, numbers: number[]): string {
  return levelMarker(lineLevel(outer, numbers.length - 1, true), numbers);
}

/** Words as a CSS string: a quote, a backslash, or a line end escaped. */
const cssString = (text: string) => `"${text.replace(/["\\\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`;

/** A list's levels as its inline style (css/toolbar.css): level n's bullet
    in --docs-bullet-n, its counter in --docs-number-n (list-style-type, for
    a browser that draws no ::marker content), and its marker in
    --docs-marker-n (::marker's content: its format's words around the
    level's counter, or around every level's for legal numbers). */
export function levelStyle(levels: ListLevel[]): string {
  return levels
    .map((level, k) => {
      const n = k + 1;
      if ("bullet" in level) return `--docs-bullet-${n}: ${cssString(`${level.bullet} `)}`;
      const parts = formatParts(level.format, k);
      if (!parts) return "";
      const count = parts.sep === null ? `counter(list-item, ${level.counter})` : `counters(list-item, ${cssString(parts.sep)}, ${level.counter})`;
      const marker = [parts.before ? cssString(parts.before) : "", count, cssString(`${parts.after} `)].filter(Boolean).join(" ");
      return `--docs-number-${n}: ${level.counter}; --docs-marker-${n}: ${marker}`;
    })
    .filter(Boolean)
    .join("; ");
}

/** A preset by its name, of any kind: the styles a list's HTML carries. */
export function presetNamed(style: unknown): ListPreset | null {
  return typeof style === "string" ? (PRESETS.find((p) => p.style === style) ?? null) : null;
}

/** The five rows a palette tile draws: levels 1, 2, 2, 3, 1, each with its
    glyph (1., a., b., i., 2.). */
export function tileRows(preset: ListPreset): { level: number; glyph: string }[] {
  const rows = [
    { level: 0, path: [1] },
    { level: 1, path: [1, 1] },
    { level: 1, path: [1, 2] },
    { level: 2, path: [1, 2, 1] },
    { level: 0, path: [2] },
  ];
  return rows.map(({ level, path }) => ({ level, glyph: levelMarker(preset.levels[level], path) }));
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
    default, undefined is no such list. A list with levels of its own gives
    its listLevels, which no preset's name matches. */
export function currentListStyle(state: EditorState, kind: ListKind): string | null | undefined {
  const list = outermostList(state, kind);
  if (!list) return undefined;
  const { listStyle, listLevels } = list.node.attrs;
  return typeof listLevels === "string" ? listLevels : typeof listStyle === "string" ? listStyle : null;
}

/** Pick a preset: the list around the selection takes it (as a whole, as
    in Docs, its own levels gone), a list of another type becomes this type,
    and paragraphs outside a list become one. */
export function applyListPreset(editor: Editor, kind: ListKind, style: string | null): void {
  const toggle = { bulletList: "toggleBulletList", orderedList: "toggleOrderedList", taskList: "toggleTaskList" } as const;
  if (!outermostList(editor.state, kind)) editor.chain().focus()[toggle[kind]]().run();
  const list = outermostList(editor.state, kind);
  if (!list) return;
  const type = list.node.type;
  const tr = editor.state.tr.setNodeMarkup(list.pos, type, { ...list.node.attrs, listStyle: style, listLevels: null });
  // Lists nested inside take no preset of their own.
  list.node.descendants((child, offset) => {
    if (child.type === type && (child.attrs.listStyle || child.attrs.listLevels)) {
      tr.setNodeMarkup(list.pos + 1 + offset, undefined, { ...child.attrs, listStyle: null, listLevels: null });
    }
    return true;
  });
  editor.view.dispatch(tr);
  editor.commands.focus();
}

/** The caret's line when the innermost list around it is numbered: the
    list, the line's index in it, and the place before the line. */
export function numberedLine(state: EditorState): { list: PMNode; pos: number; index: number; at: number } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (isList(node)) return node.type.name === "orderedList" ? { list: node, pos: $from.before(d), index: $from.index(d), at: $from.before(d + 1) } : null;
  }
  return null;
}

const startOf = (list: PMNode) => Number(list.attrs.start) || 1;

/** Restart numbering: the list splits before the caret's line, and the line
    starts a list numbered from `n`. */
export const restartNumbering =
  (n: number): Command =>
  (state, dispatch) => {
    const line = numberedLine(state);
    if (!line || (line.index === 0 && startOf(line.list) === n)) return false;
    if (dispatch) {
      const attrs = { ...line.list.attrs, start: n };
      const tr = state.tr;
      if (line.index === 0) tr.setNodeMarkup(line.pos, undefined, attrs);
      else tr.split(line.at, 1, [{ type: line.list.type, attrs }]);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };

/** Continue previous numbering: the caret's numbered list numbers on from
    the list before it of the same kind and format, and joins it when the
    two touch. False when there is none, or the numbering already goes on. */
export const continueNumbering: Command = (state, dispatch) => {
  const line = numberedLine(state);
  if (!line) return false;
  const $list = state.doc.resolve(line.pos);
  for (let i = $list.index() - 1; i >= 0; i--) {
    const prev = $list.parent.child(i);
    if (prev.type !== line.list.type || !sameFormat(prev, line.list)) continue;
    const next = startOf(prev) + prev.childCount;
    if (startOf(line.list) === next) return false;
    if (dispatch) {
      const tr = state.tr;
      if (i === $list.index() - 1) tr.join(line.pos);
      else tr.setNodeMarkup(line.pos, undefined, { ...line.list.attrs, start: next });
      dispatch(tr.scrollIntoView());
    }
    return true;
  }
  return false;
};

import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Command, EditorState } from "@tiptap/pm/state";
import { isList } from "@/components/docs/typing/lists";
import { formatParts, listLevelsOf, type ListCounter, type ListIndent, type ListLevel, type RichNode } from "@/lib/docs/schema";

// Google Docs' lists (SPEC.md §29). Each of a list's nine nesting levels
// draws a bullet, or a counter in its glyph format: the text around the
// numbers, "%0." "(%1)" "%0.%1." (%k is level k's number), as the Google
// Docs API has it. A preset is nine levels, named as the API names it. The
// outermost list keeps its preset in `listStyle` (null is its kind's
// default), or, when its levels are no preset's (an import's "a)." or
// "[12]"), the levels themselves in `listLevels`; a nested list draws its
// level of the outermost list's (listSheet). Restart numbering and
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
const TYPED_PRESETS: ListPreset[] = [
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
function listPreset(ordered: boolean, style: unknown): ListPreset {
  const presets = ordered ? NUMBER_PRESETS : BULLET_PRESETS;
  return PRESETS.find((p) => p.kind === presets[0].kind && p.style === (style ?? null)) ?? presets[0];
}

/** A list's nine levels: its own (listLevels), else its preset's
    (listStyle), else its kind's default. */
function levelsOf(list: { type: string; attrs?: Record<string, unknown> | null }): ListLevel[] {
  return listLevelsOf(list.attrs?.listLevels) ?? listPreset(list.type === "orderedList", list.attrs?.listStyle).levels;
}

/** Two levels that draw alike. */
export function sameLevel(a: ListLevel, b: ListLevel): boolean {
  return "bullet" in a ? "bullet" in b && a.bullet === b.bullet : "counter" in b && a.counter === b.counter && a.format === b.format;
}

/** The format of an outermost list whose lines draw `seen` (by depth; a
    gap is any level): none when its type's default draws them, else the
    first preset that does, else levels of its own, the default's where
    `seen` has none. */
export function listFormat(type: string, seen: (ListLevel | undefined)[]): { listStyle: string } | { listLevels: string } | null {
  const draws = (attrs: Record<string, unknown>) =>
    seen.every((level, k) => !level || sameLevel(lineLevel({ type, attrs }, k, "counter" in level), level));
  if (draws({})) return null;
  const preset = PRESETS.find((p) => p.kind === type && p.style !== null && draws({ listStyle: p.style }));
  if (preset?.style) return { listStyle: preset.style };
  const base = (type === "orderedList" ? NUMBER_PRESETS : BULLET_PRESETS)[0].levels;
  return { listLevels: JSON.stringify(base.map((level, k) => seen[k] ?? level)) };
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
function counterText(counter: ListCounter, n: number): string {
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

/** A list's levels as its inline style (listSheet): level n's bullet
    in --docs-bullet-n (with an em space after it; none for an empty bullet:
    no marker), its counter in --docs-number-n (list-style-type, for a
    browser that draws no ::marker content), and its marker in
    --docs-marker-n (::marker's content: its format's words around the
    level's counter, or around every level's for legal numbers, and an em
    space). --docs-glyph-n and --docs-count-n hold the bullet and the marker
    with no space, for a list set at its page's depths (indentStyle). */
export function levelStyle(levels: ListLevel[]): string {
  return levels
    .map((level, k) => {
      const n = k + 1;
      if ("bullet" in level) {
        return level.bullet
          ? `--docs-bullet-${n}: ${cssString(`${level.bullet}\u2003`)}; --docs-glyph-${n}: ${cssString(level.bullet)}`
          : `--docs-bullet-${n}: none; --docs-glyph-${n}: none`;
      }
      const parts = formatParts(level.format, k);
      if (!parts) return "";
      const count = parts.sep === null ? `counter(list-item, ${level.counter})` : `counters(list-item, ${cssString(parts.sep)}, ${level.counter})`;
      const words = (after: string) => [parts.before ? cssString(parts.before) : "", count, after ? cssString(after) : ""].filter(Boolean).join(" ");
      return `--docs-number-${n}: ${level.counter}; --docs-marker-${n}: ${words(`${parts.after}\u2003`)}; --docs-count-${n}: ${words(parts.after)}`;
    })
    .filter(Boolean)
    .join("; ");
}

/** Half an inch: a list depth's step where its page sets none. */
const DEPTH_PT = 36;
/** The room a checklist's box takes before its words: the box (docs.css)
    and a quarter em. */
const TASK_BOX = "14px + 0.25em";

/** A list set at its page's depths (an import's listIndents) as its inline
    style (listSheet): each depth's words at its left (--docs-indent-n), its
    first line at left + first (--docs-first-n), and its marker in a box from
    there to the words (--docs-hang-n): the page's hang where the marker
    hangs before the words, else the words' place after the marker as the
    page sets it, else the next half-inch stop, as Docs and Word set a tab
    after a marker. A marker wider than its box moves the first line's words
    on; none stands left of its line's start, so none stands in the margin.
    The depths past the list's own go on a half inch a depth, set as the
    last one. */
export function indentStyle(indents: ListIndent[]): string {
  const last = indents.length - 1;
  return Array.from({ length: 9 }, (_, k) => {
    const [own, first, after] = indents[Math.min(k, last)];
    const left = own + DEPTH_PT * Math.max(0, k - last);
    const hang = first < 0 ? -first : (after ?? DEPTH_PT - ((left + first) % DEPTH_PT));
    return `--docs-indent-${k + 1}: ${left}pt; --docs-first-${k + 1}: ${first}pt; --docs-hang-${k + 1}: ${hang}pt`;
  }).join("; ");
}

/** The list rules under `root` (".docs-prose" in the page editor, "body"
    in the web page download): Google Docs' defaults (● ○ ■, 1. a. i.), each
    depth's level, a bullet as list-style-type, and a number as ::marker's
    content, with its counter as list-style-type where a browser draws no
    ::marker content. A list set at its page's depths (data-list-indents,
    indentStyle) draws no ::marker: each line's marker is a box at its first
    line's start, before its words, and a depth that draws no marker has
    none. So does a checklist's box there, its wraps back at the depth's
    left, as the page sets them; a checklist of the page editor's own keeps
    its box beside its words (docs.css). A line a suggestion adds or
    removes whole sits in the suggestion's wrapper (css/suggest.css). */
export function listSheet(root: string): string {
  const li = (n: number) => `${root} ${Array.from({ length: n }, () => "li").join(" ")}`;
  // A list set at its page's depths, and the lists inside it.
  const own = (tag: string) => `:is(${tag}[data-list-indents], [data-list-indents] ${tag})`;
  const first = (list: string) => [`${root} ${list} > li > p:first-child`, `${root} ${list} > [data-suggestion-block] > li > p:first-child`];
  const tasks = own('ul[data-type="taskList"]');
  const task = (tail: string) => [`${root} ${tasks} > li${tail}`, `${root} ${tasks} > [data-suggestion-block] > li${tail}`].join(", ");
  return [
    `${root} { ${levelStyle(BULLET_PRESETS[0].levels)}; ${levelStyle(NUMBER_PRESETS[0].levels)}; }`,
    ...Array.from(
      { length: 9 },
      (_, k) =>
        `${li(k + 1)} { --docs-level-bullet: var(--docs-bullet-${k + 1}); --docs-level-number: var(--docs-number-${k + 1}); --docs-level-marker: var(--docs-marker-${k + 1}); --docs-level-first: var(--docs-first-${k + 1}, 0pt); --docs-level-hang: var(--docs-hang-${k + 1}, 0pt); --docs-level-glyph: var(--docs-glyph-${k + 1}); --docs-level-count: var(--docs-count-${k + 1}); }`,
    ),
    `${root} ul:not([data-type="taskList"]) > li { list-style-type: var(--docs-level-bullet); }`,
    `${root} ol > li { list-style-type: var(--docs-level-number); }`,
    `${root} :is(ol > li, ol > [data-suggestion-block] > li)::marker { content: var(--docs-level-marker); }`,
    `${first(':is(ul, ol):not([data-type="taskList"])').join(", ")} { text-indent: var(--docs-level-first); }`,
    `${root} :is(ul, ol)[data-list-indents] li { --docs-level-bullet: none; --docs-level-number: none; --docs-level-marker: none; }`,
    `${first(`${own("ul")}:not([data-type="taskList"])`).map((p) => `${p}::before`).join(", ")} { content: var(--docs-level-glyph); }`,
    `${first(own("ol")).map((p) => `${p}::before`).join(", ")} { content: var(--docs-level-count); }`,
    `${[...first(`${own("ul")}:not([data-type="taskList"])`), ...first(own("ol"))].map((p) => `${p}::before`).join(", ")} { display: inline-block; box-sizing: border-box; min-width: var(--docs-level-hang); padding-right: 0.25em; text-indent: 0; }`,
    // A checklist at its page's depths: the box at the first line's start
    // (on the words' baseline), the words after it, never closer than the
    // box's width, and the wraps at the depth's left.
    `${task("")} { display: block; position: relative; }`,
    `${task(" > label")} { position: absolute; top: 0; left: var(--docs-level-first); line-height: calc(var(--docs-ls, 1.15) * 1.15); }`,
    `${task(" > div > p:first-child")} { text-indent: calc(var(--docs-level-first) + max(var(--docs-level-hang), ${TASK_BOX})); }`,
    // Each depth's words: where the outermost list's page sets them
    // (listIndents), else a half inch a depth. A checklist of the page
    // editor's own keeps its own.
    ...Array.from(
      { length: 9 },
      (_, k) =>
        `${root} ${"li ".repeat(k)}:is(:is(ul, ol):not([data-type="taskList"]), ${tasks}) { padding-left: calc(var(--docs-indent-${k + 1}, ${DEPTH_PT * (k + 1)}pt) - var(--docs-indent-${k}, ${DEPTH_PT * k}pt)); }`,
    ),
  ].join("\n");
}

const LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"]);

/** The rich text with each list line's marker as words before its words,
    as the page draws it ("(a) ", "☑ "): the plain text download's lines.
    `outer` is the outermost list, `above` the numbers of the lines above. */
export function markersAsWords(node: RichNode, outer: RichNode | null = null, above: number[] = []): RichNode {
  if (!LIST_TYPES.has(node.type)) return node.content ? { ...node, content: node.content.map((c) => markersAsWords(c)) } : node;
  const top = outer ?? node;
  const start = Number(node.attrs?.start) || 1;
  const items = (node.content ?? []).map((item, i) => {
    const numbers = [...above, start + i];
    const marker =
      node.type === "taskList" ? (item.attrs?.checked === true ? "☑" : "☐") : levelMarker(lineLevel(top, numbers.length - 1, node.type === "orderedList"), numbers);
    const content = (item.content ?? []).map((child, k) => {
      if (LIST_TYPES.has(child.type)) return markersAsWords(child, top, numbers);
      const words = markersAsWords(child);
      return k === 0 && marker ? { ...words, content: [{ type: "text", text: `${marker} ` }, ...(words.content ?? [])] } : words;
    });
    return { ...item, content };
  });
  return { ...node, content: items };
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

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as listDrawing from "@/components/docs/toolbar/lists";
import { readStyles, sizeInPt } from "@/components/docs/toolbar/styles";
import { fontStack } from "@/components/docs/fonts";
import katex from "katex";
import { KATEX_MACROS } from "@/lib/katex";
import type { RichNode } from "@/lib/docs/schema";
import { regionBounds } from "@/lib/video/types";
import { shapeOf, type Doc } from "./adapt";
import { formulaScale, type PdfText } from "./free";
import { ROOT } from "./load";
import { splitTag } from "./math";
import { wordsOf } from "./text";
import { columnEdge } from "./layout";
import type { InkBand, Rect } from "./paint";
import type { Flat, MathItem } from "./metrics";

// What the page editor draws around an import's words, read from its own
// stylesheets (components/docs, KaTeX's) and the import's attributes, set
// against the PDF's page (pdftotext's lines): the space above and below a
// display equation, a table row's height, a list marker's place. The page
// sets each; no reference records them.

// ── The stylesheets ─────────────────────────────────────────────────────────

type Rule = { selectors: string[]; declarations: Map<string, string> };
let rulesMemo: { own: Rule[]; katex: Rule[] } | null = null;

/** A selector list's selectors: its commas outside parentheses and brackets
    (`:is(td, th)` is one selector's). */
function selectorsOf(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "(" || list[i] === "[") depth++;
    else if (list[i] === ")" || list[i] === "]") depth--;
    else if (list[i] === "," && depth === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(list.slice(start).trim());
  return out.filter(Boolean);
}

function rulesOf(css: string): Rule[] {
  const out: Rule[] = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = new Map<string, string>();
    for (const d of m[2].split(";")) {
      const at = d.indexOf(":");
      if (at > 0) declarations.set(d.slice(0, at).trim().toLowerCase(), d.slice(at + 1).replace(/!important/, "").trim());
    }
    out.push({ selectors: selectorsOf(m[1]), declarations });
  }
  return out;
}

/** A selector's specificity as one number: ids, then classes, attributes,
    and pseudo-classes, then types and pseudo-elements. `:is()`, `:not()`,
    and `:has()` count their most specific argument, `:where()` none. */
function specificity(selector: string): number {
  let [a, b, c] = [0, 0, 0];
  const closing = (at: number) => {
    let depth = 0;
    for (let i = at; i < selector.length; i++) {
      if (selector[i] === "(") depth++;
      else if (selector[i] === ")" && --depth === 0) return i;
    }
    return selector.length;
  };
  const name = (at: number) => /^[\w-]*/.exec(selector.slice(at))?.[0] ?? "";
  for (let i = 0; i < selector.length; ) {
    const ch = selector[i];
    if (ch === "#" || ch === ".") {
      if (ch === "#") a++;
      else b++;
      i += 1 + name(i + 1).length;
    } else if (ch === "[") {
      b++;
      const end = selector.indexOf("]", i);
      i = end < 0 ? selector.length : end + 1;
    } else if (ch === ":") {
      const element = selector[i + 1] === ":";
      const pseudo = name(i + (element ? 2 : 1));
      i += (element ? 2 : 1) + pseudo.length;
      const args = selector[i] === "(" ? selector.slice(i + 1, closing(i)) : null;
      if (args !== null) i = closing(i) + 1;
      if (element) c++;
      else if (args !== null && ["is", "not", "has"].includes(pseudo)) {
        const inner = Math.max(0, ...selectorsOf(args).map(specificity));
        a += Math.floor(inner / 10000);
        b += Math.floor(inner / 100) % 100;
        c += inner % 100;
      } else if (pseudo !== "where") b++;
    } else if (/[a-zA-Z]/.test(ch)) {
      c++;
      i += name(i).length;
    } else i++;
  }
  return a * 10000 + b * 100 + c;
}

/** The look checks judge a PDF's import: the page editor's shell carries
    data-import="pdf" (docs-editor.tsx). A selector that names another kind
    of import alone draws nothing on it. */
function applies(selector: string): boolean {
  const kinds = [...selector.matchAll(/\[data-import="([^"]*)"\]/g)].map((m) => m[1]);
  return kinds.length === 0 || kinds.includes("pdf");
}

/** A value with its custom properties read: the element's own (`vars`),
    else the fallback ("var(--docs-cell-padding, 0 5pt)" is "0 5pt"). */
function resolved(value: string, vars: Record<string, string>): string {
  let out = value;
  for (let m = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/.exec(out); m; m = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/.exec(out)) {
    out = out.slice(0, m.index) + (vars[m[1]] ?? m[2]?.trim() ?? "") + out.slice(m.index + m[0].length);
  }
  return out.trim();
}

/** The page editor's rules (every stylesheet under components/docs) and KaTeX's. */
function stylesheets(): { own: Rule[]; katex: Rule[] } {
  if (rulesMemo) return rulesMemo;
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith(".css") ? [join(dir, f)] : []));
  rulesMemo = {
    own: files(join(ROOT, "src", "components", "docs")).flatMap((f) => rulesOf(readFileSync(f, "utf8"))),
    katex: rulesOf(readFileSync(join(ROOT, "node_modules", "katex", "dist", "katex.min.css"), "utf8")),
  };
  return rulesMemo;
}

/** A length in points: "6pt", "4px", "1em" (at `em` points), "0". */
function points(value: string | undefined, em: number): number | null {
  const m = /^(-?\d*\.?\d+)(pt|px|em|rem)?$/.exec((value ?? "").trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "px" ? n * 0.75 : m[2] === "em" || m[2] === "rem" ? n * em : m[2] === "pt" || n === 0 ? n : null;
}

/** A box's space on one side as the browser's cascade sets it: `margin` or
    `padding`, the shorthand ("6pt 0", "4px") or the side's own property,
    from the most specific rule that sets it, the last in file order among
    rules as specific (an import's rules, `[data-import="pdf"]`, win over the
    page editor's own though an earlier file holds them). */
function side(rules: Rule[], matches: (selector: string) => boolean, property: "margin" | "padding", which: "top" | "right" | "bottom" | "left", em: number, vars: Record<string, string> = {}): number | null {
  const cascade = rules
    .map((rule, order) => ({ rule, order, weight: Math.max(-1, ...rule.selectors.filter((s) => matches(s) && applies(s)).map(specificity)) }))
    .filter((r) => r.weight >= 0)
    .sort((x, y) => x.weight - y.weight || x.order - y.order);
  let value: number | null = null;
  for (const { rule } of cascade) {
    for (const [key, raw] of rule.declarations) {
      const text = resolved(raw, vars);
      if (key === `${property}-${which}`) value = points(text, em) ?? value;
      else if (key === property) {
        // The shorthand's values: top, right, bottom, left, the missing ones taken from their opposite side.
        const parts = text.split(/\s+/);
        const at = { top: 0, right: parts.length >= 2 ? 1 : 0, bottom: parts.length >= 3 ? 2 : 0, left: parts.length >= 4 ? 3 : parts.length >= 2 ? 1 : 0 }[which];
        value = points(parts[at], em) ?? value;
      }
    }
  }
  return value;
}

// ── A display's space ───────────────────────────────────────────────────────

export type DisplayGaps = { edges: number; right: number; score: number | null; misses: string[] };

/** The space the page editor draws above and below a display's formula
    (text of `em` points) past its neighbors' own: the math block's margin
    and padding, and KaTeX's display margin inside it (collapsed into the
    block's margin where the block has no padding). An import's display
    carries its space after as its own padding under it (`after`, points:
    insert/math.ts), which wins over the stylesheet's. */
export function displaySpace(em: number, after?: number): { top: number; bottom: number } {
  const { own, katex } = stylesheets();
  const block = (s: string) => /\.docs-math-block$/.test(s);
  const display = (s: string) => /\.katex-display$/.test(s);
  const drawn = (which: "top" | "bottom") => {
    const margin = side(own, block, "margin", which, em) ?? 0;
    const pad = which === "bottom" && after !== undefined && after > 0 ? after : (side(own, block, "padding", which, em) ?? 0);
    const inner = side(own, display, "margin", which, em) ?? side(katex, (s) => s === ".katex-display", "margin", which, em) ?? 0;
    return pad > 0 ? margin + pad + inner : Math.max(margin, inner);
  };
  return { top: drawn("top"), bottom: drawn("bottom") };
}

/** The words' ascent less their descent, in ems, by the face the page
    editor draws them in (hhea): it sets where a line's baseline stands in
    its line box, half of it over the box's middle. */
const FACE_RISE: [RegExp, number][] = [
  [/^katex_main$/i, 0.631],
  [/^(?:latin modern roman|cmu serif)$/i, 0.837],
  [/^(?:arial|arimo|liberation sans|helvetica)$/i, 0.693],
  [/^(?:times new roman|tinos|liberation serif|times)$/i, 0.675],
  [/^(?:calibri|carlito)$/i, 0.5],
  [/^(?:cambria|caladea|georgia|gelasio)$/i, 0.7],
];

/** The rise of the first face of a font stack this table knows (a name no
    computer has, "Computer Modern", passes to its fallbacks); an average
    face's where it knows none. */
function faceRise(family: string): number {
  for (const name of fontStack(family).split(",").map((f) => f.trim().replace(/^['"]|['"]$/g, ""))) {
    const hit = FACE_RISE.find(([re]) => re.test(name));
    if (hit) return hit[1];
  }
  return 0.69;
}

const strutMemo = new Map<string, { height: number; depth: number } | null>();

/** A display formula's height and depth over its baseline in ems, as KaTeX
    draws it (its struts); null when KaTeX cannot read it. */
export function formulaBox(latex: string): { height: number; depth: number } | null {
  if (strutMemo.has(latex)) return strutMemo.get(latex) ?? null;
  let out: { height: number; depth: number } | null = null;
  try {
    const html = katex.renderToString(latex, { displayMode: true, output: "html", throwOnError: true, strict: "ignore", macros: { ...KATEX_MACROS } });
    let height = 0;
    let depth = 0;
    for (const m of html.matchAll(/class="(?:katex-)?strut" style="height:([\d.]+)em;(?:vertical-align:(-?[\d.]+)em;)?/g)) {
      const d = -Number(m[2] ?? 0);
      height = Math.max(height, Number(m[1]) - d);
      depth = Math.max(depth, d);
    }
    out = { height, depth };
  } catch {
    out = null;
  }
  strutMemo.set(latex, out);
  return out;
}

/** The line height the page editor gives a display's formula (KaTeX's
    `.katex`, 1.2, unless the page editor's own sheet sets it for a
    display's formula). */
function formulaLineHeight(): number {
  const { own, katex: sheet } = stylesheets();
  const read = (rules: Rule[], test: (s: string) => boolean) => {
    let value: number | null = null;
    for (const rule of rules) {
      if (!rule.selectors.some((sel) => test(sel) && applies(sel))) continue;
      const v = rule.declarations.get("line-height");
      if (v !== undefined) value = v === "normal" ? 1.2 : /^[\d.]+$/.test(v) ? Number(v) : (points(v, 1) ?? value);
    }
    return value;
  };
  return read(own, (sel) => /(?:docs-math-block|katex-display)\b.*\.katex$/.test(sel)) ?? read(sheet, (sel) => sel === ".katex") ?? 1.2;
}

/** A display's space above and below, from the ink: the page's, from the
    baseline of the line over the display to the display's first row of ink,
    and from its last row of ink to the baseline of the line under it
    (poppler's drawing in the display's column: paint.ts inkBands), against
    the page editor's, from the stylesheets and the import: the line's
    baseline in its line box (its face's rise, faceRise), the space after
    the paragraph over it and the math block's margin and padding (and
    KaTeX's display margin), and the formula's ink in its line box (KaTeX's
    struts in a line of `.katex`'s height: formulaBox). Right within 2 pt or
    a quarter. A display whose neighbor is no paragraph, or whose page
    leaves more than 36 pt, is not judged; nor is the space over one with
    the running head over it. `bandsOf`: the page's ink in a
    box (paint.ts inkBands). */
export function displayGaps(rich: RichNode, parse: Doc, pdf: PdfText, bandsOf: (page: number, box: Rect) => InkBand[]): DisplayGaps {
  const placed = parse.blocks.filter((b) => b.kind === "equation" && b.at);
  let next = 0;
  let edges = 0;
  let right = 0;
  const misses: string[] = [];
  const nodes = rich.content ?? [];
  nodes.forEach((node, i) => {
    if (node.type !== "blockMath") return;
    const latex = splitTag(String(node.attrs?.latex ?? "")).latex;
    const k = placed.findIndex((b, j) => j >= next && b.kind === "equation" && b.latex === latex);
    if (k < 0) return;
    next = k + 1;
    const at = placed[k].at;
    const size = at ? pdf.sizes.get(at.page) : undefined;
    const drawn = displayDrawn(rich, i);
    if (!at || !size || !drawn) return;
    const r = regionBounds(at.region);
    const [x1, x2, y1, y2] = [(r.x1 / 100) * size.width, (r.x2 / 100) * size.width, (r.y1 / 100) * size.height, (r.y2 / 100) * size.height];
    // The display's column: the region and the lines over and under it that share its width.
    const column = pdf.lines.filter((l) => l.page === at.page && Math.min(l.right, x2) > Math.max(l.left, x1) && l.bottom > y1 - 60 && l.top < y2 + 60);
    const left = Math.max(0, Math.min(x1, ...column.map((l) => l.left)) - 2);
    const width = Math.min(size.width, Math.max(x2, ...column.map((l) => l.right)) + 2);
    const [top, bottom] = [Math.max(0, y1 - 45), Math.min(size.height, y2 + 45)];
    const bands = bandsOf(at.page, { x1: left, x2: width, y1: top, y2: bottom });
    let own = bands.filter((b) => b.bottom > y1 && b.top < y2);
    if (own.length === 0) return;
    let [higher, lower] = [bands, bands];
    // Ink that runs on past the display's region joins it to a neighbor: the
    // line over it where the display stands beside that line's foot (a
    // quantum mechanics book's "with normalization" and the display under
    // it read as one band, and the space over the display as 28 pt where it
    // is 4), or a frame's side down to the frame's rule (a listing's output:
    // chemformula p. 5 read 14 pt under the display where the line stands
    // 25 pt under it). The display's ink is then read in its own width, and
    // each neighbor in its own: the text line next over and under that ink.
    if (own[0].top < y1 - 3 || own[own.length - 1].bottom > y2 + 3) {
      own = bandsOf(at.page, { x1: Math.max(0, x1 - 1), x2: Math.min(size.width, x2 + 1), y1: top, y2: bottom }).filter((b) => b.bottom > y1 && b.top < y2);
      if (own.length === 0) return;
      const [a, b] = [own[0].top, own[own.length - 1].bottom];
      const near = pdf.lines.filter((l) => l.page === at.page && l.right > left && l.left < width && !(l.right > x1 && l.left < x2 && l.bottom > y1 && l.top < y2));
      const up = near.filter((l) => (l.top + l.bottom) / 2 < a && l.bottom > top).sort((m, n) => n.bottom - m.bottom)[0];
      const down = near.filter((l) => (l.top + l.bottom) / 2 > b && l.top < bottom).sort((m, n) => m.top - n.top)[0];
      const inLine = (l: (typeof near)[number], from: number, to: number) => bandsOf(at.page, { x1: l.left - 0.5, x2: l.right + 0.5, y1: Math.max(from, l.top - 1), y2: Math.min(to, l.bottom + 1) });
      higher = up ? inLine(up, top, a - 0.5) : [];
      lower = down ? inLine(down, b + 0.5, bottom) : [];
    }
    const [inkTop, inkBottom] = [own[0].top, own[own.length - 1].bottom];
    // A band under 1.5 pt tall, or under a point of ink across, is a rule or
    // a frame's side, no line.
    const line = (b: InkBand) => b.bottom - b.top >= 1.5 && (b.ink ?? Infinity) >= 1;
    const above = higher.filter((b) => b.bottom <= inkTop - 0.5 && line(b)).at(-1);
    const below = lower.find((b) => b.top >= inkBottom + 0.5 && line(b));
    const judge = (page: number | null, drawnPt: number | null, what: string) => {
      if (page === null || drawnPt === null || page > 36) return;
      edges++;
      if (Math.abs(drawnPt - page) <= Math.max(2, 0.25 * page)) right++;
      else misses.push(`p${at.page}: ${what} ${Math.round(drawnPt)} pt, the page's ${Math.round(page)} pt`);
    };
    // A display that opens its column has the running head over it: the
    // space over it is the page's margin, not a display's.
    const over = column.filter((l) => l.bottom <= y1 + 1).sort((a, b) => b.bottom - a.bottom)[0];
    const opens = over !== undefined && pdf.furniture.includes(over);
    judge(above && !opens ? inkTop - above.baseline : null, drawn.above, "above");
    judge(below ? below.baseline - inkBottom : null, drawn.below, "below");
  });
  return { edges, right, score: edges > 0 ? right / edges : null, misses };
}

/** The page editor's space over and under the display at `index` of the
    import's nodes, from the baseline of the paragraph's line over it to
    the formula's first ink, and from its last ink to the baseline of the
    paragraph's line under it (null where no paragraph neighbors it, or
    KaTeX cannot read the formula). */
export function displayDrawn(rich: RichNode, index: number): { above: number | null; below: number | null } | null {
  const styles = readStyles({ attrs: rich.attrs ?? {} });
  const nodes = rich.content ?? [];
  const node = nodes[index];
  const box = node?.type === "blockMath" ? formulaBox(splitTag(String(node.attrs?.latex ?? "")).latex) : null;
  if (!box) return null;
  const spacing = (n: RichNode, key: "spaceAfter" | "spaceBefore") => (typeof n.attrs?.[key] === "number" ? (n.attrs[key] as number) : styles[n.attrs?.docStyle === "title" ? "title" : "normal"][key]);
  // A paragraph's line: its words' size and face, its line's height (the stylesheet's factor on its spacing).
  const { own } = stylesheets();
  let factor = 1.15;
  for (const rule of own) {
    if (!rule.selectors.some((sel) => /\.docs-prose p$/.test(sel))) continue;
    const m = /calc\(\s*var\(--docs-ls\s*,\s*[\d.]+\)\s*\*\s*([\d.]+)\s*\)/.exec(rule.declarations.get("line-height") ?? "");
    if (m) factor = Number(m[1]);
  }
  const lineOf = (n: RichNode) => {
    const run = (n.content ?? []).find((c) => c.type === "text");
    const look = run?.marks?.find((m) => m.type === "textStyle")?.attrs;
    const size = sizeInPt(look?.fontSize) ?? styles.normal.size;
    const lineSpacing = typeof n.attrs?.lineSpacing === "number" ? n.attrs.lineSpacing : styles.normal.lineSpacing;
    const family = typeof look?.fontFamily === "string" ? look.fontFamily : (styles.normal.font ?? "Arial");
    return { line: size * lineSpacing * factor, rise: faceRise(family) * size };
  };
  const drawn = displaySpace(styles.normal.size, typeof node.attrs?.spaceAfter === "number" ? node.attrs.spaceAfter : undefined);
  // The formula in its line box: KaTeX's struts in a line of `.katex`'s height, KaTeX_Main's rise (0.631 em).
  const em = styles.normal.size * formulaScale();
  const lineHeight = formulaLineHeight();
  const inkOver = (Math.max(box.height, lineHeight / 2 + 0.631 / 2) - box.height) * em;
  const inkUnder = (Math.max(box.depth, lineHeight / 2 - 0.631 / 2) - box.depth) * em;
  const [before, after] = [nodes[index - 1], nodes[index + 1]];
  const above = before?.type === "paragraph" ? (() => {
    const w = lineOf(before);
    return w.line / 2 - w.rise / 2 + spacing(before, "spaceAfter") + drawn.top + inkOver;
  })() : null;
  const below = after?.type === "paragraph" ? (() => {
    const w = lineOf(after);
    return inkUnder + drawn.bottom + spacing(after, "spaceBefore") + w.line / 2 + w.rise / 2;
  })() : null;
  return { above, below };
}

// ── A table row's height ────────────────────────────────────────────────────

/** TeX that stands taller than its line: a fraction, a binomial, a root, a big operator, an array. */
const STACKED_TEX_RE = /\\(?:[dt]?frac|[dt]?binom|sqrt|sum|prod|coprod|int|oint|iint|bigcup|bigcap|bigoplus|bigotimes|begin|overset|underset|stackrel|substack|over)\b/;

export type RowHeights = { tables: number; right: number; score: number | null; misses: string[] };

/** The height the page editor draws a table row of one line in: the cell
    paragraph's line height (its line spacing times the stylesheet's
    factor, at `size` points) with the cell's padding above and below and
    its rule. An import's table may carry its cells' padding (`padding`,
    "top right bottom left" in points: insert/table.ts sets it as
    --docs-cell-padding). */
export function rowHeight(size: number, lineSpacing: number, padding?: string): number {
  const { own } = stylesheets();
  const cell = (s: string) => /\.docs-prose (?:td|th|:is\(td, ?th\))$/.test(s);
  const vars: Record<string, string> = padding ? { "--docs-cell-padding": padding.trim().split(/\s+/).map((v) => `${v}pt`).join(" ") } : {};
  const para = (s: string) => /\.docs-prose p$/.test(s);
  let factor = 1.15;
  for (const rule of own) {
    if (!rule.selectors.some(para)) continue;
    const m = /calc\(\s*var\(--docs-ls\s*,\s*[\d.]+\)\s*\*\s*([\d.]+)\s*\)/.exec(rule.declarations.get("line-height") ?? "");
    if (m) factor = Number(m[1]);
  }
  const pad = (side(own, cell, "padding", "top", size, vars) ?? 0) + (side(own, cell, "padding", "bottom", size, vars) ?? 0);
  return size * lineSpacing * factor + pad + 0.75;
}

/** A table row's height: the page's, the median step from one row to the
    next where each of their cells is one line of the page (a row that wraps
    on the page is two lines there, where the page editor's wider column may
    draw it in one), against the page
    editor's for the same rows: a row of one line (rowHeight), or the row's
    own least height where it is taller (an import's ruled row, drawn as the
    row's height); right within a fifth (Word and a PDF's tables set cells
    with no space above or below the words, where the page editor pads each
    cell). */
export function rowHeights(cand: Flat, placed: number[][], pdf: PdfText): RowHeights {
  let tables = 0;
  let right = 0;
  const misses: string[] = [];
  cand.blocks.forEach((block, b) => {
    if (block.kind !== "table" || !block.cells) return;
    const line = rowHeight(block.cells.size, block.cells.lineSpacing, block.cells.padding);
    const least = block.cells.minHeights ?? [];
    const rows = new Map<number, number[]>();
    for (const u of cand.unitsOf[b]) {
      const unit = cand.units[u];
      if (unit.index < 0 || unit.end === unit.first) continue;
      rows.set(unit.row, [...(rows.get(unit.row) ?? []), u]);
    }
    const tops: { row: number; top: number; page: number }[] = [];
    // A cell on one line of the page: its one line holds all its words (a cell that wraps on the page places
    // only the line its runs of words find).
    const oneLine = (u: number) => {
      if (placed[u].length !== 1) return false;
      const held = new Map<string, number>();
      for (const w of wordsOf(pdf.lines[placed[u][0]].text)) held.set(w.w, (held.get(w.w) ?? 0) + 1);
      return cand.toks.slice(cand.units[u].first, cand.units[u].end).every((t) => {
        const n = held.get(t.w) ?? 0;
        held.set(t.w, n - 1);
        return n > 0;
      });
    };
    // A row with a stacked formula in a cell (a fraction, a binomial, a root, a big operator, an array) is not
    // measured: the page editor draws the row as tall as the formula, near twice the line for a fraction, and
    // so does the page, where this measure knows the line's height alone (parse loop finding: ICML's Table 1
    // sets 1/2 and 3/2 in its cells; its rows stand 17 pt apart on the page, and the measure drew them at the
    // line's 12 pt). A formula's cell has no words of its own, so it is not among the row's placed units.
    const stacked = (m: MathItem) => STACKED_TEX_RE.test(m.latex ?? "") || m.mathml !== undefined;
    const formulaRows = new Set(cand.math.filter((m) => !m.display && m.block === b && stacked(m)).map((m) => cand.units[m.unit].row));
    for (const [row, units] of [...rows].sort((a, c) => a[0] - c[0])) {
      if (!units.every(oneLine) || formulaRows.has(row)) continue;
      const lines = units.map((u) => pdf.lines[placed[u][0]]);
      // parse loop finding: a grid of small numbers ("0", "1.0") places a cell on another row's line that
      // holds the same words (tracemonkey's Figure 13 measured its 10 pt rows 20 pt apart): the row stands
      // where most of its cells are placed, and a row with no such majority is not measured.
      const height = Math.min(...lines.map((l) => l.bottom - l.top));
      const onRow = (l: (typeof lines)[number]) => lines.filter((m) => m.page === l.page && Math.abs(m.top - l.top) <= height / 2);
      const most = lines.map(onRow).reduce((a, b) => (b.length > a.length ? b : a));
      if (most.length * 2 <= lines.length) continue;
      tops.push({ row, top: Math.min(...most.map((l) => l.top)), page: most[0].page });
    }
    const pairs = tops.slice(1).flatMap((t, k) => (t.row === tops[k].row + 1 && t.page === tops[k].page && t.top > tops[k].top ? [{ page: t.top - tops[k].top, drawn: Math.max(line, least[tops[k].row] ?? 0) }] : []));
    if (pairs.length < 2) return;
    const median = (values: number[]) => values.sort((a, c) => a - c)[Math.floor(values.length / 2)];
    const page = median(pairs.map((p) => p.page));
    const drawnPt = median(pairs.map((p) => p.drawn));
    tables++;
    if (Math.abs(drawnPt - page) <= 0.2 * page) right++;
    else misses.push(`a table's rows drawn ${Math.round(drawnPt)} pt apart, the page's ${Math.round(page)} pt`);
  });
  return { tables, right, score: tables > 0 ? right / tables : null, misses };
}

// ── A number broken in a table cell ─────────────────────────────────────────

/** A character's advance in ems, as a face of each shape sets the characters
    of a number (Arial's, Times's, a typewriter's). */
function numberEm(ch: string, shape: "serif" | "sans" | "mono"): number {
  if (shape === "mono") return 0.6;
  const serif = shape === "serif";
  if (/\d/.test(ch)) return serif ? 0.5 : 0.556;
  if (ch === "," || ch === ".") return serif ? 0.25 : 0.278;
  if (ch === "%") return serif ? 0.833 : 0.889;
  if (ch === "−" || ch === "+") return serif ? 0.564 : 0.584;
  if (ch === "(" || ch === ")" || ch === "-" || ch === "–") return 0.333;
  return serif ? 0.5 : 0.556;
}

/** A number as a table's cell prints it: "51,051", "(565)", "−3.2", "12%", "$14,736". */
const CELL_NUMBER_RE = /^[−–\-+(]?[$€£]?\d[\d,.]*\)?%?$/u;

export type BrokenNumbers = { numbers: number; broken: number; score: number | null; misses: string[] };

/** Numbers the page editor breaks in a table's cell: a cell is its columns'
    widths (colwidth, px) less its padding (the table's own, else the
    stylesheet's), its grid line, and its paragraph's indents; a number
    wider than that (its characters' advances at its size, in the face the
    document's style names) wraps mid-number ("51,05" over "1"), which a
    number never does on the page. The score is the share of the tables'
    numbers drawn whole. */
export function brokenNumbers(rich: RichNode): BrokenNumbers {
  const styles = readStyles({ attrs: rich.attrs ?? {} });
  const { own } = stylesheets();
  const cellRule = (s: string) => /\.docs-prose (?:td|th|:is\(td, ?th\))$/.test(s);
  const px = 96 / 72;
  let numbers = 0;
  let broken = 0;
  const misses: string[] = [];
  const walk = (node: RichNode) => {
    if (node.type !== "table") {
      for (const child of node.content ?? []) walk(child);
      return;
    }
    const padding = typeof node.attrs?.cellPadding === "string" ? node.attrs.cellPadding : undefined;
    const vars: Record<string, string> = padding ? { "--docs-cell-padding": padding.trim().split(/\s+/).map((v) => `${v}pt`).join(" ") } : {};
    const size0 = typeof node.attrs?.cellSize === "number" ? node.attrs.cellSize : styles.normal.size;
    const pad = (side(own, cellRule, "padding", "left", size0, vars) ?? 0) + (side(own, cellRule, "padding", "right", size0, vars) ?? 0);
    for (const row of node.content ?? []) {
      for (const cell of row.content ?? []) {
        const widths = Array.isArray(cell.attrs?.colwidth) ? (cell.attrs.colwidth as unknown[]).filter((w): w is number => typeof w === "number") : [];
        if (widths.length === 0) continue;
        for (const para of cell.content ?? []) {
          if (para.type !== "paragraph") continue;
          const indent = (Number(para.attrs?.indentLeft ?? 0) || 0) + (Number(para.attrs?.indentRight ?? 0) || 0);
          const room = widths.reduce((a, b) => a + b, 0) - (pad + indent) * px - 1;
          for (const run of para.content ?? []) {
            if (run.type !== "text") continue;
            const look = run.marks?.find((m) => m.type === "textStyle")?.attrs;
            const size = sizeInPt(look?.fontSize) ?? size0;
            const family = typeof look?.fontFamily === "string" ? look.fontFamily : (styles.normal.font ?? "Arial");
            const shape = shapeOf(family);
            for (const token of (run.text ?? "").split(/\s+/)) {
              if (!CELL_NUMBER_RE.test(token)) continue;
              numbers++;
              const width = [...token].reduce((n, ch) => n + numberEm(ch, shape), 0) * size * px;
              if (width <= room + 0.5) continue;
              broken++;
              misses.push(`"${token}" ${Math.round(width)} px wide in a cell with ${Math.round(room)} px of room`);
            }
          }
        }
      }
    }
  };
  walk(rich);
  return { numbers, broken, score: numbers > 0 ? 1 - broken / numbers : null, misses };
}

// ── A checklist's wraps ─────────────────────────────────────────────────────

export type ChecklistWraps = { items: number; wrong: number; score: number | null; misses: string[] };

/** A checklist item's wrapped lines: the page sets them where it sets them
    (back at the margin under the box, or under the words), and the page
    editor where its drawing puts them: a checklist with listIndents at its
    depth's left (lists.ts listSheet, --docs-indent-N), one without them in
    docs.css's row (the list's padding, the box, the gap: the words and their
    wraps beside the box). Each item that wraps on the page (two of its
    lines placed there, linesOfUnits), right within 3 pt or a quarter of
    the page's indent, from its column's edge (layout.ts columnEdge). */
export function checklistWraps(cand: Flat, placed: number[][], pdf: PdfText): ChecklistWraps {
  const { own } = stylesheets();
  const lists = listDrawing as Partial<typeof listDrawing>;
  const px = 0.75;
  const read = (test: (s: string) => boolean, property: string) => {
    let value: number | null = null;
    for (const rule of own) if (rule.selectors.some(test)) value = points(rule.declarations.get(property), 11) ?? value;
    return value;
  };
  const box = read((s) => /taskList"\] li > label input$/.test(s), "width") ?? 14 * px;
  const gap = read((s) => /taskList"\] li$/.test(s), "gap") ?? 8 * px;
  const pad = read((s) => /taskList"\]$/.test(s), "padding-left") ?? 18;
  let items = 0;
  let wrong = 0;
  const misses: string[] = [];
  cand.blocks.forEach((block, b) => {
    if (block.kind !== "list" || block.checklist === undefined) return;
    let indents: [number, number, number?][] = [];
    try {
      const parsed: unknown = JSON.parse(block.checklist || "null");
      if (Array.isArray(parsed)) indents = parsed.filter((x): x is [number, number, number?] => Array.isArray(x) && x.length >= 2 && x.every((n) => typeof n === "number"));
    } catch {
      indents = [];
    }
    const style = indents.length > 0 && typeof lists.indentStyle === "function" ? (lists.indentStyle as (i: typeof indents, l: null) => string)(indents, null) : "";
    cand.unitsOf[b].forEach((u, k) => {
      const lines = placed[u].map((i) => pdf.lines[i]);
      if (lines.length < 2 || lines.some((l) => l.page !== lines[0].page)) return;
      const depth = block.items[k]?.depth ?? 0;
      const variable = new RegExp(`--docs-indent-${depth + 1}:\\s*([^;]+)`).exec(style)?.[1];
      const drawn = variable ? styleLength(variable, 11) : (pad + box + gap) * (depth + 1);
      const edge = columnEdge(pdf, lines[0], Math.max(...lines.map((l) => l.right - l.left)), new Set(lines));
      if (edge === null) return;
      const wraps = lines.slice(1).map((l) => l.left - edge).sort((a, c) => a - c);
      const set = wraps[Math.floor(wraps.length / 2)];
      items++;
      if (Math.abs(drawn - set) <= Math.max(3, 0.25 * set)) return;
      wrong++;
      misses.push(`p${lines[0].page}: a checklist's wraps drawn ${Math.round(drawn)} pt in, the page's ${Math.round(set)} pt`);
    });
  });
  return { items, wrong, score: items > 0 ? 1 - wrong / items : null, misses };
}

// ── A list marker's place ───────────────────────────────────────────────────

/** A marker's width in ems, by its characters as a book face sets them. */
function markerWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += /[()[\]]/.test(ch) ? 0.333 : /[.,:;]/.test(ch) ? 0.25 : /[iljtfr]/.test(ch) ? 0.3 : /[mw]/.test(ch) ? 0.72 : /[A-Z]/.test(ch) ? 0.67 : /[•·◦▪]/.test(ch) ? 0.35 : 0.5;
  return w;
}

/** A length the list's inline style gives ("12pt", "calc(12pt + 2em)", a
    calc inside a calc), in points at `em`. */
function styleLength(value: string, em: number): number {
  let sum = 0;
  for (const m of value.matchAll(/(-?)\s*(\d*\.?\d+)(pt|px|em)/g)) sum += (m[1] ? -1 : 1) * Number(m[2]) * (m[3] === "px" ? 0.75 : m[3] === "em" ? em : 1);
  return sum;
}

/** Where a list line's marker starts against its column's left edge, in
    points: drawn as a box at the line's start (`boxed`), where the line
    starts (its words' place plus its first line's indent); else drawn
    outside the line, its text and an em space ending at the words. */
export function markerStart(boxed: boolean, words: number, first: number, marker: string, em: number): number {
  return boxed ? words + first : words + first - (markerWidth(marker) + 1) * em;
}

export type MarkerPlaces = { lines: number; inside: number; score: number | null; misses: string[] };

/** A list marker's place: where the page editor draws a list line's marker
    in a list set at its page's depths (listIndents), against the column's
    left edge: a marker drawn as a box at the line's start (the page
    editor's ::before) stands where the line starts; a marker drawn outside
    its line (::marker, its text and an em space ending at the words) stands
    its width left of the words. A marker left of the column's edge (a hang
    narrower than the marker and its space) is wrong. */
export function markerPlaces(rich: RichNode): MarkerPlaces {
  const styles = readStyles({ attrs: rich.attrs ?? {} });
  const em = styles.normal.size;
  const lists = listDrawing as Partial<typeof listDrawing>;
  const sheet = typeof lists.listSheet === "function" ? lists.listSheet(".docs-prose") : "";
  const boxed = /::before[^{]*\{[^}]*content:\s*var\(--docs-level-(?:glyph|count)\)/.test(sheet);
  let lines = 0;
  let inside = 0;
  const misses: string[] = [];
  const walk = (node: RichNode) => {
    if (node.type !== "bulletList" && node.type !== "orderedList") {
      for (const child of node.content ?? []) walk(child);
      return;
    }
    let indents: [number, number, number?][] = [];
    try {
      const parsed: unknown = JSON.parse(String(node.attrs?.listIndents ?? "null"));
      if (Array.isArray(parsed)) indents = parsed.filter((x): x is [number, number, number?] => Array.isArray(x) && x.length >= 2 && x.every((n) => typeof n === "number"));
    } catch {
      indents = [];
    }
    if (indents.length === 0 || typeof lists.indentStyle !== "function" || typeof lists.listMarker !== "function") return;
    const style = (lists.indentStyle as (i: typeof indents, l: null) => string)(indents, null);
    const variable = (name: string) => new RegExp(`--docs-${name}:\\s*([^;]+)`).exec(style)?.[1];
    const visit = (list: RichNode, depth: number, above: number[]) => {
      const start = Number(list.attrs?.start ?? 1) || 1;
      (list.content ?? []).forEach((item, index) => {
        const numbers = [...above, start + index];
        const marker = list.type === "orderedList" ? (lists.listMarker?.(node, numbers) ?? "") : typeof lists.levelMarker === "function" && typeof lists.lineLevel === "function" ? lists.levelMarker(lists.lineLevel(node, depth, false), numbers) : "•";
        if (marker) {
          const words = styleLength(variable(`indent-${depth + 1}`) ?? `${36 * (depth + 1)}pt`, em);
          const first = styleLength(variable(`first-${depth + 1}`) ?? "0pt", em);
          const at = markerStart(boxed, words, first, marker, em);
          lines++;
          if (at >= -1) inside++;
          else misses.push(`"${marker}" at depth ${depth} starts ${Math.round(-at)} pt left of the column`);
        }
        for (const child of item.content ?? []) if (child.type === "bulletList" || child.type === "orderedList") visit(child, depth + 1, numbers);
      });
    };
    visit(node, 0, []);
  };
  walk(rich);
  return { lines, inside, score: lines > 0 ? inside / lines : null, misses };
}

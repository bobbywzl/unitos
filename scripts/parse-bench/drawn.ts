import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as listDrawing from "@/components/docs/toolbar/lists";
import { readStyles } from "@/components/docs/toolbar/styles";
import type { RichNode } from "@/lib/docs/schema";
import { regionBounds } from "@/lib/video/types";
import type { Doc } from "./adapt";
import type { PdfText } from "./free";
import { ROOT } from "./load";
import { splitTag } from "./math";
import type { Flat } from "./metrics";

// What the page editor draws around an import's words, read from its own
// stylesheets (components/docs, KaTeX's) and the import's attributes, set
// against the PDF's page (pdftotext's lines): the space above and below a
// display equation, a table row's height, a list marker's place. The page
// sets each; no reference records them.

// ── The stylesheets ─────────────────────────────────────────────────────────

type Rule = { selectors: string[]; declarations: Map<string, string> };
let rulesMemo: { own: Rule[]; katex: Rule[] } | null = null;

function rulesOf(css: string): Rule[] {
  const out: Rule[] = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = new Map<string, string>();
    for (const d of m[2].split(";")) {
      const at = d.indexOf(":");
      if (at > 0) declarations.set(d.slice(0, at).trim().toLowerCase(), d.slice(at + 1).replace(/!important/, "").trim());
    }
    out.push({ selectors: m[1].split(",").map((s) => s.trim()), declarations });
  }
  return out;
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

/** A box's space on one side from the last rule that sets it: `margin` or `padding`, the shorthand
    ("6pt 0", "4px") or the side's own property. */
function side(rules: Rule[], matches: (selector: string) => boolean, property: "margin" | "padding", which: "top" | "bottom", em: number): number | null {
  let value: number | null = null;
  for (const rule of rules) {
    if (!rule.selectors.some(matches)) continue;
    for (const [key, raw] of rule.declarations) {
      if (key === `${property}-${which}`) value = points(raw, em) ?? value;
      else if (key === property) {
        const parts = raw.split(/\s+/);
        value = points(parts[which === "top" ? 0 : parts.length >= 3 ? 2 : 0], em) ?? value;
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
    block's margin where the block has no padding). */
export function displaySpace(em: number): { top: number; bottom: number } {
  const { own, katex } = stylesheets();
  const block = (s: string) => /\.docs-math-block$/.test(s);
  const display = (s: string) => /\.katex-display$/.test(s);
  const drawn = (which: "top" | "bottom") => {
    const margin = side(own, block, "margin", which, em) ?? 0;
    const pad = side(own, block, "padding", which, em) ?? 0;
    const inner = side(own, display, "margin", which, em) ?? side(katex, (s) => s === ".katex-display", "margin", which, em) ?? 0;
    return pad > 0 ? margin + pad + inner : Math.max(margin, inner);
  };
  return { top: drawn("top"), bottom: drawn("bottom") };
}

/** A display's space above and below: the page's, from the display's region
    to the line over it and the line under it in its column (a TeX display
    stands about 4 pt from its lines), against the page editor's, the space
    after the paragraph above (its padding) and the math block's margin and
    padding, and KaTeX's display margin inside it (collapsed into the
    block's margin where the block has no padding); right within 2 pt or a
    quarter. A display whose neighbor is no paragraph (a heading, a figure,
    another display), or whose page leaves more than 36 pt, is not judged. */
export function displayGaps(rich: RichNode, parse: Doc, pdf: PdfText): DisplayGaps {
  const styles = readStyles({ attrs: rich.attrs ?? {} });
  const space = displaySpace(styles.normal.size);
  const drawn = (which: "top" | "bottom") => space[which];
  const placed = parse.blocks.filter((b) => b.kind === "equation" && b.at);
  let next = 0;
  let edges = 0;
  let right = 0;
  const misses: string[] = [];
  const spacing = (node: RichNode | undefined, key: "spaceAfter" | "spaceBefore") =>
    typeof node?.attrs?.[key] === "number" ? (node.attrs[key] as number) : node?.type === "paragraph" ? styles[node.attrs?.docStyle === "title" ? "title" : "normal"][key] : 0;
  const nodes = rich.content ?? [];
  nodes.forEach((node, i) => {
    if (node.type !== "blockMath") return;
    const latex = splitTag(String(node.attrs?.latex ?? "")).latex;
    const k = placed.findIndex((b, j) => j >= next && b.kind === "equation" && b.latex === latex);
    if (k < 0) return;
    next = k + 1;
    const at = placed[k].at;
    const size = at ? pdf.sizes.get(at.page) : undefined;
    if (!at || !size) return;
    const r = regionBounds(at.region);
    const [x1, x2, y1, y2] = [(r.x1 / 100) * size.width, (r.x2 / 100) * size.width, (r.y1 / 100) * size.height, (r.y2 / 100) * size.height];
    const column = pdf.lines.filter((l) => l.page === at.page && Math.min(l.right, x2) > Math.max(l.left, x1) && ((l.top + l.bottom) / 2 < y1 || (l.top + l.bottom) / 2 > y2));
    const above = column.filter((l) => l.bottom <= y1 + 2).sort((a, b) => b.bottom - a.bottom)[0];
    const below = column.filter((l) => l.top >= y2 - 2).sort((a, b) => a.top - b.top)[0];
    const judge = (page: number | null, drawnPt: number, what: string) => {
      if (page === null || page > 36) return;
      edges++;
      if (Math.abs(drawnPt - page) <= Math.max(2, 0.25 * page)) right++;
      else misses.push(`p${at.page}: ${what} ${Math.round(drawnPt)} pt, the page's ${Math.round(page)} pt`);
    };
    const [before, after] = [nodes[i - 1], nodes[i + 1]];
    if (before?.type === "paragraph") judge(above ? y1 - above.bottom : null, spacing(before, "spaceAfter") + drawn("top"), "above");
    if (after?.type === "paragraph") judge(below ? below.top - y2 : null, drawn("bottom") + spacing(after, "spaceBefore"), "below");
  });
  return { edges, right, score: edges > 0 ? right / edges : null, misses };
}

// ── A table row's height ────────────────────────────────────────────────────

export type RowHeights = { tables: number; right: number; score: number | null; misses: string[] };

/** The height the page editor draws a table row of one line in: the cell
    paragraph's line height (its line spacing times the stylesheet's
    factor, at `size` points) with the cell's padding above and below and
    its rule. */
export function rowHeight(size: number, lineSpacing: number): number {
  const { own } = stylesheets();
  const cell = (s: string) => /\.docs-prose (?:td|th)$/.test(s);
  const para = (s: string) => /\.docs-prose p$/.test(s);
  let factor = 1.15;
  for (const rule of own) {
    if (!rule.selectors.some(para)) continue;
    const m = /calc\(\s*var\(--docs-ls\s*,\s*[\d.]+\)\s*\*\s*([\d.]+)\s*\)/.exec(rule.declarations.get("line-height") ?? "");
    if (m) factor = Number(m[1]);
  }
  const pad = (side(own, cell, "padding", "top", size) ?? 0) + (side(own, cell, "padding", "bottom", size) ?? 0);
  return size * lineSpacing * factor + pad + 0.75;
}

/** A table row's height: the page's, the median step from one row to the
    next where each of their cells is one line of the page, against the page
    editor's for a row of one line (rowHeight); right within a fifth (Word
    and a PDF's tables set cells with no space above or below the words,
    where the page editor pads each cell). */
export function rowHeights(cand: Flat, placed: number[][], pdf: PdfText): RowHeights {
  let tables = 0;
  let right = 0;
  const misses: string[] = [];
  cand.blocks.forEach((block, b) => {
    if (block.kind !== "table" || !block.cells) return;
    const drawnPt = rowHeight(block.cells.size, block.cells.lineSpacing);
    const rows = new Map<number, number[]>();
    for (const u of cand.unitsOf[b]) {
      const unit = cand.units[u];
      if (unit.index < 0 || unit.end === unit.first) continue;
      rows.set(unit.row, [...(rows.get(unit.row) ?? []), u]);
    }
    const tops: { row: number; top: number; page: number }[] = [];
    for (const [row, units] of [...rows].sort((a, c) => a[0] - c[0])) {
      if (!units.every((u) => placed[u].length === 1)) continue;
      const lines = units.map((u) => pdf.lines[placed[u][0]]);
      tops.push({ row, top: Math.min(...lines.map((l) => l.top)), page: lines[0].page });
    }
    const steps = tops.slice(1).flatMap((t, k) => (t.row === tops[k].row + 1 && t.page === tops[k].page && t.top > tops[k].top ? [t.top - tops[k].top] : []));
    if (steps.length < 2) return;
    const page = steps.sort((a, c) => a - c)[Math.floor(steps.length / 2)];
    tables++;
    if (Math.abs(drawnPt - page) <= 0.2 * page) right++;
    else misses.push(`a table's rows drawn ${Math.round(drawnPt)} pt apart, the page's ${Math.round(page)} pt`);
  });
  return { tables, right, score: tables > 0 ? right / tables : null, misses };
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

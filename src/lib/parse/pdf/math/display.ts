// Display equations: the lines of a formula set apart from the text become
// one EQUATION whose text is the formula's LaTeX, read from its glyphs and
// rules and checked against them (layout.ts, check.ts). A printed label
// ("(1.2)") becomes \tag{1.2}: KaTeX draws it at the margin, and it stays
// editable. A formula whose LaTeX fails the check stays a FIGURE with the
// region the figure route crops (SPEC.md §16): never a wrong formula.
//
// On a page set in TeX's math fonts the glyphs say which lines are math
// (their inline zones), so a display is found before the page is cut into
// blocks: its lines — a fraction's numerator and denominator, a sum's
// limits, a matrix's rows, the label — join into one line (displayLines).
// Elsewhere a display is found among the blocks by its math-font share, as
// before, and stays a crop; so does a display those lines missed.

import type { Glyph, Rule } from "@/lib/parse/pdf/drawing";
import { CAPTION_RE } from "@/lib/parse/pdf/figures";
import { sameFlags } from "@/lib/parse/pdf/glyphs";
import { regionOf, unionBox } from "@/lib/parse/pdf/geometry";
import { ATTACH_PUNCT_RE } from "@/lib/parse/pdf/lines";
import { BULLET_RE } from "@/lib/parse/pdf/markers";
import { layoutLatex } from "@/lib/parse/pdf/math/check";
import { hangingFamily, hangingGlyph } from "@/lib/parse/pdf/math/layout";
import { mathGlyph } from "@/lib/parse/pdf/math-fonts";
import { balanced, orphanGlyphs, paintsRule, resolveZone } from "@/lib/parse/pdf/math/zones";
import type { Box, Cell, Item, Line, MathZone, PageContext, Run, Segment } from "@/lib/parse/pdf/types";

// A numbered display equation: "… = softmax(QKᵀ/√d)V   (1)". Its words are
// roman (function names), so the math share alone misses it.
const EQUATION_NUMBER_RE = /\(\d{1,3}[a-z]?\)\s*$/;
// A printed equation label: "(3)", "(1.2)", "(A.4)", "(2a)", "(∗)". Not
// "(i)" or "(a)": those mark list items.
const LABEL_RE = /^\((\d{1,3}(?:\.\d{1,3}){0,2}[a-z]?|[A-Z]\.?\d{1,3}(?:\.\d{1,3})?|[∗*†‡]{1,3})\)$/;
// A proof's end mark: flush right on a display's last line or under it,
// it goes in as the display's \tag*{$\square$}, where KaTeX draws it too.
const QED_RE = /^[□■∎]$/;
// Words a display sets in text (\text{if}), and operator names.
const MATH_WORDS = new Set([
  "if", "and", "or", "for", "all", "otherwise", "where", "with", "in", "on", "as", "then", "else",
  "lim", "sup", "inf", "max", "min", "limsup", "liminf", "log", "ln", "lg", "exp", "sin", "cos", "tan", "cot", "sec",
  "csc", "sinh", "cosh", "tanh", "arcsin", "arccos", "arctan", "det", "mod", "dim", "ker", "deg", "gcd", "hom", "arg",
  "pr", "var", "cov", "tr", "sgn", "diag", "rank", "span", "supp",
]);

// A formula's relations and operators: a display states or applies one.
const RELATION_RE = /[=<>≤≥≈∼≃≅≡≠∝≪≫≺≻→←↔⇒⇐⇔⟶⟹⟺↦∈∉∋⊂⊆⊃⊇∑∏∫∮⋀⋁⋃⋂+×∪∩⊕⊗∧∨]/;

// ── Display lines on a TeX page ─────────────────────────────────────────────

type LineKind = "math" | "label" | "fragment" | "text";

// A page set in TeX's math fonts: its glyphs name their math families.
// Read in the page loop (PageContext.tex).
export function isTexPage(glyphs: Glyph[]): boolean {
  return glyphs.some((g) => g.family === "oml" || g.family === "oms");
}

// A line's cells less a label cell at either end (two ems or more from the
// rest): where they start and end, their runs and text, and the label.
function unlabeled(line: Line): { x: number; xEnd: number; runs: Run[]; text: string; label: string | null } {
  const cells = line.cells;
  const first = cells[0]?.text.trim() ?? "";
  const last = cells[cells.length - 1]?.text.trim() ?? "";
  let from = 0;
  let to = cells.length;
  let label: string | null = null;
  if (cells.length > 1 && LABEL_RE.test(last)) {
    label = last;
    to--;
  } else if (cells.length > 1 && LABEL_RE.test(first) && cells[1].x - cells[0].x > line.size * 3) {
    label = first;
    from++;
  }
  // Cells sit in line.text joined by tabs, in order.
  let offset = 0;
  const bounds: [number, number][] = cells.map((c) => {
    const b: [number, number] = [offset, offset + c.text.length];
    offset += c.text.length + 1;
    return b;
  });
  const start = bounds[from]?.[0] ?? 0;
  const end = bounds[to - 1]?.[1] ?? 0;
  const runs = line.runs.filter((r) => r.start >= start && r.end <= end).map((r) => ({ ...r, start: r.start - start, end: r.end - start }));
  const x = cells[from]?.x ?? line.x;
  const labelX = to < cells.length ? cells[to].x : Infinity;
  const kept = line.items.filter((i) => i.x >= x - 0.5 && i.x < labelX - 0.5);
  const xEnd = kept.length > 0 ? Math.max(...kept.map((i) => i.x + i.w)) : line.xEnd;
  return { x, xEnd, runs, text: line.text.slice(start, end), label };
}

// Measured values in the words outside a formula ("0.95", "(0.21)") and
// marks (✓ ✗) anywhere: a table's row holds two or more.
function tableValues(outside: string, text: string): number {
  return outside.split(/\s+/).filter((t) => /^[-−+]?\d+[.,]\d+%?$|^\(\d[\d.,]*\)$/.test(t)).length + (text.match(/[✓✗]/g)?.length ?? 0);
}

// A text with its inline formulas and its scripts blanked: its words.
function wordsOutside(text: string, runs: Run[]): string {
  const blank = new Uint8Array(text.length);
  for (const r of runs) if (r.zone || r.sup || r.sub) blank.fill(1, r.start, r.end);
  let out = "";
  for (let i = 0; i < text.length; i++) out += blank[i] ? " " : text[i];
  return out;
}

function kindOf(line: Line, ctx: PageContext, column: { left: number; right: number }, fenced: boolean): LineKind {
  if (LABEL_RE.test(line.text.trim()) || QED_RE.test(line.text.trim())) return "label";
  const { x, xEnd, runs, text, label } = unlabeled(line);
  const inZone = new Uint8Array(text.length);
  for (const r of runs) if (r.zone) inZone.fill(1, r.start, r.end);
  let zoneChars = 0;
  let outside = "";
  for (let i = 0; i < text.length; i++) {
    if (inZone[i]) {
      if (!/\s/.test(text[i])) zoneChars++;
      outside += " ";
    } else outside += text[i];
  }
  // A list item is an item, whatever its math (census class 1: items (b)–(d)
  // of an exercise became one page picture), its bullet a math glyph too
  // ("•x₀xᵢ where …", arXiv 2410.04586 p. 12).
  if (BULLET_RE.test(text) || /^\s*[•▪◦‣●]/.test(text)) return "text";
  // A word of two or three capitals is a formula's name for a thing set in
  // roman (the outcome "HH" in m(HH)), not a word of prose.
  // Words a display sets in text ("otherwise") are its own when the line is
  // set in; at the column's edge they open a sentence ("If sec_M ≥ −K, then").
  const exempt = (w: string) => x > column.left + line.size * 1.5 && MATH_WORDS.has(w.toLowerCase());
  const all = outside.match(/\p{L}+/gu) ?? [];
  const words = all.filter((w) => w.length >= 2 && !exempt(w) && !/^\p{Lu}{2,3}$/u.test(w));
  const letters = all.filter((w) => !exempt(w)).join("").length;
  const glyphs = line.items.flatMap((i) => i.glyphs ?? []);
  // A fraction's part, a sum's limit, a delimiter: a few glyphs, all math,
  // digits, or small.
  const small = (g: Glyph) => g.size < line.size * 0.85 || g.size < ctx.bodySize * 0.85;
  const few =
    text.replace(/\s/g, "").length <= 6 &&
    glyphs.length > 0 &&
    glyphs.every((g) => g.family !== null && (g.family !== "ot1" || small(g) || /^[0-9+=()[\]!/:;.,−-]$/.test(g.unicode)));
  // A limit or a script alone on its line is set small against the body.
  const tiny = glyphs.every((g) => g.size < ctx.bodySize * 0.85);
  if (few && !label) return zoneChars > 0 && !tiny ? "math" : "fragment";
  // A line of scripts alone, however long, is a big operator's limits: it
  // joins a display or none (arXiv 2506.06752 p. 8: "p, p′ ∈ P_conn" read
  // as a display).
  if (tiny && glyphs.length > 0 && !label) return "fragment";
  // A table's row: a formula with two measured values or marks or more
  // beside it ("P(S ∈ M)  0.00 (0.00)  0.00 (0.00)", arXiv 2302.12627
  // p. 23), unless a matrix's tall delimiters hold it. A fraction's digits
  // are whole numbers ("1" over "N²").
  if (zoneChars > 0 && tableValues(outside, text) >= 2 && !fenced) return "text";
  // A labeled line: a short formula beside it, whatever its fonts (¹⁴₆C,
  // a sans-serif A).
  if (label && words.length === 0 && text.replace(/\s/g, "").length <= 20) return "math";
  if (zoneChars === 0) return "text";
  // A labeled formula with a unit or two in words, wherever it starts: a
  // journal that sets displays flush left starts them at the column edge
  // ("E_γ ε_γ ≃ 0.032 … GeV. (2)", MNRAS, arXiv 2503.22874 p. 5).
  if (label && words.length <= 2 && letters <= zoneChars) return "math";
  // Pure math anywhere; math with a word or two of text only set in from
  // the column edge (a prose line that ends in a formula starts at it).
  if (words.length === 0 && letters <= zoneChars) return "math";
  // Math with a word or two of text only set in from both edges of its
  // column: a prose line starts at an edge, the first line of a paragraph
  // runs to the right one.
  const setIn = x > column.left + line.size * 1.5 && xEnd < column.right - line.size * 1.5;
  if (words.length <= 2 && letters <= zoneChars && setIn) return "math";
  return "text";
}

// A fragment belongs to the display beside it only when the display holds
// it: a fraction bar between it and one of the display's lines; a big
// operator, brace, or delimiter it
// sits over, under, or beside (a limit, a label under a brace, a matrix
// entry); or a line of the display it sits close under or over, inside the
// display's width (an array's row). A page's first or last line is held by
// the first two only: a page number under a formula is no part of it.
function attached(frag: Line, near: Line[], rules: Rule[], edge: boolean): boolean {
  const x1 = frag.x;
  const x2 = frag.xEnd;
  const em = frag.size;
  // A bar just over or under it with a line of the display past the bar: a
  // fraction's part. The display's own line may sit between (a denominator
  // on the page's last line, its bar at the axis over the formula's
  // baseline); a sentence's inline fraction under a display has its bar on
  // the sentence's side.
  for (const r of rules) {
    if (r.dir !== "h" || r.x1 >= x2 || r.x2 <= x1) continue;
    const up = r.y1 > frag.y && r.y1 - frag.y < em * 1.3;
    const down = r.y1 < frag.y && frag.y - r.y1 < em;
    if (!up && !down) continue;
    if (near.some((l) => (up ? l.y > r.y1 : l.y < r.y1) && Math.abs(l.y - r.y1) < Math.max(em, l.size) * 1.6)) return true;
  }
  // Glyph by glyph: a text item may hold a relation and the operator after
  // it ("=∑"), and the limit under the operator stayed out of the display
  // (synth-math-tex (70)).
  for (const g of near.flatMap((l) => l.items.flatMap((item) => item.glyphs ?? []))) {
    const box = hangingGlyph(g);
    if (!box) continue;
    const on = g.x < x2 + em && g.x + g.w > x1 - em;
    const close = frag.y - box.top < em * 1.3 && box.bottom - frag.y < em * 1.6;
    const beside = frag.y <= box.top && frag.y >= box.bottom;
    if ((on && close) || beside) return true;
  }
  if (edge) return false;
  const left = Math.min(...near.map((l) => l.x));
  const right = Math.max(...near.map((l) => l.xEnd));
  return x1 >= left - em && x2 <= right + em && near.some((l) => Math.abs(l.y - frag.y) < Math.max(em, l.size) * 1.3);
}

// A row of a formula set inside a text line (an inline matrix, cases, an
// array): it sits between the tall delimiters the text line holds, or
// closer to the text line than the next line of text would, beside its
// words (a paragraph's last line, all math, under a line that starts with
// a formula is no row of it). The text line it belongs to, or null.
function inlineHost(line: Line, lines: Line[], kinds: LineKind[], fences: Box[], pitch: number): Line | null {
  // A row of words in a text font is none (a table's caption over its
  // rules joined the table's place, synth-paper-html), and a table's
  // place in the text is no text line.
  if (line.items.some((i) => !i.zone && (i.str.match(/\p{L}{2,}/gu) ?? []).some((w) => !MATH_WORDS.has(w.toLowerCase())))) return null;
  const text = (t: Line, n: number) => kinds[n] === "text" && !t.table && t.text.trim() !== "";
  for (const f of fences) {
    if (line.y > f.y2 || line.y < f.y1) continue;
    if (!((line.x >= f.x2 - 1 && line.x - f.x2 < line.size * 3) || (line.xEnd <= f.x1 + 1 && f.x1 - line.xEnd < line.size * 3))) continue;
    const host = lines.find((t, n) => text(t, n) && t.y <= f.y2 && t.y >= f.y1 && t.x <= f.x1 && t.xEnd >= f.x2);
    if (host) return host;
  }
  // A label stacked over a relation of the text line under it (an L with
  // its exponent over an arrow): small glyphs whose baseline stands half
  // an em to an em over the relation's, over its width. It is that line's;
  // taken for a row of the line over it, it glued onto its formula.
  const center = (line.x + line.xEnd) / 2;
  const under = lines.find(
    (t, n) =>
      text(t, n) &&
      t.y < line.y &&
      line.items.every((i) => i.size <= t.size * 0.85) &&
      t.items.some((i) =>
        (i.glyphs ?? []).some((g) => {
          if (g.family === null || g.size < t.size * 0.9 || mathGlyph(g.family, g.code)?.cls !== "rel") return false;
          const rise = (line.y - g.y) / g.size;
          return rise > 0.4 && rise < 1 && center > g.x - g.size * 0.1 && center < g.x + g.w + g.size * 0.1;
        }),
      ),
  );
  if (under) return under;
  const hosts = lines.filter((t, n) => {
    if (!text(t, n) || Math.abs(t.y - line.y) > Math.min(line.size * 1.6, pitch * 0.9)) return false;
    if (t.x > line.x + 1 || t.xEnd < line.xEnd - 1) return false;
    // None of the text line's words under or over the row: its words, not
    // its cells, which reach over the formula they end in (an inline
    // \dfrac's numerators joined the display over them, synth-math-html).
    return !t.items.some((it) => !it.zone && /\p{L}{2,}/u.test(it.str) && it.x < line.xEnd && it.x + it.w > line.x);
  });
  return hosts.sort((a, b) => Math.abs(a.y - line.y) - Math.abs(b.y - line.y))[0] ?? null;
}

// The rows of a formula set inside a text line (an inline matrix, cases,
// an aligned pair, fractions side by side) stand over and under it as
// lines of their own: they read as paragraphs, or as headings at KaTeX's
// math size (synth-math-html), and the text line kept a bare bracket
// ("A matrix in parentheses: ( )."). They join the text line's formula:
// its glyphs and theirs are laid out and checked as one formula, which
// keeps its characters as text when it fails, the rows in reading order.
// The lines in their order, null for a row that joined.
function joinInlineRows(lines: Line[], hosts: (Line | null)[], ctx: PageContext): (Line | null)[] {
  // A row line may hold the rows of two formulas, or two labels over two
  // arrows ("q" and "r" over the arrows of one sentence): parts two ems
  // apart are rows of their own, so the words between stay text.
  const parts = (row: Line): Line[] => {
    const groups: Item[][] = [];
    for (const item of [...row.items].sort((a, b) => a.x - b.x)) {
      const last = groups[groups.length - 1];
      if (last && item.x - Math.max(...last.map((i) => i.x + i.w)) < row.size * 2) last.push(item);
      else groups.push([item]);
    }
    if (groups.length === 1) return [row];
    return groups.map((items) => ({ ...row, items, x: items[0].x, xEnd: Math.max(...items.map((i) => i.x + i.w)), mathChars: items.reduce((sum, i) => sum + i.str.replace(/\s/g, "").length, 0) }));
  };
  const rowsOf = new Map<Line, Line[]>();
  lines.forEach((l, n) => {
    const host = hosts[n];
    if (host) rowsOf.set(host, [...(rowsOf.get(host) ?? []), ...parts(l)]);
  });
  if (rowsOf.size === 0) return [...lines];
  const orphans = orphanGlyphs(lines, ctx.drawing);
  const joined = new Map<Line, Line>();
  const kept = new Set<Line>();
  for (const [host, rows] of rowsOf) {
    // A text line cut into cells away from the rows is two columns' lines
    // or a table's row, no sentence: its rows stay lines (a two-column
    // page's lines read as a table, arXiv 2502.02648 p. 11).
    const x1 = Math.min(...rows.map((r) => r.x)) - host.size * 1.5;
    const x2 = Math.max(...rows.map((r) => r.xEnd)) + host.size * 1.5;
    if (host.cells.slice(1).some((c) => c.x < x1 || c.x > x2)) {
      kept.add(host);
      continue;
    }
    // One formula to each run of rows that overlap in x.
    const groups: Line[][] = [];
    for (const row of [...rows].sort((a, b) => a.x - b.x)) {
      const last = groups[groups.length - 1];
      if (last && row.x < Math.max(...last.map((r) => r.xEnd))) last.push(row);
      else groups.push([row]);
    }
    let line = host;
    for (const group of groups) line = joinRows(line, group, ctx, orphans);
    joined.set(host, line);
  }
  // A row stays a line of its own when its text line kept its rows.
  return lines.map((l, n) => (hosts[n] && !kept.has(hosts[n]) ? null : (joined.get(l) ?? l)));
}

// A text line with the rows of one formula joined into it (joinInlineRows).
function joinRows(host: Line, rows: Line[], ctx: PageContext, orphans: Glyph[]): Line {
  const em = host.size;
  const x1 = Math.min(...rows.map((r) => r.x));
  const x2 = Math.max(...rows.map((r) => r.xEnd));
  // The text line's formulas the rows stand in or beside (a matrix's
  // brackets, "|x| = {" before cases), and whatever it holds between them.
  const zones = new Set(host.items.filter((i) => i.zone && i.x < x2 + em * 0.6 && i.x + i.w > x1 - em * 0.6).map((i) => i.zone!));
  const own = host.items.filter((i) => (i.zone ? zones.has(i.zone) : i.x + i.w / 2 > x1 && i.x + i.w / 2 < x2));
  const glyphs = [...[...zones].flatMap((z) => z.glyphs), ...[...own.filter((i) => !i.zone), ...rows.flatMap((r) => r.items)].flatMap((i) => i.glyphs ?? [])];
  const zone: MathZone = {
    glyphs: [...new Set(glyphs)].filter((g) => g.family !== null || g.unicode.trim() !== ""),
    size: [...zones][0]?.size ?? em,
    latex: "",
    ok: false,
    open: false,
  };
  if (zone.glyphs.length > 0) resolveZone(zone, ctx.drawing, orphans);
  const mine = (i: Item): Item => ({ ...i, zone, sup: false, sub: false });
  // Reading order: the text line's words before the formula, its part
  // left of the rows, the rows from the top (the text line's part among
  // them at its place), its part right of them, the words after.
  const rest = host.items.filter((i) => !own.includes(i));
  const center = (i: Item) => i.x + i.w / 2;
  const middle: { y: number; items: Item[] }[] = [...rows.map((r) => ({ y: r.y, items: r.items })), { y: host.y, items: own.filter((i) => center(i) >= x1 && center(i) <= x2) }];
  const formulaX = Math.min(x1, ...own.map((i) => i.x));
  // A row is set off by a space on each side.
  const sequence: { items: Item[]; row: boolean }[] = [
    { items: [...rest.filter((i) => i.x < formulaX), ...own.filter((i) => center(i) < x1).map(mine)], row: false },
    ...middle
      .filter((u) => u.items.length > 0)
      .sort((a, b) => b.y - a.y)
      .map((u) => ({ items: u.items.map(mine), row: true })),
    { items: [...own.filter((i) => center(i) > x2).map(mine), ...rest.filter((i) => i.x >= formulaX)], row: false },
  ];
  // A cell of the text line starts where it started; one inside the
  // formula closes (the rows' gap had cut "( )" into two cells).
  const starts = new Set(host.cells.slice(1).map((c) => c.x));
  const cells: Cell[] = [];
  let prev: Item | null = null;
  let prevRow = false;
  for (const unit of sequence) {
    for (const [k, item] of unit.items.entries()) {
      let cell = cells[cells.length - 1];
      if (!cell || (item.zone !== zone && starts.has(item.x) && prev !== null)) {
        cell = { x: item.x, text: "", runs: [] };
        cells.push(cell);
      } else if (!cell.text.endsWith(" ") && prev !== null) {
        const gap = item.x - (prev.x + prev.w);
        const attach = ATTACH_PUNCT_RE.test(item.str) && gap < em * 0.7;
        if ((k === 0 && (unit.row || prevRow)) || (gap > em * 0.12 && !attach)) cell.text += " ";
      }
      const start = cell.text.length;
      cell.text += item.str;
      const last = cell.runs[cell.runs.length - 1];
      if (last && sameFlags(last, item) && start - last.end <= 1) last.end = cell.text.length;
      else {
        const { bold, italic, mono, smallCaps, href, sup, sub, look } = item;
        cell.runs.push({ start, end: cell.text.length, bold, italic, mono, smallCaps, href, sup, sub, zone: item.zone, look });
      }
      prev = item;
    }
    if (unit.items.length > 0) prevRow = unit.row;
  }
  let text = "";
  const runs: Run[] = [];
  for (const [n, cell] of cells.entries()) {
    cell.text = cell.text.trimEnd();
    cell.runs = cell.runs.map((r) => ({ ...r, end: Math.min(r.end, cell.text.length) })).filter((r) => r.end > r.start);
    if (n > 0) text += "\t";
    const offset = text.length;
    text += cell.text;
    for (const r of cell.runs) runs.push({ ...r, start: r.start + offset, end: r.end + offset });
  }
  return {
    ...host,
    cells,
    text,
    runs,
    items: sequence.flatMap((u) => u.items).sort((a, b) => a.x - b.x),
    x: Math.min(host.x, x1),
    xEnd: Math.max(host.xEnd, x2),
    mathChars: host.mathChars + rows.reduce((sum, r) => sum + r.mathChars, 0),
    yMin: Math.min(host.yMin, ...rows.map((r) => r.yMin)),
    yMax: Math.max(host.yMax, ...rows.map((r) => r.yMax)),
  };
}

// The page's tall delimiters: the extension font's delimiter glyphs, their
// pieces stacked in one column joined, taller than a line. Read from the
// drawing: a text item may hold a piece and the digits after it, and the
// text layer may drop a piece ("(1." over an unread piece in a matrix of
// correlations, arXiv 2302.12627 p. 23). KaTeX draws its tallest ones as
// pictures: a narrow path as tall (a matrix of three rows lost its top
// row, synth-math-html). Only on a page KaTeX set: a figure's strokes are
// no delimiters (arXiv 2411.19946 p. 1).
function fencesOf(ctx: PageContext): Box[] {
  const katex = ctx.drawing.glyphs.some((g) => g.base.startsWith("KaTeX_"));
  const drawn = katex ? ctx.drawing.paths.filter((p) => !p.clip && p.y2 - p.y1 > ctx.bodySize * 1.5 && p.x2 - p.x1 < Math.min(ctx.bodySize, (p.y2 - p.y1) * 0.35)) : [];
  const columns: Box[] = [];
  for (const g of ctx.drawing.glyphs) {
    const entry = g.family === "omx" ? mathGlyph("omx", g.code) : null;
    if (!entry || (entry.cls !== "open" && entry.cls !== "close" && !entry.piece)) continue;
    const [height, depth] = g.box ?? entry.box;
    const top = g.y + height * g.size;
    const bottom = g.y - depth * g.size;
    const found = columns.find((c) => Math.abs(c.x1 - g.x) < 1 && top >= c.y1 - g.size && bottom <= c.y2 + g.size);
    if (found) {
      found.y1 = Math.min(found.y1, bottom);
      found.y2 = Math.max(found.y2, top);
    } else columns.push({ x1: g.x, x2: g.x + g.w, y1: bottom, y2: top });
  }
  return [...columns.filter((c) => c.y2 - c.y1 > ctx.bodySize * 1.5), ...drawn.map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 }))];
}

// The edges of a line's column: where the prose lines near it that share
// its width start and end (two columns on a page have two left edges).
function columnOf(lines: Line[], n: number, ctx: PageContext): { left: number; right: number } {
  const line = lines[n];
  let left = Infinity;
  let right = -Infinity;
  for (let k = Math.max(0, n - 12); k < Math.min(lines.length, n + 13); k++) {
    const l = lines[k];
    if (k === n || l.text.length < 30 || l.xEnd < line.x || l.x > line.xEnd) continue;
    left = Math.min(left, l.x);
    right = Math.max(right, l.xEnd);
  }
  return Number.isFinite(left) ? { left, right } : { left: ctx.columnLeft, right: Infinity };
}

/** A TeX page's lines with each display equation's lines joined into one:
    runs of math lines, labels, and fragments the display holds (a limit, a
    fraction's part), close together, with two lines or more, a label, or a
    fraction bar among them; a math line alone is a display when it is
    centered, or set in with space over or under it. One label to a
    display: a second starts the next. */
export function displayLines(input: Line[], ctx: PageContext): Line[] {
  if (!ctx.tex) return input;
  const fences = fencesOf(ctx);
  const fenced = (l: Line) => fences.some((f) => l.y <= f.y2 && l.y >= f.y1 && f.x1 < l.xEnd + l.size * 2 && f.x2 > l.x - l.size * 2);
  const kinds0 = input.map((l, n) => kindOf(l, ctx, columnOf(input, n, ctx), fenced(l)));
  // A table's rows are no display: three cells or more, two of them
  // measured values or marks, with no tall delimiters around them (a
  // matrix's rows have them). Simulation tables with a formula in each row
  // label read as one display (arXiv 2302.12627 p. 23).
  for (let n = 0; n < input.length; n++) {
    const l = input[n];
    if (kinds0[n] === "text" || kinds0[n] === "label") continue;
    const cells = l.cells.filter((c) => c.text.trim());
    // A value is set at the text's size: a column of superscripts over a
    // display ("2   2   (1 − z₁²)w₁²", arXiv 2506.08494 p. 2) is no row.
    const full = (c: Cell) => {
      const next = l.cells[l.cells.indexOf(c) + 1]?.x ?? Infinity;
      return l.items.some((it) => it.x >= c.x - 0.5 && it.x < next - 0.5 && it.size >= l.size * 0.85);
    };
    // Measured values ("0.95 (0.21)", "4280 (635)") and marks; a Betti
    // table's digits and dots are a display's matrix (arXiv 2410.04586 p. 3).
    const numbers = cells.filter((c) => /^[-−+]?\d+[.,]\d+%?(\s*\([\d.,]+\))?$|^\d+\s*\([\d.,]+\)$|^[✓✗]+$/.test(c.text.trim()) && full(c)).length;
    const table = cells.length >= 3 && numbers >= 2;
    if (table && !fenced(l)) kinds0[n] = "text";
  }
  // The rows of an inline structure are the text line's, not a display.
  const hosts = input.map((l, n) => (kinds0[n] !== "text" && kinds0[n] !== "label" ? inlineHost(l, input, kinds0, fences, ctx.bodySize * ctx.leading) : null));
  const joined = joinInlineRows(input, hosts, ctx);
  const lines = joined.filter((l): l is Line => l !== null);
  const kinds = kinds0.filter((_, n) => joined[n] !== null);
  const columns = lines.map((l, n) => columnOf(lines, n, ctx));
  // A fraction's part set in words ("TeV" under "E_γ"): a short text line a
  // bar holds to a line of math beside it.
  const rules0 = ctx.drawing.rules;
  for (let n = 0; n < lines.length; n++) {
    const l = lines[n];
    if (kinds[n] !== "text" || l.text.replace(/\s/g, "").length > 6) continue;
    const beside = lines.filter((o, m) => m !== n && kinds[m] !== "text" && Math.abs(o.y - l.y) <= Math.max(o.size, l.size) * 1.6);
    const barred = rules0.some(
      (r) => r.dir === "h" && r.x1 < l.xEnd && r.x2 > l.x && beside.some((o) => r.y1 < Math.max(l.y, o.y) && r.y1 > Math.min(l.y, o.y)),
    );
    if (barred) kinds[n] = "fragment";
  }
  const rules = ctx.drawing.rules;
  const pitch = ctx.bodySize * ctx.leading;
  const edge = (l: Line) => l === lines[0] || l === lines[lines.length - 1];
  // The display's lines around a fragment, over and under it: the lines
  // within an em and a half that are no text, and of the fragments only
  // the band's own (a sentence's inline fraction under a display holds its
  // numerator to its denominator, not to the display).
  const around = (l: Line, band: Line[]) =>
    lines.filter(
      (o, n) => o !== l && kinds[n] !== "text" && (kinds[n] !== "fragment" || band.includes(o)) && Math.abs(o.y - l.y) <= Math.max(o.size, l.size) * 1.6,
    );
  const out: Line[] = [];
  let k = 0;
  while (k < lines.length) {
    if (kinds[k] === "text") {
      out.push(lines[k]);
      k++;
      continue;
    }
    const band = [lines[k]];
    let labels = kinds[k] === "label" || unlabeled(lines[k]).label !== null ? 1 : 0;
    for (let j = k + 1; j < lines.length && kinds[j] !== "text"; j++) {
      const prev = lines[j - 1];
      const next = lines[j];
      const size = Math.max(prev.size, next.size, ctx.bodySize);
      // A display's rows, limits, and fraction parts stand within an em and a
      // half of each other; the next display or text line stands farther. A
      // proof's end mark stands a line under the display's last.
      const reach = kinds[j] === "label" && QED_RE.test(next.text.trim()) ? 2.6 : 1.6;
      // A limit over the next row's sum stands a little farther from the
      // row above (a display of several rows, each with its sums).
      const limit = kinds[j] === "fragment" && prev.y - next.y <= size * 2.2 && attached(next, around(next, band), rules, edge(next));
      // Rows a tall delimiter holds are one display, however far apart.
      const held = fences.some((f) => [prev, next].every((l) => l.y >= f.y1 && l.y <= f.y2 && l.x >= f.x2 - 1 && l.x - f.x2 < l.size * 3));
      if ((prev.y - next.y > size * reach && !limit && !held) || prev.y < next.y) break;
      // A display's lines sit side by side at most a few ems apart (a
      // fraction's numerator beside a big operator); a label at the margin
      // stands farther.
      const x1 = Math.min(...band.map((l) => l.x));
      const x2 = Math.max(...band.map((l) => l.xEnd));
      if (kinds[j] !== "label" && (next.xEnd < x1 - size * 6 || next.x > x2 + size * 6) && !band.every((l) => kinds[lines.indexOf(l)] === "label")) break;
      const label = kinds[j] === "label" || unlabeled(next).label !== null ? 1 : 0;
      if (labels + label > 1) break;
      // A fragment between two math lines of the display stays in it (an
      // aligned row's lone "=" over its fraction's denominator).
      const after = lines[j + 1];
      const between = after !== undefined && kinds[j + 1] === "math" && next.y - after.y <= size * 1.6 && next.y < prev.y;
      if (kinds[j] === "fragment" && !between && !attached(next, around(next, band), rules, edge(next))) break;
      labels += label;
      band.push(next);
    }
    // A fragment that opened the band holds only if the band holds it.
    while (band.length > 1 && kinds[lines.indexOf(band[0])] === "fragment" && !attached(band[0], around(band[0], band), rules, edge(band[0]))) {
      out.push(band.shift()!);
      k++;
    }
    const kindIn = (l: Line) => kinds[lines.indexOf(l)];
    const set = (l: Line) => unlabeled(l).x > columns[lines.indexOf(l)].left + l.size * 1.5;
    // A display line alone stands apart from the text: centered in its
    // column, or set in with more than a line's space over or under it. A
    // list item's second line and a paragraph's last line are neither,
    // whatever their math (synthetic notes p. 4–5: "∑ c_k P(A_k)." ending a
    // sentence, an item's "then EX_n → EX").
    const centered = (l: Line) => {
      const { x, xEnd } = unlabeled(l);
      const c = columns[lines.indexOf(l)];
      return Number.isFinite(c.right) && x > c.left + l.size * 0.5 && Math.abs((x + xEnd) / 2 - (c.left + c.right) / 2) < l.size * 1.5;
    };
    const detached = (l: Line) => {
      const same = lines.filter((o) => o !== l && o.x < l.xEnd && o.xEnd > l.x);
      const above = same.filter((o) => o.y > l.y).sort((a, b) => a.y - b.y)[0];
      const below = same.filter((o) => o.y < l.y).sort((a, b) => b.y - a.y)[0];
      return (above !== undefined && above.y - l.y > pitch * 1.25) || (below !== undefined && l.y - below.y > pitch * 1.25);
    };
    // TeX keeps a baseline skip at least between a display and the lines
    // around it: a line closer to its neighbor is a fraction's part (a
    // numerator over a flush-left display's line).
    const spaced = (l: Line) => {
      const same = lines.filter((o) => o !== l && o.x < l.xEnd && o.xEnd > l.x);
      return same.every((o) => Math.abs(o.y - l.y) >= pitch * 0.85);
    };
    const alone = (l: Line) => spaced(l) && (centered(l) || (set(l) && detached(l)));
    const math = band.some((l) => kindIn(l) === "math" && (labels > 0 || band.length > 1 || alone(l)));
    const bar = band.length > 1 && band.some((l) => kindIn(l) === "fragment") && (labels > 0 || band.some(set)) && rules.some((r) => r.dir === "h" && band.some((a) => band.some((b) => r.y1 < a.y && r.y1 > b.y && r.x1 < a.xEnd && r.x2 > a.x)));
    if (math || bar) out.push(join(band));
    else out.push(...band);
    k += band.length;
  }
  return out;
}

// The band's lines as one line: its items, its texts in reading order.
function join(band: Line[]): Line {
  if (band.length === 1) return { ...band[0], display: true, mathChars: band[0].text.replace(/\s/g, "").length };
  let text = "";
  const runs: Run[] = [];
  for (const l of band) {
    if (text) text += " ";
    const offset = text.length;
    text += l.text.replace(/\t/g, " ");
    for (const r of l.runs) runs.push({ ...r, start: r.start + offset, end: r.end + offset });
  }
  const main = [...band].sort((a, b) => b.size - a.size || b.text.length - a.text.length)[0];
  const x = Math.min(...band.map((l) => l.x));
  const xEnd = Math.max(...band.map((l) => l.xEnd));
  return {
    cells: [{ x, text, runs }],
    text,
    runs,
    items: band.flatMap((l) => l.items),
    x,
    xEnd,
    y: main.y,
    size: Math.max(...band.map((l) => l.size)),
    page: main.page,
    firstWordWidth: xEnd - x,
    mathChars: text.replace(/\s/g, "").length,
    yMin: Math.min(...band.map((l) => l.yMin)),
    yMax: Math.max(...band.map((l) => l.yMax)),
    display: true,
  };
}

// ── Display equations among the blocks ──────────────────────────────────────

function isMathSegment(s: Segment, ctx: PageContext): boolean {
  if (s.type !== "PARAGRAPH" && s.type !== "TABLE" && s.type !== "FIGURE") return false;
  if (s.region || !s.box) return false;
  const numbered =
    EQUATION_NUMBER_RE.test(s.text) &&
    s.text.length <= 90 &&
    s.box.x1 > ctx.columnLeft + 2 &&
    // A line of nothing but "(1) (2) (3)" is a row of superscripts.
    !/^(\s*\(\d{1,3}[a-z]?\)\s*)+$/.test(s.text);
  if (!numbered && (s.mathShare ?? 0) < 0.25) return false;
  // A lone symbol (a footnote marker, a sum limit) is not an equation.
  if (s.text.replace(/\s/g, "").length < 4) return false;
  // Prose with inline math starts at the column edge and runs long, or
  // carries words ("Here χ = 1 if … and zero otherwise." — import compare
  // loop finding: a short sentence under a display merged into its crop).
  const words = (s.text.match(/\p{L}{3,}/gu) ?? []).length;
  const prose =
    s.box.x1 <= ctx.columnLeft + 2 && (s.mathShare ?? 0) < 0.6 && (s.text.length > 50 || words >= 3);
  return !prose;
}

// A line of an equation whose glyphs are mostly roman (function names, an
// equation number, a fraction's denominator): short, off the column edge,
// body-sized. Joins an equation it sits against.
function isEquationShaped(s: Segment, ctx: PageContext): boolean {
  if (s.type !== "PARAGRAPH" && s.type !== "TABLE" && s.type !== "FIGURE") return false;
  if (s.region || !s.box) return false;
  const size = s.lineSize ?? ctx.bodySize;
  // A big operator (an integral or sum sign with its limits) is a math glyph
  // set larger than the text: still a line of the equation.
  const bigOperator = (s.mathShare ?? 0) >= 0.5 && size <= ctx.bodySize * 3;
  // Words at a list indent are an item, not a line of the equation: an
  // equation line is math, a fragment of a few glyphs (a fraction's
  // numerator, an equation number, a function name), or a label set deep in
  // the column (an underbrace's caption).
  const mathOrFragment = (s.mathShare ?? 0) >= 0.2 || s.text.replace(/\s/g, "").length <= 12;
  const deep = !BULLET_RE.test(s.text) && s.box.x1 > ctx.columnLeft + size * 6;
  return (
    s.text.length <= 60 &&
    s.box.x1 > ctx.columnLeft + 2 &&
    (mathOrFragment || deep) &&
    (size <= ctx.bodySize * 1.1 || bigOperator)
  );
}

// The formula's glyphs: the glyphs of its display line, and the glyphs no
// item reads (a placed accent, a composite's second half: the page's
// orphans) inside its box, less a label at either end a quad or more apart
// (its \tag, or \tag* for a proof's end mark). null when an item holds text
// the drawing has no glyph for (the check could not see it).
function formulaGlyphs(line: Line, pageOrphans: Glyph[]): { glyphs: Glyph[]; label: string | null; labelGlyphs: Glyph[] } | null {
  if (line.items.some((i) => !i.glyphs?.length)) return null;
  const top = line.yMax + line.size * 1.2;
  const bottom = line.yMin - line.size * 0.6;
  const orphans = pageOrphans.filter((g) => g.x + g.w / 2 > line.x && g.x + g.w / 2 < line.xEnd && g.y >= bottom && g.y <= top);
  const glyphs = [...line.items.flatMap((i) => i.glyphs!), ...orphans].sort((a, b) => a.x - b.x);
  const size = Math.max(...glyphs.map((g) => g.size));
  // A label: the glyphs at an end that read "(…)", a quad or more from the rest.
  const labelAt = (from: number, dir: 1 | -1): { glyphs: Glyph[]; text: string } | null => {
    const run: Glyph[] = [];
    for (let k = from; k >= 0 && k < glyphs.length; k += dir) {
      const g = glyphs[k];
      const prev = run[run.length - 1];
      if (prev && (dir > 0 ? g.x - (prev.x + prev.w) : prev.x - (g.x + g.w)) > size * 0.5) break;
      run.push(g);
      if (run.length > 8) return null;
    }
    const ordered = dir > 0 ? run : [...run].reverse();
    const text = ordered.map((g) => (g.family ? mathGlyph(g.family, g.code)?.unicode : undefined) ?? g.unicode).join("");
    const rest = glyphs.filter((g) => !run.includes(g));
    if (rest.length === 0 || !(LABEL_RE.test(text) || (dir < 0 && QED_RE.test(text)))) return null;
    // A formula too wide for its label sets the label on a row of its own,
    // under it (over it when the label is on the left).
    const own = dir < 0 ? Math.max(...run.map((g) => g.y)) < Math.min(...rest.map((g) => g.y)) - size * 0.5 : Math.min(...run.map((g) => g.y)) > Math.max(...rest.map((g) => g.y)) + size * 0.5;
    if (own) return { glyphs: run, text };
    const gap =
      dir > 0
        ? Math.min(...rest.map((g) => g.x)) - Math.max(...run.map((g) => g.x + g.w))
        : Math.min(...run.map((g) => g.x)) - Math.max(...rest.map((g) => g.x + g.w));
    // TeX sets a label a quad at least from a wide formula.
    return gap >= size * 0.9 ? { glyphs: run, text } : null;
  };
  const label = labelAt(glyphs.length - 1, -1) ?? labelAt(0, 1);
  if (!label) return { glyphs, label: null, labelGlyphs: [] };
  const tag = QED_RE.test(label.text) ? `\\tag*{$${label.text === "□" ? "\\square" : "\\blacksquare"}$}` : `\\tag{${label.text.slice(1, -1)}}`;
  return { glyphs: glyphs.filter((g) => !label.glyphs.includes(g)), label: tag, labelGlyphs: label.glyphs };
}

// The equation's LaTeX with its label as \tag, and the box of its glyphs
// (their drawn extent, the label's included); null when the check fails.
function equationOf(line: Line, orphans: Glyph[], ctx: PageContext): { latex: string; box: Box } | null {
  const found = formulaGlyphs(line, orphans);
  if (!found || found.glyphs.length === 0) return null;
  const glyphs = found.glyphs;
  const size = Math.max(...glyphs.filter((g) => !hangingFamily(g.family)).map((g) => g.size), 1);
  // Rules among the glyphs: a fraction bar between two of their baselines,
  // an overline an em over the top one, an underline under the lowest.
  const low = Math.min(...glyphs.map((g) => g.y)) - size * 0.5;
  const high = Math.max(...glyphs.map((g) => g.y)) + size;
  // A vertical rule inside is an array's column line, and its \hline
  // runs past the cells by their padding; the paths on it are a radical's
  // sign or a picture of an accent or a tall delimiter (KaTeX draws them
  // so).
  const columns = ctx.drawing.rules.filter((r) => r.dir === "v" && r.x1 > line.x && r.x1 < line.xEnd && r.y1 >= low - size && r.y2 <= high + size);
  const pad = columns.length > 0 ? Math.max(2, size * 0.6) : 2;
  const rules = [...ctx.drawing.rules.filter((r) => r.dir === "h" && r.x1 >= line.x - pad && r.x2 <= line.xEnd + pad && r.y1 >= low && r.y1 <= high), ...columns];
  const paths = ctx.drawing.paths.filter(
    (b) =>
      !b.clip &&
      b.x1 >= line.x - size * 1.5 &&
      b.x1 < line.xEnd + size * 0.6 &&
      ((b.y1 >= low - size && b.y2 <= high + size) || (b.x2 - b.x1 < size * 0.6 && b.y2 > low && b.y1 < high)) &&
      !paintsRule(b, ctx.drawing.rules),
  );
  try {
    const { latex, check } = layoutLatex(glyphs, rules, { display: true, size }, paths);
    // A display cut in two (its operators and an opening bracket on one line,
    // the rest on the next) passes the check on what it has: its brackets
    // do not close.
    if (!check.ok || !balanced(latex)) return null;
    // Each glyph's drawn box: a TeX glyph's by its font's metrics, any
    // other's by its size.
    const all = [...glyphs, ...found.labelGlyphs];
    let box: Box = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
    for (const g of all) {
      const entry = g.family ? mathGlyph(g.family, g.code) : null;
      const [height, depth] = g.box ?? entry?.box ?? [0.7, 0.2];
      box = unionBox(box, { x1: g.x, x2: g.x + Math.max(g.w, 0), y1: g.y - depth * g.size, y2: g.y + height * g.size });
    }
    for (const r of rules) box = unionBox(box, { x1: r.x1, x2: r.x2, y1: r.y1 - r.thickness, y2: r.y2 + r.thickness });
    // A radical's sign drawn as a path: from where it starts.
    for (const b of paths) box = unionBox(box, { x1: b.x1, x2: Math.min(b.x2, box.x2), y1: b.y1, y2: b.y2 });
    // Every glyph drawn inside the formula is the formula's: one another
    // line took (a superscript read into the text line beside the display)
    // would be missing from the LaTeX.
    // A symbol of a font the tables do not know may hang from its origin
    // like an integral (esint's ∫ read as "ˆ", arXiv 2411.09614 p. 5): an
    // em over the box counts.
    // A rule at the formula's bottom edge with glyphs just under it is a
    // fraction cut in two: its denominator went to the next line (arXiv
    // 2410.04586 p. 9 read it as an \underline).
    const edges = rules.filter((r) => r.y1 - box.y1 < size * 0.35);
    const past = (g: Glyph) => edges.some((r) => g.x + g.w / 2 > r.x1 && g.x + g.w / 2 < r.x2 && g.y < r.y1 && r.y1 - g.y < size * 1.3);
    const own = new Set(all);
    const stray = ctx.drawing.glyphs.some((g) => {
      if (own.has(g) || (g.family === null && g.unicode.trim() === "")) return false;
      if (past(g)) return true;
      if (g.x + g.w / 2 <= box.x1 || g.x + g.w / 2 >= box.x2) return false;
      const hangs = g.family === null && !/^[\p{Script=Latin}\p{Script=Greek}\p{N}\p{P}]$/u.test(g.unicode);
      return g.y > box.y1 && g.y < box.y2 + (hangs ? g.size : 0);
    });
    if (stray) return null;
    const pad = size * 0.15;
    box = { x1: box.x1 - pad, y1: box.y1 - pad, x2: box.x2 + pad, y2: box.y2 + pad };
    return { latex: found.label ? `${latex} ${found.label}` : latex, box };
  } catch {
    return null;
  }
}

/** Display equations on a page: on a TeX page each joined display line's
    block, elsewhere each math block, with the equation-shaped blocks against
    it. Each becomes one EQUATION, or a FIGURE crop when its LaTeX fails the
    check (or the page has no TeX math fonts to read it by). With missed, a
    TeX page's second pass, once the figures took their own words: each
    display the display lines missed becomes a crop. */
export function displayEquations(
  segments: Segment[],
  lines: Line[],
  ctx: PageContext,
  pageWidth: number,
  pageHeight: number,
  missed?: { graphics: Box[] },
): Segment[] {
  const tex = ctx.tex;
  // A joined display line is one block: the block that reads as the line
  // and lies over it.
  const displays = lines.filter((l) => l.display);
  const used = new Set<Line>();
  const flat = (t: string) => t.replace(/\s+/g, " ").trim();
  const displayOf = (s: Segment) =>
    s.box === undefined || s.region
      ? undefined
      : displays.find((l) => !used.has(l) && flat(l.text) === flat(s.text) && l.y >= s.box!.y1 && l.y <= s.box!.y2);
  const rowGap = ctx.bodySize * ctx.leading;
  const near = (a: Segment, b: Segment) => a.box!.y1 - b.box!.y2 < rowGap * 1.5;
  // A display the display lines missed on a TeX page read as words, its
  // scripts lost: one set small in an abstract (its lines all read as
  // scripts), one with a word in roman beside its formula ("⋀ AtMostOne(…)
  // (13)", arXiv 2506.06752 p. 8). The math share finds it as it does on
  // any other page, and it becomes a crop: a picture of the right formula.
  // Only a display does: it states a relation or applies an operator, it
  // stands apart (centered in its column, or with a printed label: a
  // formula at the column's edge is as often a sentence's end, "where q =
  // 1 − p.", Grinstead–Snell p. 106), and it is no row a display line left
  // out (a limit within an em and a half of one, inside its width). What
  // the display lines read as text stays text, in the display and in the
  // lines against it: a sentence (a word outside the formula in the
  // display, two in a line against it, as a fraction's parts in words hold,
  // "area of E"), a table's row (two values or marks), head, or caption, an
  // item or a panel label (its marker, "(A) d = 3, e = 2"), and a figure's
  // labels (by a graphic).
  const inDisplay = (s: Segment) => {
    const x = (s.box!.x1 + s.box!.x2) / 2;
    const y = (s.box!.y1 + s.box!.y2) / 2;
    return displays.some((l) => x > l.x && x < l.xEnd && y > l.yMin - l.size * 1.6 && y < l.yMax + l.size * 1.6);
  };
  const em = ctx.bodySize;
  const byGraphic = (s: Segment) =>
    missed!.graphics.some((g) => s.box!.x1 < g.x2 + em && s.box!.x2 > g.x1 - em && s.box!.y1 < g.y2 + em && s.box!.y2 > g.y1 - em);
  const formulaPart = (s: Segment, words: number) => {
    if (s.type !== "PARAGRAPH" || s.region || !s.box || BULLET_RE.test(s.text) || CAPTION_RE.test(s.text) || byGraphic(s)) return false;
    const outside = wordsOutside(s.text, s.runs ?? []);
    return (outside.match(/\p{Script=Latin}{3,}/gu) ?? []).length <= words && tableValues(outside, s.text) < 2;
  };
  const isMissed = (s: Segment) =>
    missed !== undefined && formulaPart(s, 1) && isMathSegment(s, ctx) && (s.mathShare ?? 0) >= 0.25 && RELATION_RE.test(s.text) && !inDisplay(s);
  const part = (s: Segment) => isEquationShaped(s, ctx) && (!missed || formulaPart(s, 2));
  const centered = (s: Segment) => {
    const n = lines.findIndex((l) => l.y >= s.box!.y1 && l.y <= s.box!.y2 && l.x >= s.box!.x1 - 0.5 && l.xEnd <= s.box!.x2 + 0.5);
    const c = n >= 0 ? columnOf(lines, n, ctx) : null;
    const size = s.lineSize ?? ctx.bodySize;
    return c !== null && Number.isFinite(c.right) && s.box!.x1 > c.left + size * 0.5 && Math.abs((s.box!.x1 + s.box!.x2) / 2 - (c.left + c.right) / 2) < size * 1.5;
  };
  const labeled = (s: Segment) => LABEL_RE.test(s.text.trim().split(/\s+/).pop() ?? "");
  // The page's glyphs no line reads, once for all its displays.
  let orphans: Glyph[] | null = null;
  const out: Segment[] = [];
  for (let k = 0; k < segments.length; ) {
    let m = k + 1;
    let start = k;
    // The EQUATION keeps its glyphs' box as a region: a check of the parse,
    // or a later repair, reads the glyphs under it.
    let equation: { latex: string; box: Box } | null = null;
    const line = tex && !missed ? displayOf(segments[k]) : undefined;
    if (line) {
      used.add(line);
      orphans ??= orphanGlyphs(lines, ctx.drawing);
      equation = equationOf(line, orphans, ctx);
    } else if (missed ? !isMissed(segments[k]) : tex || !isMathSegment(segments[k], ctx)) {
      out.push(segments[k]);
      k++;
      continue;
    }
    // A display that stays a crop takes the equation-shaped lines against
    // it: on a TeX page, a part the display's lines left out (a denominator
    // in words) is still in the picture.
    if (!equation) {
      while (
        m < segments.length &&
        ((!tex && isMathSegment(segments[m], ctx)) || isMissed(segments[m]) || part(segments[m])) &&
        !(tex && displayOf(segments[m])) &&
        near(segments[m - 1], segments[m])
      ) {
        m++;
      }
      if (missed && ((!centered(segments[k]) && !segments.slice(k, m).some(labeled)) || segments[m]?.type === "TABLE")) {
        out.push(segments[k]);
        k++;
        continue;
      }
      // Backward over equation-shaped lines already pushed.
      while (out.length > 0 && part(out[out.length - 1]) && near(out[out.length - 1], segments[start])) {
        start = segments.indexOf(out.pop()!);
      }
    }
    const group = segments.slice(start, m);
    let box = group[0].box!;
    for (const g of group) box = unionBox(box, g.box!);
    const size = group[0].lineSize ?? ctx.bodySize;
    // The formula's box on the page: the lines' boxes already carry ascent
    // and descent; a small pad keeps the neighboring prose lines out of it.
    // Subscripts and lowered limits hang under the line box: more room below
    // than above. A big delimiter at the edge reaches past the last glyph's
    // advance: room for it on both sides.
    let crop = { x1: box.x1 - size * 0.8, y1: box.y1 - size * 0.45, x2: box.x2 + size * 0.8, y2: box.y2 - size * 0.1 };
    // The pad never reaches the neighboring text's box: a display set tight
    // over its paragraph cropped the tops of the next line (import compare
    // loop finding).
    const above = out[out.length - 1];
    const below = segments[m];
    // A missed display whose lines a block beside it overlaps (its
    // numerators read into the paragraph over it) has no clean crop: its
    // words stay (Grinstead–Snell p. 246).
    const tangled = (s?: Segment) =>
      s?.box !== undefined && s.page === group[0].page && s.box.x1 < box.x2 && s.box.x2 > box.x1 && s.box.y1 < box.y2 - size * 0.3 && s.box.y2 > box.y1 + size * 0.3;
    if (missed && (tangled(above) || tangled(below))) {
      out.push(...segments.slice(start, k + 1));
      k++;
      continue;
    }
    if (above?.box && above.page === group[0].page && above.box.y1 > crop.y1) crop = { ...crop, y2: Math.min(crop.y2, above.box.y1 - 1) };
    if (below?.box && below.page === group[0].page && below.box.y2 < crop.y2) crop = { ...crop, y1: Math.max(crop.y1, below.box.y2 + 1) };
    if (equation) {
      out.push({
        type: "EQUATION",
        text: equation.latex,
        page: group[0].page,
        box,
        region: regionOf(equation.box, pageWidth, pageHeight),
        lineSize: size,
        mathShare: 1,
      });
    } else {
      out.push({
        type: "FIGURE",
        text: group
          .map((g) => g.text.replace(/[\t\n]+/g, " "))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
        page: group[0].page,
        box: crop,
        region: regionOf(crop, pageWidth, pageHeight),
        lineSize: group[0].lineSize,
        mathShare: 1,
      });
    }
    k = m;
  }
  return out;
}

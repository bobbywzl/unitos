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
import { isUnreadMath, sameFlags } from "@/lib/parse/pdf/glyphs";
import { regionOf, unionBox } from "@/lib/parse/pdf/geometry";
import { ATTACH_PUNCT_RE, spaceGap } from "@/lib/parse/pdf/lines";
import { drawnBulletAt } from "@/lib/parse/pdf/lists";
import { BULLET_RE } from "@/lib/parse/pdf/markers";
import { layoutLatex } from "@/lib/parse/pdf/math/check";
import { braceLabelBoxes, drawnBraces, framesOf, hangingFamily, hangingGlyph, LIMIT_OPS } from "@/lib/parse/pdf/math/layout";
import { mathGlyph } from "@/lib/parse/pdf/math-fonts";
import { balanced, onOtherLine, orphanGlyphs, paintsRule, resolveZone } from "@/lib/parse/pdf/math/zones";
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
// Operator names, and the words a display sets in text (\text{if}).
const OPERATOR_NAMES = new Set([
  "lim", "sup", "inf", "max", "min", "limsup", "liminf", "log", "ln", "lg", "exp", "sin", "cos", "tan", "cot", "sec",
  "csc", "sinh", "cosh", "tanh", "arcsin", "arccos", "arctan", "det", "mod", "dim", "ker", "deg", "gcd", "hom", "arg",
  "pr", "var", "cov", "tr", "sgn", "diag", "rank", "span", "supp",
]);
const MATH_WORDS = new Set([...OPERATOR_NAMES, "if", "and", "or", "for", "all", "otherwise", "where", "with", "in", "on", "as", "then", "else"]);

// A formula's relations and operators: a display states or applies one.
const RELATION_RE = /[=<>≤≥≈∼≃≅≡≠∝≪≫≺≻→←↔⇒⇐⇔⟶⟹⟺↦∈∉∋⊂⊆⊃⊇∑∏∫∮⋀⋁⋃⋂+×∪∩⊕⊗∧∨]/;
// A display's next row opens with its relation or its operator.
const CONTINUES_RE = /^(:=|[=<>≤≥≈∼≃≅≡≠∝≪≫⇒⇔⟹⟺+−-])/;

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

// A line's words outside its formulas: its words of prose (not a math
// word of a set-in line or of one that opens with its formula, not a name
// of two or three capitals), and their letters against its formulas'.
function wordsOf(line: Line, column: { left: number; right: number }) {
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
  // A word of two or three capitals is a formula's name for a thing set in
  // roman (the outcome "HH" in m(HH)), not a word of prose.
  // Words a display sets in text ("otherwise") are its own when the line is
  // set in, or opens with its formula (a row of an aligned display at the
  // column's edge: "G = 2(b − 1)(…) for b ≤ N/2,", arXiv 2502.02648 (A1));
  // opening the line at the column's edge they open a sentence ("If sec_M
  // ≥ −K, then").
  const first = text.match(/\S/)?.index;
  const opens = first !== undefined && inZone[first] === 1;
  // A citation or a sentence's start ("… for b ≪ N [65]. For b = cN,") is
  // prose's: its words are no display's.
  // So is a line that opens with a word ("and if n = 2m + 1, then"), an
  // operator's name aside ("inf … := …"); one that opens with its formula
  // keeps its words ("−∞, otherwise," a cases row).
  const opening = opens ? "" : (/^\s*(\p{L}+)/u.exec(outside)?.[1] ?? "");
  const prose = /\[\d+(?:\s*[,–-]\s*\d+)*\]|[.?!]\s+\p{Lu}\p{Ll}/u.test(outside) || (opening.length >= 2 && !OPERATOR_NAMES.has(opening.toLowerCase()));
  const exempt = (w: string) => !prose && (x > column.left + line.size * 1.5 || opens) && MATH_WORDS.has(w.toLowerCase());
  const all = outside.match(/\p{L}+/gu) ?? [];
  const words = all.filter((w) => w.length >= 2 && !exempt(w) && !/^\p{Lu}{2,3}$/u.test(w));
  // A formula's name set in capitals (\mathrm{GOE} over a 𝒦) is no prose.
  const letters = all.filter((w) => !exempt(w) && !/^\p{Lu}{2,3}$/u.test(w)).join("").length;
  return { x, xEnd, text, label, outside, zoneChars, words, letters, opens };
}

const CONTENTS_TAIL_RE = /(?:\s*\.){5,}\s*\d{1,4}\s*$/;
function kindOf(line: Line, ctx: PageContext, column: { left: number; right: number }, fenced: boolean): LineKind {
  if (LABEL_RE.test(line.text.trim()) || QED_RE.test(line.text.trim())) return "label";
  const { x, xEnd, text, label, outside, zoneChars, words, letters, opens } = wordsOf(line, column);
  // A list item is an item, whatever its math (census class 1: items (b)–(d)
  // of an exercise became one page picture), its bullet a math glyph too
  // ("•x₀xᵢ where …", arXiv 2410.04586 p. 12). A marker a formula took is
  // the formula's: "(Mu)" opening a display is no item "(a)".
  if ((BULLET_RE.test(text) && !opens) || /^\s*[•▪◦‣●]/.test(text)) return "text";
  // So is a line with a bullet the page draws left of it (parse loop
  // finding: the MML book's "▪ λ(BC) = (λB)C = …, B ∈ R^{m×n}" read as a
  // display's second row, and the item's formulas were a crop).
  if (drawnBulletAt(line, ctx, 0.65, true) !== null) return "text";
  // A caption is text, whatever its math (parse loop finding: The Art of
  // Linear Algebra's "Figure 16: S = QΛQᵀ" read as an equation).
  if (CAPTION_RE.test(text.trim())) return "text";
  // So is a contents entry, its leader dots run to its page number (parse
  // loop finding: The Art of Linear Algebra's "6.1 A = CR . . . . 6" to
  // "6.5 A = UΣVᵀ . . . . 9" joined as one display's rows).
  if (CONTENTS_TAIL_RE.test(line.text)) return "text";
  const glyphs = line.items.flatMap((i) => i.glyphs ?? []);
  // A big operator of a display's size, taller than a line and a half (an
  // integral with limits of two levels, IEEE Access p. 9), stands in a
  // display's row: its words are the row's ("p(x) dx").
  const tall = glyphs.some((g) => {
    const box = hangingGlyph(g);
    return box?.display === true && box.top - box.bottom > ctx.bodySize * 1.5;
  });
  if (tall && !label && words.length <= 2) return "math";
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
  // A matrix's row of numbers alone, set in TeX's fonts between its tall
  // delimiters, is the matrix's: its digits are no formula's zone (parse
  // loop finding: the MML book's augmented matrix [1 0 2 0 | 1 0 0 0]
  // read its rows as a table's, apart from its brackets).
  if (fenced && /\d/.test(text) && /^[\d\s.,−+-]+$/.test(text) && glyphs.every((g) => g.family !== null)) return "math";
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

// A line of a sentence is prose, whatever its math: a display is centered
// in its column, labeled, or held by tall delimiters. The line opens with
// a word of the text and holds another or ends a sentence ("case p =
// 2/3."), and it starts at the text's own edge (the column's, a
// paragraph's indent, an item's) or nearer the column's left edge than its
// right; or it goes on from a full line of prose over it, starting where
// that line starts. arXiv 2302.12627 p. 6: "For any 𝒮m ⊆ 𝒮̂, define 𝒰 =
// 𝒮mc ∩ 𝒮̂ and" was a crop; pp. 8–9: "where Bn = {…} and" a display of
// \textit words; Grinstead–Snell: an exercise's last line, "D(X).", a
// display.
function isProseLine(lines: Line[], n: number, kinds: LineKind[], columns: { left: number; right: number }[], ctx: PageContext): boolean {
  const line = lines[n];
  const column = columns[n];
  const { x, xEnd, runs, text, label } = unlabeled(line);
  if (label || !Number.isFinite(column.right)) return false;
  const size = line.size;
  if (x > column.left + size * 0.5 && Math.abs((x + xEnd) / 2 - (column.left + column.right) / 2) < size * 1.5) return false;
  const above = lines.slice(0, n).findLast((o) => o.y > line.y && o.x < line.xEnd && o.xEnd > line.x);
  if (
    above !== undefined &&
    kinds[lines.indexOf(above)] === "text" &&
    Math.abs(above.x - x) < 1 &&
    column.right - above.xEnd < size &&
    above.y - line.y < ctx.bodySize * ctx.leading * 1.4
  ) {
    return true;
  }
  const outside = wordsOutside(text, runs);
  const words = (outside.match(/\p{L}{2,}/gu) ?? []).filter((w) => !OPERATOR_NAMES.has(w.toLowerCase()) && !/^\p{Lu}{2,3}$/u.test(w));
  if (words.length === 0 || !outside.startsWith(words[0])) return false;
  if (words.length < 2 && !/[.,]\s*$/.test(text)) return false;
  return (
    x <= column.left + size * 2 ||
    x - column.left <= column.right - xEnd ||
    lines.some((o, m) => m !== n && Math.abs(m - n) <= 12 && kinds[m] === "text" && o.text.length >= 20 && Math.abs(o.x - x) < 1)
  );
}

// The operator names that take limits ("lim", "max") among an item's
// glyphs: where each stands.
function limitNames(glyphs: Glyph[]): { x1: number; x2: number; y: number; size: number }[] {
  const out: { x1: number; x2: number; y: number; size: number }[] = [];
  for (let k = 0; k < glyphs.length; ) {
    let end = k;
    while (end < glyphs.length && /^[A-Za-z]$/.test(glyphs[end].unicode)) end++;
    if (LIMIT_OPS.has(glyphs.slice(k, end).map((g) => g.unicode).join(""))) {
      out.push({ x1: glyphs[k].x, x2: glyphs[end - 1].x + glyphs[end - 1].w, y: glyphs[k].y, size: glyphs[k].size });
    }
    k = Math.max(end, k + 1);
  }
  return out;
}

// A fragment belongs to the display beside it only when the display holds
// it: a fraction bar between it and one of the display's lines; a big
// operator, brace, or delimiter it
// sits over, under, or beside (a limit, a label under a brace, a matrix
// entry); an operator name it sits under (a limit); or a line of the
// display it sits close under or over, inside the display's width (an
// array's row). A page's first or last line is held by the first three
// only: a page number under a formula is no part of it.
// A brace piece: where it stands (a glyph of TeX's, or the end of a brace
// KaTeX draws).
type Tip = { x: number; y: number; w: number };

function attached(frag: Line, near: Line[], rules: Rule[], edge: boolean, braces: Tip[], display: Line[]): boolean {
  const x1 = frag.x;
  const x2 = frag.xEnd;
  const em = frag.size;
  // A brace's label: the brace's pieces lie between it and a line of the
  // display, across its middle (the text layer may hold no item for them:
  // synth-math-tex (65) lost its "n times"). Nested braces set their labels
  // a brace apart, farther than a fraction's parts.
  const middle = (x1 + x2) / 2;
  const braced = [...near, ...display].some((l) => {
    const tips = braces.filter((g) => g.y > Math.min(l.y, frag.y) && g.y < Math.max(l.y, frag.y));
    return tips.length >= 2 && middle > Math.min(...tips.map((g) => g.x)) && middle < Math.max(...tips.map((g) => g.x + g.w));
  });
  if (braced) return true;
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
  // Each glyph under an operator name that takes limits: Springer's (29)
  // set "x → ±∞" under each "lim" on the page's last line, and the display
  // passed with both bare.
  const names = near.flatMap((l) => l.items.flatMap((item) => limitNames(item.glyphs ?? [])));
  const glyphs = frag.items.flatMap((item) => item.glyphs ?? []);
  const under = (g: Glyph) =>
    names.some((n) => g.x + g.w / 2 > n.x1 - n.size && g.x + g.w / 2 < n.x2 + n.size && n.y - g.y > n.size * 0.3 && n.y - g.y < n.size * 1.3);
  if (glyphs.length > 0 && glyphs.every((g) => g.unicode.trim() === "" || under(g))) return true;
  if (edge) return false;
  // The display's width is all its lines': a limit's second row, wider than
  // its first, stands past the first alone (a subarray's rows align left,
  // and the display passed with the second row left out as words).
  const wide = [...near, ...display].filter((l) => l !== frag);
  const left = Math.min(...wide.map((l) => l.x));
  const right = Math.max(...wide.map((l) => l.xEnd));
  return x1 >= left - em && x2 <= right + em && near.some((l) => Math.abs(l.y - frag.y) < Math.max(em, l.size) * 1.3);
}

// A row of a formula set inside a text line (an inline matrix, cases, an
// array): it sits between the tall delimiters the text line holds, or
// beside its words closer to it than the next line of text would (a
// paragraph's last line, all math, under a line that starts with a
// formula is no row of it; nor is a display's first row under a sentence
// that ends in a formula, arXiv 2410.04586 p. 3). The text line it
// belongs to, or null. join: the text line takes the row into its
// formula, so more must hold: the row holds no words in a text font (a
// table's caption over its rules joined the table's place,
// synth-paper-html), and the text line has words (a table's or a
// figure's place in the text is none).
function inlineHost(line: Line, lines: Line[], kinds: LineKind[], fences: Box[], pitch: number, join: boolean, braces: Tip[], rules: Rule[]): Line | null {
  // A label under an underbrace or over an overbrace of a text line's
  // formula ("n times"), words and all: the formula read without it was
  // wrong. The brace's pieces lie between the two lines, across the
  // label's middle (the text layer may hold no item for them), and the
  // text line reaches over that middle: the other column's line beside a
  // display is no host (arXiv 2411.19946 p. 4: display (6) and its labels
  // ran into the left column's paragraph).
  const middle = (line.x + line.xEnd) / 2;
  const braced = lines.find((t, n) => {
    if (kinds[n] !== "text" || Math.abs(t.y - line.y) > line.size * 2.5 || t.x > middle || t.xEnd < middle) return false;
    const tips = braces.filter((g) => g.y > Math.min(line.y, t.y) && g.y < Math.max(line.y, t.y));
    return tips.length >= 2 && middle > Math.min(...tips.map((g) => g.x)) && middle < Math.max(...tips.map((g) => g.x + g.w));
  });
  if (braced) return braced;
  if (join && line.items.some((i) => !i.zone && (i.str.match(/\p{L}{2,}/gu) ?? []).some((w) => !MATH_WORDS.has(w.toLowerCase())))) return null;
  const text = (t: Line, n: number) => t !== line && kinds[n] === "text" && (!join || (!t.table && t.text.trim() !== ""));
  for (const f of fences) {
    if (line.y > f.y2 || line.y < f.y1) continue;
    // The row starts just inside the delimiter, ends just before it, or
    // runs across it: a row that holds the delimiter's top piece (parse
    // loop finding: the MML book's inline matrices in a list item, "A + B
    // = [a₁₁ + b₁₁ ⋯ a₁ₙ + b₁ₙ; ⋮; …]", their first rows read into the
    // line of prose over them, a crop).
    const across =
      line.x <= f.x1 + 1 &&
      line.xEnd >= f.x2 - 1 &&
      line.items.some((i) => (i.glyphs ?? []).some((g) => g.family === "omx" && g.x >= f.x1 - 1 && g.x + g.w <= f.x2 + 1 && mathGlyph("omx", g.code)?.piece !== undefined));
    if (!((line.x >= f.x2 - 1 && line.x - f.x2 < line.size * 3) || (line.xEnd <= f.x1 + 1 && f.x1 - line.xEnd < line.size * 3) || across)) continue;
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
  // A limit over or under a big operator of a text line, set small and
  // centered on it: a display-size operator hangs past the line's pitch,
  // and its limits stand farther off than a row would (parse loop finding:
  // GeoTopo's "sodass ⋃_{j=1}^{n} U_{i_j} ∪ (X∖A) = X" read "j=1" as a
  // paragraph of its own, its "n" lost).
  const mid = (line.x + line.xEnd) / 2;
  const limitOf = lines.find(
    (t, n) =>
      text(t, n) &&
      line.items.every((i) => i.size <= t.size * 0.85) &&
      t.items.some((i) =>
        (i.glyphs ?? []).some((g) => {
          const box = hangingGlyph(g);
          if (!box?.display || mid < g.x - g.size * 0.3 || mid > g.x + g.w + g.size * 0.3) return false;
          return (line.y < box.bottom && box.bottom - line.y < line.size * 1.6) || (line.y > box.top && line.y - box.top < line.size);
        }),
      ),
  );
  if (limitOf) return limitOf;
  // A fraction's bar on the text line, under or over the whole row, takes
  // the line as far as the row: a line may end in a fraction whose
  // numerator is wider than its denominator, or whose parts both stand off
  // the line (OpenStax's "z = (x − μ)/σ", its numerator a paragraph of its
  // own; TeX's inline \dfrac, both parts lost).
  const bar = (t: Line) =>
    rules.find((r) => r.dir === "h" && Math.abs(r.y1 - t.y) < t.size && r.x1 < t.xEnd + t.size && r.x2 > t.x && r.x1 <= line.x + 1 && r.x2 >= line.xEnd - 1);
  const hosts = lines.filter((t, n) => {
    if (!text(t, n) || Math.abs(t.y - line.y) > Math.min(line.size * 1.6, pitch * 0.9)) return false;
    if ((t.x > line.x + 1 || t.xEnd < line.xEnd - 1) && !bar(t)) return false;
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
    // A text line cut into cells by a gap the rows do not fill is two
    // columns' lines or a table's row, no sentence: its rows stay lines (a
    // two-column page's lines read as a table, arXiv 2502.02648 p. 11). A
    // run-in head's quad is no such gap.
    const x1 = Math.min(...rows.map((r) => r.x));
    const x2 = Math.max(...rows.map((r) => r.xEnd));
    const apart = host.cells.slice(1).some((c) => {
      const from = Math.max(-Infinity, ...host.items.filter((i) => i.x < c.x - 0.5).map((i) => i.x + i.w));
      return c.x - from > host.size * 1.5 && (x2 < from || x1 > c.x);
    });
    if (apart) {
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
    // Runs of rows in one formula of the text line are one formula: two
    // braces' labels side by side ("B = (B∩U₁) ∪ (B∩U₂)" over "=U₁" and
    // "=∅"), each read alone, left the other's label a stray, and the
    // formula failed (parse loop finding: GeoTopo p. 14).
    const zonesOf = (group: Line[]) => {
      const x1 = Math.min(...group.map((r) => r.x));
      const x2 = Math.max(...group.map((r) => r.xEnd));
      return new Set(host.items.filter((i) => i.zone && i.x < x2 + host.size * 0.6 && i.x + i.w > x1 - host.size * 0.6).map((i) => i.zone!));
    };
    for (let g = groups.length - 1; g > 0; g--) {
      const shared = [...zonesOf(groups[g])].some((z) => zonesOf(groups[g - 1]).has(z));
      if (shared) groups.splice(g - 1, 2, [...groups[g - 1], ...groups[g]]);
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
  // A rule under a row is the formula's bar, no underline of its glyphs.
  const mine = (i: Item): Item => ({ ...i, zone, sup: false, sub: false, look: i.look?.underline ? { ...i.look, underline: undefined } : i.look });
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
        if ((k === 0 && (unit.row || prevRow)) || (gap > spaceGap(prev, item, em) && !attach)) cell.text += " ";
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

// A tall delimiter drawn in pieces may put its top piece on a line of its
// own, over the formula it fences, and the line reads as a display of its
// own: it joins the display whose baseline the delimiter spans (arXiv
// 2302.12627 p. 6: the braces of w(𝒮m) = 2{sup … − sup …} were two crops
// of their own over the display's crop). The top piece of a brace left of
// a display stands too far from the display's other lines to join its band,
// and stays a line of text: it joins as well (parse loop finding: MML book
// (2.50), (2.55) — "{ x ∈ R⁵ : x = λ₁[…] + λ₂[…] }" read with its closing
// brace alone, and the display was a crop).
function withFencePieces(lines: Line[], fences: Box[]): Line[] {
  const pieceOf = (l: Line): Box | undefined => {
    const glyphs = l.items.flatMap((i) => i.glyphs ?? []).filter((g) => g.unicode.trim() !== "" || g.family !== null);
    if (glyphs.length === 0 || l.items.some((i) => !i.glyphs?.length)) return undefined;
    const pieces = glyphs.every((g) => g.family === "omx" && mathGlyph("omx", g.code)?.piece !== undefined);
    return pieces ? fences.find((f) => glyphs.every((g) => g.x >= f.x1 - 1 && g.x <= f.x2 + 1 && g.y >= f.y1 - g.size && g.y <= f.y2 + g.size)) : undefined;
  };
  const pieces = new Map<Line, Line[]>();
  const taken = new Set<Line>();
  for (const l of lines) {
    const fence = pieceOf(l);
    if (!fence) continue;
    const middle = (fence.y1 + fence.y2) / 2;
    const host = lines
      .filter((h) => h !== l && h.display && pieceOf(h) === undefined && h.y > fence.y1 && h.y < fence.y2 && h.x - h.size <= fence.x1 && fence.x2 <= h.xEnd + h.size)
      .sort((a, b) => Math.abs(a.y - middle) - Math.abs(b.y - middle))[0];
    if (!host) continue;
    pieces.set(host, [...(pieces.get(host) ?? []), l]);
    taken.add(l);
  }
  if (taken.size === 0) return lines;
  return lines.filter((l) => !taken.has(l)).map((l) => (pieces.has(l) ? withPieces(l, pieces.get(l)!) : l));
}

// A line with the pieces' lines added: each piece a cell at its place
// among the line's cells, its runs with it.
function withPieces(host: Line, pieces: Line[]): Line {
  const cells = [...host.cells, ...pieces.flatMap((p) => p.cells)].sort((a, b) => a.x - b.x);
  let text = "";
  const runs: Run[] = [];
  for (const [n, cell] of cells.entries()) {
    if (n > 0) text += "\t";
    const offset = text.length;
    text += cell.text;
    for (const r of cell.runs) runs.push({ ...r, start: r.start + offset, end: r.end + offset });
  }
  const all = [host, ...pieces];
  return {
    ...host,
    cells,
    text,
    runs,
    items: all.flatMap((l) => l.items).sort((a, b) => a.x - b.x),
    x: Math.min(...all.map((l) => l.x)),
    xEnd: Math.max(...all.map((l) => l.xEnd)),
    mathChars: all.reduce((n, l) => n + l.mathChars, 0),
    yMin: Math.min(...all.map((l) => l.yMin)),
    yMax: Math.max(...all.map((l) => l.yMax)),
  };
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
  const columns0 = input.map((_, n) => columnOf(input, n, ctx));
  const kinds0 = input.map((l, n) => kindOf(l, ctx, columns0[n], fenced(l)));
  for (let n = 0; n < input.length; n++) if (kinds0[n] === "math" && !fenced(input[n]) && isProseLine(input, n, kinds0, columns0, ctx)) kinds0[n] = "text";
  // The rows of cases: lines that start just right of a tall delimiter a
  // math line ends with, within its height, are the display's, words and
  // all (parse loop finding: ICML's ξ(0, h) ∼ {h^{−1/2}, smooth
  // activations; h^{−1/3}, kinked activations} read its rows as two
  // paragraphs, and the display, its brace open, was a crop).
  const opening = fences.filter((f) =>
    input.some((l, m) => {
      const { xEnd } = unlabeled(l);
      return kinds0[m] === "math" && l.y > f.y1 && l.y < f.y2 && xEnd >= f.x1 && xEnd <= f.x2 + l.size * 0.3;
    }),
  );
  for (let n = 0; n < input.length; n++) {
    const l = input[n];
    if (kinds0[n] !== "text") continue;
    if (opening.some((f) => l.y > f.y1 && l.y < f.y2 && l.x >= f.x2 - l.size * 0.2 && l.x - f.x2 < l.size * 1.5)) kinds0[n] = "math";
  }
  // A line of a lone period stacked under or over a period of a math line,
  // at its x, is the rest of \vdots: LaTeX stacks the text font's periods
  // 4 pt apart, and the lines split the stack (parse loop finding: the MML
  // book's (2.70), x₁ = ∑ … over ⋮ over x_m = ∑ …, read its last dot as
  // text, and the display broke in two at it).
  const dots = (l: Line) => l.items.flatMap((i) => i.glyphs ?? []).filter((g) => g.unicode === ".");
  for (let n = 0; n < input.length; n++) {
    const l = input[n];
    if (kinds0[n] !== "text" || l.text.replace(/\s/g, "") !== "." || dots(l).length !== 1) continue;
    const [d] = dots(l);
    const stacked = input.some(
      (o, m) => m !== n && kinds0[m] !== "text" && dots(o).some((e) => Math.abs(e.x - d.x) < d.size * 0.1 && Math.abs(e.y - d.y) > d.size * 0.2 && Math.abs(e.y - d.y) < d.size * 0.5),
    );
    if (stacked) kinds0[n] = "math";
  }
  // A row of fractions' denominators or numerators is the display's, a short word among
  // them ("dt" of d⟨x⟩/dt, set upright): each of its cells stands under a
  // fraction bar about its width, a numerator over the bar (parse loop
  // finding: Springer p26's "dt  √k₂  √π" read as text, and the display's
  // rows joined it as a sentence's inline rows, apart from its last
  // fraction, a crop).
  // A fraction's parts in words ("number of outcomes favorable to A" over
  // "number of outcomes") are the display's too, each bar on the row of a
  // math line that reaches it (parse loop finding: the probability
  // cheatsheet's P_naive(A) and the thesis's (1.69), p_i = "# codons for
  // amino acid i" over "total # of codons" = n_i/N, read their parts as
  // text lines, and both displays were crops).
  const hbars = ctx.drawing.rules.filter((r) => r.dir === "h");
  const beside = (r: Rule) =>
    input.some((m, k) => kinds0[k] === "math" && Math.abs(m.y - r.y1) < m.size && m.x < r.x2 + m.size * 1.5 && m.xEnd > r.x1 - m.size * 1.5);
  for (let n = 0; n < input.length; n++) {
    const l = input[n];
    const { words } = wordsOf(l, columns0[n]);
    if (kinds0[n] !== "text" || l.cells.length === 0) continue;
    const worded = words.length > 1 || words.some((w) => w.length > 3);
    const ink = l.items.flatMap((i) => i.glyphs ?? []).filter((g) => g.unicode.trim() !== "");
    // Each glyph stands within the span of a bar the line's own size away,
    // a line across the bar from it; a cell may hold two fractions' parts
    // (parse loop finding: the thesis's (1.66), H(1/n, 1/n, …) = −K ∑ 1/n
    // log(1/n), set its numerators "1 1  1  1" in Palatino's digits, a
    // line of text, and the sum's line "∑ⁿ" joined it as its inline row;
    // the display, its ∑ lost, was a crop). A bar is no wider than its
    // glyphs and four ems. A sign between them is a limit's ("i = 1"
    // under a ∑ on the denominators' baseline), held to no bar.
    const near = hbars.filter(
      (r) =>
        Math.abs(r.y1 - l.y) < l.size * 1.2 &&
        input.some((o) => o !== l && o.y > r.y1 !== l.y > r.y1 && Math.abs(o.y - r.y1) < o.size * 1.2 && o.x < r.x2 && o.xEnd > r.x1),
    );
    const holds = new Map<Rule, Glyph[]>();
    const barred =
      ink.every((g) => {
        const r = near.find((r) => r.x1 <= g.x + l.size * 0.2 && r.x2 >= g.x + g.w - l.size * 0.2);
        if (r) holds.set(r, [...(holds.get(r) ?? []), g]);
        return r !== undefined || /^[=+−<>≤≥]$/.test(g.unicode);
      }) &&
      holds.size > 0 &&
      [...holds].every(
        ([r, own]) =>
          (worded && beside(r)) || r.x2 - r.x1 <= Math.max(...own.map((g) => g.x + g.w)) - Math.min(...own.map((g) => g.x)) + l.size * 4,
      );
    if (barred) kinds0[n] = "math";
  }
  // A row of an aligned display holds words of its own, as many as it
  // likes, in any language: it opens with its relation, at the x of a math
  // row over or under it, a row's pitch away, both set well into the
  // column (three ems or more), where no prose starts (parse loop finding:
  // GeoTopo p19's "⇒ 𝔘 = {U_i | i ∈ I} ∪ {X ∖ A} ist offene Überdeckung
  // von X" and "⟹ es gibt i₁, …, i_n ∈ I, sodass ⋃ U_{i_j} ∪ (X ∖ A) = X"
  // read as paragraphs between the rows of their display).
  for (let grew = true; grew; ) {
    grew = false;
    for (let n = 0; n < input.length; n++) {
      const l = input[n];
      if (kinds0[n] !== "text" || !wordsOf(l, columns0[n]).opens || !/^(?:[=<>≤≥≈∼≃≅≡≠∝≪≫⇒⇔⟹⟺⊆⊂]|:=)/.test(l.text.trim())) continue;
      if (l.x < columns0[n].left + l.size * 3) continue;
      const pitch = Math.max(l.size, ctx.bodySize) * ctx.leading * 1.8;
      // The next row over and under, past the limits of its sums.
      const next = (step: 1 | -1) => {
        let m = n + step;
        while (kinds0[m] === "fragment") m += step;
        return { m, limits: Math.abs(m - n) > 1 };
      };
      const row = [next(-1), next(1)].some(({ m, limits }) => {
        const o = input[m];
        return (
          o !== undefined &&
          kinds0[m] === "math" &&
          Math.abs(o.x - l.x) < 1 &&
          Math.abs(o.y - l.y) < pitch * (limits ? 2 : 1) &&
          /^(?:[=<>≤≥≈∼≃≅≡≠∝≪≫⇒⇔⟹⟺⊆⊂]|:=)/.test(o.text.trim())
        );
      });
      if (!row) continue;
      kinds0[n] = "math";
      grew = true;
    }
  }
  // A label with no math line near it is a display's whose rows read as
  // text: each has a word or two before its formula, the last at the
  // column's edge ("Round M−1: arg min …" over "(7)", arXiv 2411.19946).
  // The lines over the label, a row's space apart, all math but for a
  // word or two, are the display's rows (its limits' lines between them).
  for (let n = 0; n < input.length; n++) {
    if (kinds0[n] !== "label") continue;
    const size = Math.max(input[n].size, ctx.bodySize);
    const near = (m: number) => Math.abs(input[m].y - input[n].y) < size * 2.6;
    if (input.some((_, m) => m !== n && kinds0[m] === "math" && near(m))) continue;
    const rows: number[] = [];
    let edge = input[n];
    for (let m = n - 1; m >= 0; m--) {
      const l = input[m];
      if (l.y - edge.y > size * 1.7 || l.y < edge.y || l.xEnd < input[n].x - size * 40) break;
      if (kinds0[m] === "text") {
        const { zoneChars, words, letters } = wordsOf(l, columns0[m]);
        if (zoneChars === 0 || words.length > 2 || letters > zoneChars) break;
        rows.push(m);
      } else if (kinds0[m] !== "fragment" && kinds0[m] !== "math") break;
      edge = l;
    }
    for (const m of rows) kinds0[m] = "math";
  }
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
  // The rows of an inline structure are the text line's, not a display:
  // they join its formula, or stay lines of text.
  const pitch0 = ctx.bodySize * ctx.leading;
  // The brace pieces: TeX's glyphs, and the ends of the braces KaTeX draws.
  const katex = ctx.drawing.glyphs.some((g) => g.base.startsWith("KaTeX_"));
  const braces: Tip[] = [
    ...ctx.drawing.glyphs.filter((g) => g.family === "omx" && /^hbrace-/.test(mathGlyph("omx", g.code)?.piece ?? "")),
    ...(katex ? drawnBraces(ctx.drawing.paths.filter((p) => !p.clip), ctx.bodySize).flatMap(({ left, right }) => [left, right].map((b) => ({ x: b.x1, y: b.y1, w: b.x2 - b.x1 }))) : []),
  ];
  const bars = ctx.drawing.rules.filter((r) => r.dir === "h");
  // A fraction's parts set in the text font (the Math Guide's −½, its 1
  // and 2 lost): short lines with no words, one over a bar and one under
  // it, each within the bar's span (its glyphs': an item's width may hold
  // the space after it). They are rows too.
  const within = (l: Line, r: Rule) => {
    const ink = l.items.flatMap((i) => i.glyphs ?? []).filter((g) => g.unicode.trim() !== "");
    const x1 = ink.length > 0 ? Math.min(...ink.map((g) => g.x)) : l.x;
    const x2 = ink.length > 0 ? Math.max(...ink.map((g) => g.x + g.w)) : l.xEnd;
    return x1 >= r.x1 - l.size * 0.2 && x2 <= r.x2 + l.size * 0.2;
  };
  const short = (l: Line) => !/\p{L}{2,}/u.test(l.text) && l.text.replace(/\s/g, "").length <= 6;
  const part = (l: Line, n: number) =>
    kinds0[n] === "text" &&
    short(l) &&
    bars.some(
      (r) =>
        within(l, r) &&
        Math.abs(l.y - r.y1) < l.size * 1.2 &&
        input.some((o, m) => m !== n && short(o) && (o.y > r.y1) !== (l.y > r.y1) && Math.abs(o.y - r.y1) < o.size * 1.2 && within(o, r)),
    );
  const row = input.map(
    (l, n) => ((kinds0[n] !== "text" && kinds0[n] !== "label") || part(l, n)) && inlineHost(l, input, kinds0, fences, pitch0, false, braces, bars) !== null,
  );
  const hosts = input.map((l, n) => (row[n] ? inlineHost(l, input, kinds0, fences, pitch0, true, braces, bars) : null));
  for (let n = 0; n < input.length; n++) if (row[n]) kinds0[n] = "text";
  const joined = joinInlineRows(input, hosts, ctx);
  const lines = joined.filter((l): l is Line => l !== null);
  const kinds = kinds0.filter((_, n) => joined[n] !== null);
  const columns = lines.map((l, n) => columnOf(lines, n, ctx));
  // The page's big operators set in a display's size: a tall integral sets
  // its limits over and under it farther apart than a line's pitch (IEEE
  // Access, "∫" with limits of two levels), and its lines are one display.
  const operators = ctx.drawing.glyphs.flatMap((g) => {
    const box = hangingGlyph(g);
    return box?.display && box.top - box.bottom > ctx.bodySize * 1.5 ? [{ x1: g.x, x2: g.x + g.w, ...box }] : [];
  });
  // A line centered under or over such an operator of a math line, a word
  // or two in it, is its limit, words and all ("k odd" under a ∑).
  for (let n = 0; n < lines.length; n++) {
    const l = lines[n];
    if (kinds[n] !== "text" || wordsOf(l, columns[n]).words.length > 2) continue;
    const mid = (l.x + l.xEnd) / 2;
    const limit = operators.some(
      (o) =>
        Math.abs(mid - (o.x1 + o.x2) / 2) < l.size * 0.5 &&
        ((l.y < o.bottom && o.bottom - l.y < l.size * 1.5) || (l.y > o.top && l.y - o.top < l.size)) &&
        lines.some((m, k) => kinds[k] === "math" && m.y < o.top && m.y > o.bottom),
    );
    if (limit) kinds[n] = "fragment";
  }
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
  const about = (l: Line, o: { x1: number; x2: number; top: number; bottom: number }) =>
    l.y > o.bottom - l.size * 2 && l.y < o.top + l.size * 1.8 && l.x < o.x2 + l.size * 6 && l.xEnd > o.x1 - l.size * 6;
  // Of two lines one stands in the operator's row, the other is its limit,
  // in a script's size: a sentence's last line over a display is none.
  const byOperator = (a: Line, b: Line) =>
    operators.some((o) => {
      const row = (l: Line) => l.y > o.bottom && l.y < o.top;
      return about(a, o) && about(b, o) && [a, b].some(row) && [a, b].every((l) => row(l) || l.size < ctx.bodySize * 0.9);
    });
  // A line over or under such an operator, clear of it: one of its limits.
  const limitOf = (l: Line) => operators.some((o) => about(l, o) && (l.y > o.top || l.y < o.bottom));
  // The display's lines around a fragment, over and under it: the lines
  // within an em and a half that are no text, and of the fragments only
  // the band's own (a sentence's inline fraction under a display holds its
  // numerator to its denominator, not to the display).
  const around = (l: Line, band: Line[]) =>
    lines.filter(
      (o, n) => o !== l && kinds[n] !== "text" && (kinds[n] !== "fragment" || band.includes(o)) && Math.abs(o.y - l.y) <= Math.max(o.size, l.size) * 1.6,
    );
  const out: Line[] = [];
  // A row that opens with a relation or an operator ("= …", "+ …") goes on
  // the display over it, however far its sums set the rows apart (such
  // rows read as displays of their own), when the two read as one formula,
  // or when neither reads alone (Springer's rows of a lone "+" stood apart
  // from the crop they end). A row that reads alone
  // under a display that does not stays an equation of its own (arXiv
  // 2410.04586 p. 7: "= ez^e[…]" under a crop of double sums).
  const continues = new Set<Line>();
  let last: { line: Line; band: Line[] } | null = null;
  let orphans: Glyph[] | null = null;
  const reads = (l: Line) => equationOf(l, (orphans ??= orphanGlyphs(lines, ctx.drawing)), ctx) !== null;
  const labeled = (band: Line[]) => band.some((l) => kinds[lines.indexOf(l)] === "label" || unlabeled(l).label !== null);
  let k = 0;
  while (k < lines.length) {
    if (kinds[k] === "text") {
      out.push(lines[k]);
      last = null;
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
      const limit = kinds[j] === "fragment" && prev.y - next.y <= size * 2.2 && attached(next, around(next, band), rules, edge(next), braces, band);
      // Rows a tall delimiter holds are one display, however far apart: each
      // starts just inside it, or runs across it (parse loop finding: The
      // Art of Linear Algebra's A = [a11 a12; …] = [a1 a2] = […], its first
      // row a line of brackets and entries set apart from "A = …", read as
      // two crops).
      const held =
        fences.some((f) =>
          [prev, next].every((l) => l.y >= f.y1 && l.y <= f.y2 && ((l.x >= f.x2 - 1 && l.x - f.x2 < l.size * 3) || (l.x <= f.x1 + 1 && l.xEnd >= f.x2 - 1))),
        ) || byOperator(prev, next);
      // A fragment stands over the next row's far end too (IEEE Access
      // (31): the square of its tall parentheses).
      const ahead = lines.find((l, m) => m > j && kinds[m] === "math" && l.y <= next.y && next.y - l.y <= size * 1.6);
      const span = kinds[j] === "fragment" && ahead ? [...band, ahead] : band;
      const x1 = Math.min(...span.map((l) => l.x));
      const x2 = Math.max(...span.map((l) => l.xEnd));
      if ((prev.y - next.y > size * reach && !limit && !held) || prev.y < next.y) {
        if (kinds[j] === "math" && CONTINUES_RE.test(unlabeled(next).text.trim()) && prev.y - next.y <= size * 3.5 && next.x >= x1 - size) continues.add(next);
        break;
      }
      // A display's lines sit side by side at most a few ems apart (a
      // fraction's numerator beside a big operator); a label at the margin
      // stands farther.
      // So do a matrix's two delimiters, however wide the matrix, when
      // their top pieces are lines of their own (parse loop finding: the MML
      // book's augmented matrix read its "[" as a display apart).
      const inFence = (l: Line, f: Box) => l.y >= f.y1 - l.size && l.y <= f.y2 + l.size && l.x < f.x2 + 1 && l.xEnd > f.x1 - 1;
      const pair = Math.abs(prev.y - next.y) < size * 0.3 && fences.some((f) => inFence(prev, f) && fences.some((g) => g !== f && inFence(next, g) && Math.abs(g.y1 - f.y1) < size && Math.abs(g.y2 - f.y2) < size));
      // So do two fractions' numerators far apart on one row, when the
      // display's main row under them runs under both (parse loop finding:
      // Springer p26's "d⟨x⟩_b … k₁√D_A" and "2k₁√(D_A t)" split the display
      // in two).
      const far = (l: Line, a: number, b: number) => l.xEnd < a - size * 6 || l.x > b + size * 6;
      const bridged = lines.some(
        (l, m) => m > j && kinds[m] === "math" && next.y - l.y >= 0 && next.y - l.y <= size * 1.6 && !far(l, x1, x2) && l.x <= next.xEnd && l.xEnd >= next.x,
      );
      if (kinds[j] !== "label" && !pair && !bridged && far(next, x1, x2) && !band.every((l) => kinds[lines.indexOf(l)] === "label")) break;
      const label = kinds[j] === "label" || unlabeled(next).label !== null ? 1 : 0;
      if (labels + label > 1) {
        // The numerators of the next display's fractions stand closer to the
        // display over it than a display's own rows do, and the band took
        // them: a line just over a fraction bar of the next display, and
        // under none of its own, goes back to it (parse loop finding:
        // Springer's (27) and (28), ∂a/∂t = … over ∂b/∂t = …, read as a
        // display ending in its neighbor's numerators and a display of bare
        // denominators, two crops).
        // So do the scripts of the next display's big operators: glyphs
        // within an operator's height, just right of it, on its row, and
        // beside none of the band's (parse loop finding: ICML's (36) sets
        // its integrals' upper limits 8 pt under (35)'s, which took them,
        // and both displays were crops). So do the rows of the next display's
        // matrices: a line its tall delimiters hold with it and with none of
        // the band's other lines (parse loop finding: the MML book's (2.34b),
        // its label read apart from (2.34a)'s, gave its matrices' first row
        // to (2.34a), and both displays were crops).
        const spans = (o: (typeof operators)[number], l: Line) => l.y < o.top && l.y > o.bottom;
        const nextOps = operators.filter((o) => spans(o, next));
        const bandOps = operators.filter((o) => band.some((l) => kinds[lines.indexOf(l)] !== "fragment" && spans(o, l)));
        const scriptOf = (f: Line) => {
          const ink = f.items.flatMap((i) => i.glyphs ?? []).filter((g) => g.unicode.trim() !== "");
          const beside = (g: Glyph, o: (typeof operators)[number]) => g.y < o.top && g.y > o.bottom && g.x >= o.x1 && g.x - o.x2 < f.size * 1.5;
          return ink.length > 0 && ink.every((g) => nextOps.some((o) => beside(g, o)) && !bandOps.some((o) => g.y < o.top + f.size * 0.3 && g.y > o.bottom - f.size * 0.3));
        };
        while (band.length > 1) {
          const f = band[band.length - 1];
          const kind = kinds[lines.indexOf(f)];
          if ((kind !== "fragment" && kind !== "math") || unlabeled(f).label !== null) break;
          const bar = (r: Rule) => r.dir === "h" && r.x1 < f.xEnd && r.x2 > f.x && Math.abs(r.y1 - f.y) < f.size * 1.2;
          const script = kind === "fragment" && scriptOf(f);
          const fencedNext = fences.some(
            (g) => [f, next].every((l) => l.y >= g.y1 && l.y <= g.y2 && l.x < g.x2 + l.size * 3 && l.xEnd > g.x1 - l.size * 3) && !band.some((l) => l !== f && l.y >= g.y1 && l.y <= g.y2),
          );
          if (!script && !fencedNext && (!rules.some((r) => bar(r) && r.y1 < f.y && r.y1 > next.y) || rules.some((r) => bar(r) && r.y1 > f.y))) break;
          band.pop();
        }
        break;
      }
      // A fragment between two math lines of the display stays in it (an
      // aligned row's lone "=" over its fraction's denominator).
      const after = lines[j + 1];
      const between = after !== undefined && kinds[j + 1] === "math" && next.y - after.y <= size * 1.6 && next.y < prev.y;
      if (kinds[j] === "fragment" && !between && !limitOf(next) && !attached(next, around(next, band), rules, edge(next), braces, band)) break;
      labels += label;
      band.push(next);
    }
    // A limit of an operator whose row the band did not take is that row's
    // (IEEE Access (31): the next row's "+∞" read as a sum's second limit).
    // One that is also a limit of an operator of the band's is the band's
    // (a display's limit over the next display's operator).
    const rowIn = (o: (typeof operators)[number]) => band.some((l) => about(l, o) && l.y < o.top && l.y > o.bottom);
    while (band.length > 1 && kinds[lines.indexOf(band[band.length - 1])] === "fragment") {
      const l = band[band.length - 1];
      const ops = operators.filter((o) => about(l, o) && (l.y > o.top || l.y < o.bottom));
      if (ops.length === 0 || ops.some(rowIn)) break;
      band.pop();
    }
    // A fragment that opened the band holds only if the band holds it.
    while (band.length > 1 && kinds[lines.indexOf(band[0])] === "fragment" && !attached(band[0], around(band[0], band), rules, edge(band[0]), braces, band)) {
      out.push(band.shift()!);
      last = null;
      k++;
    }
    const kindIn = (l: Line) => kinds[lines.indexOf(l)];
    const set = (l: Line) => unlabeled(l).x > columns[lines.indexOf(l)].left + l.size * 1.5;
    // A display line alone stands apart from the text: centered in its
    // column, or set in with more than a line's space over or under it. A
    // list item's second line and a paragraph's last line are neither,
    // whatever their math (synthetic notes p. 4–5: "∑ c_k P(A_k)." ending a
    // sentence, an item's "then EX_n → EX").
    // A proof's end mark at the margin is no part of the row it ends:
    // with it, a row of a proof's chain at the text's edge ran to the
    // margin and read as centered (parse loop finding: GeoTopo p13's "⇒
    // 𝔅δ(x) ⊆ f⁻¹(…) ⊆ f⁻¹(U)  ■" read as an equation tagged ■ under
    // its rows of text).
    const centered = (l: Line) => {
      const { x, xEnd: end } = unlabeled(l);
      const items = l.items.filter((i) => i.str.trim() !== "").sort((p, q) => p.x - q.x);
      const mark = items.length > 1 && QED_RE.test(items[items.length - 1].str.trim()) ? items[items.length - 1] : null;
      const rest = items.slice(0, -1);
      const xEnd = mark && mark.x - Math.max(...rest.map((i) => i.x + i.w)) > l.size * 2 ? Math.max(...rest.map((i) => i.x + i.w)) : end;
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
    // A display too wide to center starts at the column's edge, all math,
    // with the display's space over and under it (a proof's chain of
    // equalities read as a paragraph's line of inline formulas).
    const wide = (l: Line) => {
      const c = columns[lines.indexOf(l)];
      if (!Number.isFinite(c.right) || l.xEnd - l.x < (c.right - c.left) * 0.6) return false;
      const same = lines.filter((o) => o !== l && o.x < l.xEnd && o.xEnd > l.x);
      const above = same.filter((o) => o.y > l.y).sort((a, b) => a.y - b.y)[0];
      const below = same.filter((o) => o.y < l.y).sort((a, b) => b.y - a.y)[0];
      const { text, runs } = unlabeled(l);
      const words = (wordsOutside(text, runs).match(/\p{L}{2,}/gu) ?? []).filter((w) => !MATH_WORDS.has(w.toLowerCase()));
      return words.length === 0 && above !== undefined && below !== undefined && above.y - l.y > pitch * 1.25 && l.y - below.y > pitch * 1.25;
    };
    const alone = (l: Line) => spaced(l) && (centered(l) || (set(l) && detached(l)) || wide(l));
    // Rows of math with no label, each starting where the line of text
    // right over them starts and none centered, are lines of that text: an
    // item's formulas, one to a line. A display stands centered or set in
    // (parse loop finding: the MML book's "Distributivity:" over "(λ+ψ)C =
    // λC + ψC, C ∈ R^{m×n}" and "λ(B+C) = λB + λC, …" was a crop).
    const top = band[0];
    const over = lines
      .filter((o, m) => kinds[m] === "text" && o.y > top.y && o.x < top.xEnd && o.xEnd > top.x)
      .sort((a, b) => a.y - b.y)[0];
    const flush =
      labels === 0 &&
      over !== undefined &&
      over.y - top.y < pitch * 1.6 &&
      band.every((l) => kindIn(l) === "math" && Math.abs(l.x - over.x) < 1 && !centered(l));
    // A formula with words of prose beside it, set in at the text's edge
    // (an item's indent, a proof's), that reads as no display is a line of
    // the text: its formulas read inline. A display stands centered or
    // labeled (parse loop finding: GeoTopo's "a) f heißt stetig :⇔ ∀U ∈
    // 𝔗_Y : f⁻¹(U) ∈ 𝔗_X." and "„⇐“: Sei U ⊆ Y offen, …" were crops).
    const worded =
      labels === 0 &&
      band.some((l) => kindIn(l) === "math" && wordsOf(l, columns[lines.indexOf(l)]).words.some((w) => /^\p{L}{3,}$/u.test(w))) &&
      !band.some(centered) &&
      !reads(join(band));
    const math = !flush && !worded && band.some((l) => kindIn(l) === "math" && (labels > 0 || band.length > 1 || alone(l)));
    // A band of small lines alone is no display (a figure's labels over
    // the rules of its drawing, arXiv 2411.19946 pp. 1, 3): a display has
    // glyphs at the text's size.
    const bar =
      band.length > 1 &&
      band.some((l) => kindIn(l) === "fragment") &&
      band.some((l) => l.items.some((i) => i.size >= ctx.bodySize * 0.85)) &&
      (labels > 0 || band.some(set)) &&
      rules.some((r) => r.dir === "h" && band.some((a) => band.some((b) => r.y1 < a.y && r.y1 > b.y && r.x1 < a.xEnd && r.x2 > a.x)));
    k += band.length;
    if (last && continues.has(band[0]) && !(labeled(last.band) && labeled(band))) {
      const whole = join([...last.band, ...band]);
      if (reads(whole) || (!reads(last.line) && !reads(join(band)))) {
        out[out.length - 1] = whole;
        last = { line: whole, band: [...last.band, ...band] };
        continue;
      }
    }
    // A row whose relation stands under the relation of the display over
    // it, a few lines under it, is that display's next row (eqnarray's and
    // align's rows, their = in one column: arXiv 2302.12627 p. 6 read Θ₀ = …
    // and Θ₁ = … as two displays), when the two read as one formula.
    if (last && (math || bar) && !(labeled(last.band) && labeled(band)) && relationsAligned(last.band, band, ctx)) {
      const whole = join([...last.band, ...band]);
      if (reads(whole)) {
        out[out.length - 1] = whole;
        last = { line: whole, band: [...last.band, ...band] };
        continue;
      }
    }
    if (math || bar) {
      const line = join(band);
      out.push(line);
      last = { line, band };
    } else {
      out.push(...band);
      last = null;
    }
  }
  return withFencePieces(out, fences);
}

// Two displays' rows, one under the other a few lines apart, whose first
// relations at the text's size start or center at one x (eqnarray centers
// its middle column: "=" over "⟶").
function relationsAligned(upper: Line[], lower: Line[], ctx: PageContext): boolean {
  const relation = (band: Line[]) => {
    const size = Math.max(...band.map((l) => l.size));
    return band
      .flatMap((l) => l.items.flatMap((i) => i.glyphs ?? []))
      .filter((g) => g.size >= size * 0.9 && g.family !== null && mathGlyph(g.family, g.code)?.cls === "rel")
      .sort((a, b) => a.x - b.x)[0];
  };
  const a = relation(upper);
  const b = relation(lower);
  if (!a || !b || Math.abs(a.size - b.size) > 0.5 || (Math.abs(a.x - b.x) > 1 && Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)) > 1)) return false;
  const bottom = Math.min(...upper.map((l) => l.y));
  const top = Math.max(...lower.map((l) => l.y));
  return top < bottom && bottom - top < Math.max(ctx.bodySize, a.size) * 3.5;
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
function isEquationShaped(s: Segment, ctx: PageContext, columnLeft: number): boolean {
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
  const deep = !BULLET_RE.test(s.text) && s.box.x1 > columnLeft + size * 6;
  return (
    s.text.length <= 60 &&
    s.box.x1 > columnLeft + 2 &&
    (mathOrFragment || deep) &&
    (size <= ctx.bodySize * 1.1 || bigOperator)
  );
}

// The formula's glyphs: the glyphs of its display line, and the glyphs no
// item reads (a placed accent, a composite's second half: the page's
// orphans) inside its box, less a label at either end a quad or more apart
// (its \tag, or \tag* for a proof's end mark; left: the page sets it at the
// left margin, as amsbook does). null when an item holds text the drawing
// has no glyph for (the check could not see it).
function formulaGlyphs(line: Line, pageOrphans: Glyph[], page: Glyph[], lines: Line[]): { glyphs: Glyph[]; label: string | null; labelGlyphs: Glyph[]; left: boolean } | null {
  if (line.items.some((i) => !i.glyphs?.length)) return null;
  const top = line.yMax + line.size * 1.2;
  const bottom = line.yMin - line.size * 0.6;
  const own = new Set(line.items.flatMap((i) => i.glyphs ?? []));
  // A composite's second half drawn from the origin of a glyph another line
  // reads is that line's: the arrowhead of a ↦ in the sentence over a
  // display (arXiv 2506.08494 (2.23) took it as a row).
  const elsewhere = (g: Glyph) =>
    page.some((h) => h !== g && !own.has(h) && !pageOrphans.includes(h) && Math.abs(h.x - g.x) < g.size * 0.12 && Math.abs(h.y - g.y) < g.size * 0.05);
  // An orphan on another line's baseline is that line's (resolveZones).
  // So is a limit under or over one of the line's operators, past the
  // line's reach: a text-size ∑ with its limit set under it (\sum\limits)
  // hangs it more than half a line down (the probability cheatsheet's
  // E(X) = ∑ᵢ xᵢP(X = xᵢ) lost its i, and was a crop).
  const ops = line.items.flatMap((i) => i.glyphs ?? []).flatMap((g) => {
    const h = hangingGlyph(g);
    return h && g.family === "omx" && mathGlyph("omx", g.code)?.cls === "op" ? [{ x1: g.x, x2: g.x + g.w, ...h }] : [];
  });
  const limit = (g: Glyph) =>
    ops.some((o) => g.x + g.w / 2 > o.x1 && g.x + g.w / 2 < o.x2 && ((g.y < o.bottom && g.y > o.bottom - line.size) || (g.y > o.top && g.y < o.top + line.size * 0.6)));
  const orphans = pageOrphans.filter(
    (g) => g.x + g.w / 2 > line.x && g.x + g.w / 2 < line.xEnd && ((g.y >= bottom && g.y <= top) || limit(g)) && !elsewhere(g) && !onOtherLine(g, line, lines),
  );
  // A blank glyph is no symbol (KaTeX sets struts as spaces a point high).
  const glyphs = [...line.items.flatMap((i) => i.glyphs!), ...orphans].filter((g) => g.family !== null || g.unicode.trim() !== "").sort((a, b) => a.x - b.x);
  if (glyphs.length === 0) return null;
  const size = Math.max(...glyphs.map((g) => g.size));
  // A label: the glyphs at an end that read "(…)", a quad or more from the
  // rest of its row. A display's other rows may reach past its start (IEEE
  // Access (28): "(28)" on the last of seven rows).
  const labelAt = (from: number, dir: 1 | -1): { glyphs: Glyph[]; text: string } | null => {
    const run: Glyph[] = [];
    const onRow = (g: Glyph) => glyphs[from] !== undefined && Math.abs(g.y - glyphs[from].y) < size * 0.3;
    for (let k = from; k >= 0 && k < glyphs.length; k += dir) {
      const g = glyphs[k];
      if (!onRow(g)) continue;
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
    const row = rest.filter(onRow);
    if (row.length === 0) return { glyphs: run, text };
    const gap =
      dir > 0
        ? Math.min(...row.map((g) => g.x)) - Math.max(...run.map((g) => g.x + g.w))
        : Math.min(...run.map((g) => g.x)) - Math.max(...row.map((g) => g.x + g.w));
    // amsmath sets a label half a quad at least from a wide formula
    // (\mintagsep): a label set 0.79 em left of a display with cases read
    // into the formula as its first words.
    return gap >= size * 0.5 ? { glyphs: run, text } : null;
  };
  // A label on a row of its own may reach under the formula's last glyphs
  // (both end at the margin): the lowest row, or the highest for a left
  // label, alone reads "(…)" at the text's size, at the formula's end
  // (arXiv 2506.06752 (4)). A script is smaller: p_{13}^{(2)} is no label.
  const rowAt = (dir: 1 | -1): { glyphs: Glyph[]; text: string } | null => {
    const edge = dir < 0 ? Math.min(...glyphs.map((g) => g.y)) : Math.max(...glyphs.map((g) => g.y));
    const run = glyphs.filter((g) => Math.abs(g.y - edge) < size * 0.1);
    const rest = glyphs.filter((g) => !run.includes(g));
    if (run.length > 8 || rest.length === 0 || run.some((g) => g.size < size * 0.9)) return null;
    if (dir < 0 ? edge > Math.min(...rest.map((g) => g.y)) - size * 0.5 : edge < Math.max(...rest.map((g) => g.y)) + size * 0.5) return null;
    const x1 = Math.min(...run.map((g) => g.x));
    const x2 = Math.max(...run.map((g) => g.x + g.w));
    if (dir < 0 ? x2 < Math.max(...rest.map((g) => g.x + g.w)) - size : x1 > Math.min(...rest.map((g) => g.x)) + size) return null;
    const text = run.map((g) => (g.family ? mathGlyph(g.family, g.code)?.unicode : undefined) ?? g.unicode).join("");
    return LABEL_RE.test(text) ? { glyphs: run, text } : null;
  };
  const right = labelAt(glyphs.length - 1, -1) ?? rowAt(-1);
  const label = right ?? labelAt(0, 1) ?? rowAt(1);
  if (!label) return { glyphs, label: null, labelGlyphs: [], left: false };
  const tag = QED_RE.test(label.text) ? `\\tag*{$${label.text === "□" ? "\\square" : "\\blacksquare"}$}` : `\\tag{${label.text.slice(1, -1)}}`;
  return { glyphs: glyphs.filter((g) => !label.glyphs.includes(g)), label: tag, labelGlyphs: label.glyphs, left: right === null };
}

// The equation's LaTeX with its label as \tag, and the box of its glyphs
// (their drawn extent, the label's included): padded for the crop, and as
// drawn (glyphBox: the display's space above and below is measured to it);
// null when the check fails.
function equationOf(line: Line, orphans: Glyph[], ctx: PageContext, lines: Line[] = []): { latex: string; box: Box; glyphBox: Box; left: boolean } | null {
  const found = formulaGlyphs(line, orphans, ctx.drawing.glyphs, lines);
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
  // A frame around the formula or a part of it (\boxed) stands its padding
  // out from the glyphs: its four rules are the formula's when it holds
  // some of them (layout.ts reads it).
  for (const f of framesOf(ctx.drawing.rules, size * 0.15)) {
    const x1 = f.left.x1;
    const x2 = f.right.x1;
    const y1 = Math.min(f.left.y1, f.left.y2);
    const y2 = Math.max(f.left.y1, f.left.y2);
    if (y2 - y1 > high - low + size * 2 || !glyphs.some((g) => g.x + g.w / 2 > x1 && g.x + g.w / 2 < x2 && g.y > y1 && g.y < y2)) continue;
    for (const r of [f.left, f.right, f.top, f.bottom]) if (!rules.includes(r)) rules.push(r);
    // So is every horizontal rule inside it: a fraction bar may reach past
    // the glyphs' extent by more than the pad (the CS 229 probability
    // refresher's ρ_{XY} = σ²_{XY}/(σ_Xσ_Y), its bar 2.03 pt past them).
    for (const r of ctx.drawing.rules) if (r.dir === "h" && r.x1 > x1 && r.x2 < x2 && r.y1 > y1 && r.y1 < y2 && !rules.includes(r)) rules.push(r);
  }
  const paths = ctx.drawing.paths.filter(
    (b) =>
      !b.clip &&
      b.x1 >= line.x - size * 1.5 &&
      b.x1 < line.xEnd + size * 0.6 &&
      b.x2 <= line.xEnd + size * 1.5 &&
      ((b.y1 >= low - size && b.y2 <= high + size) || (b.x2 - b.x1 < size * 0.6 && b.y2 > low && b.y1 < high)) &&
      !paintsRule(b, ctx.drawing.rules),
  );
  try {
    const { latex, check, atoms } = layoutLatex(glyphs, rules, { display: true, size }, paths);
    // A display cut in two (its operators and an opening bracket on one line,
    // the rest on the next) passes the check on what it has: its brackets
    // do not close. One that ends its sentence is whole: a bracket it leaves
    // open is the page's (arXiv 2411.19946 (5) opens "(sup {|" and closes
    // neither).
    if (!check.ok || !balanced(latex, /\.(\s*\\end\{\w+\})*$/.test(latex))) return null;
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
    // em over the box counts. So may an unread glyph of a math font: the
    // braces of Springer's (12) hang from an em over its first row, which
    // passed without them.
    // A rule at the formula's bottom edge with glyphs just under it is a
    // fraction cut in two: its denominator went to the next line (arXiv
    // 2410.04586 p. 9 read it as an \underline).
    const edges = rules.filter((r) => r.y1 - box.y1 < size * 0.35);
    const past = (g: Glyph) => edges.some((r) => g.x + g.w / 2 > r.x1 && g.x + g.w / 2 < r.x2 && g.y < r.y1 && r.y1 - g.y < size * 1.3);
    const own = new Set(all);
    const labels = braceLabelBoxes(atoms);
    // A glyph of TeX's fonts within an em past the right edge, on the
    // formula's rows, is a part the formula lost: in four displays of arXiv
    // 2506.08494 (pp. 4–7) the closing norm and its subscript stood past the
    // line's last glyph, and each passed without them.
    const beyond = (g: Glyph) => g.family !== null && !g.hidden && g.x + g.w / 2 >= box.x2 && g.x < box.x2 + size && g.y > box.y1 && g.y < box.y2;
    // So is a brace within an em under or over it that it did not read, with
    // the brace's label: display (6) of arXiv 2411.19946 p. 4 sets three
    // braces one under another, and passed with the first alone.
    const brace = (g: Glyph) =>
      g.family === "omx" &&
      /^hbrace-/.test(mathGlyph("omx", g.code)?.piece ?? "") &&
      g.x + g.w / 2 > box.x1 &&
      g.x + g.w / 2 < box.x2 &&
      g.y > box.y1 - size &&
      g.y < box.y2 + size;
    // So is a glyph under or over one of its big operators, where a limit
    // stands: a limit on a line of its own that the display's lines left out
    // (its words set in a text italic, "g′ ∈ fullS(g)") passed with its
    // operators bare, arXiv 2506.06752 (10).
    // So is a glyph under an operator name that takes limits: Springer's
    // (29) passed with its two "lim"s bare.
    const ops = atoms.filter((a) => a.cls === "op" && (a.entry?.display || hangingFamily(a.fam)));
    const names = line.items.flatMap((item) => limitNames(item.glyphs ?? []));
    const limit = (g: Glyph) => {
      const cx = g.x + g.w / 2;
      return (
        g.size < size * 0.85 &&
        (ops.some((op) => cx > op.x1 - size * 0.2 && cx < op.x2 + size * 0.2 && ((g.y < op.bottom && g.y > op.bottom - size * 0.9) || (g.y > op.top && g.y < op.top + size * 0.45))) ||
          names.some((n) => cx > n.x1 - n.size * 0.5 && cx < n.x2 + n.size * 0.5 && g.y < n.y - n.size * 0.3 && g.y > n.y - n.size * 1.3))
      );
    };
    const stray = ctx.drawing.glyphs.some((g) => {
      if (own.has(g) || (g.family === null && g.unicode.trim() === "")) return false;
      if (past(g) || beyond(g) || brace(g) || limit(g)) return true;
      if (labels.some((b) => g.x + g.w / 2 > b.x1 && g.x + g.w / 2 < b.x2 && g.y > b.y1 && g.y < b.y2)) return true;
      if (g.x + g.w / 2 <= box.x1 || g.x + g.w / 2 >= box.x2) return false;
      // A text font's ligature ("ﬁ") is letters: it hangs from nothing (the
      // line over arXiv 2506.06752 (14) failed it).
      const hangs = g.family === null && (isUnreadMath(g) || !/^[\p{Script=Latin}\p{Script=Greek}\p{N}\p{P}]+$/u.test(g.unicode.normalize("NFKC")));
      return g.y >= box.y1 - size * 0.05 && g.y < box.y2 + (hangs ? g.size : 0);
    });
    if (stray) return null;
    const glyphBox = box;
    const pad = size * 0.15;
    box = { x1: box.x1 - pad, y1: box.y1 - pad, x2: box.x2 + pad, y2: box.y2 + pad };
    return { latex: found.label ? `${latex} ${found.label}` : latex, box, glyphBox, left: found.left };
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
  // The left edge of a segment's column: on a page of two columns the
  // page's own left edge is the left column's, and every line of the right
  // one stood "deep" (arXiv 2502.02648 p. 6: "At this time [82]," went
  // into the crop under it).
  const columnLeftOf = (s: Segment) => {
    const box = s.box;
    if (!box) return ctx.columnLeft;
    const n = lines.findIndex((l) => l.y >= box.y1 && l.y <= box.y2 && l.x >= box.x1 - 0.5 && l.xEnd <= box.x2 + 0.5);
    return n >= 0 ? Math.min(columnOf(lines, n, ctx).left, box.x1) : ctx.columnLeft;
  };
  const part = (s: Segment) => isEquationShaped(s, ctx, columnLeftOf(s)) && (!missed || formulaPart(s, 2));
  const centered = (s: Segment) => {
    const n = lines.findIndex((l) => l.y >= s.box!.y1 && l.y <= s.box!.y2 && l.x >= s.box!.x1 - 0.5 && l.xEnd <= s.box!.x2 + 0.5);
    const c = n >= 0 ? columnOf(lines, n, ctx) : null;
    const size = s.lineSize ?? ctx.bodySize;
    return c !== null && Number.isFinite(c.right) && s.box!.x1 > c.left + size * 0.5 && Math.abs((s.box!.x1 + s.box!.x2) / 2 - (c.left + c.right) / 2) < size * 1.5;
  };
  // A printed label ends the display's text, or one of its lines: a matrix
  // sets its label beside its middle row (nps-thesis-2020-shevock (35)).
  const labeled = (s: Segment) =>
    LABEL_RE.test(s.text.trim().split(/\s+/).pop() ?? "") ||
    lines.some((l) => l.y >= s.box!.y1 && l.y <= s.box!.y2 && l.x >= s.box!.x1 - 0.5 && l.xEnd <= s.box!.x2 + 0.5 && unlabeled(l).label !== null);
  // A missed display's rows the page set apart are its own: blocks all in
  // math against it, their boxes touching (Word's 9×9 matrices (31), (32),
  // and (35) of nps-thesis-2020-shevock were half a crop and half a
  // paragraph of bracket pieces). They join its crop, never tangle it.
  const row = (s: Segment) => missed !== undefined && formulaPart(s, 0) && (s.mathShare ?? 0) >= 0.9;
  const against = (a: Segment, b: Segment) => a.box!.y1 - b.box!.y2 < em * 0.5;
  // The page's glyphs no line reads, once for all its displays.
  let orphans: Glyph[] | null = null;
  const out: Segment[] = [];
  for (let k = 0; k < segments.length; ) {
    let m = k + 1;
    let start = k;
    // The EQUATION keeps its glyphs' box as a region: a check of the parse,
    // or a later repair, reads the glyphs under it.
    let equation: { latex: string; box: Box; glyphBox: Box; left: boolean } | null = null;
    const line = tex && !missed ? displayOf(segments[k]) : undefined;
    if (line) {
      used.add(line);
      orphans ??= orphanGlyphs(lines, ctx.drawing);
      equation = equationOf(line, orphans, ctx, lines);
    } else if (missed ? !isMissed(segments[k]) : tex || !isMathSegment(segments[k], ctx)) {
      out.push(segments[k]);
      k++;
      continue;
    }
    // A display that stays a crop takes the equation-shaped lines against
    // it: on a TeX page, a part the display's lines left out (a denominator
    // in words) is still in the picture.
    if (!equation) {
      // Once a row joined, only a block against the last joins: the rows
      // touch, and the next display stands a skip apart.
      let rows = false;
      while (m < segments.length && !(tex && displayOf(segments[m]))) {
        const s = segments[m];
        const loose: boolean = !rows && ((!tex && isMathSegment(s, ctx)) || isMissed(s) || part(s)) && near(segments[m - 1], s);
        if (!loose && !(row(s) && against(segments[m - 1], s))) break;
        rows ||= !loose;
        m++;
      }
      if (missed && ((!centered(segments[k]) && !segments.slice(k, m).some(labeled)) || segments[m]?.type === "TABLE")) {
        out.push(segments[k]);
        k++;
        continue;
      }
      // Backward over equation-shaped lines and rows already pushed.
      while (out.length > 0) {
        const s = out[out.length - 1];
        const loose: boolean = !rows && part(s) && near(s, segments[start]);
        if (!loose && !(row(s) && against(s, segments[start]))) break;
        rows ||= !loose;
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
        glyphBox: equation.glyphBox,
        lineSize: size,
        mathShare: 1,
        // A label the page sets at the left margin (amsbook's leqno): the
        // import draws the \tag there.
        ...(equation.left ? { html: '<p class="leqno"></p>' } : {}),
      });
    } else {
      // Its text is the display's glyphs as the text layer reads them, often
      // garbled: the import shows the crop with no caption (mathCrop).
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
        mathCrop: true,
      });
    }
    k = m;
  }
  return out;
}

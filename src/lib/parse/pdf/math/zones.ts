// Inline math zones (research memo §1.7): which glyphs of a text line are a
// formula. TeX says it by font: math italic letters come from the math
// italic font (text italic from CMTI), math commas and periods from it too,
// a math minus from the symbol font. Digits, + = ( ) and small glyphs join
// the math beside them; a word in a text font ends the formula. A zone is
// cut out of the line's items (an item may hold the end of a formula and
// the start of the next words: "+ 1 = 0 has a superscript"), so its words
// ride through line joins and merges as runs, and its LaTeX comes once the
// page's rules are known (resolveZones).

import type { Glyph, PageDrawing } from "@/lib/parse/pdf/drawing";
import { layoutLatex } from "@/lib/parse/pdf/math/check";
import { mathGlyph } from "@/lib/parse/pdf/math-fonts";
import type { Item, Line, MathZone, Run } from "@/lib/parse/pdf/types";
import type { MathSpan } from "@/lib/parse/types";

type Kind = "math" | "attach" | "text";

const MATH_FAMILIES = new Set(["oml", "oms", "omx", "msa", "msb", "euf", "rsfs", "lasy", "esint"]);
const ATTACH_RE = /^[0-9+=()[\]!/:;]$/;
// Operator names set upright next to math: \lim, \sup, \log, … (a word
// in prose is set apart by spaces and followed by words, never by math).
const OPNAMES = new Set([
  "lim", "sup", "inf", "max", "min", "sin", "cos", "tan", "log", "ln", "exp", "det", "dim", "ker", "deg", "gcd",
  "arg", "Pr", "limsup", "liminf", "mod",
]);

// A glyph only math sets: a math family's, or the text font's upright
// capital Greek (Γ … Ω, codes 0–10: "ω ∈ Ω" ended the formula at the Ω, read
// as a word).
const isMathGlyph = (g: Glyph) => (g.family !== null && MATH_FAMILIES.has(g.family)) || (g.family === "ot1" && g.code <= 0x0a);

function kind(g: Glyph, size: number): Kind {
  if (isMathGlyph(g)) return "math";
  if (g.family !== "ot1") return "text";
  if (g.size < size * 0.85 || ATTACH_RE.test(g.unicode)) return "attach";
  // An accent over a math letter (\hat, \bar, \dot) is the text font's.
  return mathGlyph("ot1", g.code)?.cls === "accent" ? "attach" : "text";
}

const LETTER_RE = /^\p{L}$/u;
const isLetter = (g: Glyph) => LETTER_RE.test(g.unicode);
// A list marker: "(a)", "(iv)", "(3)", "a.", "3.", "iv)".
const MARKER_RE = /^(\((?:[a-zA-Z]|[ivxlc]{1,5}|\d{1,3})\)|(?:[a-zA-Z]|[ivxlc]{1,5}|\d{1,3})[.)])$/;
const gapOf = (a: Glyph, b: Glyph) => b.x - (a.x + a.w);

/** The formulas among a cell's glyphs (in x order), as glyph runs. */
function zonesOf(glyphs: Glyph[], size: number): Glyph[][] {
  const zones: Glyph[][] = [];
  let cur: Glyph[] = [];
  const kinds = glyphs.map((g) => kind(g, size));
  const flush = () => {
    let z = cur;
    cur = [];
    const count = (ch: string) => z.filter((g) => g.unicode === ch).length;
    // A sentence's colon or semicolon after a formula, and a bracket it
    // does not close, are the sentence's.
    for (;;) {
      const last = z[z.length - 1];
      if (!last || last.family !== "ot1") break;
      if (/^[;:]$/.test(last.unicode) || (last.unicode === ")" && count(")") > count("("))) z = z.slice(0, -1);
      else break;
    }
    // A footnote mark set apart before the formula, the sentence's colon,
    // or a bracket the formula does not close, is the sentence's.
    for (;;) {
      const first = z[0];
      if (!first || first.family !== "ot1") break;
      const mark = first.size < size * 0.85 && z[1] !== undefined && gapOf(first, z[1]) > 0.15 * size;
      const punct = /^[:;!]$/.test(first.unicode);
      const bracket = /^[([]$/.test(first.unicode) && !z.slice(1).some((g) => g.unicode === ")" || g.unicode === "]");
      if (mark || punct || bracket) z = z.slice(1);
      else break;
    }
    // A list item's marker at the cell's start ("(a)", "(ii)", "3.") is the
    // item's, not its first formula's ("(a) x ≥ 0" read as one formula).
    if (z[0] === glyphs[0]) {
      for (let n = 2; n < Math.min(7, z.length); n++) {
        const head = z.slice(0, n).map((g) => g.unicode).join("");
        if (MARKER_RE.test(head) && gapOf(z[n - 1], z[n]) > 0.15 * size) {
          z = z.slice(n);
          break;
        }
      }
    }
    // Math by font, or small glyphs stacked one over the other (a fraction
    // of digits: \frac{1}{2} sets no math-font glyph).
    const stacked = z.some((a) => z.some((b) => a !== b && a.size < size * 0.85 && b.size < size * 0.85 && Math.abs(a.y - b.y) > size * 0.4 && a.x < b.x + b.w && b.x < a.x + a.w));
    if (!stacked && !z.some((g) => kind(g, size) === "math")) return;
    // A lone raised symbol after a word (a footnote's dagger) is a mark,
    // not a formula: every glyph small, none on the line.
    if (!stacked && z.every((g) => g.size < size * 0.85)) return;
    zones.push(z);
  };
  for (let k = 0; k < glyphs.length; k++) {
    const g = glyphs[k];
    const prev = glyphs[k - 1];
    const gap = prev ? gapOf(prev, g) : 0;
    if (kinds[k] === "text") {
      // A word in a text font (roman, bold, italic) ends the formula,
      // unless it is an operator name next to math, one letter set against
      // math (\mathbf{x}, \mathrm{d}x), or a short name set tight before it
      // (\mathrm{Var}(X)).
      let j = k;
      while (j < glyphs.length && kinds[j] === "text" && isLetter(glyphs[j]) && (j === k || gapOf(glyphs[j - 1], glyphs[j]) < 0.12 * size)) j++;
      if (j === k) {
        flush();
        continue;
      }
      const word = glyphs.slice(k, j).map((x) => x.unicode).join("");
      const after = glyphs[j];
      const afterGap = after ? gapOf(glyphs[j - 1], after) : Infinity;
      const nextMath = after !== undefined && kinds[j] !== "text";
      const opname = OPNAMES.has(word) && (cur.length > 0 || nextMath);
      // "Var(" or "sgn x" set tight: a name; "sets:" is a word and its colon.
      const opens = after !== undefined && (kinds[j] === "math" || after.unicode === "(");
      // A bold letter stands a relation's space from its neighbors
      // (\mathbf{x} = y); a roman one touches them (\mathrm{d}x), where a
      // word space, however tight, is a fifth of an em.
      const near = (/^CMBX/i.test(g.base) ? 0.3 : 0.12) * size;
      const letter = word.length === 1 && ((cur.length > 0 && gap < near) || (nextMath && afterGap < near));
      const name = word.length <= 4 && opens && afterGap < 0.12 * size;
      if (opname || letter || name) cur.push(...glyphs.slice(k, j));
      else flush();
      k = j - 1;
      continue;
    }
    if (cur.length && gap > 0.6 * size && kinds[k] !== "math" && kinds[k - 1] !== "math") flush();
    cur.push(g);
  }
  flush();
  return zones;
}

// ── Items cut at a formula's edges ─────────────────────────────────────────

// Where each of an item's glyphs sits in its string. An item whose text
// was built from its glyphs (glyphs.ts itemText) says what each adds (""
// for an accent set on its letter or a composite's second half); for the
// others pdf.js adds spaces between glyphs, and a ligature is one glyph and
// two letters.
function charSpans(item: Item): [number, number][] {
  const spans: [number, number][] = [];
  let i = 0;
  for (const g of item.glyphs ?? []) {
    const read = g.text ?? g.unicode.normalize("NFKC");
    if (read !== "") while (i < item.str.length && /\s/.test(item.str[i])) i++;
    let end: number;
    if (read !== "" && item.str.startsWith(read, i)) end = i + read.length;
    else if (read === "" || g.w <= g.size * 0.01) end = i;
    else end = Math.min(item.str.length, i + 1);
    spans.push([i, end]);
    i = end;
  }
  return spans;
}

// A part of an item: its glyphs [from, to) and their string. The spaces
// after a part stay with it, so the line puts exactly one space between it
// and the next part.
function part(item: Item, spans: [number, number][], from: number, to: number, zone: MathZone | undefined): Item {
  const glyphs = item.glyphs!.slice(from, to);
  const start = from === 0 ? 0 : spans[from][0];
  const end = to === spans.length ? item.str.length : spans[to][0];
  const x = from === 0 ? item.x : glyphs[0].x;
  const last = glyphs[glyphs.length - 1];
  const xEnd = to === spans.length ? item.x + item.w : last.x + last.w;
  const out: Item = { ...item, str: item.str.slice(start, end), x, w: Math.max(0, xEnd - x), glyphs, zone };
  if (zone) {
    out.sup = false;
    out.sub = false;
  }
  return out;
}

/** The line's items with its formulas cut out: an item inside a formula
    carries its zone (its sub- and superscript flags off: they belong to
    the formula's LaTeX), an item a formula starts or ends in splits
    there. cells: where each cell of the line starts in items. */
export function splitZones(items: Item[], cells: number[]): Item[] {
  const out: Item[] = [];
  const bounds = [...cells, items.length];
  for (let c = 0; c + 1 < bounds.length; c++) {
    const cellItems = items.slice(bounds[c], bounds[c + 1]);
    const size = textSize(cellItems);
    // zonesOf keeps a run only with a math glyph in it or two small glyphs
    // stacked: a cell with no math glyph and fewer than two small ones, as
    // most are, has no formula and keeps its items as they are.
    let math = false;
    let small = 0;
    for (const it of cellItems) {
      for (const g of it.glyphs ?? []) {
        if (isMathGlyph(g)) math = true;
        if (g.size < size * 0.85) small++;
      }
    }
    if (!math && small < 2) {
      out.push(...cellItems);
      continue;
    }
    const glyphs = cellItems.flatMap((it) => it.glyphs ?? []).sort((a, b) => a.x - b.x || b.y - a.y);
    const zoneOf = new Map<Glyph, MathZone>();
    // An item with no glyphs is text a formula cannot run through.
    const breaks = cellItems.filter((it) => !it.glyphs?.length).map((it) => it.x);
    for (const z of zonesOf(glyphs, size)) {
      const x1 = z[0].x;
      const x2 = z[z.length - 1].x;
      if (breaks.some((x) => x > x1 && x < x2)) continue;
      const zone: MathZone = { glyphs: z, size, latex: "", ok: false, open: false };
      for (const g of z) zoneOf.set(g, zone);
    }
    for (const item of cellItems) {
      const glyphs = item.glyphs ?? [];
      if (glyphs.length === 0 || !glyphs.some((g) => zoneOf.has(g))) {
        out.push(item);
        continue;
      }
      const spans = charSpans(item);
      // A cut falls where the formula changes between two glyphs with text
      // between them; a glyph that reads as nothing (an accent composed on
      // its letter, a composite's second half) stays with the one before.
      let from = 0;
      for (let k = 1; k <= glyphs.length; k++) {
        if (k < glyphs.length && (zoneOf.get(glyphs[k]) === zoneOf.get(glyphs[from]) || spans[k][0] === spans[from][0])) continue;
        out.push(part(item, spans, from, k, zoneOf.get(glyphs[from])));
        from = k;
      }
    }
  }
  return out;
}

// The size most of a cell's characters are set in.
function textSize(items: Item[]): number {
  const chars = new Map<number, number>();
  for (const i of items) {
    const key = Math.round(i.size * 10) / 10;
    chars.set(key, (chars.get(key) ?? 0) + i.str.length);
  }
  return [...chars].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
}

/** The glyphs no text item reads: an accent placed on its letter, the
    second half of a composite (↦'s arrow), a code the text layer drops. A
    formula's layout needs them. */
export function orphanGlyphs(lines: Line[], drawing: PageDrawing): Glyph[] {
  const read = new Set<Glyph>();
  for (const line of lines) for (const item of line.items) for (const g of item.glyphs ?? []) read.add(g);
  return drawing.glyphs.filter((g) => !read.has(g) && g.family !== null);
}

/** Each zone on the page's lines gets its LaTeX, checked against its
    glyphs (and the page's glyphs no item reads that sit on it); a zone
    that fails stays plain text. */
export function resolveZones(lines: Line[], drawing: PageDrawing) {
  // Read at the first zone: most pages of prose have none.
  let orphans: Glyph[] | null = null;
  const seen = new Set<MathZone>();
  for (const line of lines) {
    for (const item of line.items) {
      const zone = item.zone;
      if (!zone || seen.has(zone)) continue;
      seen.add(zone);
      orphans ??= orphanGlyphs(lines, drawing);
      const x1 = Math.min(...zone.glyphs.map((g) => g.x));
      const x2 = Math.max(...zone.glyphs.map((g) => g.x + g.w));
      const low = Math.min(...zone.glyphs.map((g) => g.y));
      const high = Math.max(...zone.glyphs.map((g) => g.y));
      const on = (g: Glyph) => g.x + g.w / 2 > x1 && g.x + g.w / 2 < x2 && g.y > low - zone.size * 0.6 && g.y < high + zone.size * 1.2;
      const extra = orphans.filter(on);
      for (const g of extra) orphans.splice(orphans.indexOf(g), 1);
      const glyphs = [...zone.glyphs, ...extra];
      // The rules inside it: a fraction bar, a radical's or an overline's
      // bar over its glyphs. A bar with the formula's glyphs over it only
      // is a display's fraction bar under its numerator's line (arXiv
      // 2506.08494 p. 2 read it as \underline).
      const near = drawing.rules.filter(
        (r) =>
          r.dir === "h" &&
          r.x1 >= x1 - 1 &&
          r.x2 <= x2 + 1 &&
          r.y1 > low - zone.size &&
          r.y1 < high + zone.size &&
          glyphs.some((g) => g.y < r.y1 && g.x + g.w / 2 > r.x1 && g.x + g.w / 2 < r.x2),
      );
      try {
        const { latex, check, atoms } = layoutLatex(glyphs, near, { display: false, size: zone.size });
        zone.latex = latex;
        zone.ok = check.ok;
        const last = atoms.filter((a) => a.size >= zone.size * 0.85).sort((a, b) => b.x2 - a.x2)[0];
        zone.open = last !== undefined && (last.cls === "rel" || last.cls === "bin" || last.cls === "punct");
      } catch {
        zone.ok = false;
      }
    }
  }
}

/** A block's inline formulas: the runs of one formula that passed the
    check. A formula TeX broke across lines (after a relation or an
    operator) is two zones with only a line break between: they join. */
export function mathSpans(text: string, runs: Run[] | undefined): MathSpan[] {
  const spans: { start: number; end: number; zones: MathZone[] }[] = [];
  for (const r of runs ?? []) {
    const zone = r.zone;
    if (!zone) continue;
    const last = spans[spans.length - 1];
    const between = last ? text.slice(last.end, r.start) : "x";
    const tail = last?.zones[last.zones.length - 1];
    if (last && tail && between.trim() === "" && (tail === zone || tail.open)) {
      last.end = r.end;
      if (tail !== zone) last.zones.push(zone);
      continue;
    }
    spans.push({ start: r.start, end: r.end, zones: [zone] });
  }
  // A zone whose runs lie apart (its items out of order in the line) and a
  // zone that failed the check stay text.
  const seen = new Map<MathZone, number>();
  for (const s of spans) for (const z of s.zones) seen.set(z, (seen.get(z) ?? 0) + 1);
  const out: MathSpan[] = [];
  for (const s of spans) {
    if (!s.zones.every((z) => z.ok && seen.get(z) === 1)) continue;
    let { start, end } = s;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    const latex = s.zones.map((z) => z.latex).join(" ");
    // A formula a text word cut in two ("m(" and ") = m(" around HH) reads
    // as two formulas with a bracket each: both stay text.
    if (end > start && balanced(latex)) out.push({ start, end, latex });
  }
  return out;
}

// Brackets in a formula's LaTeX; any other command is skipped whole.
const BRACKET_RE = /\\(?:lbrace|rbrace|langle|rangle|lfloor|rfloor|lceil|rceil|[{}])|\\[A-Za-z]+|[()[\]]/g;
const OPENS = new Set(["(", "[", "\\lbrace", "\\{", "\\langle", "\\lfloor", "\\lceil"]);
const CLOSES = new Set([")", "]", "\\rbrace", "\\}", "\\rangle", "\\rfloor", "\\rceil"]);

/** Every bracket closes one opened before it, of any kind: a half-open
    interval [0, 1) counts. */
export function balanced(latex: string): boolean {
  let depth = 0;
  for (const [t] of latex.matchAll(BRACKET_RE)) {
    if (OPENS.has(t)) depth++;
    else if (CLOSES.has(t)) depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

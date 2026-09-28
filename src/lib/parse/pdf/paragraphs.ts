// Paragraphs: vertically continuous lines in one column, and the tests of a
// line's place in its column that lists share (an indent, the column's
// right edge, lines pushed apart by tall glyphs).

import { lineColumn } from "@/lib/parse/pdf/columns";
import { TOC_LABEL_RE } from "@/lib/parse/pdf/contents";
import type { Glyph } from "@/lib/parse/pdf/drawing";
import { CAPTION_RE } from "@/lib/parse/pdf/figures";
import { geom, lineMathShare } from "@/lib/parse/pdf/geometry";
import { BULLET_RE, GLYPH_BULLET_RE, isGlyphMarker, readMarker } from "@/lib/parse/pdf/markers";
import { boldShare, endsBold, fillsMargin, joinGroup, startsWithBoldLead } from "@/lib/parse/pdf/text";
import type { Line, PageContext, Step } from "@/lib/parse/pdf/types";

// The column's right edge near a band of lines [from, to): the widest prose
// line (single cell, longer than 40 characters, in the same column) within
// four lines before or after the band. A band's own longest line always reads
// as wrapped against itself. Lengths here count characters, not UTF-16 units:
// a math letter (𝔤, 𝒜) is two units, and a 40-character line ending in one
// became the edge (synth-math-tex p5: a display's label took three sentences
// as a list).
export function proseEdge(lines: Line[], from: number, to: number): number {
  let edge = 0;
  const x = lines[from].x;
  const size = lines[from].size;
  for (let k = Math.max(0, from - 4); k < Math.min(lines.length, to + 4); k++) {
    if (k >= from && k < to) continue;
    const l = lines[k];
    if (l.cells.length !== 1 || [...l.text].length <= 40) continue;
    if (Math.abs(l.x - x) > size * 6 || otherColumn(l, lines[from])) continue;
    if (l.xEnd > edge) edge = l.xEnd;
  }
  return edge;
}

// The prose edge when two lines near the band end at it: a column's edge,
// not a slide's longest line (a citation's two lines on a slide split where
// the first line ended, as if at a sentence's end).
function sharedEdge(lines: Line[], from: number, to: number): number {
  const edge = proseEdge(lines, from, to);
  const size = lines[from].size;
  let near = 0;
  for (let k = Math.max(0, from - 4); k < Math.min(lines.length, to + 4); k++) {
    const l = lines[k];
    if (l.cells.length === 1 && l.xEnd <= edge && l.xEnd >= edge - size * 2 && !otherColumn(l, lines[from])) near++;
  }
  return near >= 2 ? edge : 0;
}

// Line l was read in another column than line `of`: a two-column page's title
// or author line, kept whole across the gutter, is no edge of either column
// (arxiv-2503-10997 p1: the abstract's lines all read as short against the
// author line, and the abstract as a 19-item list). Two columns agree within
// an em at both edges.
function otherColumn(l: Line, of: Line): boolean {
  const a = lineColumn(l);
  const b = lineColumn(of);
  if (!a || !b) return false;
  return Math.abs(a[0] - b[0]) > of.size || Math.abs(a[1] - b[1]) > of.size;
}

export function isIndented(line: Line, ctx: PageContext): boolean {
  return (
    line.x > ctx.columnLeft + line.size * 0.6 &&
    line.x < ctx.columnLeft + line.size * 6 &&
    line.cells.length === 1
  );
}

// The edges of the column line k was read in (columns.ts lineColumn): its
// left edge, and where the full lines near k that start at that edge end
// (the nearest ones, so a full-width caption on a two-column page does not
// widen the column). A line of the page's right column is measured in that
// column: against the first column's edge, no line there was centered. A
// ruled table's line counts with its box where no line of words does (a
// statement's title over its table read as not centered: the table is its
// column's only full line, apple-fy24q4 p1). A line read alone across a
// page's columns (a title over two columns) stands in the page's width.
function columnEdges(lines: Line[], k: number, ctx: PageContext): { left: number; right: number } {
  const line = lines[k];
  const column = lineColumn(line);
  const alone = column !== undefined && Math.abs(column[0] - line.x) < 0.5 && Math.abs(column[1] - line.xEnd) < 0.5;
  const inner = column !== undefined && !alone && column[0] > ctx.columnLeft + line.size;
  const left = inner ? column[0] : ctx.columnLeft;
  // A full line at the column's left edge: in the page's first column any
  // line there; in another column one read in it; for a line alone, a line
  // at its own column's edge anywhere on the page.
  const atLeft = (l: Line) => {
    if (alone) return Math.abs(l.x - (lineColumn(l)?.[0] ?? ctx.columnLeft)) <= l.size;
    if (inner && !l.table && lineColumn(l) !== column) return false;
    return Math.abs(l.x - left) <= l.size;
  };
  let right = 0;
  let table = 0;
  // The lines near k, four each side, doubling until one is full; a line
  // alone reads the whole page.
  for (let d = alone ? lines.length : 1; right === 0; d *= 2) {
    for (let n = Math.max(0, k - 4 * d); n < Math.min(lines.length, k + 4 * d + 1); n++) {
      const l = lines[n];
      if (n === k || !atLeft(l)) continue;
      if (l.table) table = Math.max(table, l.xEnd);
      else if (l.cells.length === 1 && [...l.text].length > 30) right = Math.max(right, l.xEnd);
    }
    if (4 * d >= lines.length) break;
  }
  return { left, right: right || table };
}

/** Line k is centered in its column, set in from its edge by as much as
    it stops short of the other: a caption's, a title page's, or a form's
    centered line. A block quotation set in on the left only is not. */
export function isCentered(lines: Line[], k: number, ctx: PageContext): boolean {
  const line = lines[k];
  const { left, right } = columnEdges(lines, k, ctx);
  const inset = line.x - left;
  return right > line.xEnd && inset > line.size * 2 && Math.abs(inset - (right - line.xEnd)) <= line.size;
}

/** How lines [from, to) are aligned in their column, when not flush left:
    "center" when every line is centered; "right" when every line ends at
    the column's right edge and one starts well in from its left (a date
    line, a signature, an address set flush right); "justify" when two
    lines or more fill the column to both edges but the last, which stops
    short (Docs' justify). A line ends at the edge within a third of its
    size: TeX lets a hyphen or a period hang into the margin. */
export function lineAlign(lines: Line[], from: number, to: number, ctx: PageContext): "center" | "right" | "justify" | null {
  const group = lines.slice(from, to);
  if (group.length === 0 || group.some((l) => l.cells.length !== 1)) return null;
  if (group.every((_, k) => isCentered(lines, from + k, ctx))) return "center";
  const edges = group.map((_, k) => columnEdges(lines, from + k, ctx));
  const atRight = (l: Line, k: number) => edges[k].right > 0 && Math.abs(edges[k].right - l.xEnd) <= l.size * 0.33;
  if (group.every(atRight) && group.some((l, k) => l.x - edges[k].left > l.size * 4)) {
    // Flush right starts its lines anywhere; a block set in at one x and
    // justified starts them together.
    const ragged = group.length === 1 || group.some((l) => Math.abs(l.x - group[0].x) > l.size);
    if (ragged) return "right";
  }
  const last = group.length - 1;
  if (last >= 1 && group.slice(0, last).every(atRight) && !atRight(group[last], last)) return "justify";
  return null;
}

// Two lines pushed apart by tall glyphs: an inline fraction's denominator on
// the upper line and a sum sign on the lower leave the baselines farther
// apart than the text leading while the glyphs nearly touch (TeX's lineskip).
// That gap is no paragraph or item gap (import compare loop finding: an
// exercise's item split at such a line).
export function pushedApart(prev: Line, next: Line): boolean {
  const size = Math.max(prev.size, next.size);
  const deep = prev.yMin < prev.y - size * 0.3;
  const tall = next.yMax > next.y + size * 0.6;
  return (deep || tall) && prev.yMin - next.yMax <= size * 0.45;
}

const THEOREM_LABEL_RE =
  /^(Theorem|Lemma|Proposition|Corollary|Definition|Remark|Example|Exercise|Proof|Claim|Conjecture|Note|Notation|Hint|Problem|Solution|Assumption|Axiom|Fact)\b/i;

/** A line that opens with a theorem-like label set bold or in small caps
    ("Theorem 2.1.", "Exercise 3.4."): a paragraph of its own, never an
    item of an indented band (a one-line theorem and the exercise under it
    read as a two-item list) nor a line of the paragraph above. */
export function opensWithLabel(line: Line): boolean {
  const first = line.runs[0];
  if (!first || first.start > 0 || !(first.bold || first.smallCaps)) return false;
  return THEOREM_LABEL_RE.test(line.text.slice(first.start, first.end));
}

// A sentence's end, in Latin or CJK punctuation, before a closing quote or
// bracket.
const TERMINAL_RE = /[.!?:。！？：]["'”’」』)）]?$/;
// A line that opens a sentence: a capital, a number, a CJK character, an
// opening quote or bracket, or a note's symbol.
const OPENS_SENTENCE_RE = /^[\p{Lu}\p{N}\p{Lo}“"'‘(\[*†‡§¶‖]/u;

// An OCR layer over a scan: most of the page's glyphs are invisible (text
// render mode 3), and each line's size comes from the scan's letters, so it
// jitters from line to line (a 1913 bulletin's body lines read 8.8 to
// 10.9 pt: its paragraphs split at every jump, and a body line read as a
// heading). Read in the page loop (PageContext.ocr).
export function isOcrLayer(glyphs: Glyph[]): boolean {
  return glyphs.length > 0 && glyphs.filter((g) => g.mode === 3).length * 2 > glyphs.length;
}

/** Two lines' sizes differ past what one paragraph's lines do: 0.6 pt, or a
    fifth of the size on an OCR layer. */
function sizesDiffer(a: Line, b: Line, ctx: PageContext): boolean {
  return Math.abs(a.size - b.size) > (ctx.ocr ? Math.max(a.size, b.size) * 0.2 : 0.6);
}

// A display's number set left of it, in a cell of its own ("(33) ⇥ ⟨u, v⟩",
// amsart's leqno).
const EQ_NUMBER_RE = /^\(\d{1,3}[a-z]?\)$/;
// A contents entry's end: leader dots and a page number.
const LEADERS_RE = /(?:\s*\.){3,}\s*\d{1,4}\s*$/;

// A display equation's line: mostly math glyphs, set in from the column edge,
// or its number in the first cell. A numbered display at the column's edge
// read as a line of prose, and a formula sheet's sentences and displays as
// one paragraph.
function isDisplayMathLine(line: Line, ctx: PageContext): boolean {
  // A display the math reader joined (math/display.ts).
  if (line.display) return true;
  if (line.cells.length >= 2 && EQ_NUMBER_RE.test(line.cells[0].text.trim())) return true;
  return lineMathShare(line) >= 0.4 && line.x > ctx.columnLeft + line.size * 2;
}

// A first-line indent (LaTeX's parindent): an unmarked indented line whose
// next line is back at the column's left edge at text leading is the first
// line of that paragraph, not an item (import compare loop finding: every
// indented paragraph split after its first line).
export function isFirstLineIndent(lines: Line[], i: number, ctx: PageContext, runOf: number[]): boolean {
  const line = lines[i];
  const after = lines[i + 1];
  const marker = after ? readMarker(after) : null;
  return (
    line.cells.length === 1 &&
    !(BULLET_RE.test(line.text) && line.size <= ctx.bodySize * 1.15) &&
    isIndented(line, ctx) &&
    after !== undefined &&
    runOf[i + 1] === -1 &&
    after.cells.length === 1 &&
    Math.abs(after.x - ctx.columnLeft) <= 3 &&
    // The indent against the paragraph's next line: up to 3.2 em, or up to
    // 5 em when the line runs to the column's edge as a wrapped first line
    // does (Word's half-inch indent is 3.3 em at 11 pt, and its first lines
    // read as one-line items).
    (line.x - after.x <= line.size * 3.2 ||
      (line.x - after.x <= line.size * 5 && line.xEnd >= columnRight(lines, i, ctx) - line.size * 1.5)) &&
    line.y - after.y > 0 &&
    line.y - after.y <= after.size * ctx.leading * 1.3 &&
    !sizesDiffer(after, line, ctx) &&
    // A marker read by family, not any parenthesized word: "(BTS) Airline…"
    // under a paragraph's first line is its second line, and so are an
    // initial ("A. Vaswani…") and a citation ("[30] discussion…").
    (marker === null || marker.family === "cite" || (marker.family === "upperAlpha" && marker.shape === "x."))
  );
}

// Paragraph group: vertically continuous same-size lines in one column.
// A hanging indent (a reference entry, a glossary term) indents every
// line after the first: the second line may step in by up to three ems
// when the first line breaks mid-sentence.
export function readParagraph(lines: Line[], i: number, ctx: PageContext, runOf: number[]): Step {
  const line = lines[i];
  const body = ctx.bodySize;
  const firstLineIndent = isFirstLineIndent(lines, i, ctx, runOf);
  const group: Line[] = [line];
  const colEdge = proseEdge(lines, i, i);
  const sentenceEdge = sharedEdge(lines, i, i);
  let j = i + 1;
  while (j < lines.length) {
    const next = lines[j];
    const prev = group[group.length - 1];
    const gap = prev.y - next.y;
    const prevTerminal = TERMINAL_RE.test(prev.text.trim());
    const nextMarker = readMarker(next);
    // Centered lines of one paragraph start at different x (a caption's two
    // lines, a court's centered caption): their shifts are no indent, and
    // their ends say nothing of the paragraph's end.
    const centered = isCentered(lines, j - 1, ctx) && isCentered(lines, j, ctx);
    // A line that stops short of the column's edge after a sentence ends its
    // paragraph when the next line opens a sentence: the next line's first
    // word would have fit, so the break was the writer's. In a document with
    // no space between paragraphs it is the only sign (a Google Docs
    // export's paragraphs and a report's table notes read as one before).
    const endsShort =
      !centered &&
      sentenceEdge > 0 &&
      prevTerminal &&
      !fillsMargin(prev, next, sentenceEdge) &&
      OPENS_SENTENCE_RE.test(next.text);
    // A hanging indent (a reference entry, a glossary term): the second
    // line steps in by one to three ems under a first line that wrapped —
    // it ran to the margin, or broke mid-sentence.
    const hanging =
      group.length === 1 &&
      !isIndented(prev, ctx) &&
      next.x > prev.x + next.size * 0.8 &&
      next.x <= prev.x + next.size * 3.5 &&
      !BULLET_RE.test(next.text) &&
      gap <= next.size * ctx.leading * 1.3 &&
      (!prevTerminal || /^[a-z0-9(]/.test(next.text) || prev.xEnd > colEdge - prev.size * 1.5);
    // A wrapped line whose stretched word gaps read as cells is still one
    // line of prose when no table run claims it.
    const stretched =
      next.cells.length > 1 &&
      next.cells.length <= 3 &&
      Math.abs(next.x - prev.x) <= next.size * 0.5 &&
      next.cells.every((c) => c.text.length > 0);
    if (
      runOf[j] !== -1 ||
      (next.cells.length !== 1 && !stretched) ||
      gap < 0 ||
      // No line gap reaches 1.9 sizes, unless the document's own leading
      // does and the line above wrapped at the column's edge: a
      // double-spaced paper's lines sit 2 sizes apart, and each line read as
      // its own paragraph. A contents entry's leader dots run to the edge
      // too, and end the entry.
      (gap > next.size * 1.9 &&
        !(gap <= next.size * ctx.leading * 1.3 && colEdge > 0 && fillsMargin(prev, next, colEdge) && !LEADERS_RE.test(prev.text))) ||
      // The paragraph gap: looser than the text leading by a third.
      (gap > next.size * ctx.leading * 1.3 && !pushedApart(prev, next)) ||
      sizesDiffer(next, prev, ctx) ||
      (next.x > prev.x + next.size * 1.1 && !hanging && !centered) ||
      (next.x < prev.x - next.size * 1.1 && !(group.length === 1 && firstLineIndent) && !centered) ||
      next.size > body * (ctx.ocr ? 1.3 : 1.14) ||
      endsShort ||
      TOC_LABEL_RE.test(next.text.trim()) ||
      (isIndented(next, ctx) && !isIndented(prev, ctx) && !hanging && !centered) ||
      // An equation's line and a text line never share a paragraph: the
      // label under an underbrace joined the formula and diluted its math
      // share below the equation threshold (import compare loop finding).
      isDisplayMathLine(prev, ctx) !== isDisplayMathLine(next, ctx) ||
      // A marker opening the next line starts an item — a glyph bullet or a
      // box always, a number or a "(7)" only under a line that ended short
      // of the column edge or with a sentence: "(7) Weight-space…" at a line
      // start inside a justified paragraph is text (import compare loop
      // finding).
      (nextMarker !== null &&
        readMarker(prev) === null &&
        (isGlyphMarker(nextMarker) || GLYPH_BULLET_RE.test(next.text) || prev.xEnd < colEdge - prev.size * 1.5)) ||
      // "Setup." after a sentence end opens the next paragraph, and so does a
      // bold label under a line that stopped short of the column edge
      // ("Category. mechanism" over "Summary. …" in a boxed entry).
      (startsWithBoldLead(next) &&
        !endsBold(prev) &&
        (prevTerminal || prev.xEnd < colEdge - prev.size * 2)) ||
      // A theorem-like label in small caps opens its own paragraph too.
      (opensWithLabel(next) && !opensWithLabel(prev) && (prevTerminal || prev.xEnd < colEdge - prev.size * 2)) ||
      // A wholly bold line that stops short of the column edge is a title
      // line: the regular text under it is its own block.
      (boldShare(prev.runs, prev.text.length) > 0.9 &&
        [...prev.text].length > 2 &&
        prev.xEnd < colEdge - prev.size * 2 &&
        boldShare(next.runs, next.text.length) < 0.5)
    )
      break;
    group.push(next);
    j++;
  }
  const { text, runs } = joinGroup(group, true);
  const monoChars = runs.filter((r) => r.mono).reduce((n, r) => n + (r.end - r.start), 0);
  if (text.length > 0 && monoChars / text.length > 0.85) {
    return { segments: [{ type: "CODE", text, page: line.page, runs, ...geom(group) }], next: j };
  }
  const tokens = layoutTokens(lines, i, j, ctx, text);
  const html = tokens.length > 0 ? `<p class="${tokens.join(" ")}"></p>` : undefined;
  return { segments: [{ type: "PARAGRAPH", text, ...(html ? { html } : {}), page: line.page, runs, ...geom(group) }], next: j };
}

// What a paragraph's lines show of its layout, as the class tokens the reader
// and the import converter read: "center" for centered lines, "caption" for
// a table's or a figure's caption, and its indent — "indent-first" (the
// first line set in from the others), "indent-hanging" (the others set in
// from the first), or "indent-block" (every line set in from the column's
// edge). One line alone shows no indent.
function layoutTokens(lines: Line[], from: number, to: number, ctx: PageContext, text: string): string[] {
  const tokens: string[] = [];
  const group = lines.slice(from, to);
  const size = group[0].size;
  const centered = group.every((_, k) => isCentered(lines, from + k, ctx));
  if (centered) tokens.push("center");
  if (CAPTION_RE.test(text)) tokens.push("caption");
  if (centered || group.length < 2) return tokens;
  const rest = group.slice(1);
  const restX = rest[0].x;
  if (!rest.every((l) => Math.abs(l.x - restX) <= size * 0.5)) return tokens;
  const shift = group[0].x - restX;
  // A block's indent is from its own column's left edge: against the page's
  // first column, every paragraph of the second read as set in.
  const left = lineColumn(rest[0])?.[0] ?? ctx.columnLeft;
  if (shift >= size * 0.5 && shift <= size * 4) tokens.push("indent-first");
  else if (-shift >= size * 0.5 && -shift <= size * 4) tokens.push("indent-hanging");
  else if (Math.abs(shift) <= size * 0.5 && restX > left + size) tokens.push("indent-block");
  return tokens;
}

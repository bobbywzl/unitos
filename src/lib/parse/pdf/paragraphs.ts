// Paragraphs: vertically continuous lines in one column, and the tests of a
// line's place in its column that lists share (an indent, the column's
// right edge, lines pushed apart by tall glyphs).

import { lineColumn } from "@/lib/parse/pdf/columns";
import { TOC_LABEL_RE } from "@/lib/parse/pdf/contents";
import type { Glyph } from "@/lib/parse/pdf/drawing";
import { CAPTION_RE } from "@/lib/parse/pdf/figures";
import { geom, lineMathShare, median } from "@/lib/parse/pdf/geometry";
import { BULLET_RE, GLYPH_BULLET_RE, isGlyphMarker, opensSequence, readMarker } from "@/lib/parse/pdf/markers";
import { boldShare, endsBold, fillsMargin, joinGroup, startsWithBoldLead } from "@/lib/parse/pdf/text";
import type { Line, PageContext, Segment, Step } from "@/lib/parse/pdf/types";
import type { Indent } from "@/lib/parse/types";

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
// the first line ended, as if at a sentence's end). With no two near, the
// edge three lines of the page share that start where the band does, in
// its column: among short typed lines four lines hold no full one (dated
// lines, a page's first lines), and the writer's line breaks ran together.
function sharedEdge(lines: Line[], from: number, to: number): number {
  const edge = proseEdge(lines, from, to);
  const band = lines[from];
  const size = band.size;
  const near = (l: Line, at: number) => l.cells.length === 1 && l.xEnd <= at && l.xEnd >= at - size * 2 && !otherColumn(l, band);
  if (lines.slice(Math.max(0, from - 4), to + 4).filter((l) => near(l, edge)).length >= 2) return edge;
  const own = lines.filter((l) => l.cells.length === 1 && !l.table && Math.abs(l.x - band.x) <= size && !otherColumn(l, band));
  const page = Math.max(0, ...own.filter((l) => [...l.text].length > 40).map((l) => l.xEnd));
  return own.filter((l) => near(l, page)).length >= 3 ? page : 0;
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

// Each line's column edge, set for a page by markEdges.
const edges = new WeakMap<Line, number>();

/** Where each line's column starts (leftEdge reads it): the leftmost place
    the lines of its column start at, among the lines of one cell, read in
    its column, that reach over it, from 85% of its size to half as large
    again (a caption set smaller beside the text is no edge of it; the body
    is the edge of an abstract set smaller and in). The extent the column
    split keeps reaches past that edge where anything stands in the
    column's margin (Elsevier's right column: every paragraph read as set
    in by 10 pt), and spans a side column or a float read with the text
    (PLOS pp. 2 and 6, Nature p. 1: 165 to 178 pt). A line with no such
    place (a box on a form) starts its own column: nothing sets it in. */
export function markEdges(lines: Line[], ctx: PageContext) {
  const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;
  for (const line of lines) {
    const size = line.size;
    const column = lineColumn(line);
    const xs = lines
      .filter((l) => {
        if (l === line || l.cells.length !== 1 || l.size < size * 0.85 || l.size > size * 1.5) return false;
        if (l.x >= line.xEnd - size || l.xEnd <= line.x + size) return false;
        const other = lineColumn(l);
        return !column || !other || (near(column[0], other[0], 1) && near(column[1], other[1], 1));
      })
      .map((l) => l.x)
      .sort((a, b) => a - b);
    // Starts within a fifth of an em of one another are one place (an OCR
    // layer's lines, a third). The edge is the leftmost place that two
    // lines start at, and a third as many as at the busiest place: a form's
    // labels set in under a few lines at the margin keep the margin, and a
    // label in the margin (one line) is no edge.
    const tolerance = Math.max(1, size * (ctx.ocr ? 0.3 : 0.2));
    const places: number[][] = [];
    for (const x of xs) {
      const place = places[places.length - 1];
      if (place && x - place[0] <= tolerance) place.push(x);
      else places.push([x]);
    }
    const busiest = Math.max(0, ...places.map((p) => p.length));
    const edge = places.find((p) => p.length >= 2 && p.length * 3 >= busiest);
    edges.set(line, edge ? edge[Math.floor(edge.length / 2)] : line.x);
  }
}

// The left edge of the column a line was read in (markEdges); for a line
// not marked, the page's column (PageContext.columnLeft), or the extent of
// a column further right.
export function leftEdge(line: Line, ctx: PageContext): number {
  const edge = edges.get(line);
  if (edge !== undefined) return edge;
  const column = lineColumn(line);
  if (!column) return ctx.columnLeft;
  // The page's column is measured to a whole point; its extent to the glyph.
  return column[0] > ctx.columnLeft + line.size || Math.abs(column[0] - ctx.columnLeft) <= 1 ? column[0] : ctx.columnLeft;
}

// The first-line indent a page's paragraphs share, in points: the step most
// first lines are set in by, to a half point, over a line back at the
// column's left edge at the text's leading. A first line stands under a
// line that stopped short of the column's right edge, or apart from it.
// Two such lines at least, else none. amsbook sets its paragraphs in by
// half an em, under isIndented's reach.
const pageSteps = new WeakMap<Line[], number | null>();
function paragraphStep(lines: Line[], ctx: PageContext): number | null {
  let step = pageSteps.get(lines);
  if (step !== undefined) return step;
  const counts = new Map<number, number>();
  lines.forEach((line, k) => {
    const next = lines[k + 1];
    const above = lines[k - 1];
    if (!next || line.cells.length !== 1 || next.cells.length !== 1 || lineColumn(line) !== lineColumn(next) || sizesDiffer(line, next, ctx)) return;
    const shift = line.x - next.x;
    const gap = line.y - next.y;
    if (shift < line.size * 0.25 || shift > line.size * 4 || Math.abs(next.x - leftEdge(next, ctx)) > line.size * 0.5) return;
    if (gap <= 0 || gap > next.size * ctx.leading * 1.3) return;
    // TeX's last line of a paragraph may end near the edge: its sentence's
    // end says it ended.
    const opens =
      !above ||
      lineColumn(above) !== lineColumn(line) ||
      above.y - line.y > line.size * ctx.leading * 1.3 ||
      !fillsMargin(above, line, columnEdges(lines, k - 1, ctx).right) ||
      (TERMINAL_RE.test(above.text.trim()) && columnEdges(lines, k - 1, ctx).right - above.xEnd > above.size * 0.33);
    if (!opens) return;
    const key = Math.round(shift * 2) / 2;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  step = best && best[1] >= 2 ? best[0] : null;
  pageSteps.set(lines, step);
  return step;
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
  const alone = column !== undefined && (columnLines(lines).get(column) ?? 0) <= 1;
  const inner = column !== undefined && !alone && column[0] > ctx.columnLeft + line.size;
  // An inner column's edge is where its lines start (markEdges): its extent
  // reaches past it where anything stands in its margin, and against that a
  // one-line lead-in read as centered (arXiv 2411.19946 p. 2).
  const left = inner ? Math.max(column[0], leftEdge(line, ctx)) : ctx.columnLeft;
  // A full line at the column's left edge: in the page's first column any
  // line there; in another column one read in it; for a line alone, a line
  // at its own column's edge anywhere on the page.
  const atLeft = (l: Line) => {
    if (alone) return Math.abs(l.x - (lineColumn(l)?.[0] ?? ctx.columnLeft)) <= l.size;
    if (inner && !l.table && lineColumn(l) !== column) return false;
    // A line across both columns (a caption over them) is no edge of the
    // first: against it the first column's lines stopped short.
    if (column && l.xEnd > column[1] + l.size) return false;
    return Math.abs(l.x - left) <= l.size;
  };
  let ends: number[] = [];
  let table = 0;
  // The lines near k, four each side, doubling until three are long; a
  // line alone reads the whole page. One long line is no edge: a form's
  // label line of 33 characters made its centered heading read as set
  // right of the column's middle.
  for (let d = alone ? lines.length : 1; ; d *= 2) {
    ends = [];
    for (let n = Math.max(0, k - 4 * d); n < Math.min(lines.length, k + 4 * d + 1); n++) {
      const l = lines[n];
      if (n === k || !atLeft(l)) continue;
      if (l.table) table = Math.max(table, l.xEnd);
      else if (l.cells.length === 1 && [...l.text].length > 30) ends.push(l.xEnd);
    }
    if (ends.length >= 3 || 4 * d >= lines.length) break;
  }
  return { left, right: rightEdge(ends, line.size) || table };
}

// The column's right edge among the ends of its full lines: the furthest,
// unless one line alone runs past two that end together, by an em at most.
// TeX lets a line run over the edge when it cannot break it (an overfull
// line 4.5 pt past it): against that line, every justified line of its
// paragraph read as stopping short.
function rightEdge(ends: number[], size: number): number {
  const [first, second, third] = [...ends].sort((a, b) => b - a);
  if (first === undefined) return 0;
  const overfull = second !== undefined && third !== undefined && first - second > size * 0.33 && first - second <= size && second - third <= size * 0.33;
  return overfull ? second : first;
}

// How many of a page's lines were read in each column: a line alone in its
// column was read across the page's columns (a spanning title). A full
// line of a column spans the column's extent too, so the extent does not
// tell them apart.
const columnCounts = new WeakMap<Line[], Map<[number, number], number>>();
function columnLines(lines: Line[]): Map<[number, number], number> {
  let counts = columnCounts.get(lines);
  if (!counts) {
    counts = new Map();
    for (const l of lines) {
      const column = lineColumn(l);
      if (column) counts.set(column, (counts.get(column) ?? 0) + 1);
    }
    columnCounts.set(lines, counts);
  }
  return counts;
}

/** Line k is centered in its column, set in from its edge by as much as
    it stops short of the other: a caption's, a title page's, or a form's
    centered line. A block quotation set in on the left only is not. The
    other edge is where the column's full lines end near k, or the
    column's own extent: a ragged page's lines stop short of it, and a
    centered line under a title read as set left (synth-agreement-html). A
    line set larger than the body (a title, a heading) may nearly fill its
    column: set in by half an em, it is centered within a quarter of one (a
    paper's title across both columns, 13.7 pt in on the left and 15.4 pt
    on the right, real-acm-damon25-3736236 p1). */
export function isCentered(lines: Line[], k: number, ctx: PageContext): boolean {
  const line = lines[k];
  const { left, right } = columnEdges(lines, k, ctx);
  const inset = line.x - left;
  const big = line.size >= ctx.bodySize * 1.2;
  const column = lineColumn(line);
  const centeredTo = (edge: number) => {
    if (edge <= line.xEnd) return false;
    const off = Math.abs(inset - (edge - line.xEnd));
    return (inset > line.size * 2 && off <= line.size) || (big && inset > line.size * 0.5 && off <= line.size * 0.25);
  };
  return centeredTo(right) || (column !== undefined && column[1] > right && centeredTo(column[1])) || sharesMiddle(lines, k, ctx);
}

// A stack of short lines, each read in a column of its own, that share
// their middle: an author's block in a paper's grid of authors (name,
// affiliation, city, address). Three lines or more, their middles within
// half an em, each within three ems under the one before, starting at
// different places; the grid's other cells come between them in reading
// order (real-acm-damon25-3736236 p1). Only the lines' alignment reads it:
// as a centered line to join, it joined lines of different cells.
function centeredStack(lines: Line[], k: number): boolean {
  const alone = (l: Line) => {
    const column = lineColumn(l);
    return column !== undefined && (columnLines(lines).get(column) ?? 0) <= 1 && l.cells.length === 1 && !l.table;
  };
  const line = lines[k];
  if (!alone(line)) return false;
  const middle = (line.x + line.xEnd) / 2;
  const stack = [line];
  for (const step of [-1, 1]) {
    let prev = line;
    for (let n = k + step; n >= 0 && n < lines.length && Math.abs(n - k) <= 16; n += step) {
      const o = lines[n];
      if (Math.abs(o.y - prev.y) > Math.max(o.size, prev.size) * 3) break;
      if (!alone(o) || Math.abs((o.x + o.xEnd) / 2 - middle) > Math.min(o.size, line.size) * 0.5) continue;
      stack.push(o);
      prev = o;
    }
  }
  const xs = stack.map((l) => l.x);
  return stack.length >= 3 && Math.max(...xs) - Math.min(...xs) > line.size * 0.5;
}

// The lines over and under line k, in its column, that share its middle
// and not their left edges: they are centered on that middle. A title
// page's lines have no column but their widest line, and against it the
// widest and the ones nearly as wide read flush left (synth-notes-html's
// title, subtitle, and department). The middle is the column's, within two
// ems: a clause's heading under an item's last line shared that line's
// middle, 70 pt left of the column's (synth-agreement-docx), unless the
// page centers three lines or more there (pageMiddle). A line that
// fills its column shows no centering and ends the run: an abstract's full
// lines under a centered title and its authors shared their middle, and
// read as centered (real-jnlp-31-47 p1).
function sharesMiddle(lines: Line[], k: number, ctx: PageContext): boolean {
  const line = lines[k];
  if (line.cells.length !== 1 || fillsColumn(lines, k, ctx)) return false;
  const middle = (line.x + line.xEnd) / 2;
  const { left, right } = columnEdges(lines, k, ctx);
  // A line of prose at the body's size that runs to the column's right edge
  // from its left edge or a first-line indent is a paragraph's, not a
  // centered one: two justified lines under a centered heading shared its
  // middle (MMWR p. 3). A heading's line, set in another size, in capitals,
  // or bold, may fill the column over its centered last line (arXiv
  // 2502.02648 p. 8, a thesis's title).
  const full = (l: Line) =>
    right > 0 &&
    Math.abs(right - l.xEnd) <= l.size * 0.33 &&
    l.x - left <= l.size * 2 &&
    Math.abs(l.size - ctx.bodySize) <= ctx.bodySize * 0.05 &&
    /\p{Ll}/u.test(l.text) &&
    boldShare(l.runs, l.text.length) < 0.9;
  if (full(line)) return false;
  const column = lineColumn(line);
  const center = right > 0 ? (left + right) / 2 : column ? (column[0] + column[1]) / 2 : middle;
  const shared = pageMiddle(lines, ctx);
  if (Math.abs(center - middle) > line.size * 2 && !(shared !== null && Math.abs(shared - middle) <= line.size * 0.5)) return false;
  const run = [line];
  for (const step of [-1, 1]) {
    let prev = line;
    for (let n = k + step; n >= 0 && n < lines.length; n += step) {
      const o = lines[n];
      if (o.cells.length !== 1 || o.table || lineColumn(o) !== lineColumn(line) || fillsColumn(lines, n, ctx) || full(o)) break;
      if (Math.abs(o.y - prev.y) > Math.max(o.size, prev.size) * 3) break;
      if (Math.abs((o.x + o.xEnd) / 2 - middle) > Math.min(o.size, line.size) * 0.5) break;
      run.push(o);
      prev = o;
    }
  }
  const xs = run.map((l) => l.x);
  if (run.length > 1 && Math.max(...xs) - Math.min(...xs) > Math.max(...run.map((l) => l.size)) * 2) return true;
  // A title's line, set larger than the body, and one beside it share their
  // middle within a tenth of their size and start apart: on a slide the
  // title's two lines start 18.8 pt apart at 52 pt, their middles 0.05 pt
  // (real-gslides-oer-5rs p2).
  if (line.size < ctx.bodySize * 1.2) return false;
  return run.some((o) => {
    const size = Math.min(o.size, line.size);
    return o !== line && Math.abs((o.x + o.xEnd) / 2 - middle) <= size * 0.1 && Math.abs(o.x - line.x) > size * 0.1;
  });
}

// The middle that three lines or more share on a page, set in from the
// column's left edge and starting at three places or more: the column's
// middle where no line of the page reaches its right edge, and the edge
// measured from the lines stops short (a sheet of one-line sentences and
// displays under its centered title, author, and abstract: synth-math-tex).
const pageMiddles = new WeakMap<Line[], number | null>();
function pageMiddle(lines: Line[], ctx: PageContext): number | null {
  let found = pageMiddles.get(lines);
  if (found !== undefined) return found;
  const inset = lines.filter((l) => l.cells.length === 1 && !l.table && l.x > ctx.columnLeft + l.size * 2);
  const middleOf = (l: Line) => (l.x + l.xEnd) / 2;
  const hit = inset.find((l) => {
    const near = inset.filter((o) => Math.abs(middleOf(o) - middleOf(l)) <= o.size * 0.5);
    return near.length >= 3 && new Set(near.map((o) => Math.round(o.x))).size >= 3;
  });
  found = hit ? middleOf(hit) : null;
  pageMiddles.set(lines, found);
  return found;
}

// Line k is one of a block's full lines: it runs from its column's left
// edge to its right edge, and so does a line next to it. The widest line
// of a centered title is its column's width, and alone.
function fillsColumn(lines: Line[], k: number, ctx: PageContext): boolean {
  const full = (n: number) => {
    const l = lines[n];
    if (!l || l.cells.length !== 1) return false;
    const { left, right } = columnEdges(lines, n, ctx);
    return right > 0 && Math.abs(l.x - left) <= Math.max(1, l.size * 0.1) && Math.abs(right - l.xEnd) <= l.size * 0.6;
  };
  return full(k) && ((full(k - 1) && lineColumn(lines[k - 1]) === lineColumn(lines[k])) || (full(k + 1) && lineColumn(lines[k + 1]) === lineColumn(lines[k])));
}

/** How lines [from, to) are aligned in their column, when not flush left:
    "center" when every line is centered, or a title's lines are centered on
    one another; "right" when every line ends at
    the column's right edge and they start at different places, or one
    line starts well in from its left (a date line, a signature, an address
    set flush right); "justify" when two lines or more fill the column to
    both edges, the last aside, on a page set justified (Docs' justify). A
    line ends at the edge within a third of its size: TeX lets a hyphen or
    a period hang into the margin. */
export function lineAlign(lines: Line[], from: number, to: number, ctx: PageContext): "center" | "right" | "justify" | null {
  const group = lines.slice(from, to);
  if (group.length === 0 || group.some((l) => l.cells.length !== 1)) return null;
  if (group.every((_, k) => isCentered(lines, from + k, ctx) || centeredStack(lines, from + k)) || centeredTitle(group, ctx)) return "center";
  const edges = group.map((_, k) => columnEdges(lines, from + k, ctx));
  const atRight = (l: Line, k: number) => atEdge(l, edges[k].right);
  // Flush right starts its lines anywhere but at the column's left edge: a
  // justified paragraph's indented first line over lines that fill the
  // column read as flush right (arxiv-2504-02736 p2).
  const inset = (l: Line, k: number) => l.x - edges[k].left;
  // Short lines that end at one place and start a few points apart are
  // flush right too: the SF 298's "Standard Form 298 (Rev. 2-89)" over
  // "Prescribed by ANSI Std. 239-18" start 3.1 pt apart and end 0.1 pt
  // apart (lines half the column wide or less: a justified quote's lines
  // end together and fill it).
  const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
  const [starts, ends] = [spread(group.map((l) => l.x)), spread(group.map((l) => l.xEnd))];
  const short = group.every((l, k) => l.xEnd - l.x <= (edges[k].right - edges[k].left) / 2);
  const ragged =
    group.length === 1
      ? inset(group[0], 0) > group[0].size * 4
      : group.every((l, k) => inset(l, k) > l.size * 2) && (starts > group[0].size || (short && starts > group[0].size * 0.25 && ends * 4 < starts));
  if (group.every(atRight) && ragged) return "right";
  // A formula's line (a display that fell into the paragraph, a limit on a
  // baseline of its own, set smaller) and the line before it stop where
  // the formula puts them: they say nothing of the paragraph's edge.
  const last = group.length - 1;
  const size = median(group.map((l) => l.size));
  const formula = (k: number) => k <= last && (lineMathShare(group[k]) >= 0.4 || group[k].size < size * 0.85);
  const wrapped = group.slice(0, last);
  const fills = (l: Line, k: number) => atRight(l, k) || atEdge(l, fullEnd(lines, from + k));
  if (wrapped.some(fills) && wrapped.every((l, k) => fills(l, k) || formula(k) || formula(k + 1)) && justifiedPage(lines, ctx)) return "justify";
  return null;
}

/** Line k stops short of its column's right edge on a page set justified:
    it ends its paragraph or its list item, and the line under it is no wrap
    of it (a hint under an exercise's last item joined the item). */
export function stopsShort(lines: Line[], k: number, ctx: PageContext): boolean {
  if (!justifiedPage(lines, ctx)) return false;
  const right = columnEdges(lines, k, ctx).right;
  return right > 0 && right - lines[k].xEnd > lines[k].size * 0.33 && !atEdge(lines[k], fullEnd(lines, k));
}

/** A list's items set justified, as lineAlign reads a paragraph: every line
    of an item but its last fills the column to its right edge, on a page
    set justified, and one item of two lines at least shows it. A page may
    justify its items as it does its paragraphs, and the import drew the
    items ragged. */
export function justifiedItems(lines: Line[], items: Line[][], ctx: PageContext): boolean {
  const wrapped = items.filter((item) => item.length >= 2);
  if (wrapped.length === 0 || !justifiedPage(lines, ctx)) return false;
  return wrapped.every((item) =>
    item.slice(0, -1).every((l) => {
      const k = lines.indexOf(l);
      return k >= 0 && (atEdge(l, columnEdges(lines, k, ctx).right) || atEdge(l, fullEnd(lines, k)));
    }),
  );
}

// A line ends at the column's right edge within a third of its size, or
// runs past it by an em at most (TeX's overfull line).
function atEdge(l: Line, right: number): boolean {
  return right > 0 && right - l.xEnd <= l.size * 0.33 && l.xEnd - right <= l.size;
}

// Where the full lines of line k's column end, over its whole page: the
// lines near a paragraph at a page's foot may all stop short (a list, lines
// before displays), and its justified first line read as stopping short of
// them.
const fullEnds = new WeakMap<Line[], Map<unknown, number>>();
function fullEnd(lines: Line[], k: number): number {
  let byColumn = fullEnds.get(lines);
  if (!byColumn) {
    const ends = new Map<unknown, number[]>();
    for (const l of lines) {
      if (l.cells.length !== 1 || [...l.text].length <= 30) continue;
      const key = lineColumn(l);
      ends.set(key, [...(ends.get(key) ?? []), l.xEnd]);
    }
    byColumn = new Map([...ends].map(([key, list]) => [key, rightEdge(list, median(lines.map((l) => l.size)))]));
    fullEnds.set(lines, byColumn);
  }
  return byColumn.get(lineColumn(lines[k])) ?? 0;
}

// A title's lines, set larger than the body, centered on one another:
// their middles agree within a tenth of their size, and they start at
// different places. On a slide or a title page the widest line is the
// column, and no edge tells (real-gslides-oer-5rs p2's title, its lines'
// middles 0.05 pt apart).
function centeredTitle(group: Line[], ctx: PageContext): boolean {
  if (group.length < 2 || group.some((l) => l.size < ctx.bodySize * 1.2)) return false;
  const size = Math.min(...group.map((l) => l.size));
  const middles = group.map((l) => (l.x + l.xEnd) / 2);
  const starts = group.map((l) => l.x);
  return Math.max(...middles) - Math.min(...middles) <= size * 0.1 && Math.max(...starts) - Math.min(...starts) > size * 0.1;
}

// A page set justified: of its lines of prose that end within three ems of
// their column's right edge, most end at it. A ragged page's lines end
// anywhere near the edge, a justified page's at it, its paragraphs' last
// lines aside. Without it a ragged page's two-line paragraph read as
// justified wherever its first line happened to fill the column.
const justifiedPages = new WeakMap<Line[], boolean>();
function justifiedPage(lines: Line[], ctx: PageContext): boolean {
  let justified = justifiedPages.get(lines);
  if (justified === undefined) {
    let near = 0;
    let flush = 0;
    lines.forEach((l, k) => {
      if (l.cells.length !== 1 || [...l.text].length < 30) return;
      const short = columnEdges(lines, k, ctx).right - l.xEnd;
      if (short > l.size * 3 || short < -l.size) return;
      near++;
      if (Math.abs(short) <= l.size * 0.33) flush++;
    });
    justified = near >= 4 && flush >= near * 0.6;
    justifiedPages.set(lines, justified);
  }
  return justified;
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

/** A page's leading, as a multiple of its text's size: the document's
    (PageContext.leading, measured from gaps under two sizes), unless the
    page is set double-spaced: most of its pairs of long lines one under
    the other, of one size and starting at one place or stepping out from
    an indent, stand two sizes apart or more (under three). Then it is the
    middle of those: a report's body set 2.35 sizes apart read a paragraph
    to a line, its first lines' 36 pt indents lost. */
export function pageLeading(lines: Line[], leading: number): number {
  const single: number[] = [];
  const double: number[] = [];
  for (let k = 1; k < lines.length; k++) {
    const [a, b] = [lines[k - 1], lines[k]];
    const gap = a.y - b.y;
    if (a.cells.length !== 1 || b.cells.length !== 1 || [...a.text].length < 40 || [...b.text].length < 40) continue;
    if (Math.abs(a.size - b.size) >= 0.6 || b.x > a.x + 1 || gap <= b.size * 1.05 || gap >= b.size * 3) continue;
    (gap < b.size * 2 ? single : double).push(gap / b.size);
  }
  return double.length >= 4 && double.length > single.length * 2 ? Math.max(leading, median(double)) : leading;
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
  // Set in from the next line's column's edge (markEdges): in the page's
  // right column every paragraph split after its first line (Elsevier,
  // Nature: 17 pt read as a block indent).
  const edge = after ? leftEdge(after, ctx) : ctx.columnLeft;
  return (
    line.cells.length === 1 &&
    !(BULLET_RE.test(line.text) && line.size <= ctx.bodySize * 1.15) &&
    line.x > edge + line.size * 0.6 &&
    line.x < edge + line.size * 6 &&
    after !== undefined &&
    runOf[i + 1] === -1 &&
    after.cells.length === 1 &&
    Math.abs(after.x - edge) <= 3 &&
    // The indent against the paragraph's next line: up to 3.2 em, or up to
    // 5 em when the line runs to the column's edge as a wrapped first line
    // does (Word's half-inch indent is 3.3 em at 11 pt, and its first lines
    // read as one-line items).
    (line.x - after.x <= line.size * 3.2 ||
      (line.x - after.x <= line.size * 5 && line.xEnd >= columnEdges(lines, i, ctx).right - line.size * 1.5)) &&
    line.y - after.y > 0 &&
    line.y - after.y <= after.size * ctx.leading * 1.3 &&
    !sizesDiffer(after, line, ctx) &&
    // A marker read by family, not any parenthesized word: "(BTS) Airline…"
    // under a paragraph's first line is its second line, and so are an
    // initial ("A. Vaswani…") and a citation ("[30] discussion…").
    (marker === null || marker.family === "cite" || (marker.family === "upperAlpha" && marker.shape === "x."))
  );
}

// The width of a line's first word, across the items the text layer cut it
// into where its look changes: the first item alone read an opening quote
// as the whole word (“ of “Partnership”),), and a wrapped line as one the
// writer broke (synth-agreement-html).
function firstWord(line: Line): number {
  let end = line.x;
  for (const item of [...line.items].sort((a, b) => a.x - b.x)) {
    if (item.x > end + line.size * 0.12 && end > line.x) break;
    const cut = item.str.search(/\S\s/);
    if (cut >= 0) return Math.max(line.firstWordWidth, item.x + (item.w * (cut + 1)) / item.str.length - line.x);
    end = item.x + item.w;
  }
  return Math.max(line.firstWordWidth, end - line.x);
}

// A line's words, less the marks set apart after them: a form's box dash
// ("… whose number to enter.  –") ends no sentence ("Part II
// Certification" under it joined its paragraph: the W-9).
function wordsText(line: Line): string {
  let n = line.cells.length;
  while (n > 1 && !/[\p{L}\p{N}]/u.test(line.cells[n - 1].text)) n--;
  return (n === line.cells.length ? line.text : line.cells.slice(0, n).map((c) => c.text).join(" ")).trim();
}

// A float's label alone on its line: "TABLE I", "Figure 3.".
const FLOAT_LABEL_RE = /^(?:fig\.?|figure|table|tab\.)\s*(?:\d+|[A-Z]\d+|[IVXL]+)[.:]?$/i;

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
  const step = paragraphStep(lines, ctx);
  let j = i + 1;
  while (j < lines.length) {
    const next = lines[j];
    const prev = group[group.length - 1];
    const gap = prev.y - next.y;
    const prevTerminal = TERMINAL_RE.test(wordsText(prev));
    const nextMarker = readMarker(next);
    // Centered lines of one paragraph start at different x (a caption's two
    // lines, a court's centered caption): their shifts are no indent, and
    // their ends say nothing of the paragraph's end.
    const centered = isCentered(lines, j - 1, ctx) && isCentered(lines, j, ctx);
    // A line set in by the page's own first-line indent under a paragraph's
    // line at the column's edge opens the next paragraph, under a full line
    // too: amsbook's half-em indent is under isIndented's reach, and
    // paragraphs ran into the one above. A paragraph's second line under its
    // first may be a hanging indent.
    const stepsIn =
      step !== null &&
      group.length >= 2 &&
      !centered &&
      Math.abs(next.x - prev.x - step) <= next.size * 0.15 &&
      Math.abs(prev.x - leftEdge(prev, ctx)) <= prev.size * 0.5;
    // A line that stops short of the column's edge after a sentence ends its
    // paragraph when the next line opens a sentence: the next line's first
    // word would have fit, so the break was the writer's. In a document with
    // no space between paragraphs it is the only sign (a Google Docs
    // export's paragraphs and table notes read as one before).
    // With no sentence's end, the line stops short by an em more than that
    // word: dated lines one under another and a paper's author lines ran
    // together.
    const word = firstWord(next);
    const roomy = prev.xEnd + prev.size * 1.28 + word < sentenceEdge;
    const endsShort =
      !centered &&
      sentenceEdge > 0 &&
      (prevTerminal || roomy) &&
      prev.xEnd + prev.size * 0.28 + word <= sentenceEdge - 1 &&
      OPENS_SENTENCE_RE.test(next.text);
    // A line that opens with a raised label (an affiliation's "1Department
    // of Physics…", a note's "²") starts a paragraph of its own: the
    // affiliations of arxiv-2504-02736 ran into one.
    const first = next.runs[0];
    const labelled = first !== undefined && first.start === 0 && first.sup === true && !first.zone && /^[\d*∗†‡§¶‖,\s]+$/u.test(next.text.slice(0, first.end));
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
      // A line set larger than the body stands alone (no heading reader
      // took it), unless it goes on a centered line of its own size: a
      // title page's author line, set large and wrapped in two
      // (real-jnlp-31-47-p1).
      (next.size > body * (ctx.ocr ? 1.3 : 1.14) && !(centered && !ctx.ocr && Math.abs(next.size - prev.size) <= 0.5)) ||
      endsShort ||
      stepsIn ||
      labelled ||
      // A centered line under a shorter one whose room would have taken its
      // first word, wider by as much on each side: the writer broke the
      // line, and a paragraph starts (a title slide's credit lines, "David
      // Wiley, Lumen Learning" over "This presentation is licensed CC BY",
      // real-gslides-oer-5rs p2). An IEEE caption's label ("TABLE I") over
      // its title is one caption.
      (centered &&
        !ctx.ocr &&
        !FLOAT_LABEL_RE.test(prev.text.trim()) &&
        next.xEnd - next.x > prev.xEnd - prev.x + next.firstWordWidth + next.size * 0.3 &&
        Math.abs(prev.x - next.x - (next.xEnd - prev.xEnd)) <= next.size * 0.5) ||
      // Centered lines set wholly bold, each short of its column, are lines
      // of their own: a statement's company, title, and units lines ran
      // into one paragraph (real-sec-10k-goog-2024-p54).
      (centered &&
        boldShare(prev.runs, prev.text.length) > 0.9 &&
        boldShare(next.runs, next.text.length) > 0.9 &&
        prev.xEnd + prev.size * 1.28 + next.firstWordWidth < (lineColumn(prev)?.[1] ?? 0)) ||
      TOC_LABEL_RE.test(next.text.trim()) ||
      // A line stretched into cells tells no indent of its own.
      (isIndented(next, ctx) && prev.cells.length === 1 && !isIndented(prev, ctx) && !hanging && !centered) ||
      // An equation's line and a text line never share a paragraph: the
      // label under an underbrace joined the formula and diluted its math
      // share below the equation threshold (import compare loop finding).
      isDisplayMathLine(prev, ctx) !== isDisplayMathLine(next, ctx) ||
      // A marker opening the next line starts an item — a glyph bullet or a
      // box always, a number or a "(7)" only under a line that ended short
      // of the column edge or with a sentence: "(7) Weight-space…" at a line
      // start inside a justified paragraph is text (import compare loop
      // finding), and so is a number that opens no list under a line that
      // stops mid-sentence ("40 CFR part" | "178. To ensure…").
      (nextMarker !== null &&
        readMarker(prev) === null &&
        !(!opensSequence(nextMarker) && /[\p{Ll},]$/u.test(prev.text.trim())) &&
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
  const { tokens, indent } = layout(lines, i, j, ctx, text);
  const html = tokens.length > 0 ? `<p class="${tokens.join(" ")}"></p>` : undefined;
  return { segments: [{ type: "PARAGRAPH", text, ...(html ? { html } : {}), ...(indent ? { indent } : {}), page: line.page, runs, ...geom(group) }], next: j };
}

// What a paragraph's lines show of its layout: the class tokens the reader
// and the import converter read — its alignment ("center", "right", or
// "justify", lineAlign), "caption" for a table's or a figure's caption, and
// its indent's kind: "indent-first" (the first line set in from the
// others), "indent-hanging" (the others set in from the first), or
// "indent-block" (every line set in from the column's edge) — and the
// indent's size (ParsedBlock.indent). A centered or flush-right paragraph
// shows no indent. One line alone set in by the page's first-line indent
// shows that indent, and set in otherwise a block indent (a form's label
// lines under its item; one-line definitions set in by the page's indent
// read flush).
export function layout(lines: Line[], from: number, to: number, ctx: PageContext, text: string): { tokens: string[]; indent?: Indent } {
  const tokens: string[] = [];
  const group = lines.slice(from, to);
  const first = group[0];
  const size = first.size;
  const align = lineAlign(lines, from, to, ctx);
  if (align) tokens.push(align);
  if (CAPTION_RE.test(text)) tokens.push("caption");
  if (align === "center" || align === "right") return { tokens };
  // A block's indent is from its own column's left edge (markEdges): against
  // the page's first column, every paragraph of the second read as set in.
  const left = leftEdge(group[group.length > 1 ? 1 : 0], ctx);
  // A block indent leaves the column's words room: a quarter of the column
  // at most, and the widest line fits after it (a form's box read as set in
  // 461 pt of a 468 pt text width, and the page editor broke its words; a
  // column read with a float's edge set every paragraph in by 165 pt).
  const right = Math.max(lineColumn(first)?.[1] ?? 0, ...group.map((l) => l.xEnd));
  const widest = Math.max(...group.map((l) => l.xEnd - l.x));
  const fits = (inset: number) => inset <= (right - left) / 4 && inset + widest <= right - left + size;
  let indent: Indent | null = null;
  if (group.length === 1) {
    const step = paragraphStep(lines, ctx);
    const inset = first.x - left;
    // A line that runs to the column's edge over a line back at the edge is
    // a paragraph's first line read alone: its inset is the paragraph's
    // first-line indent (a double-spaced report's half inch, 36 pt, read as
    // a block indent: its lines stand farther apart than a paragraph's).
    const next = lines[to];
    const wraps =
      next !== undefined &&
      next.cells.length === 1 &&
      next.y < first.y &&
      !sizesDiffer(next, first, ctx) &&
      Math.abs(next.x - leftEdge(next, ctx)) <= size * 0.5 &&
      Math.abs(leftEdge(next, ctx) - left) <= size * 0.5 &&
      fillsMargin(first, next, right);
    // Set in by the page's step from the column's edge, or from the column
    // split's extent where it stands a little left of that edge: a column's
    // references set their labels in by 3 pt, and the acknowledgment's one
    // line over them lost its first-line indent.
    const column = lineColumn(first);
    const stepped = (x: number) => step !== null && Math.abs(first.x - x - step) <= size * 0.15;
    if (step !== null && (stepped(left) || (column !== undefined && column[0] < left && left - column[0] <= size && stepped(column[0])))) indent = { left: 0, first: step };
    else if (inset >= size && wraps && inset <= size * 5) indent = { left: 0, first: inset };
    else if (inset >= size && fits(inset)) indent = { left: inset, first: 0 };
  } else {
    const xs = group.slice(1).map((l) => l.x).sort((a, b) => a - b);
    const restX = xs[Math.floor(xs.length / 2)];
    if (!xs.every((x) => Math.abs(x - restX) <= size * 0.5)) return { tokens };
    const shift = first.x - restX;
    const inset = restX - left;
    // A first-line indent from a third of an em: amsbook's is half of one,
    // and at half an em rounding decided (paragraphs read flush). An OCR
    // layer's lines jitter by that much.
    if (shift >= size * (ctx.ocr ? 0.5 : 0.3) && shift <= size * 4) indent = { left: inset >= size && fits(inset) ? inset : 0, first: shift };
    else if (-shift >= size * 0.5 && -shift <= size * 4) {
      // A hanging first line stands at the column's edge or right of it:
      // where most of a bibliography's lines are its entries' wraps, the
      // column's edge is theirs.
      const base = Math.min(left, first.x);
      indent = { left: fits(restX - base) ? restX - base : -shift, first: shift };
    } else if (Math.abs(shift) <= size * 0.5 && inset > size && fits(inset)) indent = { left: inset, first: 0 };
  }
  if (!indent) return { tokens };
  tokens.push(indent.first > 0 ? "indent-first" : indent.first < 0 ? "indent-hanging" : "indent-block");
  return { tokens, indent: { left: Math.round(indent.left), first: Math.round(indent.first) } };
}

/** The space after each text block of a page (ParsedBlock.spaceAfter): the
    gap from its lines to the next text block's under it in its column,
    beyond the text's line pitch, in points; none where a figure, a table,
    or the page's end follows. A Google Docs export marks a gap with a blank
    line and sets none between a label and its lines: the import's fixed
    10 pt after every paragraph set each line of such a page apart. */
export function measureSpacing(segments: Segment[], ctx: PageContext) {
  const text = (s: Segment) => s.type === "PARAGRAPH" || s.type === "HEADING" || s.type === "LIST";
  for (let k = 0; k + 1 < segments.length; k++) {
    const [a, b] = [segments[k], segments[k + 1]];
    if (!text(a) || !text(b) || !a.box || !b.box || a.page !== b.page) continue;
    const size = b.lineSize ?? ctx.bodySize;
    // b stands under a, and their columns meet.
    if (b.box.y2 > a.box.y1 + size || b.box.x1 > a.box.x2 || b.box.x2 < a.box.x1) continue;
    // A line's box reaches 0.3 of its size under its baseline and 0.85
    // over it (geometry.ts): lines at the text's pitch leave the rest.
    const gap = a.box.y1 - b.box.y2 - (ctx.leading - 1.15) * size;
    if (gap > -size) a.spaceAfter = Math.max(0, Math.round(gap));
  }
}

// Right-to-left lines read mirrored. A paragraph or a list set right to left
// starts its lines at the column's right edge and wraps short at its left:
// the readers measure starts, indents, and wraps from the left. Mirrored
// across the page, a right-to-left line starts at the left, and the list
// and paragraph readers read it as they read a left-to-right one (parse
// loop finding: an Arabic book's bullets "▪" read at three depths, one per
// line length, and each paragraph's last line, short at the left, read as
// a paragraph of its own set flush right).
//
// The mirror copies the page's lines, its context, and the caches the
// readers keep per line: the column each line was read in (columns.ts
// lineColumn) and each line's column edge (paragraphs.ts markLineEdges,
// measured again on the copies). Text and style runs stay as they are: a
// line's text is in reading order already. A block read on the copies
// takes the page's own boxes back (unmirror).

import { mirrorColumn } from "@/lib/parse/pdf/columns";
import { markLineEdges } from "@/lib/parse/pdf/paragraphs";
import type { Box, Item, Line, PageContext, Segment, Step } from "@/lib/parse/pdf/types";

const RTL_LETTER_RE = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/gu;
const LETTER_RE = /\p{L}/gu;

/** A line whose letters are most in a right-to-left script. */
export function readsRightToLeft(line: Line): boolean {
  if (line.table || line.display) return false;
  const rtl = line.text.match(RTL_LETTER_RE)?.length ?? 0;
  const all = line.text.match(LETTER_RE)?.length ?? 0;
  return rtl > 0 && rtl * 2 > all;
}

export type Mirror = { lines: Line[]; ctx: PageContext; axis: number };

const flipBox = <B extends Box>(b: B, axis: number): B => ({ ...b, x1: axis - b.x2, x2: axis - b.x1 });

// The width of the first word read: a right-to-left item reads from its
// right end.
function firstWordWidth(item: Item): number {
  const word = item.str.trim().split(/\s+/)[0] ?? "";
  return item.str.length > 0 ? item.w * Math.min(1, word.length / item.str.length) : item.size;
}

function mirrorLine(line: Line, axis: number): Line {
  const items = line.items.map((it) => ({ ...it, x: axis - it.x - it.w })).sort((a, b) => a.x - b.x);
  // A cell starts at the item read first in it: the page's item at the
  // cell's x, whose right end the mirror puts at the cell's left.
  const cells = line.cells.map((cell) => {
    const at = line.items.find((it) => Math.abs(it.x - cell.x) < 0.01);
    return { ...cell, x: at ? axis - at.x - at.w : axis - line.xEnd };
  });
  const last = line.items.reduce((a, b) => (b.x + b.w > a.x + a.w ? b : a), line.items[0]);
  return {
    ...line,
    cells,
    items,
    x: axis - line.xEnd,
    xEnd: axis - line.x,
    firstWordWidth: last ? firstWordWidth(last) : line.firstWordWidth,
  };
}

// The page's column, as index.ts reads it: the smallest x that body lines
// regularly start at.
function columnLeftOf(lines: Line[]): number {
  const xs = lines.filter((l) => l.cells.length === 1 && l.text.length > 30).map((l) => Math.round(l.x));
  const counts = new Map<number, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  const prominent = Math.max(2, Math.ceil(xs.length * 0.12));
  const regular = [...counts].filter(([, n]) => n >= prominent).map(([x]) => x);
  return regular.length > 0 ? Math.min(...regular) : lines.length > 0 ? Math.min(...lines.map((l) => l.x)) : 0;
}

/** The page's lines and context mirrored across the page's text. */
export function mirrorPage(lines: Line[], ctx: PageContext): Mirror {
  const text = lines.filter((l) => !l.table);
  const axis = text.length > 0 ? Math.min(...text.map((l) => l.x)) + Math.max(...text.map((l) => l.xEnd)) : 0;
  const mirrored = lines.map((l) => (l.table ? l : mirrorLine(l, axis)));
  lines.forEach((l, k) => {
    if (!l.table) mirrorColumn(l, mirrored[k], axis);
  });
  const flip = <B extends Box>(b: B) => flipBox(b, axis);
  const drawing = ctx.drawing;
  const mctx: PageContext = {
    ...ctx,
    columnLeft: columnLeftOf(mirrored.filter((l) => !l.table)),
    pageMinX: text.length > 0 ? Math.min(...mirrored.filter((l) => !l.table).map((l) => l.x)) : 0,
    labelColumn: null,
    frames: ctx.frames.map(flip),
    drawing: { ...drawing, rules: drawing.rules.map(flip), fills: drawing.fills.map(flip), images: drawing.images.map(flip), paths: drawing.paths.map(flip), shades: drawing.shades.map(flip) },
  };
  markLineEdges(mirrored, mctx);
  return { lines: mirrored, ctx: mctx, axis };
}

/** A step read on mirrored lines, its blocks at the page's own place. */
export function unmirror(step: Step | null, axis: number): Step | null {
  if (!step) return null;
  const back = (s: Segment): Segment => ({
    ...s,
    ...(s.box ? { box: flipBox(s.box, axis) } : {}),
    ...(s.lineBox ? { lineBox: flipBox(s.lineBox, axis) } : {}),
    ...(s.glyphBox ? { glyphBox: flipBox(s.glyphBox, axis) } : {}),
    ...(s.captionBox ? { captionBox: flipBox(s.captionBox, axis) } : {}),
  });
  return { ...step, segments: step.segments.map(back) };
}

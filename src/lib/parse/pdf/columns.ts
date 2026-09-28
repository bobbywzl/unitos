// Reading order (memo P0-F §5.2, a recursive XY-cut): a region of the page
// is cut at a gutter that almost no text crosses. The rows that cross it span
// both sides and split the region into bands; in each band the left side
// reads before the right, and each side is a region of its own (a third
// column, a sidebar). A graphic takes part as a block: a graphic beside a
// column of text is a column of its own, and its place in the order is where
// its figure goes.

import { buildLines } from "@/lib/parse/pdf/lines";
import type { Box, Item, Line } from "@/lib/parse/pdf/types";

// A graphic in the reading order: after is the last line read before it
// (null when it comes first on the page), order its place among the page's
// graphics.
export type Placed = { box: Box; after?: Line | null; order?: number };

// A run of items read together, and the extent of the column they belong
// to (the leaf's, or the spanning row's own); its lines when a column test
// built them already.
type Piece = { items: Item[]; extent?: [number, number]; lines?: Line[] } | { graphic: Placed };

// The column each line was read in: its extent on the page. A figure's
// caption takes its figure's width from it (figures.ts).
const columns = new WeakMap<Line, [number, number]>();
export function lineColumn(line: Line): [number, number] | undefined {
  return columns.get(line);
}

const chars = (list: Item[]) => list.reduce((n, i) => n + i.str.trim().length, 0);

export function pageLines(items: Item[], pageWidth: number, page: number, graphics: Placed[] = []): Line[] {
  const text = items.filter((i) => i.str.trim().length > 0);
  if (text.length === 0 && graphics.length === 0) return [];
  const pieces = readRegion(text, graphics, page, pageWidth, 0);
  const lines: Line[] = [];
  let order = 0;
  for (const piece of pieces) {
    if ("graphic" in piece) {
      Object.assign(piece.graphic, { after: lines[lines.length - 1] ?? null, order: order++ });
      continue;
    }
    const built = piece.lines ?? buildLines(piece.items, page);
    const extent = piece.extent ?? [Math.min(...built.map((l) => l.x)), Math.max(...built.map((l) => l.xEnd))];
    for (const line of built) columns.set(line, extent);
    lines.push(...built);
  }
  return lines;
}

function readRegion(items: Item[], graphics: Placed[], page: number, pageWidth: number, depth: number, lines?: Line[]): Piece[] {
  const split = depth < 3 ? findSplit(items, graphics, page, pageWidth) : null;
  if (!split) return leaf(items, graphics, lines);
  const out: Piece[] = [];
  for (const band of split.bands) {
    // A band where neither side is prose (a wide table's rows, a form under
    // two columns of text) reads in one pass, so its rows stay whole. A
    // band of a line or two a side (between an overfull line and a float)
    // is columns still.
    const left = buildLines(band.left.items, page);
    const right = left.length >= 3 ? buildLines(band.right.items, page) : [];
    const whole = left.length >= 3 && right.length >= 3 && !isProse(left, 1) && !isProse(right, 1);
    if (whole) out.push(...leaf([...band.left.items, ...band.right.items], [...band.left.graphics, ...band.right.graphics]));
    else {
      out.push(...readRegion(band.left.items, band.left.graphics, page, pageWidth, depth + 1, left));
      out.push(...readRegion(band.right.items, band.right.graphics, page, pageWidth, depth + 1, left.length >= 3 ? right : undefined));
    }
    if (band.separator) out.push(band.separator);
  }
  return out;
}

// One column: its lines top to bottom, and each graphic after the lines
// above it and the lines beside it on its left (a slide's text beside its
// photo reads first); graphics on one row read left to right. lines: the
// items' lines, when the band test built them.
function leaf(items: Item[], graphics: Placed[], lines?: Line[]): Piece[] {
  const sorted = [...graphics].sort((a, b) => {
    const overlap = Math.min(a.box.y2, b.box.y2) - Math.max(a.box.y1, b.box.y1);
    const shorter = Math.min(a.box.y2 - a.box.y1, b.box.y2 - b.box.y1);
    return overlap > shorter * 0.5 ? a.box.x1 - b.box.x1 : b.box.y2 - a.box.y2;
  });
  const out: Piece[] = [];
  const extent: [number, number] = [Math.min(...items.map((i) => i.x)), Math.max(...items.map((i) => i.x + i.w))];
  let rest = items;
  for (const graphic of sorted) {
    const { x1, x2, y1, y2 } = graphic.box;
    const first = (i: Item) => i.y > y2 || (i.y >= y1 && i.x + i.w / 2 < (x1 + x2) / 2);
    const before = rest.filter(first);
    rest = rest.filter((i) => !first(i));
    if (before.length > 0) out.push({ items: before, extent });
    out.push({ graphic });
  }
  if (rest.length > 0) out.push({ items: rest, extent, lines: rest === items ? lines : undefined });
  return out;
}

type Side = { items: Item[]; graphics: Placed[] };
type Band = { left: Side; right: Side; separator: Piece | null };

// The gutter of a region, and its bands, when the region reads as columns:
// few characters cross the gutter, and in the bands with something on both
// sides, each side is prose set in a column (or graphics only, beside a
// column of text). A wide table also leaves a gutter, but its sides are
// short cells: those regions stay in one pass so rows keep their reading
// order.
function findSplit(items: Item[], graphics: Placed[], page: number, pageWidth: number): { bands: Band[] } | null {
  if (items.length === 0) return null;
  const x0 = Math.min(...items.map((i) => i.x), ...graphics.map((p) => p.box.x1));
  const x1 = Math.max(...items.map((i) => i.x + i.w), ...graphics.map((p) => p.box.x2));
  const width = x1 - x0;
  const total = chars(items);
  if (width < pageWidth * 0.3 || total === 0) return null;

  // The gutter: the x that the fewest characters cross, the one nearest the
  // region's middle among equals.
  let best: { g: number; cross: number } | null = null;
  const middle = x0 + width / 2;
  for (let g = x0 + width * 0.2; g <= x0 + width * 0.8; g += width * 0.01) {
    let cross = 0;
    for (const i of items) if (i.x < g && i.x + i.w > g) cross += i.str.trim().length;
    if (!best || cross < best.cross || (cross === best.cross && Math.abs(g - middle) < Math.abs(best.g - middle))) {
      best = { g, cross };
    }
  }
  if (!best || best.cross / total >= 0.5) return null;
  const g = best.g;

  // Rows that span the gutter: the items that cross it, the items on either
  // side of it with no more than a word's gap between them, up to 1.2 em (a
  // full-width caption whose word gap fell on the gutter was read as two
  // halves; REVTeX sets "FIG. 2." 0.86 em from its words, arXiv 2502.02648;
  // a two-column gutter is 1.4 em or more), and
  // the items that run on from those along their baseline (a line of word
  // items has one word over the gutter and the rest on either side).
  const byY = [...items].sort((a, b) => a.y - b.y);
  const maxSize = Math.max(...items.map((i) => i.size));
  const near = (s: Item) => {
    // The items near s's baseline: a binary search for the window's start.
    let lo = 0;
    let hi = byY.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (byY[mid].y < s.y - maxSize * 0.5) lo = mid + 1;
      else hi = mid;
    }
    const out: Item[] = [];
    for (let k = lo; k < byY.length && byY[k].y <= s.y + maxSize * 0.5; k++) {
      const item = byY[k];
      const size = Math.max(s.size, item.size);
      const gap = Math.max(item.x - (s.x + s.w), s.x - (item.x + item.w));
      if (item !== s && Math.abs(item.y - s.y) < size * 0.5 && gap < size * 1.2) out.push(item);
    }
    return out;
  };
  const spanning = new Set(items.filter((i) => i.x < g && i.x + i.w > g));
  for (const item of items) {
    if (item.x + item.w > g) continue;
    const across = near(item).filter((j) => j.x >= g);
    if (across.length > 0) [item, ...across].forEach((i) => spanning.add(i));
  }
  const queue = [...spanning];
  while (queue.length > 0) {
    for (const item of near(queue.pop()!)) {
      if (spanning.has(item)) continue;
      spanning.add(item);
      queue.push(item);
    }
  }
  // Two columns of text hold two fifths of the region's characters beside
  // each other, off the spanning rows: with no graphic to stand beside a
  // column (none, or each across the gutter, as a scan's page image is), a
  // region with less off them reads in one pass, and its spanning rows are
  // never built (a page of one column whose lines cross the gutter).
  if (graphics.every((p) => p.box.x1 < g && p.box.x2 > g) && total - chars([...spanning]) < total * 0.4) return null;
  const rows = buildLines([...spanning], page);
  const crossingGraphics = graphics.filter((p) => p.box.x1 < g && p.box.x2 > g);
  // Separators top to bottom: the spanning rows (by baseline) and the
  // graphics that cross the gutter (by their middle).
  const separators: { y: number; piece: Piece }[] = [
    ...rows.map((l) => ({ y: l.y, piece: { items: l.items } as Piece })),
    ...crossingGraphics.map((p) => ({ y: (p.box.y1 + p.box.y2) / 2, piece: { graphic: p } as Piece })),
  ].sort((a, b) => b.y - a.y);
  const bands: Band[] = separators.map((s) => ({ left: { items: [], graphics: [] }, right: { items: [], graphics: [] }, separator: s.piece }));
  bands.push({ left: { items: [], graphics: [] }, right: { items: [], graphics: [] }, separator: null });
  const bandOf = (y: number) => {
    const k = separators.findIndex((s) => y > s.y);
    return k < 0 ? separators.length : k;
  };
  for (const item of items) {
    if (spanning.has(item)) continue;
    const band = bands[bandOf(item.y)];
    (item.x + item.w / 2 < g ? band.left : band.right).items.push(item);
  }
  for (const graphic of graphics) {
    if (crossingGraphics.includes(graphic)) continue;
    const band = bands[bandOf((graphic.box.y1 + graphic.box.y2) / 2)];
    ((graphic.box.x1 + graphic.box.x2) / 2 < g ? band.left : band.right).graphics.push(graphic);
  }

  // The bands with something on both sides decide.
  const twoSided = bands.filter(
    (b) => (b.left.items.length > 0 || b.left.graphics.length > 0) && (b.right.items.length > 0 || b.right.graphics.length > 0),
  );
  if (twoSided.length === 0) return null;
  const left = twoSided.flatMap((b) => b.left.items);
  const right = twoSided.flatMap((b) => b.right.items);
  const leftChars = chars(left);
  const rightChars = chars(right);
  const sideChars = leftChars + rightChars;
  const leftGraphics = twoSided.some((b) => b.left.graphics.length > 0);
  const rightGraphics = twoSided.some((b) => b.right.graphics.length > 0);
  // A graphic beside a column of text: the text side is prose, the other
  // side graphics and at most a stray mark (a slide's page number).
  const graphicsLeft = leftGraphics && leftChars <= sideChars * 0.05;
  const graphicsRight = rightGraphics && rightChars <= sideChars * 0.05;
  if (graphicsLeft || graphicsRight) return isProse(buildLines(graphicsLeft ? right : left, page), 2) ? { bands } : null;
  if (leftChars === 0 || rightChars === 0) return null;
  // Two columns of text: most of the region's characters sit beside each
  // other, each side holds a fair share, and each side is a prose column.
  if (sideChars < total * 0.4) return null;
  if (leftChars < sideChars * 0.15 || rightChars < sideChars * 0.15) return null;
  return isColumn(left, page) && isColumn(right, page) ? { bands } : null;
}

// A prose column: its lines start at the column's edge or the paragraph
// indent — two x positions hold most of its characters — and most of its
// letters sit in lines of 15 letters or more with no wide gap. A table's
// side starts its rows at many x positions, or holds numbers, short cells,
// or rows of cells (MMWR's wide table read as two columns); a form's side
// holds fill-in lines (a signature page's two blocks are one table).
function isColumn(items: Item[], page: number): boolean {
  const lines = buildLines(items, page);
  if (lines.length < 6) return false;
  const byX = new Map<number, number>();
  let all = 0;
  for (const line of lines) {
    const x = Math.round(line.x / 4) * 4;
    const n = line.text.replace(/\s/g, "").length;
    byX.set(x, (byX.get(x) ?? 0) + n);
    all += n;
  }
  const sorted = [...byX.values()].sort((a, b) => b - a);
  return (sorted[0] ?? 0) + (sorted[1] ?? 0) >= all * 0.62 && isProse(lines, 6);
}

function isProse(lines: Line[], minLines: number): boolean {
  if (lines.length < minLines) return false;
  const letters = (l: Line) => l.text.replace(/[^\p{L}]/gu, "").length;
  const all = lines.reduce((n, l) => n + letters(l), 0);
  const prose = lines.filter((l) => l.cells.length === 1 && letters(l) >= 15).reduce((n, l) => n + letters(l), 0);
  return all > 0 && prose >= all * 0.6;
}

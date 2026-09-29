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
  const split = depth < 3 ? findSplit(items, graphics, page, pageWidth, depth) : null;
  if (!split) return leaf(items, graphics, lines);
  const out: Piece[] = [];
  let aboveWhole = false;
  for (const band of split.bands) {
    // A band where neither side is prose (a wide table's rows, a form under
    // two columns of text) reads in one pass, so its rows stay whole. A
    // band of a line or two a side (between an overfull line and a float)
    // is columns still, unless the band above it was read in one pass: then
    // it holds the table's last rows (arXiv 2411.19946 p. 12: read apart,
    // the right half of a table's last row left the table and ran into the
    // paragraph under it).
    const fewest: number = aboveWhole ? 1 : 3;
    const left = buildLines(band.left.items, page);
    const right = left.length >= fewest ? buildLines(band.right.items, page) : [];
    const whole = left.length >= fewest && right.length >= fewest && !isProse(left, 1) && !isProse(right, 1);
    if (whole) out.push(...leaf([...band.left.items, ...band.right.items], [...band.left.graphics, ...band.right.graphics]));
    else {
      out.push(...readRegion(band.left.items, band.left.graphics, page, pageWidth, depth + 1, left));
      out.push(...readRegion(band.right.items, band.right.graphics, page, pageWidth, depth + 1, left.length >= fewest ? right : undefined));
    }
    aboveWhole = whole;
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
// order. depth: how many regions this one lies in (a side tested as columns
// of its own counts one more).
function findSplit(items: Item[], graphics: Placed[], page: number, pageWidth: number, depth: number): { bands: Band[] } | null {
  if (items.length === 0) return null;
  const x0 = Math.min(...items.map((i) => i.x), ...graphics.map((p) => p.box.x1));
  const x1 = Math.max(...items.map((i) => i.x + i.w), ...graphics.map((p) => p.box.x2));
  const width = x1 - x0;
  const total = chars(items);
  if (width < pageWidth * 0.3 || total === 0) return null;

  // The gutters to try: each valley of the characters that cross an x, the
  // x of a valley nearest the region's middle, the fewest crossings first.
  // The fewest are not always the columns': the IRS W-9 sets two columns of
  // instructions under a form whose field 4 stands in a column of its own,
  // and the form's lines cross the columns' gutter.
  const middle = x0 + width / 2;
  const scan: { g: number; cross: number }[] = [];
  for (let g = x0 + width * 0.2; g <= x0 + width * 0.8; g += width * 0.01) {
    let cross = 0;
    for (const i of items) if (i.x < g && i.x + i.w > g) cross += i.str.trim().length;
    scan.push({ g, cross });
  }
  const valleys: { g: number; cross: number }[] = [];
  for (let k = 0; k < scan.length; ) {
    let end = k;
    while (end + 1 < scan.length && scan[end + 1].cross === scan[k].cross) end++;
    const run = scan.slice(k, end + 1);
    const low = (k === 0 || scan[k - 1].cross > scan[k].cross) && (end === scan.length - 1 || scan[end + 1].cross > scan[k].cross);
    if (low && scan[k].cross / total < 0.5) valleys.push(run.reduce((a, b) => (Math.abs(b.g - middle) < Math.abs(a.g - middle) ? b : a)));
    k = end + 1;
  }
  valleys.sort((a, b) => a.cross - b.cross || Math.abs(a.g - middle) - Math.abs(b.g - middle));
  for (const { g } of valleys.slice(0, 3)) {
    const split = splitAt(items, graphics, page, pageWidth, depth, g, total);
    if (split) return split;
  }
  return null;
}

// The region cut at the gutter g, when it reads as columns there.
function splitAt(items: Item[], graphics: Placed[], page: number, pageWidth: number, depth: number, g: number, total: number): { bands: Band[] } | null {
  // Rows that span the gutter: the items that cross it, the items on either
  // side of it with no more than a word's gap between them, up to 1.2 em (a
  // full-width caption whose word gap fell on the gutter was read as two
  // halves; REVTeX sets "FIG. 2." 0.86 em from its words, arXiv 2502.02648;
  // a two-column gutter is 1.4 em or more), and
  // the items that run on from those along their baseline (a line of word
  // items has one word over the gutter and the rest on either side).
  const byY = [...items].sort((a, b) => a.y - b.y);
  const maxSize = Math.max(...items.map((i) => i.size));
  // The items near s's baseline: a binary search for the window's start.
  const beside = (s: Item) => {
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
      if (item !== s && Math.abs(item.y - s.y) < Math.max(s.size, item.size) * 0.5) out.push(item);
    }
    return out;
  };
  // The right column's edge: the x where four lines or more right of the
  // gutter start. An item there, more than half an em after the item before
  // it across the gutter, opens the right column's line: the Federal
  // Register sets its three columns 1.0 em apart, and each line of a column
  // that ran near the gutter took the next column's line into a row across
  // the page.
  const starts = new Map<number, number>();
  for (const item of items) {
    if (item.x < g || beside(item).some((j) => j.x < item.x && j.x + j.w > g)) continue;
    const x = Math.round(item.x);
    starts.set(x, (starts.get(x) ?? 0) + 1);
  }
  const counted = (x: number) => (starts.get(x - 1) ?? 0) + (starts.get(x) ?? 0) + (starts.get(x + 1) ?? 0);
  const edge = [...starts.keys()].map((x) => ({ x, n: counted(x) })).filter((e) => e.n >= 4).sort((a, b) => b.n - a.n)[0]?.x;
  const opens = (a: Item, b: Item, size: number) =>
    edge !== undefined && a.x + a.w <= g && b.x >= g && Math.abs(b.x - edge) <= 1.5 && b.x - (a.x + a.w) > size * 0.5;
  const near = (s: Item) =>
    beside(s).filter((item) => {
      const size = Math.max(s.size, item.size);
      const gap = Math.max(item.x - (s.x + s.w), s.x - (item.x + item.w));
      return gap < size * 1.2 && !(item.x > s.x ? opens(s, item, size) : opens(item, s, size));
    });
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
  // other, and each side is a prose column, however narrow (the Earth
  // Observer's pull quote beside its article holds 7% of their characters).
  if (sideChars < total * 0.4) return null;
  return isColumns(left, page, pageWidth, depth) && isColumns(right, page, pageWidth, depth) ? { bands } : null;
}

// A side of a split: a prose column, or columns of its own (a page of three
// columns cut at its first gutter holds two on its right: the Federal
// Register).
function isColumns(items: Item[], page: number, pageWidth: number, depth: number): boolean {
  return isColumn(items, page) || (depth < 2 && findSplit(items, [], page, pageWidth, depth + 1) !== null);
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

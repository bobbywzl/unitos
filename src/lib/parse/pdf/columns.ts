// Reading order (memo P0-F §5.2, a recursive XY-cut): a region of the page
// is cut at a gutter that almost no text crosses. The rows that cross it span
// both sides and split the region into bands; in each band the left side
// reads before the right, and each side is a region of its own (a third
// column, a sidebar). A graphic takes part as a block: a graphic beside a
// column of text is a column of its own, and its place in the order is where
// its figure goes.

import { median } from "@/lib/parse/pdf/geometry";
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

// The page's horizontal rules outside its tables, while pageLines reads it:
// a rule across a gutter ends the band of columns above it (splitAt).
let pageRules: Box[] = [];

export function pageLines(items: Item[], pageWidth: number, page: number, graphics: Placed[] = [], rules: Box[] = []): Line[] {
  const text = items.filter((i) => i.str.trim().length > 0);
  if (text.length === 0 && graphics.length === 0) return [];
  pageRules = rules;
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

// extent: the column the region's lines were read in, when it is not the
// region's own (blocks side by side in a column).
function readRegion(items: Item[], graphics: Placed[], page: number, pageWidth: number, depth: number, lines?: Line[], extent?: [number, number]): Piece[] {
  // A ruled table across the region cuts it: what stands above the table
  // and what stands under it read as regions of their own, the table
  // between them (the W-9's masthead of three boxes over its form read row
  // by row across the boxes). Their lines keep the region's column: in a
  // column as wide as its own lines, a résumé's centered name read as
  // flush left. A table's item stands at the box's middle.
  const [x0, x1] = items.length > 0 ? extentOf(items) : [0, 0];
  const table = lines ? undefined : items.find((i) => i.table && i.w >= (x1 - x0) * 0.8);
  if (table) {
    const higher = (y: number) => y > table.y;
    const column = extent ?? [x0, x1];
    return [
      ...readRegion(items.filter((i) => i !== table && higher(i.y)), graphics.filter((p) => higher((p.box.y1 + p.box.y2) / 2)), page, pageWidth, depth, undefined, column),
      { items: [table], extent },
      ...readRegion(items.filter((i) => i !== table && !higher(i.y)), graphics.filter((p) => !higher((p.box.y1 + p.box.y2) / 2)), page, pageWidth, depth, undefined, column),
    ];
  }
  const split = depth < 3 ? findSplit(items, graphics, page, pageWidth, depth) : null;
  if (!split) return leaf(items, graphics, lines, extent);
  const out: Piece[] = [];
  let aboveWhole = false;
  const own = extent ?? extentOf(items);
  for (const band of split.bands) {
    const note = band.kind === "columns" ? sideNote(band, page) : null;
    if (note) {
      // A note reads beside the paragraph that holds its top.
      for (const part of note) out.push(...readRegion(part.items, part.graphics, page, pageWidth, depth + 1));
      aboveWhole = false;
      continue;
    }
    if (band.kind && band.kind !== "columns") {
      // A part reads as a region of its own, a block in the region's column.
      for (const side of [band.left, band.right]) {
        if (side.items.length + side.graphics.length > 0) out.push(...readRegion(side.items, side.graphics, page, pageWidth, depth + 1, undefined, band.kind === "blocks" ? own : extent));
      }
      aboveWhole = false;
      continue;
    }
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

const extentOf = (items: Item[]): [number, number] => [Math.min(...items.map((i) => i.x)), Math.max(...items.map((i) => i.x + i.w))];
const width = (items: Item[]) => extentOf(items)[1] - extentOf(items)[0];

// One column: its lines top to bottom, and each graphic after the lines
// above it and the lines beside it on its left (a slide's text beside its
// photo reads first); graphics on one row read left to right. lines: the
// items' lines, when the band test built them.
function leaf(items: Item[], graphics: Placed[], lines?: Line[], column?: [number, number]): Piece[] {
  const sorted = [...graphics].sort((a, b) => {
    const overlap = Math.min(a.box.y2, b.box.y2) - Math.max(a.box.y1, b.box.y1);
    const shorter = Math.min(a.box.y2 - a.box.y1, b.box.y2 - b.box.y1);
    return overlap > shorter * 0.5 ? a.box.x1 - b.box.x1 : b.box.y2 - a.box.y2;
  });
  const out: Piece[] = [];
  const extent = column ?? extentOf(items);
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
// A band: its two sides beside the gutter, then the row across the gutter
// under it. A part (what stands above or under one band) reads as a region
// of its own; blocks are a band's sides set side by side in the region's
// column (stacked).
type Band = { left: Side; right: Side; separator: Piece | null; kind?: "part" | "blocks" | "columns" };

// The gutter of a region, and its bands, when the region reads as columns:
// few characters cross the gutter, and in the bands with something on both
// sides, each side is prose set in a column (or graphics only, beside a
// column of text). A wide table also leaves a gutter, but its sides are
// short cells: those regions stay in one pass so rows keep their reading
// order. depth: how many regions this one lies in (a side tested as columns
// of its own counts one more); oneBand: a page may be read as one band of
// columns (bandGutter).
function findSplit(items: Item[], graphics: Placed[], page: number, pageWidth: number, depth: number, oneBand = true): { bands: Band[] } | null {
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
  const split = best && best.cross / total < 0.5 ? splitAt(items, graphics, page, pageWidth, depth, best.g, total) : null;
  if (split) return split;
  const margin = marginGutter(items, graphics, x0, width);
  const notes = margin === null ? null : splitAt(items, graphics, page, pageWidth, depth, margin, total);
  if (notes || !oneBand || depth > 0) return notes;
  // A page that is not two columns may still hold one band of them, or a
  // column and a note beside it: its gutter is then the one beside which
  // one clear band holds the most words on both sides (IEEE's two columns
  // under a full-width abstract; a column of italic labels beside the 10-K's
  // paragraphs, a seventh of the width).
  const g = bandGutter(items, graphics, x0, width);
  return g === null ? null : splitAt(items, graphics, page, pageWidth, depth, g, total, true);
}

// The gutter of a column of notes in the region's outer fifth, the margin a
// book sets its margin notes in: no item and no graphic crosses it, the
// notes' side holds a seventh of the characters at most, and its words are
// set smaller than the column's (a page number in the margin aside). The
// gutter stands next to the column. Parse loop finding: the MML book's
// margin notes ("associativity", "augmented matrix") stand closer to the
// page's edge than a fifth of its width, the columns test never cut there,
// and each note ran into the line of the column beside it.
function marginGutter(items: Item[], graphics: Placed[], x0: number, width: number): number | null {
  const total = chars(items);
  const sizeOf = (list: Item[]) => median(list.filter((i) => !/^\d+$/.test(i.str.trim())).map((i) => i.size));
  const clear = (g: number) => !items.some((i) => i.x < g && i.x + i.w > g) && !graphics.some((p) => p.box.x1 < g && p.box.x2 > g);
  const fits = (g: number) => {
    const left = items.filter((i) => i.x + i.w <= g);
    const right = items.filter((i) => i.x >= g);
    const [note, wide] = chars(left) < chars(right) ? [left, right] : [right, left];
    const words = note.filter((i) => !/^\d+$/.test(i.str.trim()));
    return words.length > 0 && chars(note) * 7 <= total && sizeOf(note) < sizeOf(wide) * 0.9;
  };
  const step = width * 0.01;
  // Left: the gutter nearest the column, scanning in from the fifth.
  let left: number | null = null;
  for (let g = x0 + width * 0.2; g >= x0 + width * 0.03 && left === null; g -= step) if (clear(g)) left = g;
  if (left !== null && fits(left)) return left;
  let right: number | null = null;
  for (let g = x0 + width * 0.8; g <= x0 + width * 0.97 && right === null; g += step) if (clear(g)) right = g;
  return right !== null && fits(right) ? right : null;
}

// The gutter of the region's best band: for each x, the clear bands between
// the items and graphics that come within half an em of it (a gutter is an
// em wide: a justified line's word gaps are narrower), and the fewer
// characters of a band's two sides; the x whose best band holds the most,
// nearest the region's middle among equals. None when no band holds ten
// characters on each side.
function bandGutter(items: Item[], graphics: Placed[], x0: number, width: number): number | null {
  let best: { g: number; score: number } | null = null;
  const middle = x0 + width / 2;
  const near = (i: Item, g: number) => i.x < g + i.size * 0.5 && i.x + i.w > g - i.size * 0.5;
  for (let g = x0 + width * 0.05; g <= x0 + width * 0.95; g += width * 0.01) {
    const crossing: number[] = [];
    for (const i of items) if (near(i, g)) crossing.push(i.y);
    for (const p of graphics) if (p.box.x1 < g && p.box.x2 > g) crossing.push(p.box.y1, p.box.y2);
    crossing.sort((a, b) => b - a);
    // A band's index: how many crossings stand at or above an item.
    const bandOf = (y: number) => {
      let lo = 0;
      let hi = crossing.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (crossing[mid] >= y) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    const sides = new Map<number, [number, number]>();
    for (const i of items) {
      if (near(i, g)) continue;
      const k = bandOf(i.y);
      const side = sides.get(k) ?? [0, 0];
      side[i.x + i.w / 2 < g ? 0 : 1] += i.str.trim().length;
      sides.set(k, side);
    }
    const score = Math.max(0, ...[...sides.values()].map(([l, r]) => Math.min(l, r)));
    if (!best || score > best.score || (score === best.score && Math.abs(g - middle) < Math.abs(best.g - middle))) best = { g, score };
  }
  return best && best.score >= 10 ? best.g : null;
}

// The region cut at the gutter g, when it reads as columns there. banded: g
// is a band's gutter (bandGutter), and the rows across it may hold most of
// the region's characters.
function splitAt(items: Item[], graphics: Placed[], page: number, pageWidth: number, depth: number, g: number, total: number, banded = false): { bands: Band[] } | null {
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
  // The columns' edges: on each side of the gutter, the x where four lines
  // or more start. An item at the right column's edge, more than half an em
  // after the item before it across the gutter, opens the right column's
  // line when that item's line starts at the left column's edge (not a
  // centered author line whose third name stands at the edge: arXiv
  // 2411.19946). The Federal Register sets its three columns 1.0 em apart,
  // and each line of a column that ran near the gutter took the next
  // column's line into a row across the page.
  const edgeOf = (right: boolean) => {
    const starts = new Map<number, number>();
    for (const item of items) {
      // The first item of its line on its side of the gutter.
      const side = right ? item.x >= g : item.x + item.w <= g;
      if (!side || beside(item).some((j) => j.x < item.x && (right ? j.x + j.w > g : j.x + j.w <= g))) continue;
      const x = Math.round(item.x);
      starts.set(x, (starts.get(x) ?? 0) + 1);
    }
    const counted = (x: number) => (starts.get(x - 1) ?? 0) + (starts.get(x) ?? 0) + (starts.get(x + 1) ?? 0);
    return [...starts.keys()].map((x) => ({ x, n: counted(x) })).filter((e) => e.n >= 4).sort((a, b) => b.n - a.n)[0]?.x;
  };
  const [leftEdge, rightEdge] = [edgeOf(false), edgeOf(true)];
  const lineStart = (a: Item) => Math.min(a.x, ...beside(a).filter((j) => j.x + j.w <= g).map((j) => j.x));
  const opens = (a: Item, b: Item, size: number) =>
    rightEdge !== undefined &&
    leftEdge !== undefined &&
    a.x + a.w <= g &&
    b.x >= g &&
    Math.abs(b.x - rightEdge) <= 1.5 &&
    b.x - (a.x + a.w) > size * 0.5 &&
    Math.abs(lineStart(a) - leftEdge) <= size * 2;
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
  if (!banded && graphics.every((p) => p.box.x1 < g && p.box.x2 > g) && total - chars([...spanning]) < total * 0.4) return null;
  const rows = buildLines([...spanning], page);
  const crossingGraphics = graphics.filter((p) => p.box.x1 < g && p.box.x2 > g);
  // Separators top to bottom: the spanning rows (by baseline), the
  // graphics that cross the gutter (by their middle), and the rules drawn
  // across it in the white between two lines (an appendix over its
  // references, each two columns: arXiv 2502.02648 p. 11 read the page
  // column by column, the appendix and the references twice interleaved). A
  // script raised beside a row, set smaller and half the row's size over its
  // baseline at most, stands in the band under the row, with the words it
  // is set on (a running head's "Ca²⁺" beside the journal's name across the
  // gutter).
  const [top, bottom] = [Math.max(...items.map((i) => i.y)), Math.min(...items.map((i) => i.y))];
  const clear = (y: number) => !items.some((i) => y > i.y - i.size * 0.5 && y < i.y + i.size);
  const crossingRules = pageRules.filter((r) => r.x1 < g - maxSize * 2 && r.x2 > g + maxSize * 2 && r.x2 - r.x1 >= width(items) * 0.2 && r.y1 < top && r.y1 > bottom && clear(r.y1));
  const separators: { y: number; size: number; piece: Piece | null }[] = [
    ...rows.map((l) => ({ y: l.y, size: l.size, piece: { items: l.items } as Piece })),
    ...crossingGraphics.map((p) => ({ y: (p.box.y1 + p.box.y2) / 2, size: 0, piece: { graphic: p } as Piece })),
    ...crossingRules.map((r) => ({ y: r.y1, size: 0, piece: null })),
  ].sort((a, b) => b.y - a.y);
  const bands: Band[] = separators.map((s) => ({ left: { items: [], graphics: [] }, right: { items: [], graphics: [] }, separator: s.piece }));
  bands.push({ left: { items: [], graphics: [] }, right: { items: [], graphics: [] }, separator: null });
  const bandOf = (y: number, size = Infinity) => {
    const k = separators.findIndex((s) => y > s.y + (size < s.size * 0.85 ? s.size * 0.5 : 0));
    return k < 0 ? separators.length : k;
  };
  for (const item of items) {
    if (spanning.has(item)) continue;
    const band = bands[bandOf(item.y, item.size)];
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
  const fair = sideChars >= total * 0.4 && leftChars >= sideChars * 0.15 && rightChars >= sideChars * 0.15;
  if (fair && columnPair(left, right, page, pageWidth, depth)) return { bands };
  // Else one band may hold two columns of its own between the rows across
  // the gutter: the region reads as what stands above the band, the band's
  // columns, and what stands under it. The IRS W-9 sets two columns of
  // instructions under a form of one; the Earth Observer sets a pull quote
  // beside its article, 7% of their characters. Each side's lines follow
  // one another at the text's leading: a table's first column of labels,
  // a row's height apart, is no column (arXiv 2609.29669's Table 2).
  const letters = (side: Side) => chars(side.items);
  // A side spaced apart (OpenStax's formula review, a line a paragraph) is
  // a column still where its lines stand on the other side's baselines less
  // than half the time.
  const band = twoSided
    .filter((b) => letters(b.left) >= 90 && letters(b.right) >= 90)
    .sort((a, b) => letters(b.left) + letters(b.right) - letters(a.left) - letters(a.right))
    .find((b) => {
      if (!columnPair(b.left.items, b.right.items, page, pageWidth, depth)) return false;
      const [l, r] = [buildLines(b.left.items, page), buildLines(b.right.items, page)];
      return (isDense(l) && isDense(r)) || rowsShared(l, r) * 2 < Math.min(l.length, r.length);
    });
  if (band) return { bands: stacked(band, items, graphics, "columns", page) };
  // A note beside a column, a gutter apart (sideNote): the band it stands
  // in is columns, and the note reads beside the paragraph at its top.
  if (twoSided.length === 1 && isNoteBand(twoSided[0], page)) return { bands: stacked(twoSided[0], items, graphics, "columns", page) };
  // Blocks a band's gutter finds (bandGutter) stand beside each other (a
  // court's caption line over a run-in heading at the column's edge is no
  // pair), hold words on both sides (a contents list's page numbers beside
  // its entries are its table's), and are no figure's labels: the rows
  // under the band, short ones up to a "Figure N" caption, say they are (a
  // flowchart's boxes over its caption, NASA TM p. 14).
  const wordy = (side: Side) => side.items.reduce((n, i) => n + i.str.replace(/[^\p{L}]/gu, "").length, 0) * 2 >= chars(side.items);
  const abreast = (b: Band) => {
    const [l, r] = [b.left.items.map((i) => i.y), b.right.items.map((i) => i.y)];
    return Math.min(Math.max(...l), Math.max(...r)) >= Math.max(Math.min(...l), Math.min(...r));
  };
  const blocks = twoSided.find((b) => isBlocks(b, page) && !(banded && (overCaption(bands, b) || !wordy(b.left) || !wordy(b.right) || !abreast(b))));
  return blocks ? { bands: stacked(blocks, items, graphics, "blocks", page) } : null;
}

// The rows under a band are short labels down to a figure's caption.
function overCaption(bands: Band[], band: Band): boolean {
  for (const b of bands.slice(bands.indexOf(band))) {
    const row = b.separator && "items" in b.separator ? b.separator.items.map((i) => i.str).join(" ").trim() : null;
    if (row === null) continue;
    if (FIGURE_LABEL_RE.test(row)) return true;
    if (row.length >= 40) return false;
  }
  return false;
}

const FIGURE_LABEL_RE = /^(?:fig\.?|figure)\s*\d+/i;

// Two sides of a gutter that read as columns: both prose columns, or one a
// prose column and the other a column of text and display equations whose
// lines stand on the other's baselines less than half the time (a table's
// rows share theirs): IEEE Access p. 9 and arXiv 2502.02648 p. 11 set
// displays between the sentences of one column.
function columnPair(left: Item[], right: Item[], page: number, pageWidth: number, depth: number): boolean {
  const [a, b] = [isColumns(left, page, pageWidth, depth), isColumns(right, page, pageWidth, depth)];
  if (a && b) return true;
  if (!a && !b) return false;
  const [column, other] = a ? [buildLines(left, page), buildLines(right, page)] : [buildLines(right, page), buildLines(left, page)];
  if (!isTextColumn(other)) return false;
  return rowsShared(other, column) * 2 < other.length;
}

// How many of a's lines stand on a baseline of b's, within a point.
function rowsShared(a: Line[], b: Line[]): number {
  return a.filter((l) => b.some((m) => Math.abs(m.y - l.y) <= 1)).length;
}

// A column of text and display equations: six lines or more, three of them
// prose (one cell, 15 letters or more) that start at the column's left edge
// (a first-line indent within two ems), two of those running on to its
// right edge.
function isTextColumn(lines: Line[]): boolean {
  if (lines.length < 6) return false;
  const letters = (l: Line) => l.text.replace(/[^\p{L}]/gu, "").length;
  const left = Math.min(...lines.map((l) => l.x));
  const right = Math.max(...lines.map((l) => l.xEnd));
  const prose = lines.filter((l) => l.cells.length === 1 && letters(l) >= 15 && l.x - left <= l.size * 2);
  return prose.length >= 3 && prose.filter((l) => right - l.xEnd <= l.size).length >= 2;
}

// A band that is a column and a note beside it (sideNote): the wide side a
// prose column at the text's leading, the note words (ten letters or more)
// an em or more from it.
function isNoteBand(band: Band, page: number): boolean {
  if (band.left.items.length === 0 || band.right.items.length === 0 || !sideNote(band, page)) return false;
  const [note, wide] = chars(band.left.items) < chars(band.right.items) ? [band.left, band.right] : [band.right, band.left];
  if (note.items.reduce((n, i) => n + i.str.replace(/[^\p{L}]/gu, "").length, 0) < 10) return false;
  const size = median(wide.items.map((i) => i.size));
  const gutter = Math.min(...band.right.items.map((i) => i.x)) - Math.max(...band.left.items.map((i) => i.x + i.w));
  return gutter >= size && isColumn(wide.items, page) && isDense(buildLines(wide.items, page));
}

// A region cut above and under one band: what stands above it, the band,
// and what stands under it, each read as a region of its own; the band's
// sides are columns, or blocks in the region's column.
function stacked(input: Band, items: Item[], graphics: Placed[], kind: "blocks" | "columns", page: number): Band[] {
  const band = kind === "columns" ? withoutTail(input, page) : input;
  const own = new Set([...band.left.items, ...band.right.items]);
  const ownGraphics = new Set([...band.left.graphics, ...band.right.graphics]);
  const top = Math.max(...[...own].map((i) => i.y));
  const part = (list: Item[], placed: Placed[]): Band => ({ left: { items: list, graphics: placed }, right: { items: [], graphics: [] }, separator: null, kind: "part" });
  const rest = items.filter((i) => !own.has(i));
  const restGraphics = graphics.filter((p) => !ownGraphics.has(p));
  const high = (p: Placed) => (p.box.y1 + p.box.y2) / 2 > top;
  return [
    part(rest.filter((i) => i.y > top), restGraphics.filter(high)),
    { ...band, separator: null, kind },
    part(rest.filter((i) => i.y <= top), restGraphics.filter((p) => !high(p))),
  ].filter((b) => b.left.items.length + b.left.graphics.length + b.right.items.length + b.right.graphics.length > 0);
}

// A band of two columns ends where its shorter side does: a heading under
// that side's last line, set larger or bold and apart from the line above
// it by more than the lines' pitch, stands under the band (OpenStax's
// "PRACTICE" under its two columns of formulas). A note beside a column,
// a fourth of its words or fewer, ends where it does and ends no band.
function withoutTail(band: Band, page: number): Band {
  const [l, r] = [band.left.items, band.right.items];
  if (l.length === 0 || r.length === 0 || Math.min(chars(l), chars(r)) * 4 < Math.max(chars(l), chars(r))) return band;
  const end = Math.max(Math.min(...l.map((i) => i.y)), Math.min(...r.map((i) => i.y)));
  const long = Math.min(...l.map((i) => i.y)) < end ? band.left : band.right;
  const lines = buildLines(long.items, page);
  const pitch = median(lines.slice(1).map((line, k) => lines[k].y - line.y));
  const size = median(lines.map((line) => line.size));
  const tail = lines.findIndex(
    (line, k) =>
      k > 0 &&
      line.y < end - line.size * 0.5 &&
      lines[k - 1].y - line.y > pitch * 1.5 &&
      (line.size >= size * 1.15 || line.runs.every((run) => run.bold)),
  );
  if (tail < 0) return band;
  const cut = lines[tail].y + lines[tail].size * 0.5;
  const keep = (side: Side) => (side === long ? { items: side.items.filter((i) => i.y > cut), graphics: side.graphics.filter((p) => (p.box.y1 + p.box.y2) / 2 > cut) } : side);
  return { ...band, left: keep(band.left), right: keep(band.right) };
}

// A note beside a column: the band's narrow side, a seventh of its
// characters or less, set in another size or in italic, with no graphic on
// its side (a pull quote, a side note, a label). It reads beside the wide side's
// paragraph that holds its top, as the reader meets it: after it when it
// stands on the right (the Earth Observer's pull quote stands beside the
// article's first paragraph), and each of its groups before the paragraph
// beside it when it stands on the left (PLOS's sidebar beside the page's
// first paragraph, the 10-K's italic labels beside their paragraphs).
function sideNote(band: Band, page: number): Side[] | null {
  const onLeft = chars(band.left.items) < chars(band.right.items);
  const [note, wide] = onLeft ? [band.left, band.right] : [band.right, band.left];
  if (note.items.length === 0 || note.graphics.length > 0 || chars(note.items) * 7 > chars(note.items) + chars(wide.items)) return null;
  const size = (list: Item[]) => median(list.map((i) => i.size));
  const italic = (list: Item[]) => list.filter((i) => i.italic).length * 2 > list.length;
  if (Math.abs(size(note.items) - size(wide.items)) < size(wide.items) * 0.1 && italic(note.items) === italic(wide.items)) return null;
  const lines = buildLines(wide.items, page);
  const gaps = lines.slice(1).map((l, k) => lines[k].y - l.y);
  const pitch = median(gaps);
  // A group of the note: its lines at their own pitch (a stray mark on the
  // note's side, its page number, is a group of its own).
  const noteLines = buildLines(note.items, page);
  const notePitch = median(noteLines.slice(1).map((l, k) => noteLines[k].y - l.y));
  const groups: Item[][] = [];
  noteLines.forEach((l, k) => {
    // Two notes alone set their one gap as the pitch: a gap of two lines
    // of their size parts them too (the MML book's "associativity" and
    // "distributivity", four lines apart, read as one note).
    if (k > 0 && (noteLines[k - 1].y - l.y > notePitch * 1.3 || noteLines[k - 1].y - l.y > l.size * 2.5)) groups.push([]);
    if (groups.length === 0) groups.push([]);
    groups[groups.length - 1].push(...l.items);
  });
  // Where each group reads: under the cut, a y on the wide side. On the
  // right, the paragraph's end: the first line at or under the group's top
  // whose gap to the next line is wider than the lines' pitch. On the left,
  // the paragraph's start: the last line at or over the group's top whose
  // gap to the line above is wider than the pitch, or the first line.
  const cuts: number[] = [];
  for (const group of groups) {
    const top = Math.max(...group.map((i) => i.y));
    if (onLeft) {
      let start = lines.findLastIndex((l, k) => l.y >= top - l.size * 0.5 && (k === 0 || gaps[k - 1] > pitch * 1.3));
      if (start < 0) start = 0;
      cuts.push(start === 0 ? Infinity : lines[start].y + lines[start].size * 0.5);
    } else {
      const end = lines.findIndex((l, k) => l.y <= top && (k === lines.length - 1 || gaps[k] > pitch * 1.3));
      if (end < 0) return null;
      cuts.push(lines[end].y - lines[end].size * 0.5);
    }
  }
  const parts: Side[] = [];
  let above = Infinity;
  const graphicY = (p: Placed) => (p.box.y1 + p.box.y2) / 2;
  groups.forEach((group, k) => {
    const cut = Math.min(above, cuts[k]);
    const between = (y: number) => y <= above && y > cut;
    parts.push({ items: wide.items.filter((i) => between(i.y)), graphics: wide.graphics.filter((p) => between(graphicY(p))) });
    parts.push({ items: group, graphics: [] });
    above = cut;
  });
  parts.push({ items: wide.items.filter((i) => i.y <= above), graphics: wide.graphics.filter((p) => graphicY(p) <= above) });
  return parts.filter((part) => part.items.length + part.graphics.length > 0);
}

// Blocks side by side, not a table's columns: two sides a wide gutter
// apart (three ems or more) whose lines share a baseline once at most,
// while a line of one side has no partner. A table's rows share their
// baselines. The SF 298's foot, "NSN 7540-01-280-5500" beside "Standard
// Form 298 (Rev. 2-89)" over "Prescribed by ANSI Std. 239-18", read as one
// paragraph; the IRS W-9's three header boxes as one line. A stray mark is
// no block (a slide's page number beside its last bullets).
function isBlocks(band: Band, page: number): boolean {
  const { left, right } = band;
  if (chars(left.items) < 10 || chars(right.items) < 10 || [...left.items, ...right.items].some((i) => i.math)) return false;
  const size = median([...left.items, ...right.items].map((i) => i.size));
  if (Math.min(...right.items.map((i) => i.x)) - Math.max(...left.items.map((i) => i.x + i.w)) < size * 3) return false;
  const [a, b] = [buildLines(left.items, page), buildLines(right.items, page)];
  const paired = a.filter((l) => b.some((m) => Math.abs(m.y - l.y) <= 0.5)).length;
  return paired <= 1 && Math.max(a.length, b.length) > paired;
}

// A side of a split: a prose column, or columns of its own (a page of three
// columns cut at its first gutter holds two on its right: the Federal
// Register).
function isColumns(items: Item[], page: number, pageWidth: number, depth: number): boolean {
  return isColumn(items, page) || (depth < 2 && findSplit(items, [], page, pageWidth, depth + 1, false) !== null);
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

// Lines set at the text's leading: most follow the line above a line and a
// half of their size apart or less.
function isDense(lines: Line[]): boolean {
  const gaps = lines.slice(1).map((l, k) => lines[k].y - l.y);
  return gaps.length > 0 && median(gaps) <= median(lines.map((l) => l.size)) * 1.6;
}

// Prose: letters, most of them in lines of 15 letters or more. A column of
// amounts under a line of words is none (the 10-K's statement of
// comprehensive income, p. 55, read its labels and its values apart).
function isProse(lines: Line[], minLines: number): boolean {
  if (lines.length < minLines) return false;
  const letters = (l: Line) => l.text.replace(/[^\p{L}]/gu, "").length;
  const all = lines.reduce((n, l) => n + letters(l), 0);
  const prose = lines.filter((l) => l.cells.length === 1 && letters(l) >= 15).reduce((n, l) => n + letters(l), 0);
  return all > 0 && prose >= all * 0.6 && all * 2 >= lines.reduce((n, l) => n + l.text.replace(/\s/g, "").length, 0);
}

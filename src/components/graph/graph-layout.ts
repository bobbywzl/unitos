// The graph's layout (SPEC.md §13): where each document sits on the canvas.
// Linked documents sit near each other: each group of documents joined by
// links (a component) runs a small force layout of its own — every pair of
// nodes pushes apart, every linked pair pulls together, harder with more
// links — and the groups pack side by side, the largest first. Documents
// with no link to another document line up in a tidy grid under the groups.
// Everything is seeded from the document ids, so the same project lays out
// the same way on every open. Pure: no DOM, no randomness.

export type LayoutEdge = { a: string; b: string; weight: number };
export type Point = { x: number; y: number };

// The room one node needs: its dot and its two-line label (graph-view.tsx
// draws the label 144px wide under a dot of at most 34px). Two node centers
// sit at least SPACE_X apart side by side, or SPACE_Y apart one above the
// other, so labels never overlap even when they grow at a low zoom.
export const SPACE_X = 200;
export const SPACE_Y = 118;
const GROUP_GAP = 70;
// The widest layout a tall canvas takes: three grid columns.
const TALL_MAX_W = 3 * SPACE_X;
const TICKS = 240;

// Deterministic pseudo-random in [-1, 1] from a string.
export function seeded(id: string, salt: number): number {
  let h = salt;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 999) * 2 - 1;
}

/** The components of the link graph, loops left out, each listed in BFS
    order from its highest-degree document; isolated documents last, in the
    order given. */
function components(ids: string[], adjacency: Map<string, Map<string, number>>): { groups: string[][]; isolated: string[] } {
  const degree = (id: string) => adjacency.get(id)?.size ?? 0;
  const seen = new Set<string>();
  const groups: string[][] = [];
  const starts = [...ids].sort((a, b) => degree(b) - degree(a) || a.localeCompare(b));
  for (const start of starts) {
    if (seen.has(start) || degree(start) === 0) continue;
    seen.add(start);
    const order = [start];
    for (let i = 0; i < order.length; i++) {
      const next = [...(adjacency.get(order[i])?.keys() ?? [])]
        .filter((n) => !seen.has(n))
        .sort((a, b) => degree(b) - degree(a) || a.localeCompare(b));
      for (const n of next) {
        seen.add(n);
        order.push(n);
      }
    }
    groups.push(order);
  }
  return { groups, isolated: ids.filter((id) => degree(id) === 0) };
}

/** One component's force layout, centered on its own origin. */
function layoutGroup(order: string[], adjacency: Map<string, Map<string, number>>): Map<string, Point> {
  const n = order.length;
  const pos = order.map((id, i) => {
    // Start on a spiral in BFS order, so neighbors start near each other.
    const angle = i * 2.39996 + seeded(id, 11) * 0.3;
    const r = 60 * Math.sqrt(i + 0.5);
    return { x: Math.cos(angle) * r * 1.4, y: Math.sin(angle) * r };
  });
  if (n === 2) {
    return new Map([
      [order[0], { x: -SPACE_X * 0.65, y: 0 }],
      [order[1], { x: SPACE_X * 0.65, y: 0 }],
    ]);
  }
  const index = new Map(order.map((id, i) => [id, i]));
  const springs: { i: number; j: number; len: number; k: number }[] = [];
  for (const [i, id] of order.entries()) {
    for (const [other, weight] of adjacency.get(id) ?? []) {
      const j = index.get(other);
      if (j === undefined || j <= i) continue;
      // More links: a shorter, stiffer spring.
      springs.push({ i, j, len: SPACE_X * (1.05 - Math.min(weight, 6) * 0.03), k: 0.06 + Math.min(weight, 6) * 0.012 });
    }
  }
  // [ui5] COST5-10: flat arrays, and each pair's push computed once for
  // both ends. The arithmetic is the same, in the same order, so the layout
  // is the same to the last bit (graph-layout-check); only faster.
  const px = Float64Array.from(pos, (p) => p.x);
  const py = Float64Array.from(pos, (p) => p.y);
  const dispX = new Float64Array(n);
  const dispY = new Float64Array(n);
  const push = SPACE_X * SPACE_X * 0.9;
  for (let tick = 0; tick < TICKS; tick++) {
    const alpha = 1 - tick / TICKS;
    dispX.fill(0);
    dispY.fill(0);
    // Every pair pushes apart; distance is read on an ellipse, since a label
    // is wider than it is tall.
    for (let i = 0; i < n; i++) {
      const xi = px[i];
      const yi = py[i];
      for (let j = i + 1; j < n; j++) {
        const dx = xi - px[j];
        const dy = (yi - py[j]) * 1.6;
        const d2 = Math.max(dx * dx + dy * dy, 100);
        const f = push / d2;
        const d = Math.sqrt(d2);
        const ux = (dx / d) * f;
        const uy = ((dy / d) * f) / 1.6;
        dispX[i] += ux;
        dispY[i] += uy;
        dispX[j] -= ux;
        dispY[j] -= uy;
      }
    }
    for (const s of springs) {
      const dx = px[s.j] - px[s.i];
      const dy = py[s.j] - py[s.i];
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const f = (d - s.len) * s.k;
      const ux = (dx / d) * f;
      const uy = (dy / d) * f;
      dispX[s.i] += ux;
      dispY[s.i] += uy;
      dispX[s.j] -= ux;
      dispY[s.j] -= uy;
    }
    // A pull to the center keeps the group round.
    for (let i = 0; i < n; i++) {
      dispX[i] -= px[i] * 0.012;
      dispY[i] -= py[i] * 0.02;
      const step = Math.sqrt(dispX[i] ** 2 + dispY[i] ** 2);
      const cap = 40 * alpha + 2;
      const scale = step > cap ? cap / step : 1;
      px[i] += dispX[i] * scale;
      py[i] += dispY[i] * scale;
    }
  }
  for (let i = 0; i < n; i++) pos[i] = { x: px[i], y: py[i] };
  // [/ui5]
  separate(pos);
  const cx = pos.reduce((s, p) => s + p.x, 0) / n;
  const cy = pos.reduce((s, p) => s + p.y, 0) / n;
  return new Map(order.map((id, i) => [id, { x: pos[i].x - cx, y: pos[i].y - cy }]));
}

/** Pushes apart any two nodes closer than the room a node needs. */
function separate(pos: Point[]): void {
  // [ui5] COST5-10: flat arrays; the same arithmetic in the same order.
  const n = pos.length;
  const px = Float64Array.from(pos, (p) => p.x);
  const py = Float64Array.from(pos, (p) => p.y);
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = px[j] - px[i];
        const dy = py[j] - py[i];
        const e = (dx / SPACE_X) ** 2 + (dy / SPACE_Y) ** 2;
        if (e >= 1) continue;
        moved = true;
        const d = Math.sqrt(e) || 0.01;
        const push = (1 - d) / 2 + 0.01;
        // Push along the axis that needs less: usually sideways.
        const ux = d > 0.01 ? dx / (d * SPACE_X) : 1;
        const uy = d > 0.01 ? dy / (d * SPACE_Y) : 0;
        px[i] -= ux * push * SPACE_X;
        py[i] -= uy * push * SPACE_Y;
        px[j] += ux * push * SPACE_X;
        py[j] += uy * push * SPACE_Y;
      }
    }
    if (!moved) break;
  }
  for (let i = 0; i < n; i++) {
    pos[i].x = px[i];
    pos[i].y = py[i];
  }
}

type Box = { ids: string[]; pos: Map<string, Point>; w: number; h: number };

/** The canvas shapes the layout is made for, from a pane's width and
    height: wide (a laptop under the header and over the Stitch box), square
    (a tablet, a narrow window), and tall (a phone). Few shapes, so a small
    resize never moves a node. */
export function layoutAspect(width: number, height: number): number {
  const r = height > 0 ? width / height : 2;
  return r < 0.8 ? 0.7 : r < 1.5 ? 1.3 : 2.1;
}

/** The groups shelf-packed in rows no wider than rowWidth, each row
    centered; the unlinked documents in a grid of `cols` columns under them. */
function arrange(boxes: Box[], isolated: string[], rowWidth: number, cols: number): { pos: Map<string, Point>; w: number; h: number } {
  const rows: { boxes: Box[]; w: number; h: number }[] = [];
  for (const b of boxes) {
    const last = rows[rows.length - 1];
    if (last && last.w + GROUP_GAP + b.w <= rowWidth) {
      last.boxes.push(b);
      last.w += GROUP_GAP + b.w;
      last.h = Math.max(last.h, b.h);
    } else rows.push({ boxes: [b], w: b.w, h: b.h });
  }
  const gridCols = Math.min(cols, isolated.length);
  const gridW = gridCols * SPACE_X;
  const width = Math.max(gridW, ...rows.map((r) => r.w), 0);
  const pos = new Map<string, Point>();
  let y = 0;
  for (const r of rows) {
    let x = (width - r.w) / 2;
    for (const b of r.boxes) {
      const by = y + (r.h - b.h) / 2;
      for (const [id, p] of b.pos) pos.set(id, { x: x + p.x + SPACE_X / 2, y: by + p.y + SPACE_Y / 2 });
      x += b.w + GROUP_GAP;
    }
    y += r.h + GROUP_GAP;
  }
  if (gridCols > 0) {
    const top = rows.length ? y - GROUP_GAP + 24 : 0;
    const gridRows = Math.ceil(isolated.length / gridCols);
    isolated.forEach((id, i) => {
      const row = Math.floor(i / gridCols);
      const inRow = row === gridRows - 1 ? isolated.length - row * gridCols : gridCols;
      const left = (width - inRow * SPACE_X) / 2;
      pos.set(id, { x: left + (i % gridCols) * SPACE_X + SPACE_X / 2, y: top + row * SPACE_Y + SPACE_Y / 2 });
    });
    y = top + gridRows * SPACE_Y + GROUP_GAP;
  }
  return { pos, w: Math.max(width, SPACE_X), h: Math.max(y - GROUP_GAP, SPACE_Y) };
}

function boxOf(pos: Map<string, Point>): Box {
  const pts = [...pos.values()];
  const x0 = Math.min(...pts.map((p) => p.x));
  const x1 = Math.max(...pts.map((p) => p.x));
  const y0 = Math.min(...pts.map((p) => p.y));
  const y1 = Math.max(...pts.map((p) => p.y));
  const shifted = new Map([...pos].map(([id, p]) => [id, { x: p.x - x0, y: p.y - y0 }]));
  return { ids: [...pos.keys()], pos: shifted, w: x1 - x0 + SPACE_X, h: y1 - y0 + SPACE_Y };
}

/** Every document's center on the canvas, the whole layout centered on 0,0.
    `edges` may list a pair more than once and may hold loops (a === b);
    loops never move a node. */
export function graphLayout(ids: string[], edges: LayoutEdge[], aspect = 2.1, apart?: Set<string>): Map<string, Point> {
  if (apart && apart.size > 0 && ids.some((id) => apart.has(id))) {
    const own = ids.filter((id) => !apart.has(id));
    const main = own.length > 0 ? graphLayout(own, edges, aspect) : new Map<string, Point>();
    return withApartRow(main, ids.filter((id) => apart.has(id)), aspect);
  }
  const known = new Set(ids);
  const adjacency = new Map<string, Map<string, number>>();
  for (const e of edges) {
    if (e.a === e.b || !known.has(e.a) || !known.has(e.b)) continue;
    for (const [x, y] of [
      [e.a, e.b],
      [e.b, e.a],
    ]) {
      const m = adjacency.get(x) ?? new Map<string, number>();
      m.set(y, (m.get(y) ?? 0) + e.weight);
      adjacency.set(x, m);
    }
  }
  const { groups, isolated } = components(ids, adjacency);
  const boxes = groups.map((g) => boxOf(layoutGroup(g, adjacency)));
  // Pack the groups in rows, the largest first, and the unlinked documents
  // in a grid under them. Of every row width and grid width, keep the
  // arrangement a canvas of this aspect shows at the largest zoom.
  let best: { pos: Map<string, Point>; scale: number } | null = null;
  const widths = new Set<number>([Math.max(SPACE_X * 2, ...boxes.map((b) => b.w))]);
  let run = 0;
  for (const b of boxes) {
    run += (run ? GROUP_GAP : 0) + b.w;
    widths.add(run);
  }
  const colChoices = isolated.length ? Array.from({ length: Math.min(isolated.length, 24) }, (_, i) => i + 1) : [0];
  // A tall canvas (a phone) shows a tall layout at the fit's least zoom and
  // scrolls down, never sideways: an arrangement wider than TALL_MAX_W, or
  // than its widest linked group, puts nodes and labels past the canvas's
  // edges (VIEW4-05). It is kept only when no arrangement is that narrow.
  const tall = aspect < 1;
  const tallMax = Math.max(TALL_MAX_W, ...boxes.map((b) => b.w));
  let bestNarrow = false;
  for (const rowWidth of widths) {
    for (const cols of colChoices) {
      const packed = arrange(boxes, isolated, rowWidth, cols);
      const scale = Math.min(aspect / packed.w, 1 / packed.h);
      const narrow = !tall || packed.w <= tallMax;
      if (!best || (narrow && !bestNarrow) || (narrow === bestNarrow && scale > best.scale * 1.0001)) {
        best = { pos: packed.pos, scale };
        bestNarrow = narrow;
      }
    }
  }
  const result = best?.pos ?? new Map<string, Point>();
  // Center the whole layout on 0,0.
  const pts = [...result.values()];
  if (pts.length === 0) return result;
  const cx = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2;
  const cy = (Math.min(...pts.map((p) => p.y)) + Math.max(...pts.map((p) => p.y))) / 2;
  for (const [id, p] of result) result.set(id, { x: Math.round(p.x - cx), y: Math.round(p.y - cy) });
  return result;
}

/** The generated documents in rows under the layout, centered under it,
    and the whole re-centered on 0,0. */
function withApartRow(main: Map<string, Point>, apartIds: string[], aspect: number): Map<string, Point> {
  const pts = [...main.values()];
  const x0 = pts.length ? Math.min(...pts.map((p) => p.x)) : 0;
  const x1 = pts.length ? Math.max(...pts.map((p) => p.x)) : 0;
  const y1 = pts.length ? Math.max(...pts.map((p) => p.y)) : -SPACE_Y - GROUP_GAP;
  const width = Math.max(x1 - x0 + SPACE_X, SPACE_X);
  // As many per row as the layout's width holds, at least the aspect's share.
  const perRow = Math.max(1, Math.floor(width / SPACE_X), Math.round(Math.sqrt(apartIds.length * aspect)));
  const out = new Map(main);
  apartIds.forEach((id, i) => {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, apartIds.length - row * perRow);
    const left = (x0 + x1) / 2 - ((inRow - 1) * SPACE_X) / 2;
    out.set(id, { x: left + (i % perRow) * SPACE_X, y: y1 + SPACE_Y + GROUP_GAP + row * SPACE_Y });
  });
  const all = [...out.values()];
  const cx = (Math.min(...all.map((p) => p.x)) + Math.max(...all.map((p) => p.x))) / 2;
  const cy = (Math.min(...all.map((p) => p.y)) + Math.max(...all.map((p) => p.y))) / 2;
  for (const [id, p] of out) out.set(id, { x: Math.round(p.x - cx), y: Math.round(p.y - cy) });
  return out;
}

/** True when a node at p keeps the room a node needs from every placed one. */
function roomAt(p: Point, placed: Iterable<Point>): boolean {
  for (const q of placed) if (((p.x - q.x) / SPACE_X) ** 2 + ((p.y - q.y) / SPACE_Y) ** 2 < 1) return false;
  return true;
}

/** The free spot nearest to `start` on a lattice of node rooms. */
function freeSpot(start: Point, placed: Point[]): Point {
  for (let ring = 0; ring < 40; ring++) {
    const spots: Point[] = [];
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        spots.push({ x: start.x + i * SPACE_X * 0.75, y: start.y + j * SPACE_Y });
      }
    }
    spots.sort((a, b) => Math.hypot(a.x - start.x, a.y - start.y) - Math.hypot(b.x - start.x, b.y - start.y));
    const hit = spots.find((p) => roomAt(p, placed));
    if (hit) return { x: Math.round(hit.x), y: Math.round(hit.y) };
  }
  return { x: Math.round(start.x), y: Math.round(start.y) };
}

/** The layout of `ids` that keeps every node of `prev` where it was (WALK2-03).
    A new document goes beside the documents it links to (the free spot
    nearest their middle), a new generated document at the end of the
    generated row, any other new document under the layout. Null when too
    few of the documents were laid out before (under half): then a fresh
    layout reads better than a patched one. */
export function extendLayout(
  prev: Map<string, Point>,
  ids: string[],
  edges: LayoutEdge[],
  apart?: Set<string>,
): Map<string, Point> | null {
  const kept = ids.filter((id) => prev.has(id));
  if (kept.length === 0 || kept.length * 2 < ids.length) return null;
  const out = new Map<string, Point>(kept.map((id) => [id, prev.get(id)!]));
  const fresh = ids.filter((id) => !prev.has(id));
  if (fresh.length === 0) return out;
  const neighbors = new Map<string, string[]>();
  for (const e of edges) {
    if (e.a === e.b) continue;
    neighbors.set(e.a, [...(neighbors.get(e.a) ?? []), e.b]);
    neighbors.set(e.b, [...(neighbors.get(e.b) ?? []), e.a]);
  }
  const pts = () => [...out.values()];
  const bottom = () => Math.max(...pts().map((p) => p.y));
  const middleX = () => {
    const xs = pts().map((p) => p.x);
    return (Math.min(...xs) + Math.max(...xs)) / 2;
  };
  for (const id of fresh) {
    let start: Point;
    if (apart?.has(id)) {
      // The end of the generated row: right of the last generated document.
      const row = [...out].filter(([other]) => apart.has(other)).map(([, p]) => p);
      if (row.length > 0) {
        const y = Math.max(...row.map((p) => p.y));
        const x = Math.max(...row.filter((p) => p.y === y).map((p) => p.x));
        start = { x: x + SPACE_X, y };
      } else start = { x: middleX(), y: bottom() + SPACE_Y + GROUP_GAP };
    } else {
      const linked = (neighbors.get(id) ?? [])
        .filter((n) => !apart?.has(n))
        .map((n) => out.get(n))
        .filter((p): p is Point => p !== undefined);
      start = linked.length
        ? { x: linked.reduce((s, p) => s + p.x, 0) / linked.length, y: linked.reduce((s, p) => s + p.y, 0) / linked.length }
        : { x: middleX(), y: bottom() + SPACE_Y };
    }
    out.set(id, freeSpot(start, pts()));
  }
  return out;
}

/** The documents in the layout's own order, for a list beside the canvas
    (the Documents list, SPEC.md §13): the linked groups the largest first,
    each group's documents by most links first; then the unlinked
    documents in the order given; then the documents set apart (generated
    documents). Linked documents come next to each other, as on the canvas. */
export function layoutOrder(ids: string[], edges: LayoutEdge[], apart?: Set<string>): string[] {
  const own = apart ? ids.filter((id) => !apart.has(id)) : ids;
  const known = new Set(own);
  const adjacency = new Map<string, Map<string, number>>();
  const weight = new Map<string, number>();
  for (const e of edges) {
    if (e.a === e.b || !known.has(e.a) || !known.has(e.b)) continue;
    for (const [x, y] of [
      [e.a, e.b],
      [e.b, e.a],
    ]) {
      const m = adjacency.get(x) ?? new Map<string, number>();
      m.set(y, (m.get(y) ?? 0) + e.weight);
      adjacency.set(x, m);
      weight.set(x, (weight.get(x) ?? 0) + e.weight);
    }
  }
  const { groups, isolated } = components(own, adjacency);
  const linked = [...groups]
    .sort((x, y) => y.length - x.length)
    .flatMap((g) => [...g].sort((x, y) => (weight.get(y) ?? 0) - (weight.get(x) ?? 0) || g.indexOf(x) - g.indexOf(y)));
  return [...linked, ...isolated, ...(apart ? ids.filter((id) => apart.has(id)) : [])];
}

// The lines of a ruled table: the grid a page's rules and filled boxes draw
// (pdfplumber's lattice: snap, join, intersections, cells, tables — parse
// loop memo §4.2), and the stacks of horizontal rules that bound a table
// drawn without vertical rules (booktabs). The rules and filled boxes come
// from the page's drawing (drawing.ts); ruled.ts reads the tables.

import type { Fill, Rule } from "@/lib/parse/pdf/drawing";
import type { Box } from "@/lib/parse/pdf/types";

// ── The lattice ─────────────────────────────────────────────────────────────

// pdfplumber's defaults: edges within 3 pt snap together and join, an edge
// shorter than 3 pt is no edge. Intersections within 2 pt: a double rule
// (two rules 2.4 pt apart) snaps to its middle, 1.4 pt from where the
// vertical rules end, and the rows it closed fell out of the grid (arXiv
// 2504.02736's tables lost their head row and their last row).
const SNAP = 3;
const JOIN = 3;
const MIN_LENGTH = 3;
const INTERSECT = 2;

type Edge = { dir: "h" | "v"; pos: number; a: number; b: number };

function edgesOf(rules: Rule[], fills: Fill[]): Edge[] {
  const edges: Edge[] = [];
  for (const r of rules) {
    if (r.dir === "h") edges.push({ dir: "h", pos: r.y1, a: r.x1, b: r.x2 });
    else edges.push({ dir: "v", pos: r.x1, a: r.y1, b: r.y2 });
  }
  // A filled box's sides are edges too: a shaded cell, a cell drawn filled.
  // A box of one color painted inside a box of that color shows no side:
  // Word shades a cell's lines again over the cell's own shading, and
  // apple-fy24q4's two-line row split at its lines.
  const hidden = (f: Fill) =>
    f.color !== undefined &&
    fills.some((o) => o !== f && o.color === f.color && o.x1 <= f.x1 + 0.5 && o.x2 >= f.x2 - 0.5 && o.y1 <= f.y1 + 0.5 && o.y2 >= f.y2 - 0.5 && (o.x2 - o.x1) * (o.y2 - o.y1) > (f.x2 - f.x1) * (f.y2 - f.y1));
  for (const f of fills) {
    if (hidden(f)) continue;
    edges.push(
      { dir: "h", pos: f.y1, a: f.x1, b: f.x2 },
      { dir: "h", pos: f.y2, a: f.x1, b: f.x2 },
      { dir: "v", pos: f.x1, a: f.y1, b: f.y2 },
      { dir: "v", pos: f.x2, a: f.y1, b: f.y2 },
    );
  }
  return edges;
}

// Parallel edges within SNAP of each other share their mean position;
// collinear edges within JOIN of each other join.
function mergeEdges(edges: Edge[]): Edge[] {
  const out: Edge[] = [];
  for (const dir of ["h", "v"] as const) {
    const list = edges.filter((e) => e.dir === dir).sort((p, q) => p.pos - q.pos);
    const groups: Edge[][] = [];
    for (const e of list) {
      const group = groups[groups.length - 1];
      if (group && e.pos - group[0].pos <= SNAP) group.push(e);
      else groups.push([e]);
    }
    for (const group of groups) {
      const pos = group.reduce((s, e) => s + e.pos, 0) / group.length;
      const spans = group.map((e) => ({ a: e.a, b: e.b })).sort((p, q) => p.a - q.a);
      const joined: { a: number; b: number }[] = [];
      for (const s of spans) {
        const last = joined[joined.length - 1];
        if (last && s.a <= last.b + JOIN) last.b = Math.max(last.b, s.b);
        else joined.push({ ...s });
      }
      // Short pieces count once joined: Word draws a border's corners as
      // pieces of 1.5 pt, and the border stopped short of the frame without them.
      for (const s of joined) if (s.b - s.a >= MIN_LENGTH) out.push({ dir, pos, a: s.a, b: s.b });
    }
  }
  return out;
}

// One cell of a grid: its box, and its place (row 0 at the top).
export type GridCell = Box & { row: number; col: number; rowspan: number; colspan: number };
export type Grid = { box: Box; xs: number[]; ys: number[]; cells: GridCell[] };

type Point = { x: number; y: number; h: Set<Edge>; v: Set<Edge> };

// Each intersection, top-left first, closes the smallest rectangle whose
// four corners are intersections joined by shared edges.
function cellsOf(edges: Edge[]): Box[] {
  const hs = edges.filter((e) => e.dir === "h");
  const vs = edges.filter((e) => e.dir === "v");
  const points = new Map<string, Point>();
  const key = (x: number, y: number) => `${x.toFixed(2)},${y.toFixed(2)}`;
  for (const v of vs) {
    for (const h of hs) {
      if (v.pos < h.a - INTERSECT || v.pos > h.b + INTERSECT || h.pos < v.a - INTERSECT || h.pos > v.b + INTERSECT) continue;
      const k = key(v.pos, h.pos);
      const p = points.get(k) ?? { x: v.pos, y: h.pos, h: new Set<Edge>(), v: new Set<Edge>() };
      p.h.add(h);
      p.v.add(v);
      points.set(k, p);
    }
  }
  const list = [...points.values()].sort((p, q) => q.y - p.y || p.x - q.x);
  const byX = new Map<string, Point[]>();
  const byY = new Map<string, Point[]>();
  for (const p of list) {
    const kx = p.x.toFixed(2);
    const ky = p.y.toFixed(2);
    byX.set(kx, [...(byX.get(kx) ?? []), p]);
    byY.set(ky, [...(byY.get(ky) ?? []), p]);
  }
  const shares = (a: Set<Edge>, b: Set<Edge>) => [...a].some((e) => b.has(e));
  const out: Box[] = [];
  for (const p of list) {
    // Below p on a shared vertical edge (nearest first), right of p on a
    // shared horizontal edge (nearest first).
    const below = (byX.get(p.x.toFixed(2)) ?? []).filter((q) => q.y < p.y && shares(p.v, q.v));
    const right = (byY.get(p.y.toFixed(2)) ?? []).filter((q) => q.x > p.x && shares(p.h, q.h)).sort((a, b) => a.x - b.x);
    let found: Box | null = null;
    for (const b of below) {
      for (const r of right) {
        const corner = points.get(key(r.x, b.y));
        if (corner && shares(corner.v, r.v) && shares(corner.h, b.h)) {
          found = { x1: p.x, x2: r.x, y1: b.y, y2: p.y };
          break;
        }
      }
      if (found) break;
    }
    if (found) out.push(found);
  }
  return out;
}

// Cells that share a corner are one table.
function groupCells(cells: Box[]): Box[][] {
  const left = [...cells];
  const out: Box[][] = [];
  const corners = (c: Box) => [`${c.x1},${c.y1}`, `${c.x1},${c.y2}`, `${c.x2},${c.y1}`, `${c.x2},${c.y2}`];
  for (let first = left.shift(); first !== undefined; first = left.shift()) {
    const group = [first];
    const seen = new Set(corners(first));
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = left.length - 1; i >= 0; i--) {
        if (corners(left[i]).some((k) => seen.has(k))) {
          const [cell] = left.splice(i, 1);
          group.push(cell);
          for (const k of corners(cell)) seen.add(k);
          grew = true;
        }
      }
    }
    out.push(group);
  }
  return out;
}

// The grid a group of cells draws: the distinct x's and y's are its column
// and row lines; a cell over k inner lines spans k + 1 columns or rows.
function gridOf(cells: Box[]): Grid {
  const xs = [...new Set(cells.flatMap((c) => [c.x1, c.x2]))].sort((a, b) => a - b);
  const ys = [...new Set(cells.flatMap((c) => [c.y1, c.y2]))].sort((a, b) => b - a);
  const box = {
    x1: xs[0],
    x2: xs[xs.length - 1],
    y1: ys[ys.length - 1],
    y2: ys[0],
  };
  const gridCells = cells.map((c) => {
    const col = xs.indexOf(c.x1);
    const row = ys.indexOf(c.y2);
    return { ...c, row, col, colspan: xs.indexOf(c.x2) - col, rowspan: ys.indexOf(c.y1) - row };
  });
  gridCells.sort((a, b) => a.row - b.row || a.col - b.col);
  return { box, xs, ys, cells: gridCells };
}

// The ruled grids of a page: two cells or more that share corners.
export function latticeGrids(rules: Rule[], fills: Fill[]): Grid[] {
  const cells = cellsOf(mergeEdges(edgesOf(rules, fills)));
  return groupCells(cells)
    .filter((group) => group.length >= 2)
    .map(gridOf);
}

// ── Rule stacks ─────────────────────────────────────────────────────────────

// Horizontal rules that share one extent, top to bottom: a booktabs table's
// top, middle, and bottom rules, or a table ruled between its rows only.
// The rules come joined (joinedRules).
export type RuleStack = { x1: number; x2: number; rules: Rule[] };

// The pieces of one horizontal rule joined: InDesign draws a row's rule
// cell by cell (MMWR's tables).
export function joinedRules(rules: Rule[]): Rule[] {
  const sorted = rules.filter((r) => r.dir === "h").sort((a, b) => b.y1 - a.y1 || a.x1 - b.x1);
  const out: Rule[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y1 - r.y1) <= 1 && r.x1 <= last.x2 + JOIN && r.x2 >= last.x1) {
      last.x1 = Math.min(last.x1, r.x1);
      last.x2 = Math.max(last.x2, r.x2);
      last.thickness = Math.max(last.thickness, r.thickness);
    } else out.push({ ...r });
  }
  return out;
}

// The stacks of a page's rules minLength long or more: rules whose ends lie
// within SNAP of a stack's ends join it, and a stack holds two rules or more.
export function ruleStacks(rules: Rule[], minLength: number): RuleStack[] {
  const stacks: RuleStack[] = [];
  for (const r of rules) {
    if (r.x2 - r.x1 < minLength) continue;
    const stack = stacks.find((s) => Math.abs(s.x1 - r.x1) <= SNAP && Math.abs(s.x2 - r.x2) <= SNAP);
    if (stack) stack.rules.push(r);
    else stacks.push({ x1: r.x1, x2: r.x2, rules: [r] });
  }
  return stacks.filter((s) => s.rules.length >= 2);
}

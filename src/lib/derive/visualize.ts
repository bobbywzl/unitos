import { JSDOM } from "jsdom";
import { z } from "zod";
import { imageUrl } from "@/lib/images";
import { renderSimulation, simulationSchema } from "@/lib/derive/simulate";
import {
  ACCENT,
  CHIP_LINE,
  DARK_RULES,
  escapeXml,
  FILL,
  INK,
  MUTED,
  PAPER,
  THEME_STYLE,
} from "@/lib/derive/visual-palette";

// VISUALIZE (SPEC.md §20, Unitos Ultra): the model's output contract, the
// diagram layout, and the SVG the reader sees. A diagram arrives as nodes and
// edges and is laid out here with measured text, so no label overflows; a
// simulation arrives as a law and its conditions and is integrated and drawn
// here (lib/derive/simulate.ts); a picture or an animation arrives as SVG
// source and is reduced to the elements and attributes the prompt allows
// before it is stored. Either way the result is one SVG ImageAsset the
// annotation's markdown points at.

// ── Output contract ────────────────────────────────────────────────────────

// role: passage = what the passage itself states, article = what the article
// states elsewhere and the picture needs (the problem this passage solves,
// the structure it replaces). The layout draws the passage's nodes strong
// and the article's faint when a diagram holds both.
const nodeSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
  detail: z.string().max(240).nullish(),
  role: z.enum(["passage", "article"]).nullish(),
});

const edgeSchema = z.object({
  from: z.string().min(1).max(40),
  to: z.string().min(1).max(40),
  label: z.string().max(80).nullish(),
});

// 3 to 12 nodes is what the prompt asks for; the floor of 2 and the ceiling
// of 16 are what the layout still draws well, so a model that misses the ask
// by one node still lands a picture instead of failing the run.
export const diagramSchema = z.object({
  direction: z.enum(["right", "down"]).default("right"),
  nodes: z.array(nodeSchema).min(2).max(16),
  edges: z.array(edgeSchema).max(48),
});

const visualSchema = z.object({
  kind: z.enum(["diagram", "simulation", "picture", "animation"]),
  caption: z.string().min(1).max(400),
  diagram: diagramSchema.nullish(),
  simulation: simulationSchema.nullish(),
  // The same ceiling the reduction checks (MAX_SVG_BYTES below), so an SVG
  // past it is caught by validation and retried with the reason, never
  // sanitized and then thrown away.
  svg: z.string().max(300_000).nullish(),
});

export const visualizeOutputSchema = z.object({
  judgment: z.object({
    structure: z.string().max(600).default(""),
    certain: z.boolean(),
    reason: z.string().min(1).max(1200),
  }),
  visual: visualSchema.nullable(),
});

// The check (SPEC.md §20): the model reads the finished picture back and
// keeps it, replaces it, or withdraws it. keep true = the picture stands;
// keep false with a visual = that one replaces it; keep false with none = the
// run declines with the reason, because a picture that misleads is worse than
// no picture.
export const visualizeCheckSchema = z.object({
  keep: z.boolean(),
  reason: z.string().min(1).max(1200),
  visual: visualSchema.nullish(),
});

export type VisualizeCheck = z.infer<typeof visualizeCheckSchema>;

export type VisualizeOutput = z.infer<typeof visualizeOutputSchema>;
export type Visual = NonNullable<VisualizeOutput["visual"]>;
export type Diagram = z.infer<typeof diagramSchema>;

/** The annotation's markdown: the image, then the caption under it. */
export function visualizationMarkdown(imageId: string, caption: string): string {
  const alt = caption.replace(/[[\]\n]/g, " ").trim();
  return `![${alt}](${imageUrl(imageId)})\n\n*${caption.replace(/\n+/g, " ").trim()}*`;
}

/** The SVG of one visual: laid out for a diagram, integrated for a
    simulation, reduced for a picture or an animation. error: what made it
    unusable, for the reader's card. */
export async function renderVisual(visual: Visual): Promise<{ svg: string } | { error: string }> {
  if (visual.kind === "diagram") {
    if (!visual.diagram) return { error: "The diagram has no nodes." };
    return { svg: await renderDiagram(visual.diagram) };
  }
  if (visual.kind === "simulation") {
    if (!visual.simulation) return { error: "The simulation has no law." };
    return renderSimulation(visual.simulation);
  }
  if (!visual.svg) return { error: "The picture has no SVG." };
  return sanitizeSvg(visual.svg);
}

// ── Text measurement ───────────────────────────────────────────────────────

type Measure = (text: string, size: number, bold: boolean) => number;

// A CJK character is as wide as the font size; a Latin one about half.
function estimate(text: string, size: number): number {
  let width = 0;
  for (const ch of text) width += ch.codePointAt(0)! >= 0x2e80 ? size : size * 0.56;
  return width;
}

// @napi-rs/canvas measures with its own font, and the reader draws the SVG
// with the system font, so every measure carries a margin. Without the
// canvas (a build without native modules) the estimate stands.
async function measurer(): Promise<Measure> {
  try {
    const { createCanvas } = await import("@napi-rs/canvas");
    const ctx = createCanvas(4, 4).getContext("2d");
    return (text, size, bold) => {
      ctx.font = `${bold ? "bold " : ""}${size}px sans-serif`;
      const width = ctx.measureText(text).width;
      return Math.max(width, estimate(text, size) * 0.8) * 1.12;
    };
  } catch {
    return (text, size) => estimate(text, size) * 1.05;
  }
}

/** Lines of `text` no wider than `maxWidth`: word by word, and character by
    character when a word (or a run of CJK) is wider than the line. */
function wrap(text: string, size: number, bold: boolean, maxWidth: number, measure: Measure): string[] {
  const lines: string[] = [];
  const pushWord = (line: string, word: string): string => {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate, size, bold) <= maxWidth) return candidate;
    if (line) lines.push(line);
    if (measure(word, size, bold) <= maxWidth) return word;
    // Too wide alone: cut by characters.
    let run = "";
    for (const ch of word) {
      if (measure(run + ch, size, bold) > maxWidth && run) {
        lines.push(run);
        run = ch;
      } else {
        run += ch;
      }
    }
    return run;
  };
  for (const paragraph of text.replace(/\s+/g, " ").trim().split(" ")) {
    if (!paragraph) continue;
    const last = lines.length ? lines.pop()! : "";
    const next = pushWord(last, paragraph);
    if (next) lines.push(next);
  }
  return lines.length ? lines : [""];
}

// ── Diagram layout ─────────────────────────────────────────────────────────

const LABEL_SIZE = 15;
const DETAIL_SIZE = 12;
const LABEL_LINE = 19;
const DETAIL_LINE = 15;
const EDGE_SIZE = 12;
const PAD_X = 14;
const PAD_Y = 10;
const MAX_TEXT = 190;
const MIN_WIDTH = 90;
const GAP = 28; // between nodes of one rank
const RANK_GAP = 84; // between ranks
const MARGIN = 24;
const BACK_LIFT = 64; // how far a back edge arcs outside the nodes
const WAYPOINT = 20; // the lane one long edge takes in a rank it passes
const SWEEPS = 8; // ordering passes, down and up

type Box = {
  id: string;
  label: string[];
  detail: string[];
  w: number;
  h: number;
  x: number;
  y: number;
  rank: number;
  // What the article states elsewhere, drawn faint beside the passage's own
  // nodes (nodeSchema.role).
  article: boolean;
  // A waypoint on an edge that skips ranks: it orders and places like a box,
  // takes a lane of its rank, and draws nothing.
  waypoint: boolean;
};

type Edge = { from: string; to: string; label: string | null; back: boolean };

type Point = { x: number; y: number };

const at = (p: Point) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;

/** Ranks by longest path over the forward edges; a DFS marks the edges that
    close a cycle as back edges so the layering ends. */
function layer(ids: string[], edges: Edge[]): Map<string, number> {
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  const state = new Map<string, 0 | 1 | 2>();
  for (const e of edges) out.get(e.from)!.push(e.to);
  const byPair = new Map(edges.map((e) => [`${e.from}>${e.to}`, e]));
  const visit = (id: string) => {
    state.set(id, 1);
    for (const to of out.get(id)!) {
      const s = state.get(to) ?? 0;
      if (s === 1) byPair.get(`${id}>${to}`)!.back = true;
      else if (s === 0) visit(to);
    }
    state.set(id, 2);
  };
  for (const id of ids) if (!state.get(id)) visit(id);

  const rank = new Map(ids.map((id) => [id, 0]));
  const forward = edges.filter((e) => !e.back);
  // n ≤ 16: relax until stable.
  for (let pass = 0; pass < ids.length + 1; pass++) {
    let moved = false;
    for (const e of forward) {
      const r = rank.get(e.from)! + 1;
      if (r > rank.get(e.to)!) {
        rank.set(e.to, r);
        moved = true;
      }
    }
    if (!moved) break;
  }
  // A node nobody points at and that points at nothing sits at rank 0 with
  // the sources, in the model's order.
  return rank;
}

/** A smooth path through the points. Both ends run along the rank axis, so an
    arrow always meets the box it points at square on. */
function splinePath(points: Point[], right: boolean): string {
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length === 2) {
    const c1 = right ? { x: first.x + RANK_GAP / 2, y: first.y } : { x: first.x, y: first.y + RANK_GAP / 2 };
    const c2 = right ? { x: last.x - RANK_GAP / 2, y: last.y } : { x: last.x, y: last.y - RANK_GAP / 2 };
    return `M${at(first)} C${at(c1)} ${at(c2)} ${at(last)}`;
  }
  // Catmull-Rom through the waypoints, written as cubics.
  const parts = [`M${at(first)}`];
  for (let i = 0; i + 1 < points.length; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const p0 = points[i - 1] ?? p1;
    const p3 = points[i + 2] ?? p2;
    let c1: Point = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    let c2: Point = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    if (i === 0) c1 = right ? { x: p1.x + RANK_GAP / 3, y: p1.y } : { x: p1.x, y: p1.y + RANK_GAP / 3 };
    if (i + 2 === points.length) {
      c2 = right ? { x: p2.x - RANK_GAP / 3, y: p2.y } : { x: p2.x, y: p2.y - RANK_GAP / 3 };
    }
    parts.push(`C${at(c1)} ${at(c2)} ${at(p2)}`);
  }
  return parts.join(" ");
}

/** The diagram as SVG. The model picks the direction; when that reads as a
    strip too wide for the card (a long chain laid out left to right), the
    other direction stands in, so the picture is legible at card width. */
export async function renderDiagram(diagram: Diagram): Promise<string> {
  const measure = await measurer();
  const right = diagram.direction === "right";
  let drawn = drawDiagram(diagram, right, measure);
  if (drawn.width > drawn.height * 1.6) {
    const flipped = drawDiagram(diagram, !right, measure);
    if (flipped.width / flipped.height < drawn.width / drawn.height) drawn = flipped;
  }
  return drawn.svg;
}

function drawDiagram(
  diagram: Diagram,
  right: boolean,
  measure: Measure,
): { svg: string; width: number; height: number } {
  const seen = new Set<string>();
  const nodes = diagram.nodes.filter((n) => {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    return true;
  });
  const ids = nodes.map((n) => n.id);
  const edgeSeen = new Set<string>();
  const edges: Edge[] = diagram.edges
    .filter((e) => seen.has(e.from) && seen.has(e.to) && e.from !== e.to)
    .filter((e) => {
      const key = `${e.from}>${e.to}`;
      if (edgeSeen.has(key)) return false;
      edgeSeen.add(key);
      return true;
    })
    .map((e) => ({ from: e.from, to: e.to, label: e.label?.trim() || null, back: false }));

  const rank = layer(ids, edges);
  const boxes: Box[] = nodes.map((n) => {
    const label = wrap(n.label, LABEL_SIZE, true, MAX_TEXT, measure);
    const detail = n.detail?.trim() ? wrap(n.detail, DETAIL_SIZE, false, MAX_TEXT, measure) : [];
    const textW = Math.max(
      ...label.map((l) => measure(l, LABEL_SIZE, true)),
      ...detail.map((l) => measure(l, DETAIL_SIZE, false)),
    );
    return {
      id: n.id,
      label,
      detail,
      w: Math.max(MIN_WIDTH, Math.ceil(textW) + PAD_X * 2),
      h: label.length * LABEL_LINE + detail.length * DETAIL_LINE + (detail.length ? 4 : 0) + PAD_Y * 2,
      x: 0,
      y: 0,
      rank: rank.get(n.id)!,
      article: n.role === "article",
      waypoint: false,
    };
  });
  // The passage's nodes stand out only against the article's: a diagram of
  // the passage alone is drawn plain, with no one node louder than another.
  const mixed = boxes.some((b) => b.article) && boxes.some((b) => !b.article);
  const byId = new Map(boxes.map((b) => [b.id, b]));

  // An edge's label is measured with the nodes, so the layout can keep room
  // for it instead of dropping it wherever the line happens to run.
  const chip = new Map<Edge, { lines: string[]; w: number; h: number }>();
  for (const e of edges) {
    if (!e.label) continue;
    const lines = wrap(e.label, EDGE_SIZE, false, 120, measure);
    chip.set(e, {
      lines,
      w: Math.max(...lines.map((l) => measure(l, EDGE_SIZE, false))) + 10,
      h: lines.length * 15 + 4,
    });
  }

  // An edge that skips ranks travels through one waypoint per rank it passes.
  // The waypoints order and place with the boxes, so a long edge bends
  // through the gaps instead of crossing the boxes between its ends. The
  // waypoint that carries the edge's label is the size of that label, so the
  // rank keeps room for it and no label lands on a box.
  let waypoints = 0;
  const chains: { edge: Edge; ids: string[]; carry: number }[] = [];
  for (const e of edges) {
    if (e.back) {
      chains.push({ edge: e, ids: [e.from, e.to], carry: -1 });
      continue;
    }
    const path = [e.from];
    for (let r = rank.get(e.from)! + 1; r < rank.get(e.to)!; r++) {
      const id = `waypoint ${waypoints++}`;
      const box: Box = {
        id,
        label: [],
        detail: [],
        w: right ? 0 : WAYPOINT,
        h: right ? WAYPOINT : 0,
        x: 0,
        y: 0,
        rank: r,
        article: false,
        waypoint: true,
      };
      boxes.push(box);
      byId.set(id, box);
      path.push(id);
    }
    path.push(e.to);
    // The middle waypoint carries the label; a two-point edge has none and
    // labels at the middle of its curve, in the gap between the ranks.
    const carry = path.length > 2 ? Math.floor(path.length / 2) : -1;
    const box = chip.get(e);
    if (carry > 0 && box) {
      const on = byId.get(path[carry])!;
      on.w = box.w;
      on.h = box.h;
    }
    chains.push({ edge: e, ids: path, carry });
  }

  // Ranks, in order. Within a rank the nodes sort by the mean seat of their
  // neighbours in the rank before (a down sweep) or after (an up sweep); the
  // arrangement with the fewest crossing edges wins, and the model's order
  // breaks every tie.
  const rankCount = Math.max(...boxes.map((b) => b.rank)) + 1;
  const start: Box[][] = Array.from({ length: rankCount }, () => []);
  for (const b of boxes) start[b.rank].push(b);
  const before = new Map<string, string[]>(boxes.map((b) => [b.id, []]));
  const after = new Map<string, string[]>(boxes.map((b) => [b.id, []]));
  for (const chain of chains) {
    if (chain.edge.back) continue;
    for (let i = 0; i + 1 < chain.ids.length; i++) {
      after.get(chain.ids[i])!.push(chain.ids[i + 1]);
      before.get(chain.ids[i + 1])!.push(chain.ids[i]);
    }
  }
  const crossings = (rs: Box[][]): number => {
    const seat = new Map<string, number>();
    rs.forEach((r) => r.forEach((b, i) => seat.set(b.id, i)));
    let total = 0;
    for (const r of rs) {
      const links: [number, number][] = [];
      for (const b of r) for (const to of after.get(b.id)!) links.push([seat.get(b.id)!, seat.get(to)!]);
      links.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
      for (let i = 0; i < links.length; i++) {
        for (let j = i + 1; j < links.length; j++) if (links[i][1] > links[j][1]) total++;
      }
    }
    return total;
  };
  const current = start.map((r) => [...r]);
  let best = current.map((r) => [...r]);
  let fewest = crossings(current);
  const seat = new Map<string, number>();
  for (let pass = 0; pass < SWEEPS && fewest > 0; pass++) {
    const downward = pass % 2 === 0;
    current.forEach((r) => r.forEach((b, i) => seat.set(b.id, i)));
    const order = downward
      ? current.map((_, i) => i).slice(1)
      : current.map((_, i) => i).slice(0, -1).reverse();
    for (const r of order) {
      const neighbours = downward ? before : after;
      const key = (b: Box) => {
        const seats = neighbours.get(b.id)!.map((id) => seat.get(id) ?? 0);
        return seats.length
          ? seats.reduce((s, c) => s + c, 0) / seats.length
          : Number.MAX_SAFE_INTEGER;
      };
      current[r] = current[r]
        .map((b, i) => ({ b, i, k: key(b) }))
        .sort((a, c) => a.k - c.k || a.i - c.i)
        .map((x) => x.b);
      current[r].forEach((b, i) => seat.set(b.id, i));
    }
    const count = crossings(current);
    if (count < fewest) {
      fewest = count;
      best = current.map((r) => [...r]);
    }
  }
  const ranks = best;

  // Coordinates: along = the rank axis, across = the stacking axis.
  const along = (b: Box) => (right ? b.w : b.h);
  const across = (b: Box) => (right ? b.h : b.w);
  const rankSize = ranks.map((r) => Math.max(0, ...r.map(along)));
  const rankSpan = ranks.map((r) => r.reduce((s, b) => s + across(b), 0) + GAP * (r.length - 1));
  const maxSpan = Math.max(...rankSpan);
  let alongAt = MARGIN;
  ranks.forEach((r, i) => {
    let acrossAt = MARGIN + (maxSpan - rankSpan[i]) / 2;
    for (const b of r) {
      const centered = alongAt + (rankSize[i] - along(b)) / 2;
      if (right) {
        b.x = centered;
        b.y = acrossAt;
      } else {
        b.y = centered;
        b.x = acrossAt;
      }
      acrossAt += across(b) + GAP;
    }
    alongAt += rankSize[i] + RANK_GAP;
  });

  // The viewBox is what the drawing actually covers, so nothing is cut: every
  // box, every label, and the far side of every back edge's arc.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const cover = (x: number, y: number, w = 0, h = 0) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };
  for (const b of boxes) cover(b.x, b.y, b.w, b.h);

  // Edges: a spline from the facing side of one box, through the waypoints of
  // every rank it passes, to the facing side of the other. A back edge arcs
  // over the top (or the left) so it never crosses the nodes it passes.
  const paths: string[] = [];
  const labels: string[] = [];
  const center = (b: Box): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  // Back edges arc concentrically, each one deeper than the last, so two that
  // run the same way stay two lines and not one thick one.
  let backs = 0;
  for (const chain of chains) {
    const e = chain.edge;
    const a = byId.get(e.from)!;
    const b = byId.get(e.to)!;
    let d: string;
    let mid: Point;
    if (!e.back) {
      const points: Point[] = [
        right ? { x: a.x + a.w, y: a.y + a.h / 2 } : { x: a.x + a.w / 2, y: a.y + a.h },
        ...chain.ids.slice(1, -1).map((id) => center(byId.get(id)!)),
        right ? { x: b.x, y: b.y + b.h / 2 } : { x: b.x + b.w / 2, y: b.y },
      ];
      d = splinePath(points, right);
      if (points.length === 2) {
        const [p1, p2] = points;
        const c1 = right ? { x: p1.x + RANK_GAP / 2, y: p1.y } : { x: p1.x, y: p1.y + RANK_GAP / 2 };
        const c2 = right ? { x: p2.x - RANK_GAP / 2, y: p2.y } : { x: p2.x, y: p2.y - RANK_GAP / 2 };
        mid = {
          x: (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8,
          y: (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8,
        };
      } else {
        // On a waypoint: the one place along a long edge that is clear.
        mid = points[Math.floor(points.length / 2)];
      }
    } else {
      const x1 = right ? a.x + a.w / 2 : a.x;
      const y1 = right ? a.y : a.y + a.h / 2;
      const x2 = right ? b.x + b.w / 2 : b.x;
      const y2 = right ? b.y : b.y + b.h / 2;
      const deep = BACK_LIFT * (1 + backs++ * 0.45);
      const c1x = right ? x1 : x1 - deep;
      const c1y = right ? y1 - deep : y1;
      const c2x = right ? x2 : x2 - deep;
      const c2y = right ? y2 - deep : y2;
      d = `M${x1},${y1} C${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`;
      mid = { x: (x1 + 3 * c1x + 3 * c2x + x2) / 8, y: (y1 + 3 * c1y + 3 * c2y + y2) / 8 };
      // The arc reaches past the nodes on the lift side; a curve stays inside
      // its control points, so covering those covers the arc.
      cover(Math.min(c1x, c2x), Math.min(c1y, c2y));
      cover(Math.max(c1x, c2x), Math.max(c1y, c2y));
    }
    paths.push(
      `<path d="${d}" fill="none" stroke="${e.back ? ACCENT : INK}" stroke-width="2" marker-end="url(#arrow${e.back ? "-back" : ""})"/>`,
    );
    const box = chip.get(e);
    if (box) {
      const { lines, w: lw, h: lh } = box;
      // A back edge's label sits on the arc, which runs beside the nodes: push
      // it clear of them, the way the arc itself is clear of them.
      if (e.back) {
        if (right) mid.y -= lh / 2 + 4;
        else mid.x -= lw / 2 + 4;
      }
      cover(mid.x - lw / 2, mid.y - lh / 2, lw, lh);
      labels.push(
        `<rect x="${(mid.x - lw / 2).toFixed(1)}" y="${(mid.y - lh / 2).toFixed(1)}" width="${lw.toFixed(1)}" height="${lh}" rx="4" fill="${PAPER}" stroke="${CHIP_LINE}" stroke-width="1"/>`,
        ...lines.map(
          (l, i) =>
            `<text x="${mid.x.toFixed(1)}" y="${(mid.y - lh / 2 + 2 + (i + 1) * 15 - 4).toFixed(1)}" font-size="${EDGE_SIZE}" fill="${MUTED}" text-anchor="middle" font-family="system-ui, sans-serif">${escapeXml(l)}</text>`,
        ),
      );
    }
  }

  const nodeMarkup = boxes
    .filter((b) => !b.waypoint)
    .map((b) => {
      const lines: string[] = [];
      const faint = mixed && b.article;
      let y = b.y + PAD_Y + LABEL_SIZE - 1;
      for (const l of b.label) {
        lines.push(
          `<text x="${(b.x + b.w / 2).toFixed(1)}" y="${y.toFixed(1)}" font-size="${LABEL_SIZE}" font-weight="700" fill="${faint ? MUTED : INK}" text-anchor="middle" font-family="system-ui, sans-serif">${escapeXml(l)}</text>`,
        );
        y += LABEL_LINE;
      }
      y += b.detail.length ? 4 - (LABEL_LINE - DETAIL_LINE) : 0;
      for (const l of b.detail) {
        lines.push(
          `<text x="${(b.x + b.w / 2).toFixed(1)}" y="${y.toFixed(1)}" font-size="${DETAIL_SIZE}" fill="${MUTED}" text-anchor="middle" font-family="system-ui, sans-serif">${escapeXml(l)}</text>`,
        );
        y += DETAIL_LINE;
      }
      // Mixed: the passage's nodes in the accent on the fill, the article's
      // faint — a muted dashed outline on the paper. Plain otherwise, the
      // sources marked.
      const outline = mixed
        ? b.article
          ? `fill="${PAPER}" stroke="${MUTED}" stroke-width="1.5" stroke-dasharray="5 4"`
          : `fill="${FILL}" stroke="${ACCENT}" stroke-width="2"`
        : `fill="${FILL}" stroke="${b.rank === 0 ? ACCENT : INK}" stroke-width="1.5"`;
      return (
        `<rect x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${b.w}" height="${b.h}" rx="10" ${outline}/>` +
        lines.join("")
      );
    });

  const x = Math.floor(minX - MARGIN);
  const y = Math.floor(minY - MARGIN);
  const width = Math.ceil(maxX + MARGIN) - x;
  const height = Math.ceil(maxY + MARGIN) - y;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" role="img">`,
    THEME_STYLE,
    `<defs>`,
    `<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${INK}"/></marker>`,
    `<marker id="arrow-back" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${ACCENT}"/></marker>`,
    `</defs>`,
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${PAPER}"/>`,
    ...paths,
    ...nodeMarkup,
    ...labels,
    `</svg>`,
  ].join("");
  return { svg, width, height };
}

// ── Picture and animation: the model's SVG, reduced ────────────────────────

const ALLOWED_ELEMENTS = new Set([
  "svg",
  "g",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "path",
  "text",
  "tspan",
  "title",
  "desc",
  "defs",
  "marker",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "animate",
  "animateTransform",
  "animateMotion",
  "mpath",
  "set",
]);

const MAX_SVG_BYTES = 300_000;

// Colors the model may write another way. The dark palette matches on the
// exact value (THEME_STYLE), so every color attribute is normalized to lower
// case six-digit hex first — a picture written with #FFF or white retints
// like one written with #ffffff.
const COLOR_ATTRIBUTES = new Set(["fill", "stroke", "stop-color", "flood-color", "lighting-color"]);
const COLOR_NAMES: Record<string, string> = { white: "#ffffff", black: "#000000" };

function normalizeColor(value: string): string {
  const text = value.trim().toLowerCase();
  const named = COLOR_NAMES[text];
  if (named) return named;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return /^#[0-9a-f]{6}$/.test(text) ? text : value;
}

/** The model's SVG with only the allowed elements and attributes left: no
    script, no foreign content, no external reference, no event handler. The
    root keeps its viewBox and loses width and height, so the card scales it. */
export function sanitizeSvg(source: string): { svg: string } | { error: string } {
  const text = source.trim();
  if (!/^(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text)) return { error: "The output is not an SVG." };
  const dom = new JSDOM("");
  const { DOMParser, XMLSerializer } = dom.window;
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    return { error: "The SVG is not well-formed." };
  }
  const root = doc.documentElement;
  if (root.localName !== "svg") return { error: "The output is not an SVG." };
  if (!root.getAttribute("viewBox")) return { error: "The SVG has no viewBox." };

  const clean = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (!ALLOWED_ELEMENTS.has(child.localName)) {
        // A link or a switch keeps what it wraps; anything else goes whole.
        if (child.localName === "a" || child.localName === "switch") {
          child.replaceWith(...Array.from(child.childNodes));
          clean(el);
          return;
        }
        child.remove();
        continue;
      }
      clean(child);
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      // url() reaches outside the file unless it names a fragment of it, and
      // a reference outside the file is the one thing an <img> must not make.
      const urls = value.match(/url\s*\(\s*['"]?([^'")]*)/gi) ?? [];
      const drop =
        name.startsWith("on") ||
        ((name === "href" || name.endsWith(":href")) && !value.startsWith("#")) ||
        urls.some((u) => !/url\s*\(\s*['"]?#/i.test(u)) ||
        (name === "style" && /expression|@import/i.test(value)) ||
        /javascript:|data:/i.test(value);
      if (drop) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (COLOR_ATTRIBUTES.has(name)) el.setAttribute(attr.name, normalizeColor(value));
    }
  };
  clean(root);
  root.removeAttribute("width");
  root.removeAttribute("height");
  root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (root.children.length === 0) return { error: "The SVG is empty." };
  // The dark palette rides inside the picture, added after the reduction: the
  // model never writes a style element, the server always does.
  const style = doc.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = DARK_RULES;
  root.insertBefore(style, root.firstChild);
  const svg = new XMLSerializer().serializeToString(root);
  if (svg.length > MAX_SVG_BYTES) return { error: "The SVG is too large." };
  return { svg };
}

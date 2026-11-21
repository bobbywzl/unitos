import { getStroke } from "perfect-freehand";
import { z } from "zod";

// Jottings (SPEC.md §33): handwriting drawn over a document in the reader
// with a pen. A jotting is one stroke. It is keyed to a block, so it stays
// with its words when the page scrolls, the pane narrows, or the text above
// it changes. Everything here is plain data and geometry, shared by the
// route, the layer, and the checks.

/** The pen's colors: ink (the text color) and the four highlight hues. */
export const JOT_COLORS = ["ink", "clay", "sage", "gold", "plum"] as const;
export type JotColor = (typeof JOT_COLORS)[number];

export const JOT_COLOR_CSS: Record<JotColor, string> = {
  ink: "var(--ink)",
  clay: "var(--clay-400)",
  sage: "var(--sage-500)",
  gold: "#d9a54a",
  plum: "#a78bfa",
};

/** The pen's two widths, in px as drawn. */
export const JOT_WIDTHS_PX = [2.5, 5] as const;

export const JOT_POINTS_MAX = 600;
/** One save carries this many jottings at most. */
export const JOT_BATCH_MAX = 200;

// A point is [x, y, pressure]. One unit is a hundredth of the block's width;
// the origin is the block's top left corner; y grows down. A stroke may run
// into the margins (x under 0 or over 100) and past the block's foot.
const point = z.tuple([
  z.number().min(-1000).max(1100),
  z.number().min(-5000).max(200_000),
  z.number().min(0).max(1),
]);
export type JotPoint = z.infer<typeof point>;

export const jottingSchema = z.object({
  // The browser names the row, so a save sent twice writes it once.
  id: z.string().regex(/^j[a-z0-9]{12,40}$/),
  blockId: z.string().min(1).max(100),
  // Where the block stood among the pane's blocks when the stroke was drawn:
  // the place the stroke takes when its block is gone (a re-parse).
  blockOrder: z.number().int().min(0).max(1_000_000),
  // "core": drawn on the block's core in the collapsed view (SPEC.md §28).
  layer: z.literal("core").nullable(),
  color: z.enum(JOT_COLORS),
  // The pen's width, in units.
  width: z.number().min(0.02).max(10),
  // The block's height when the stroke was drawn, in units.
  aspect: z.number().min(0).max(200_000),
  points: z.array(point).min(1).max(JOT_POINTS_MAX),
});
export type Jotting = z.infer<typeof jottingSchema>;

/** A stored jotting as the reader gets it: with who drew it. */
export type StoredJotting = Jotting & { userId: string };

/** A row's `points` column read back; null = not points. */
export function parseJotPoints(value: unknown): JotPoint[] | null {
  const parsed = z.array(point).min(1).max(JOT_POINTS_MAX).safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function newJottingId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `j${Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("")}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A drawn stroke made ready to store: points closer than `gap` units to the
    one before are dropped, the rest thinned to JOT_POINTS_MAX, every number
    kept to two decimals. The first and the last point always stay. */
export function tidyPoints(points: JotPoint[], gap = 0.12): JotPoint[] {
  const kept: JotPoint[] = [];
  for (const p of points) {
    const last = kept[kept.length - 1];
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < gap) continue;
    kept.push(p);
  }
  const end = points[points.length - 1];
  const lastKept = kept[kept.length - 1];
  if (end && lastKept && (end[0] !== lastKept[0] || end[1] !== lastKept[1])) kept.push(end);
  let thinned = kept;
  if (kept.length > JOT_POINTS_MAX) {
    const step = (kept.length - 1) / (JOT_POINTS_MAX - 1);
    thinned = Array.from({ length: JOT_POINTS_MAX }, (_, i) => kept[Math.round(i * step)]);
  }
  return thinned.map(([x, y, p]) => [round2(x), round2(y), round2(p)]);
}

/** The stroke's outline as an SVG path, in units: a filled shape whose width
    follows the pen's pressure. One point draws a dot. */
export function jottingPathD(points: JotPoint[], width: number): string {
  const outline = getStroke(points, {
    size: width,
    thinning: 0.55,
    smoothing: 0.5,
    streamline: 0.35,
    simulatePressure: false,
    last: true,
  });
  if (outline.length === 0) return "";
  const f = (n: number) => n.toFixed(2);
  let d = `M${f(outline[0][0])} ${f(outline[0][1])} Q`;
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    d += `${f(x0)} ${f(y0)} ${f((x0 + x1) / 2)} ${f((y0 + y1) / 2)} `;
  }
  return `${d}Z`;
}

export type JotBounds = { minX: number; minY: number; maxX: number; maxY: number };

export function jottingBounds(points: JotPoint[]): JotBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** How far down a stroke moves, in units, when its block is `aspect` units
    tall now and was `drawn` units tall when the stroke was drawn. The block's
    words wrap again when its width changes, so its height in units changes:
    the stroke keeps its place as a share of the height (a mark beside the
    last line stays beside the last line). A stroke above or below the block
    keeps its distance from the nearer edge. */
export function jottingShift(bounds: JotBounds, drawn: number, aspect: number): number {
  if (drawn <= 0 || aspect <= 0 || Math.abs(aspect - drawn) < 0.01) return 0;
  const center = (bounds.minY + bounds.maxY) / 2;
  if (center <= 0) return 0;
  if (center >= drawn) return aspect - drawn;
  return (center / drawn) * aspect - center;
}

/** Whether the point (x, y), in units, is within `reach` units of the stroke. */
export function jottingHit(points: JotPoint[], x: number, y: number, reach: number): boolean {
  if (points.length === 1) return Math.hypot(points[0][0] - x, points[0][1] - y) <= reach;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    if (Math.hypot(ax + t * dx - x, ay + t * dy - y) <= reach) return true;
  }
  return false;
}

/** The body of one save: strokes to add, strokes to erase, and erased
    strokes to bring back (Undo). */
export const jottingsSaveSchema = z.object({
  notebookId: z.string().min(1).max(100),
  add: z.array(jottingSchema).max(JOT_BATCH_MAX).default([]),
  erase: z.array(z.string().min(1).max(64)).max(JOT_BATCH_MAX).default([]),
  restore: z.array(z.string().min(1).max(64)).max(JOT_BATCH_MAX).default([]),
});
export type JottingsSave = z.infer<typeof jottingsSaveSchema>;

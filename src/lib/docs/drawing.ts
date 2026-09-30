import { z } from "zod";
import { PAPER, escapeXml } from "@/lib/derive/visual-palette";

// Insert > Drawing (SPEC.md §29): lines, arrows, rectangles, ovals, text
// boxes, and scribbles drawn in a dialog. The drawing is an image (the SVG
// below, cut to what is drawn and stored as a PNG) that keeps its shapes on
// the image (`drawing`, a JSON string), so a double-click edits it. One
// place for the shapes' rules and the SVG: the dialog draws with it, and the
// save checks the shapes with it.

/** The most shapes a drawing keeps, and the most points of all its scribbles. */
export const MAX_DRAWING_SHAPES = 300;
export const MAX_DRAWING_POINTS = 20_000;
/** The most characters a drawing keeps as JSON. */
export const MAX_DRAWING_JSON = 400_000;

const coord = z.number().finite().min(-10_000).max(10_000);
const size = z.number().finite().min(0).max(10_000);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const weight = z.number().finite().min(0.5).max(24);

const line = z.object({ kind: z.literal("line"), x1: coord, y1: coord, x2: coord, y2: coord, stroke: color, width: weight });
const arrow = z.object({ kind: z.literal("arrow"), x1: coord, y1: coord, x2: coord, y2: coord, stroke: color, width: weight });
const rect = z.object({ kind: z.literal("rect"), x: coord, y: coord, w: size, h: size, stroke: color, fill: color.nullable(), width: weight });
const ellipse = z.object({ kind: z.literal("ellipse"), x: coord, y: coord, w: size, h: size, stroke: color, fill: color.nullable(), width: weight });
const text = z.object({ kind: z.literal("text"), x: coord, y: coord, text: z.string().max(2000), color, size: z.number().finite().min(8).max(72) });
const scribble = z.object({ kind: z.literal("scribble"), points: z.array(z.tuple([coord, coord])).min(1).max(5000), stroke: color, width: weight });

export const shapeSchema = z.union([line, arrow, rect, ellipse, text, scribble]);
export type Shape = z.infer<typeof shapeSchema>;
export type ShapeKind = Shape["kind"];

export const drawingSchema = z
  .object({ v: z.literal(1), shapes: z.array(shapeSchema).max(MAX_DRAWING_SHAPES) })
  .refine((d) => d.shapes.reduce((n, s) => n + (s.kind === "scribble" ? s.points.length : 0), 0) <= MAX_DRAWING_POINTS);
export type Drawing = z.infer<typeof drawingSchema>;

/** A drawing's shapes from the image's attribute (a JSON string) or an
    object; null when they break a rule. */
export function parseDrawing(value: unknown): Drawing | null {
  let data = value;
  if (typeof value === "string") {
    if (value.length > MAX_DRAWING_JSON) return null;
    try {
      data = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const parsed = drawingSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

// ── The SVG ─────────────────────────────────────────────────────────────────

export const DRAWING_FONT = "Arial, Helvetica, 'Liberation Sans', sans-serif";
/** A text box's line height over its size. */
export const TEXT_LEADING = 1.25;
/** The room around what is drawn, in px. */
const PAD = 8;

/** A width for `line` at `size` px: the SVG has no fonts to measure. */
export const textWidth = (line: string, size: number) => line.length * size * 0.56;

/** The corners of an arrow's head at (x2, y2). */
export function arrowHead(s: { x1: number; y1: number; x2: number; y2: number; width: number }): [number, number][] {
  const angle = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
  const length = 6 + s.width * 3;
  const spread = Math.PI / 7;
  return [
    [s.x2, s.y2],
    [s.x2 - length * Math.cos(angle - spread), s.y2 - length * Math.sin(angle - spread)],
    [s.x2 - length * Math.cos(angle + spread), s.y2 - length * Math.sin(angle + spread)],
  ];
}

/** Where a shape reaches: x0, y0, x1, y1, its line's half width in. */
export function shapeBounds(s: Shape): [number, number, number, number] {
  switch (s.kind) {
    case "line":
    case "arrow": {
      const reach = s.kind === "arrow" ? 6 + s.width * 3 : s.width / 2;
      return [Math.min(s.x1, s.x2) - reach, Math.min(s.y1, s.y2) - reach, Math.max(s.x1, s.x2) + reach, Math.max(s.y1, s.y2) + reach];
    }
    case "rect":
    case "ellipse":
      return [s.x - s.width / 2, s.y - s.width / 2, s.x + s.w + s.width / 2, s.y + s.h + s.width / 2];
    case "text": {
      const lines = s.text.split("\n");
      const wide = Math.max(s.size, ...lines.map((l) => textWidth(l, s.size)));
      return [s.x, s.y, s.x + wide, s.y + lines.length * s.size * TEXT_LEADING];
    }
    case "scribble": {
      const xs = s.points.map((p) => p[0]);
      const ys = s.points.map((p) => p[1]);
      return [Math.min(...xs) - s.width / 2, Math.min(...ys) - s.width / 2, Math.max(...xs) + s.width / 2, Math.max(...ys) + s.width / 2];
    }
  }
}

const n = (v: number) => Number(v.toFixed(2)).toString();

/** One shape as SVG. */
export function shapeSvg(s: Shape): string {
  switch (s.kind) {
    case "line":
      return `<line x1="${n(s.x1)}" y1="${n(s.y1)}" x2="${n(s.x2)}" y2="${n(s.y2)}" stroke="${s.stroke}" stroke-width="${n(s.width)}" stroke-linecap="round"/>`;
    case "arrow": {
      // The shaft stops where the head starts, so a thick line never shows past its point.
      const head = arrowHead(s);
      const back = [(head[1][0] + head[2][0]) / 2, (head[1][1] + head[2][1]) / 2];
      return (
        `<line x1="${n(s.x1)}" y1="${n(s.y1)}" x2="${n(back[0])}" y2="${n(back[1])}" stroke="${s.stroke}" stroke-width="${n(s.width)}" stroke-linecap="round"/>` +
        `<polygon points="${head.map((p) => `${n(p[0])},${n(p[1])}`).join(" ")}" fill="${s.stroke}"/>`
      );
    }
    case "rect":
      return `<rect x="${n(s.x)}" y="${n(s.y)}" width="${n(s.w)}" height="${n(s.h)}" fill="${s.fill ?? "none"}" stroke="${s.stroke}" stroke-width="${n(s.width)}"/>`;
    case "ellipse":
      return `<ellipse cx="${n(s.x + s.w / 2)}" cy="${n(s.y + s.h / 2)}" rx="${n(s.w / 2)}" ry="${n(s.h / 2)}" fill="${s.fill ?? "none"}" stroke="${s.stroke}" stroke-width="${n(s.width)}"/>`;
    case "text":
      return `<text font-family="${DRAWING_FONT}" font-size="${n(s.size)}" fill="${s.color}">${s.text
        .split("\n")
        .map((l, i) => `<tspan x="${n(s.x)}" y="${n(s.y + s.size * (0.9 + TEXT_LEADING * i))}">${escapeXml(l) || " "}</tspan>`)
        .join("")}</text>`;
    case "scribble":
      return s.points.length === 1
        ? `<circle cx="${n(s.points[0][0])}" cy="${n(s.points[0][1])}" r="${n(s.width / 2)}" fill="${s.stroke}"/>`
        : `<polyline points="${s.points.map((p) => `${n(p[0])},${n(p[1])}`).join(" ")}" fill="none" stroke="${s.stroke}" stroke-width="${n(s.width)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
}

/** The drawing as an SVG document cut to what is drawn, on white; null
    when nothing is drawn. */
export function drawingSvg(drawing: Drawing): { svg: string; width: number; height: number } | null {
  const shapes = drawing.shapes.filter((s) => s.kind !== "text" || s.text.trim());
  if (shapes.length === 0) return null;
  const boxes = shapes.map(shapeBounds);
  const x0 = Math.min(...boxes.map((b) => b[0])) - PAD;
  const y0 = Math.min(...boxes.map((b) => b[1])) - PAD;
  const width = Math.max(24, Math.ceil(Math.max(...boxes.map((b) => b[2])) + PAD - x0));
  const height = Math.max(24, Math.ceil(Math.max(...boxes.map((b) => b[3])) + PAD - y0));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${n(x0)} ${n(y0)} ${width} ${height}">` +
    `<rect x="${n(x0)}" y="${n(y0)}" width="${width}" height="${height}" fill="${PAPER}"/>${shapes.map(shapeSvg).join("")}</svg>`;
  return { svg, width, height };
}

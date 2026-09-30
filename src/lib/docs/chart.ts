import { z } from "zod";
import { ACCENTS, CHIP_LINE, INK, MUTED, PAPER, escapeXml } from "@/lib/derive/visual-palette";

// Insert > Chart (SPEC.md §29): a column, bar, line, or pie chart in the
// page, drawn from data the reader types or from a table of the page. The
// chart is an image (the drawing below, stored as a PNG) that keeps its data
// on the image (`chart`, a JSON string), so a double-click edits it. One
// place for the data's rules and the drawing: the page draws with it, and
// the save checks the data with it.

export const CHART_TYPES = ["column", "bar", "line", "pie"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/** The most labels (rows) and series (columns) a chart takes. */
export const MAX_CHART_LABELS = 50;
export const MAX_CHART_SERIES = 8;
/** The most characters a chart's data keeps as JSON. */
export const MAX_CHART_JSON = 20_000;

const name = z.string().max(100);
export const chartSchema = z
  .object({
    v: z.literal(1),
    type: z.enum(CHART_TYPES),
    title: z.string().max(200),
    labels: z.array(name).min(1).max(MAX_CHART_LABELS),
    series: z
      .array(z.object({ name, values: z.array(z.number().finite().nullable()).max(MAX_CHART_LABELS) }))
      .min(1)
      .max(MAX_CHART_SERIES),
  })
  .refine((c) => c.series.every((s) => s.values.length === c.labels.length));
export type ChartSpec = z.infer<typeof chartSchema>;

/** A chart's data from the image's attribute (a JSON string) or an object;
    null when it breaks a rule. */
export function parseChart(value: unknown): ChartSpec | null {
  let data = value;
  if (typeof value === "string") {
    if (value.length > MAX_CHART_JSON) return null;
    try {
      data = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const parsed = chartSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** A cell's number: "1,234.5", "12%", "$30", " -4 "; null for anything else. */
export function chartNumber(text: string): number | null {
  const plain = text.replace(/[\s,$€£¥%]/g, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(plain)) return null;
  const n = Number(plain);
  return Number.isFinite(n) ? n : null;
}

/** A chart from a table's cell texts, row by row: the first column names the
    labels, and the first row names the series when its cells are words. A
    cell that is not a number is empty. Null when the table has fewer than
    two columns or no number at all. */
export function chartFromRows(rows: string[][], seriesName: (n: number) => string): ChartSpec | null {
  const width = Math.min(MAX_CHART_SERIES + 1, Math.max(0, ...rows.map((r) => r.length)));
  if (rows.length === 0 || width < 2) return null;
  const header = rows[0].slice(1, width).some((cell) => cell.trim() && chartNumber(cell) === null);
  const body = (header ? rows.slice(1) : rows).slice(0, MAX_CHART_LABELS);
  if (body.length === 0) return null;
  const series = Array.from({ length: width - 1 }, (_, i) => ({
    name: (header ? rows[0][i + 1]?.trim() : "") || seriesName(i + 1),
    values: body.map((row) => chartNumber(row[i + 1] ?? "")),
  }));
  if (!series.some((s) => s.values.some((v) => v !== null))) return null;
  return {
    v: 1,
    type: "column",
    title: "",
    labels: body.map((row) => (row[0] ?? "").trim().slice(0, 100)),
    series: series.map((s) => ({ ...s, name: s.name.slice(0, 100) })),
  };
}

// ── The drawing ─────────────────────────────────────────────────────────────

/** The chart's size in px, Google Docs' own. */
export const CHART_WIDTH = 600;
export const CHART_HEIGHT = 371;

/** One color per series (a pie: per slice), Unitos's accents first. */
export const CHART_COLORS = [...ACCENTS, "#4f7396", "#3f8a86", "#a3566e", "#7a7342"];
const FONT = "Arial, Helvetica, 'Liberation Sans', sans-serif";

const color = (i: number) => CHART_COLORS[i % CHART_COLORS.length];
/** A width for `text` at `size` px: the drawing has no fonts to measure. */
const widthOf = (text: string, size: number) => text.length * size * 0.56;
/** `text` cut to `room` px, with "…". */
function fit(text: string, room: number, size: number): string {
  const most = Math.max(1, Math.floor(room / (size * 0.56)));
  return text.length <= most ? text : `${text.slice(0, Math.max(1, most - 1))}…`;
}
const num = (n: number) => Number(n.toFixed(2)).toString();
/** A tick's label: whole thousands and millions short. */
function tickLabel(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6 && a % 1e5 === 0) return `${num(v / 1e6)}M`;
  if (a >= 1e4 && a % 100 === 0) return `${num(v / 1e3)}k`;
  return num(v);
}

function textEl(x: number, y: number, body: string, size: number, fill: string, anchor: "start" | "middle" | "end" = "start", weight = 400): string {
  return `<text x="${num(x)}" y="${num(y)}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escapeXml(body)}</text>`;
}

/** An axis from 0 (or below, for negative values) with about five steps at round numbers. */
function axis(values: number[]): { min: number; max: number; step: number } {
  let lo = Math.min(0, ...values);
  let hi = Math.max(0, ...values);
  if (lo === hi) hi = lo + 1;
  const raw = (hi - lo) / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  return { min: lo, max: hi, step };
}

/** The legend's row of names, centered at `y`. */
function legendRow(names: string[], y: number): string {
  const items = names.map((n) => fit(n, 140, 12));
  const total = items.reduce((w, n) => w + 18 + widthOf(n, 12) + 16, -16);
  let x = (CHART_WIDTH - total) / 2;
  return items
    .map((n, i) => {
      const out = `<rect x="${num(x)}" y="${num(y - 9)}" width="10" height="10" rx="2" fill="${color(i)}"/>${textEl(x + 16, y, n, 12, MUTED)}`;
      x += 18 + widthOf(n, 12) + 16;
      return out;
    })
    .join("");
}

/** The chart as an SVG document, CHART_WIDTH by CHART_HEIGHT, on white.
    `noData` is the line an empty chart shows, in the reader's language. */
export function chartSvg(spec: ChartSpec, noData: string): string {
  const W = CHART_WIDTH;
  const H = CHART_HEIGHT;
  const parts: string[] = [`<rect width="${W}" height="${H}" fill="${PAPER}"/>`];
  let top = 22;
  if (spec.title.trim()) {
    parts.push(textEl(W / 2, 32, fit(spec.title.trim(), W - 48, 16), 16, INK, "middle", 700));
    top = 52;
  }
  const values = spec.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const pie = spec.type === "pie";
  const empty = pie ? !spec.series[0].values.some((v) => v !== null && v > 0) : values.length === 0;
  if (!pie && spec.series.length > 1) {
    parts.push(legendRow(spec.series.map((s) => s.name), top + 6));
    top += 26;
  }
  if (empty) {
    parts.push(textEl(W / 2, (top + H) / 2, noData, 13, MUTED, "middle"));
  } else if (pie) {
    parts.push(pieParts(spec, top));
  } else if (spec.type === "bar") {
    parts.push(barParts(spec, values, top));
  } else {
    parts.push(columnParts(spec, values, top));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
}

/** Columns and lines: the labels along the bottom, the values up the side. */
function columnParts(spec: ChartSpec, values: number[], top: number): string {
  const { min, max, step } = axis(values);
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  const side = Math.max(...ticks.map((v) => widthOf(tickLabel(v), 11)));
  const left = 20 + side + 8;
  const right = CHART_WIDTH - 20;
  const bottom = CHART_HEIGHT - 40;
  const y = (v: number) => bottom - ((v - min) / (max - min)) * (bottom - top);
  const out: string[] = [];
  for (const v of ticks) {
    out.push(`<line x1="${num(left)}" x2="${num(right)}" y1="${num(y(v))}" y2="${num(y(v))}" stroke="${CHIP_LINE}" stroke-width="1"/>`);
    out.push(textEl(left - 8, y(v) + 4, tickLabel(v), 11, MUTED, "end"));
  }
  const n = spec.labels.length;
  const band = (right - left) / n;
  const every = Math.max(1, Math.ceil((n * 44) / (right - left)));
  spec.labels.forEach((label, i) => {
    if (i % every === 0) out.push(textEl(left + band * (i + 0.5), bottom + 18, fit(label, band * every - 6, 11), 11, MUTED, "middle"));
  });
  if (spec.type === "line") {
    spec.series.forEach((s, k) => {
      let run: string[] = [];
      const lines: string[][] = [];
      s.values.forEach((v, i) => {
        if (v === null) {
          if (run.length) lines.push(run);
          run = [];
          return;
        }
        run.push(`${num(left + band * (i + 0.5))},${num(y(v))}`);
      });
      if (run.length) lines.push(run);
      for (const pts of lines) {
        if (pts.length > 1) out.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${color(k)}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`);
        for (const p of pts) {
          const [cx, cy] = p.split(",");
          out.push(`<circle cx="${cx}" cy="${cy}" r="3.5" fill="${color(k)}"/>`);
        }
      }
    });
  } else {
    const count = spec.series.length;
    const barW = Math.min(48, (band * 0.72) / count);
    spec.series.forEach((s, k) => {
      s.values.forEach((v, i) => {
        if (v === null) return;
        const x = left + band * (i + 0.5) - (barW * count) / 2 + barW * k;
        const y0 = y(Math.max(0, Math.min(v, max)));
        const y1 = y(Math.min(0, Math.max(v, min)));
        out.push(`<rect x="${num(x + 0.5)}" y="${num(Math.min(y0, y1))}" width="${num(Math.max(1, barW - 1))}" height="${num(Math.max(0.5, Math.abs(y1 - y0)))}" fill="${color(k)}"/>`);
      });
    });
  }
  out.push(`<line x1="${num(left)}" x2="${num(right)}" y1="${num(y(0))}" y2="${num(y(0))}" stroke="${MUTED}" stroke-width="1"/>`);
  return out.join("");
}

/** Bars: the labels down the side, the values along the bottom. */
function barParts(spec: ChartSpec, values: number[], top: number): string {
  const { min, max, step } = axis(values);
  const side = Math.min(CHART_WIDTH * 0.32, Math.max(24, ...spec.labels.map((l) => widthOf(l, 11))));
  const left = 20 + side + 8;
  const right = CHART_WIDTH - 28;
  const bottom = CHART_HEIGHT - 40;
  const x = (v: number) => left + ((v - min) / (max - min)) * (right - left);
  const out: string[] = [];
  for (let v = min; v <= max + step / 2; v += step) {
    const at = x(Number(v.toPrecision(12)));
    out.push(`<line x1="${num(at)}" x2="${num(at)}" y1="${num(top)}" y2="${num(bottom)}" stroke="${CHIP_LINE}" stroke-width="1"/>`);
    out.push(textEl(at, bottom + 18, tickLabel(Number(v.toPrecision(12))), 11, MUTED, "middle"));
  }
  const n = spec.labels.length;
  const band = (bottom - top) / n;
  const every = Math.max(1, Math.ceil((n * 16) / (bottom - top)));
  const count = spec.series.length;
  const barH = Math.min(36, (band * 0.72) / count);
  spec.labels.forEach((label, i) => {
    if (i % every === 0) out.push(textEl(left - 8, top + band * (i + 0.5) + 4, fit(label, side, 11), 11, MUTED, "end"));
  });
  spec.series.forEach((s, k) => {
    s.values.forEach((v, i) => {
      if (v === null) return;
      const y = top + band * (i + 0.5) - (barH * count) / 2 + barH * k;
      const x0 = x(Math.min(0, Math.max(v, min)));
      const x1 = x(Math.max(0, Math.min(v, max)));
      out.push(`<rect x="${num(x0)}" y="${num(y + 0.5)}" width="${num(Math.max(0.5, x1 - x0))}" height="${num(Math.max(1, barH - 1))}" fill="${color(k)}"/>`);
    });
  });
  out.push(`<line x1="${num(x(0))}" x2="${num(x(0))}" y1="${num(top)}" y2="${num(bottom)}" stroke="${MUTED}" stroke-width="1"/>`);
  return out.join("");
}

/** A pie of the first series: a slice per positive value, its share on it
    when there is room, and the labels beside it. */
function pieParts(spec: ChartSpec, top: number): string {
  const slices = spec.labels
    .map((label, i) => ({ label, value: spec.series[0].values[i] ?? 0, i }))
    .filter((s) => s.value > 0);
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const bottom = CHART_HEIGHT - 20;
  const r = Math.min((bottom - top) / 2, 150);
  const cx = 40 + r;
  const cy = (top + bottom) / 2;
  const out: string[] = [];
  let angle = -Math.PI / 2;
  for (const s of slices) {
    const share = s.value / total;
    const next = angle + share * Math.PI * 2;
    const c = color(s.i);
    if (share >= 0.9999) {
      out.push(`<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}" fill="${c}"/>`);
    } else {
      const large = share > 0.5 ? 1 : 0;
      const p = (a: number) => `${num(cx + r * Math.cos(a))},${num(cy + r * Math.sin(a))}`;
      out.push(`<path d="M${num(cx)},${num(cy)} L${p(angle)} A${num(r)},${num(r)} 0 ${large} 1 ${p(next)} Z" fill="${c}" stroke="${PAPER}" stroke-width="1.5"/>`);
    }
    if (share >= 0.06) {
      const mid = (angle + next) / 2;
      out.push(textEl(cx + r * 0.62 * Math.cos(mid), cy + r * 0.62 * Math.sin(mid) + 4, `${Math.round(share * 100)}%`, 12, PAPER, "middle", 700));
    }
    angle = next;
  }
  const legendX = cx + r + 32;
  const shown = slices.slice(0, Math.max(1, Math.floor((bottom - top) / 22)));
  const startY = cy - (shown.length * 22) / 2 + 14;
  shown.forEach((s, k) => {
    const y = startY + k * 22;
    out.push(`<rect x="${num(legendX)}" y="${num(y - 9)}" width="10" height="10" rx="2" fill="${color(s.i)}"/>`);
    out.push(textEl(legendX + 16, y, fit(s.label || "—", CHART_WIDTH - legendX - 36, 12), 12, MUTED));
  });
  return out.join("");
}

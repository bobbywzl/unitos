import * as ssf from "ssf";
import { attr, child, children, cleanText, descendants, escapeHtml, intAttr, num } from "@/lib/parse/office";

// Charts (SPEC.md §27): a chart part (c:chartSpace) drawn as an SVG — bars
// and columns (clustered, stacked, percent stacked), lines, areas, pies and
// doughnuts, scatter plots — with its title, axes, gridlines, legend, and
// data labels, in the colors the file sets or the theme's accents. Both
// the slides parser (a chart on a slide) and the sheets parser (a chart in
// a sheet's drawing) draw with it. The SVG's words are the chart's own; the
// caller marks the SVG data-anchor-skip and carries the data as a table in
// the block text (SPEC.md §5). A chart kind this does not draw (a radar, a
// stock chart) falls back to the caller's data table.

export type ChartPalette = {
  // The theme's accent colors, in order: the series colors when the file
  // sets none.
  accents: string[];
  // A DrawingML color element (srgbClr, schemeClr, …) as CSS; null when it
  // cannot be read.
  resolveColor: (el: Element | null) => string | null;
  // The cells a reference formula names ("'Data'!$B$2:$B$5"), as the sheet
  // holds them, for a chart part that carries references without cached
  // values (a file written by a library). Null = unknown.
  resolveRef?: (formula: string) => { text: string; number: number | null }[] | null;
};

export type RenderedChart = {
  svg: string;
  title: string;
  // The data as rows: a header row (the series names), then one row per
  // category with its label first.
  rows: string[][];
};

type Kind = "col" | "bar" | "line" | "area" | "pie" | "doughnut" | "scatter";

type Series = {
  name: string;
  cats: string[];
  vals: (number | null)[];
  xs: (number | null)[]; // scatter only
  color: string | null;
  pointColors: Map<number, string>;
  marker: boolean;
  lineHidden: boolean; // a:ln with noFill: a marker-only series
  smooth: boolean;
  labels: boolean;
  labelsPercent: boolean;
  formatCode: string | null;
};

type Plot = {
  kind: Kind;
  grouping: "clustered" | "stacked" | "percentStacked";
  series: Series[];
  holeSize: number;
  labels: boolean;
  labelsPercent: boolean;
  markersOnly: boolean; // a scatter plot of points without lines
};

type Axis = { shown: boolean; title: string; formatCode: string | null; gridlines: boolean; min: number | null; max: number | null };

const LEGEND_POSITIONS = new Set(["r", "l", "t", "b", "tr"]);

// ── Reading ──────────────────────────────────────────────────────────────────

function richText(el: Element | null): string {
  if (!el) return "";
  return cleanText(
    descendants(el, "t")
      .map((t) => t.textContent ?? "")
      .join(""),
  ).trim();
}

function cacheValues(container: Element | null, palette?: ChartPalette): { text: string[]; numbers: (number | null)[]; formatCode: string | null } {
  const text: string[] = [];
  const numbers: (number | null)[] = [];
  let formatCode: string | null = null;
  if (!container) return { text, numbers, formatCode };
  const cache = descendants(container, "numCache")[0] ?? descendants(container, "strCache")[0] ?? descendants(container, "numLit")[0] ?? descendants(container, "strLit")[0];
  if (!cache) {
    const formula = descendants(container, "f")[0]?.textContent?.trim();
    const cells = formula && palette?.resolveRef ? palette.resolveRef(formula) : null;
    if (cells) {
      for (const cell of cells) {
        text.push(cell.text);
        numbers.push(cell.number);
      }
    }
    return { text, numbers, formatCode };
  }
  formatCode = child(cache, "formatCode")?.textContent?.trim() || null;
  const count = intAttr(child(cache, "ptCount"), "val") ?? 0;
  const byIdx = new Map<number, string>();
  for (const pt of children(cache, "pt")) {
    const idx = intAttr(pt, "idx");
    if (idx !== null) byIdx.set(idx, cleanText(child(pt, "v")?.textContent ?? ""));
  }
  const n = Math.max(count, byIdx.size > 0 ? Math.max(...byIdx.keys()) + 1 : 0);
  for (let i = 0; i < n; i++) {
    const v = byIdx.get(i);
    text.push(v ?? "");
    const parsed = v === undefined || v === "" ? NaN : Number(v);
    numbers.push(Number.isFinite(parsed) ? parsed : null);
  }
  return { text, numbers, formatCode };
}

function readSeries(ser: Element, index: number, kind: Kind, palette: ChartPalette): Series {
  const tx = child(ser, "tx");
  const name = tx ? cacheValues(tx, palette).text[0] ?? richText(tx) : "";
  const cat = cacheValues(child(ser, "cat") ?? child(ser, "xVal"), palette);
  const val = cacheValues(child(ser, "val") ?? child(ser, "yVal"), palette);
  const spPr = child(ser, "spPr");
  const fill = palette.resolveColor(colorIn(child(spPr, "solidFill")));
  const line = palette.resolveColor(colorIn(child(child(spPr, "ln"), "solidFill")));
  const pointColors = new Map<number, string>();
  for (const dPt of children(ser, "dPt")) {
    const idx = intAttr(child(dPt, "idx"), "val");
    const color = palette.resolveColor(colorIn(child(child(dPt, "spPr"), "solidFill")));
    if (idx !== null && color) pointColors.set(idx, color);
  }
  const dLbls = child(ser, "dLbls");
  const markerEl = child(ser, "marker");
  const markerSymbol = attr(child(markerEl, "symbol"), "val");
  return {
    name: name || `Series ${index + 1}`,
    cats: cat.text,
    vals: val.numbers,
    xs: kind === "scatter" ? cat.numbers : [],
    color: (kind === "line" || kind === "scatter" ? line ?? fill : fill ?? line) ?? null,
    pointColors,
    marker: markerSymbol !== "none",
    lineHidden: child(child(spPr, "ln"), "noFill") !== null,
    smooth: attr(child(ser, "smooth"), "val") === "1",
    labels: dLbls !== null && attr(child(dLbls, "showVal"), "val") === "1",
    labelsPercent: dLbls !== null && attr(child(dLbls, "showPercent"), "val") === "1",
    formatCode: val.formatCode,
  };
}

function colorIn(fill: Element | null): Element | null {
  if (!fill) return null;
  for (const c of Array.from(fill.children)) {
    if (["srgbClr", "schemeClr", "sysClr", "prstClr", "scrgbClr"].includes(c.localName)) return c;
  }
  return null;
}

const PLOT_KINDS: Record<string, Kind> = {
  barChart: "col",
  bar3DChart: "col",
  lineChart: "line",
  line3DChart: "line",
  areaChart: "area",
  area3DChart: "area",
  pieChart: "pie",
  pie3DChart: "pie",
  ofPieChart: "pie",
  doughnutChart: "doughnut",
  scatterChart: "scatter",
  bubbleChart: "scatter",
};

function readPlots(plotArea: Element, palette: ChartPalette): Plot[] {
  const plots: Plot[] = [];
  for (const el of Array.from(plotArea.children)) {
    let kind = PLOT_KINDS[el.localName];
    if (!kind) continue;
    if (kind === "col" && attr(child(el, "barDir"), "val") === "bar") kind = "bar";
    const grouping = attr(child(el, "grouping"), "val");
    const dLbls = child(el, "dLbls");
    const series = children(el, "ser")
      .map((ser, i) => ({ ser, order: intAttr(child(ser, "order"), "val") ?? i, i }))
      .sort((a, b) => a.order - b.order)
      .map(({ ser, i }) => readSeries(ser, i, kind, palette));
    plots.push({
      kind,
      grouping: grouping === "stacked" ? "stacked" : grouping === "percentStacked" ? "percentStacked" : "clustered",
      series,
      holeSize: (intAttr(child(el, "holeSize"), "val") ?? 50) / 100,
      labels: dLbls !== null && attr(child(dLbls, "showVal"), "val") === "1",
      labelsPercent: dLbls !== null && attr(child(dLbls, "showPercent"), "val") === "1",
      markersOnly: attr(child(el, "scatterStyle"), "val") === "marker",
    });
  }
  return plots;
}

function readAxis(el: Element | null): Axis {
  if (!el) return { shown: true, title: "", formatCode: null, gridlines: false, min: null, max: null };
  const scaling = child(el, "scaling");
  return {
    shown: attr(child(el, "delete"), "val") !== "1",
    title: richText(child(el, "title")),
    formatCode: attr(child(el, "numFmt"), "formatCode"),
    gridlines: child(el, "majorGridlines") !== null,
    min: Number(attr(child(scaling, "min"), "val") ?? "") || null,
    max: Number(attr(child(scaling, "max"), "val") ?? "") || null,
  };
}

// ── Layout helpers ───────────────────────────────────────────────────────────

function formatValue(v: number, formatCode: string | null): string {
  const fmt = formatCode && formatCode !== "General" ? formatCode : null;
  try {
    if (fmt) return cleanText(ssf.format(fmt, v));
  } catch {
    // A format code ssf cannot read: the plain number stands.
  }
  const abs = Math.abs(v);
  if (abs >= 1e6 || (abs > 0 && abs < 1e-3)) return v.toExponential(2);
  return String(Math.round(v * 1000) / 1000);
}

/** Nice axis bounds and step: 4 to 7 steps of 1, 2, 2.5, or 5 × 10^k. */
function niceScale(min: number, max: number, fixedMin: number | null, fixedMax: number | null): { min: number; max: number; step: number } {
  let lo = fixedMin ?? Math.min(0, min);
  let hi = fixedMax ?? Math.max(0, max);
  if (hi === lo) hi = lo + 1;
  const span = hi - lo;
  const rough = span / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * mag);
  const step = candidates.find((c) => span / c <= 7) ?? candidates[candidates.length - 1];
  if (fixedMin === null) lo = Math.floor(lo / step) * step;
  if (fixedMax === null) hi = Math.ceil(hi / step) * step;
  return { min: lo, max: hi, step };
}

function textWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.55;
}

type Rect = { x: number; y: number; w: number; h: number };

function svgText(x: number, y: number, text: string, opts: { size: number; anchor?: "start" | "middle" | "end"; weight?: number; fill?: string; rotate?: number; baseline?: string }): string {
  const transform = opts.rotate ? ` transform="rotate(${opts.rotate} ${num(x)} ${num(y)})"` : "";
  return `<text x="${num(x)}" y="${num(y)}" font-size="${num(opts.size)}" text-anchor="${opts.anchor ?? "start"}"${opts.weight ? ` font-weight="${opts.weight}"` : ""} fill="${opts.fill ?? "#333333"}"${opts.baseline ? ` dominant-baseline="${opts.baseline}"` : ""}${transform}>${escapeHtml(text)}</text>`;
}

// ── Entry ────────────────────────────────────────────────────────────────────

/** The chart drawn as an SVG that fills a box of the given aspect. Null
    when the part has no plot this draws. */
export function renderChart(doc: XMLDocument, size: { width: number; height: number }, palette: ChartPalette): RenderedChart | null {
  const chart = descendants(doc, "chart")[0];
  const plotArea = child(chart, "plotArea");
  if (!chart || !plotArea) return null;
  const plots = readPlots(plotArea, palette);
  if (plots.length === 0 || plots.every((p) => p.series.length === 0)) return null;

  const W = 1000;
  const H = Math.max(200, Math.round((1000 * size.height) / Math.max(1, size.width)));
  const font = Math.max(11, Math.min(20, W * 0.02));
  const out: string[] = [];
  const explicitTitle = richText(child(chart, "title"));
  const autoTitleDeleted = attr(child(chart, "autoTitleDeleted"), "val") === "1";
  const allSeries = plots.flatMap((p) => p.series);
  const title = explicitTitle || (!autoTitleDeleted && child(chart, "title") && allSeries.length === 1 ? allSeries[0].name : "");

  // Series colors: the file's, else the accents in order.
  let colorIndex = 0;
  for (const plot of plots) {
    for (const s of plot.series) {
      if (!s.color) s.color = palette.accents[colorIndex % Math.max(1, palette.accents.length)] ?? "#4472c4";
      colorIndex++;
    }
  }

  let top = font * 0.8;
  if (title) {
    out.push(svgText(W / 2, top + font * 1.5, title, { size: font * 1.4, anchor: "middle", weight: 600 }));
    top += font * 2.6;
  }

  // Legend.
  const legendEl = child(chart, "legend");
  const legendPos = legendEl && attr(child(legendEl, "delete"), "val") !== "1" ? (attr(child(legendEl, "legendPos"), "val") ?? "r") : null;
  const pieLike = plots[0].kind === "pie" || plots[0].kind === "doughnut";
  const legendEntries: { label: string; color: string }[] = pieLike
    ? plots[0].series[0].cats.map((c, i) => ({ label: c || `Point ${i + 1}`, color: plots[0].series[0].pointColors.get(i) ?? palette.accents[i % Math.max(1, palette.accents.length)] ?? "#4472c4" }))
    : allSeries.map((s) => ({ label: s.name, color: s.color ?? "#4472c4" }));
  const area: Rect = { x: font * 0.8, y: top, w: W - font * 1.6, h: H - top - font * 0.8 };
  if (legendPos && LEGEND_POSITIONS.has(legendPos) && legendEntries.length > 0) {
    const swatch = font * 0.9;
    const gap = font * 0.5;
    if (legendPos === "r" || legendPos === "l" || legendPos === "tr") {
      const width = Math.max(...legendEntries.map((e) => textWidth(e.label, font))) + swatch + gap * 2;
      const x = legendPos === "l" ? area.x : area.x + area.w - width;
      let y = area.y + (legendPos === "tr" ? 0 : Math.max(0, (area.h - legendEntries.length * font * 1.6) / 2));
      for (const e of legendEntries) {
        out.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(swatch)}" height="${num(swatch)}" fill="${e.color}"/>`);
        out.push(svgText(x + swatch + gap, y + swatch * 0.8, e.label, { size: font }));
        y += font * 1.6;
      }
      if (legendPos === "l") area.x += width + gap;
      area.w -= width + gap;
    } else {
      const widths = legendEntries.map((e) => textWidth(e.label, font) + swatch + gap * 2.5);
      const total = widths.reduce((a, b) => a + b, 0);
      let x = area.x + Math.max(0, (area.w - total) / 2);
      const y = legendPos === "t" ? area.y : area.y + area.h - swatch;
      legendEntries.forEach((e, i) => {
        out.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(swatch)}" height="${num(swatch)}" fill="${e.color}"/>`);
        out.push(svgText(x + swatch + gap, y + swatch * 0.8, e.label, { size: font }));
        x += widths[i];
      });
      if (legendPos === "t") area.y += font * 2;
      area.h -= font * 2;
    }
  }

  if (pieLike) drawPie(out, plots[0], area, font, palette);
  else {
    // A scatter plot reads two value axes; every other chart a category
    // axis and a value axis.
    const valAxes = children(plotArea, "valAx");
    const catAx = child(plotArea, "catAx") ?? child(plotArea, "dateAx");
    const scatter = plots[0].kind === "scatter";
    const xAxis = scatter ? readAxis(valAxes[0] ?? null) : readAxis(catAx);
    const yAxis = scatter ? readAxis(valAxes[1] ?? valAxes[0] ?? null) : readAxis(valAxes[0] ?? null);
    drawAxes(out, plots, area, font, xAxis, yAxis);
  }

  const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" font-family="inherit" xmlns="http://www.w3.org/2000/svg">${out.join("")}</svg>`;
  return { svg, title, rows: dataRows(plots) };
}

function dataRows(plots: Plot[]): string[][] {
  const series = plots.flatMap((p) => p.series);
  const rows: string[][] = [];
  const categories = series.find((s) => s.cats.length > 0)?.cats ?? [];
  const scatter = plots[0].kind === "scatter";
  if (scatter) {
    rows.push(["", ...series.map((s) => s.name)]);
    const longest = Math.max(...series.map((s) => s.vals.length));
    for (let i = 0; i < longest; i++) rows.push([series[0].xs[i] !== null && series[0].xs[i] !== undefined ? String(series[0].xs[i]) : "", ...series.map((s) => (s.vals[i] === null || s.vals[i] === undefined ? "" : formatValue(s.vals[i] as number, s.formatCode)))]);
    return rows;
  }
  if (categories.length > 0) {
    rows.push(["", ...series.map((s) => s.name)]);
    categories.forEach((cat, i) => rows.push([cat, ...series.map((s) => (s.vals[i] === null || s.vals[i] === undefined ? "" : formatValue(s.vals[i] as number, s.formatCode)))]));
  } else {
    rows.push(series.map((s) => s.name));
    const longest = Math.max(...series.map((s) => s.vals.length));
    for (let i = 0; i < longest; i++) rows.push(series.map((s) => (s.vals[i] === null || s.vals[i] === undefined ? "" : formatValue(s.vals[i] as number, s.formatCode))));
  }
  return rows;
}

// ── Pies ─────────────────────────────────────────────────────────────────────

function drawPie(out: string[], plot: Plot, area: Rect, font: number, palette: ChartPalette): void {
  const s = plot.series[0];
  const values = s.vals.map((v) => (v === null ? 0 : Math.max(0, v)));
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return;
  const cx = area.x + area.w / 2;
  const cy = area.y + area.h / 2;
  const r = (Math.min(area.w, area.h) / 2) * 0.9;
  const inner = plot.kind === "doughnut" ? r * plot.holeSize : 0;
  let angle = -Math.PI / 2;
  values.forEach((v, i) => {
    if (v <= 0) return;
    const sweep = (v / total) * Math.PI * 2;
    const a0 = angle;
    const a1 = angle + sweep;
    angle = a1;
    const color = s.pointColors.get(i) ?? palette.accents[i % Math.max(1, palette.accents.length)] ?? "#4472c4";
    const large = sweep > Math.PI ? 1 : 0;
    const p = (a: number, rad: number) => `${num(cx + rad * Math.cos(a))} ${num(cy + rad * Math.sin(a))}`;
    const d =
      values.filter((x) => x > 0).length === 1
        ? inner > 0
          ? `M ${p(a0, r)} A ${num(r)} ${num(r)} 0 1 1 ${p(a0 + Math.PI, r)} A ${num(r)} ${num(r)} 0 1 1 ${p(a0, r)} M ${p(a0, inner)} A ${num(inner)} ${num(inner)} 0 1 0 ${p(a0 + Math.PI, inner)} A ${num(inner)} ${num(inner)} 0 1 0 ${p(a0, inner)}`
          : `M ${num(cx - r)} ${num(cy)} A ${num(r)} ${num(r)} 0 1 1 ${num(cx + r)} ${num(cy)} A ${num(r)} ${num(r)} 0 1 1 ${num(cx - r)} ${num(cy)}`
        : inner > 0
          ? `M ${p(a0, r)} A ${num(r)} ${num(r)} 0 ${large} 1 ${p(a1, r)} L ${p(a1, inner)} A ${num(inner)} ${num(inner)} 0 ${large} 0 ${p(a0, inner)} Z`
          : `M ${num(cx)} ${num(cy)} L ${p(a0, r)} A ${num(r)} ${num(r)} 0 ${large} 1 ${p(a1, r)} Z`;
    out.push(`<path d="${d}" fill="${color}" stroke="#ffffff" stroke-width="2" fill-rule="evenodd"/>`);
    if (plot.labels || plot.labelsPercent || s.labels || s.labelsPercent) {
      const mid = (a0 + a1) / 2;
      const rad = inner > 0 ? (r + inner) / 2 : r * 0.62;
      const label = plot.labelsPercent || s.labelsPercent ? `${Math.round((v / total) * 100)}%` : formatValue(v, s.formatCode);
      out.push(svgText(cx + rad * Math.cos(mid), cy + rad * Math.sin(mid), label, { size: font, anchor: "middle", baseline: "middle", fill: "#ffffff", weight: 600 }));
    }
  });
}

// ── Axis charts ──────────────────────────────────────────────────────────────

function drawAxes(out: string[], plots: Plot[], area: Rect, font: number, catAxis: Axis, valAxis: Axis): void {
  const main = plots[0];
  const horizontal = main.kind === "bar";
  const scatter = main.kind === "scatter";
  const categories = main.series.find((s) => s.cats.length > 0)?.cats ?? [];
  const n = scatter ? 0 : Math.max(categories.length, ...plots.flatMap((p) => p.series.map((s) => s.vals.length)));

  // Value range across every plot, stacks summed.
  let lo = Infinity;
  let hi = -Infinity;
  for (const plot of plots) {
    if (plot.grouping !== "clustered" && (plot.kind === "col" || plot.kind === "bar" || plot.kind === "area")) {
      for (let i = 0; i < n; i++) {
        let pos = 0;
        let neg = 0;
        for (const s of plot.series) {
          const v = s.vals[i] ?? 0;
          if (v >= 0) pos += v;
          else neg += v;
        }
        lo = Math.min(lo, neg, 0);
        hi = Math.max(hi, pos, 0);
      }
    } else {
      for (const s of plot.series) for (const v of s.vals) if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
  }
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  const percent = main.grouping === "percentStacked";
  const scale = percent ? { min: 0, max: 1, step: 0.2 } : niceScale(lo, hi, valAxis.min, valAxis.max);
  const valueFormat = percent ? "0%" : valAxis.formatCode ?? main.series[0]?.formatCode ?? null;
  const ticks: number[] = [];
  for (let v = scale.min; v <= scale.max + scale.step / 1e6; v += scale.step) ticks.push(Math.round(v * 1e9) / 1e9);

  // Scatter x range.
  let xScale = { min: 0, max: 1, step: 0.2 };
  if (scatter) {
    let xlo = Infinity;
    let xhi = -Infinity;
    for (const s of main.series) for (const x of s.xs) if (x !== null) { xlo = Math.min(xlo, x); xhi = Math.max(xhi, x); }
    if (!Number.isFinite(xlo)) { xlo = 0; xhi = 1; }
    xScale = niceScale(xlo, xhi, catAxis.min, catAxis.max);
  }
  const xTicks: number[] = [];
  if (scatter) for (let v = xScale.min; v <= xScale.max + xScale.step / 1e6; v += xScale.step) xTicks.push(Math.round(v * 1e9) / 1e9);

  // The plot rectangle: room for the value labels on the left (or bottom
  // for horizontal bars) and the category labels below (or left).
  const valueLabels = ticks.map((t) => formatValue(t, valueFormat));
  const valueLabelW = Math.max(...valueLabels.map((l) => textWidth(l, font)));
  const catLabels = scatter ? xTicks.map((t) => formatValue(t, catAxis.formatCode)) : Array.from({ length: n }, (_, i) => categories[i] ?? String(i + 1));
  const slot = horizontal ? area.h / Math.max(1, n) : (area.w - valueLabelW - font) / Math.max(1, scatter ? xTicks.length : n);
  const rotate = !horizontal && catLabels.some((l) => textWidth(l, font) > slot * 0.95);
  const catLabelH = horizontal ? font * 1.6 : rotate ? Math.min(font * 6, Math.max(...catLabels.map((l) => textWidth(l, font))) * 0.72 + font) : font * 1.6;
  const titleH = font * 1.8;
  const plot: Rect = {
    x: area.x + (horizontal ? Math.max(...catLabels.map((l) => textWidth(l, font))) + font : valueLabelW + font) + (valAxis.title && !horizontal ? titleH : 0) + (catAxis.title && horizontal ? titleH : 0),
    y: area.y + font * 0.5,
    w: 0,
    h: 0,
  };
  plot.w = area.x + area.w - plot.x - font * 0.5;
  plot.h = area.y + area.h - plot.y - catLabelH - (catAxis.title && !horizontal ? titleH : 0) - (valAxis.title && horizontal ? titleH : 0);
  if (plot.w <= 0 || plot.h <= 0) return;

  const vPos = (v: number) => (horizontal ? plot.x + ((v - scale.min) / (scale.max - scale.min)) * plot.w : plot.y + plot.h - ((v - scale.min) / (scale.max - scale.min)) * plot.h);
  const cPos = (i: number, share = 0.5) => (horizontal ? plot.y + ((i + share) / Math.max(1, n)) * plot.h : plot.x + ((i + share) / Math.max(1, n)) * plot.w);
  const xPos = (x: number) => plot.x + ((x - xScale.min) / (xScale.max - xScale.min)) * plot.w;

  // Gridlines and value labels.
  ticks.forEach((t, i) => {
    const p = vPos(t);
    {
      out.push(horizontal
        ? `<line x1="${num(p)}" y1="${num(plot.y)}" x2="${num(p)}" y2="${num(plot.y + plot.h)}" stroke="#e0e0e0" stroke-width="1"/>`
        : `<line x1="${num(plot.x)}" y1="${num(p)}" x2="${num(plot.x + plot.w)}" y2="${num(p)}" stroke="#e0e0e0" stroke-width="1"/>`);
    }
    if (valAxis.shown) {
      out.push(horizontal
        ? svgText(p, plot.y + plot.h + font * 1.2, valueLabels[i], { size: font, anchor: "middle", fill: "#555555" })
        : svgText(plot.x - font * 0.4, p + font * 0.35, valueLabels[i], { size: font, anchor: "end", fill: "#555555" }));
    }
  });
  // Axis lines.
  out.push(`<line x1="${num(plot.x)}" y1="${num(plot.y + plot.h)}" x2="${num(plot.x + plot.w)}" y2="${num(plot.y + plot.h)}" stroke="#9e9e9e" stroke-width="1"/>`);
  out.push(`<line x1="${num(plot.x)}" y1="${num(plot.y)}" x2="${num(plot.x)}" y2="${num(plot.y + plot.h)}" stroke="#9e9e9e" stroke-width="1"/>`);
  // Category labels.
  if (catAxis.shown) {
    if (scatter) {
      xTicks.forEach((t, i) => {
        const x = xPos(t);
        out.push(`<line x1="${num(x)}" y1="${num(plot.y)}" x2="${num(x)}" y2="${num(plot.y + plot.h)}" stroke="#e0e0e0" stroke-width="1"/>`);
        out.push(svgText(x, plot.y + plot.h + font * 1.2, catLabels[i], { size: font, anchor: "middle", fill: "#555555" }));
      });
    } else {
      catLabels.forEach((label, i) => {
        if (horizontal) out.push(svgText(plot.x - font * 0.4, cPos(i) + font * 0.35, label, { size: font, anchor: "end", fill: "#555555" }));
        else if (rotate) out.push(svgText(cPos(i), plot.y + plot.h + font * 0.9, label, { size: font, anchor: "end", fill: "#555555", rotate: -45 }));
        else out.push(svgText(cPos(i), plot.y + plot.h + font * 1.2, label, { size: font, anchor: "middle", fill: "#555555" }));
      });
    }
  }
  // Axis titles.
  if (catAxis.title) {
    if (horizontal) out.push(svgText(area.x + font, plot.y + plot.h / 2, catAxis.title, { size: font, anchor: "middle", rotate: -90, fill: "#555555" }));
    else out.push(svgText(plot.x + plot.w / 2, area.y + area.h - font * 0.3, catAxis.title, { size: font, anchor: "middle", fill: "#555555" }));
  }
  if (valAxis.title) {
    if (horizontal) out.push(svgText(plot.x + plot.w / 2, area.y + area.h - font * 0.3, valAxis.title, { size: font, anchor: "middle", fill: "#555555" }));
    else out.push(svgText(area.x + font, plot.y + plot.h / 2, valAxis.title, { size: font, anchor: "middle", rotate: -90, fill: "#555555" }));
  }

  for (const p of plots) {
    const seriesCount = p.series.length;
    if (p.kind === "col" || p.kind === "bar") {
      const stacked = p.grouping !== "clustered";
      const groupShare = 0.7;
      const stackPos: number[] = Array(n).fill(0);
      const stackNeg: number[] = Array(n).fill(0);
      const totals: number[] = Array.from({ length: n }, (_, i) => p.series.reduce((a, s) => a + Math.abs(s.vals[i] ?? 0), 0));
      p.series.forEach((s, si) => {
        for (let i = 0; i < n; i++) {
          let v = s.vals[i];
          if (v === null || v === undefined) continue;
          if (percent) v = totals[i] > 0 ? Math.abs(v) / totals[i] : 0;
          let from: number;
          let to: number;
          if (stacked) {
            if (v >= 0) { from = stackPos[i]; stackPos[i] += v; to = stackPos[i]; }
            else { from = stackNeg[i]; stackNeg[i] += v; to = stackNeg[i]; }
          } else { from = 0; to = v; }
          const a = vPos(from);
          const b = vPos(to);
          const thickness = stacked ? slotSize(p.kind, plot, n) * groupShare : (slotSize(p.kind, plot, n) * groupShare) / seriesCount;
          const start = stacked ? cPos(i, (1 - groupShare) / 2) : cPos(i, (1 - groupShare) / 2) + si * thickness;
          const color = s.pointColors.get(i) ?? s.color ?? "#4472c4";
          if (horizontal) {
            out.push(`<rect x="${num(Math.min(a, b))}" y="${num(start)}" width="${num(Math.abs(b - a))}" height="${num(thickness)}" fill="${color}"/>`);
            if (s.labels || p.labels) out.push(svgText(Math.max(a, b) + font * 0.3, start + thickness / 2 + font * 0.35, formatValue(s.vals[i] as number, s.formatCode), { size: font * 0.9, fill: "#333333" }));
          } else {
            out.push(`<rect x="${num(start)}" y="${num(Math.min(a, b))}" width="${num(thickness)}" height="${num(Math.abs(b - a))}" fill="${color}"/>`);
            if (s.labels || p.labels) {
              const label = formatValue(s.vals[i] as number, s.formatCode);
              out.push(stacked
                ? svgText(start + thickness / 2, (a + b) / 2 + font * 0.35, label, { size: font * 0.9, anchor: "middle", fill: "#ffffff" })
                : svgText(start + thickness / 2, Math.min(a, b) - font * 0.3, label, { size: font * 0.9, anchor: "middle", fill: "#333333" }));
            }
          }
        }
      });
    } else if (p.kind === "line" || p.kind === "area" || p.kind === "scatter") {
      const stacked = p.kind === "area" && p.grouping !== "clustered";
      const stack: number[] = Array(n).fill(0);
      const totals: number[] = Array.from({ length: n }, (_, i) => p.series.reduce((a, s) => a + Math.abs(s.vals[i] ?? 0), 0));
      p.series.forEach((s) => {
        const points: { x: number; y: number; v: number }[] = [];
        const base: number[] = [];
        const count = scatter ? s.vals.length : n;
        for (let i = 0; i < count; i++) {
          let v = s.vals[i];
          if (v === null || v === undefined) continue;
          if (percent) v = totals[i] > 0 ? Math.abs(v) / totals[i] : 0;
          const from = stacked ? stack[i] : 0;
          const to = stacked ? stack[i] + v : v;
          if (stacked) stack[i] = to;
          const x = scatter ? xPos(s.xs[i] ?? 0) : cPos(i);
          points.push({ x, y: vPos(to), v: s.vals[i] as number });
          base.push(vPos(from));
        }
        if (points.length === 0) return;
        const color = s.color ?? "#4472c4";
        const d = points.map((pt, i) => `${i === 0 ? "M" : "L"} ${num(pt.x)} ${num(pt.y)}`).join(" ");
        if (p.kind === "area") {
          const back = points.map((pt, i) => `L ${num(pt.x)} ${num(base[i])}`).reverse().join(" ");
          out.push(`<path d="${d} ${back} Z" fill="${color}" fill-opacity="0.35" stroke="none"/>`);
        }
        if (points.length > 1) {
          const showLine = p.kind !== "scatter" || (!s.lineHidden && !p.markersOnly);
          if (showLine) out.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${num(Math.max(2, font * 0.18))}" stroke-linejoin="round" stroke-linecap="round"/>`);
        }
        if ((p.kind === "line" && s.marker) || p.kind === "scatter") {
          for (const pt of points) out.push(`<circle cx="${num(pt.x)}" cy="${num(pt.y)}" r="${num(Math.max(3, font * 0.28))}" fill="${color}" stroke="#ffffff" stroke-width="1"/>`);
        }
        if (s.labels || p.labels) {
          for (const pt of points) out.push(svgText(pt.x, pt.y - font * 0.6, formatValue(pt.v, s.formatCode), { size: font * 0.9, anchor: "middle", fill: "#333333" }));
        }
      });
    }
  }
}

function slotSize(kind: Kind, plot: Rect, n: number): number {
  return (kind === "bar" ? plot.h : plot.w) / Math.max(1, n);
}

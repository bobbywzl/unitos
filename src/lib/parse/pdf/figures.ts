// Figures: display equations, captioned figures, and the page's graphics
// (images and vector drawings) become FIGURE blocks with a region to crop.
// The page's drawing (images and vector paths) comes from drawing.ts.

import type { PageDrawing, PathBox } from "@/lib/parse/pdf/drawing";
import { median, regionOf, unionBox } from "@/lib/parse/pdf/geometry";
import { lineColumn, type Placed } from "@/lib/parse/pdf/columns";
import { buildLines } from "@/lib/parse/pdf/lines";
import { joinGroup } from "@/lib/parse/pdf/text";
import type { Box, Item, Line, PageContext, Segment } from "@/lib/parse/pdf/types";

// ── Figure regions ──────────────────────────────────────────────────────────
// A PDF carries no figure objects the text layer can name: a vector chart is
// its tick labels and legend, a display equation its glyphs, a raster image
// nothing at all. What the page shows at that spot is the figure, so the block
// becomes a FIGURE whose region the figure image route crops (SPEC.md §16):
// display equations by their math glyphs, captioned figures by the space and
// the debris above (or below) their "Figure N" caption. Import compare loop
// finding: charts read as tables of ticks, equations as tables, figures shown
// as whole pages.

export const CAPTION_RE = /^(fig\.|figure|table|tab\.)\s*(\d+|[A-Z]\d+)[a-z]?\s*[.:|–—-]\s*/i;
// "Table 3", "Table A1", and IEEE's "TABLE IV".
const TABLE_CAPTION_RE = /^(table|tab\.)\s*(\d+|[A-Z]\d+|[IVXL]+\b)/i;

// Chart text, equation glyphs, ticks: what a figure leaves in the text layer.
function isFigureDebris(s: Segment, ctx: PageContext): boolean {
  if (s.region || s.type === "HEADING" || s.type === "CODE" || s.type === "EQUATION") return false;
  if (CAPTION_RE.test(s.text)) return false;
  if (s.type === "FIGURE") return !s.region;
  if (s.type === "TABLE") return true;
  if ((s.lineSize ?? ctx.bodySize) < ctx.bodySize * 0.92) return true;
  const text = s.text.trim();
  if (text.length <= 12) return true;
  // A panel title or axis label at body size: short, no sentence end.
  return (
    text.length <= 60 &&
    !/[.!?:;,]$/.test(text) &&
    (s.lineSize ?? ctx.bodySize) <= ctx.bodySize * 1.05 &&
    !s.text.includes("\n")
  );
}

// ── Embedded images ─────────────────────────────────────────────────────────
// The images a captioned figure's band takes in (drawing.ts reads them all):
// icons and bullet glyphs are too small to count; a page-sized image is a
// scan or a background, whose text layer stays text.
function figureImages(images: Box[], pageWidth: number, pageHeight: number): Box[] {
  const boxes = images.filter((box) => {
    const w = box.x2 - box.x1;
    const h = box.y2 - box.y1;
    return w >= pageWidth * 0.12 && h >= pageHeight * 0.04 && w * h <= pageWidth * pageHeight * 0.85;
  });
  // Images on one row (a left and a right chart) are one figure.
  const merged: Box[] = [];
  for (const box of boxes.sort((a, b) => b.y2 - a.y2 || a.x1 - b.x1)) {
    const near = merged.find((m) => {
      const overlap = Math.min(m.y2, box.y2) - Math.max(m.y1, box.y1);
      const shorter = Math.min(m.y2 - m.y1, box.y2 - box.y1);
      const gap = Math.max(box.x1 - m.x2, m.x1 - box.x2);
      return overlap > shorter * 0.5 && gap < pageWidth * 0.08;
    });
    if (near) {
      near.x1 = Math.min(near.x1, box.x1);
      near.y1 = Math.min(near.y1, box.y1);
      near.x2 = Math.max(near.x2, box.x2);
      near.y2 = Math.max(near.y2, box.y2);
    } else merged.push({ ...box });
  }
  return merged;
}

type Drawn = { images: Box[]; paths: PathBox[] };

// ── Graphics ────────────────────────────────────────────────────────────────
// What the page draws that is a graphic: an image, or a vector drawing (a
// diagram, a chart). Found before the page's lines are built, so a graphic's
// labels (a chart's ticks, a diagram's names) never join the text beside it
// and never become text: the figure's crop shows them. Census class 10: a
// slide's diagram labels were pasted into its bullets. Text over a graphic
// that reads as the page's own (a title, a quotation, a paragraph) stays
// text, and a panel or banner that holds it is a background, not a graphic.
// Census class 2: a photo and the quotation's panel beside it merged into
// one box that deleted the slide's title, quotation, and citation.

export type Graphic = Placed & { labels: Item[]; caption: Item[] };

// A run of text: the items on one baseline that follow each other with no
// wider gap than a word's.
type TextRun = { items: Item[]; box: Box; size: number; chars: number; italic: number };

function textRuns(items: Item[]): TextRun[] {
  const sorted = items.filter((i) => i.str.trim().length > 0).sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Item[][] = [];
  for (const item of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - item.y) < Math.max(row[0].size, item.size) * 0.35) row.push(item);
    else rows.push([item]);
  }
  const runs: TextRun[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let run: Item[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const size = Math.max(...run.map((i) => i.size));
      const chars = run.reduce((n, i) => n + i.str.trim().length, 0);
      const italic = run.filter((i) => i.italic).reduce((n, i) => n + i.str.trim().length, 0);
      runs.push({
        items: run,
        size,
        chars,
        italic,
        box: {
          x1: Math.min(...run.map((i) => i.x)),
          x2: Math.max(...run.map((i) => i.x + i.w)),
          y1: Math.min(...run.map((i) => i.y)) - size * 0.25,
          y2: Math.max(...run.map((i) => i.y)) + size * 0.8,
        },
      });
      run = [];
    };
    for (const item of row) {
      const last = run[run.length - 1];
      if (last && item.x - (last.x + last.w) > Math.max(last.size, item.size)) flush();
      run.push(item);
    }
    flush();
  }
  return runs;
}

// The share of a box's area inside another.
function shareInside(inner: Box, outer: Box): number {
  const w = Math.max(0, Math.min(inner.x2, outer.x2) - Math.max(inner.x1, outer.x1));
  const h = Math.max(0, Math.min(inner.y2, outer.y2) - Math.max(inner.y1, outer.y1));
  const area = (inner.x2 - inner.x1) * (inner.y2 - inner.y1);
  return area > 0 ? (w * h) / area : 0;
}

const area = (b: Box) => Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
const grow = (b: Box, by: number): Box => ({ x1: b.x1 - by, y1: b.y1 - by, x2: b.x2 + by, y2: b.y2 + by });

export function pageGraphics(drawing: PageDrawing, items: Item[], pageWidth: number, pageHeight: number): Graphic[] {
  const pageArea = pageWidth * pageHeight;
  const onPage = (b: Box): Box => ({
    x1: Math.max(0, b.x1),
    y1: Math.max(0, b.y1),
    x2: Math.min(pageWidth, b.x2),
    y2: Math.min(pageHeight, b.y2),
  });
  const runs = textRuns(items);
  // The page's text size: the size most of its characters are set in, away
  // from the running heads and feet (a slide deck's footline in 6 pt made a
  // diagram's 8 pt names read as large). Text set well above it (a title, a
  // big number) is the page's own.
  const body = runs.filter((r) => r.box.y1 > pageHeight * 0.07 && r.box.y2 < pageHeight * 0.93);
  const bySize = (body.length > 0 ? body : runs).flatMap((r) => r.items.map((i) => ({ size: i.size, n: i.str.trim().length })));
  bySize.sort((a, b) => a.size - b.size);
  const half = bySize.reduce((n, x) => n + x.n, 0) / 2;
  let seen = 0;
  let textSize = 10;
  for (const x of bySize) {
    seen += x.n;
    if (seen >= half) {
      textSize = x.size;
      break;
    }
  }
  // Page text: a run set large, or a line's worth of words. A label is short:
  // a tick, a name in a diagram, a legend entry.
  const isPageText = (r: TextRun) => r.size >= textSize * 1.3 || r.chars >= 40;
  const runsIn = (box: Box) => runs.filter((r) => shareInside(r.box, box) >= 0.7);
  // A box that holds the page's text (a panel behind a quotation, a banner
  // behind a paragraph): a background, never a graphic.
  const holdsText = (box: Box) => {
    const inside = runsIn(box);
    return inside.some(isPageText) || inside.filter((r) => r.chars >= 20).length >= 3;
  };

  type Part = { box: Box; image: boolean; thin: boolean };
  const parts: Part[] = [];
  for (const raw of drawing.images) {
    const box = onPage(raw);
    if (area(box) < pageArea * 0.0005 || area(box) > pageArea * 0.85) continue;
    if (holdsText(box)) continue;
    parts.push({ box, image: true, thin: false });
  }
  for (const raw of drawing.paths) {
    if (raw.clip) continue;
    const box = onPage(raw);
    if (box.x2 < box.x1 || box.y2 < box.y1) continue;
    const thin = Math.min(box.x2 - box.x1, box.y2 - box.y1) < 1.5;
    if (!thin && box.x2 - box.x1 > textSize * 2 && box.y2 - box.y1 > textSize * 2 && holdsText(box)) continue;
    parts.push({ box, image: false, thin });
  }

  // Clusters: parts within 6 pt of each other.
  const parent = parts.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const order = parts.map((_, i) => i).sort((a, b) => parts[a].box.x1 - parts[b].box.x1);
  for (let a = 0; a < order.length; a++) {
    const p = parts[order[a]].box;
    for (let b = a + 1; b < order.length; b++) {
      const q = parts[order[b]].box;
      if (q.x1 > p.x2 + 6) break;
      if (q.y1 <= p.y2 + 6 && p.y1 <= q.y2 + 6) parent[find(order[a])] = find(order[b]);
    }
  }
  const clusters = new Map<number, Part[]>();
  parts.forEach((part, i) => {
    const root = find(i);
    const list = clusters.get(root);
    if (list) list.push(part);
    else clusters.set(root, [part]);
  });

  // Inside a vector drawing, its own words (a chart's title, a legend) are
  // set large or run long as often as a slide's; only a line of body text
  // is the page's (arXiv 2609.29669 p9: a chart's 40-character title kept
  // the chart from being a figure, and its caption lost its figure).
  const isBodyLine = (r: TextRun) => r.chars >= 60;
  type Found = { box: Box; drawn: boolean };
  const found: Found[] = [];
  for (const members of clusters.values()) {
    const box = members.map((m) => m.box).reduce((a, b) => unionBox(a, b));
    const w = box.x2 - box.x1;
    const h = box.y2 - box.y1;
    const images = members.filter((m) => m.image);
    const paths = members.filter((m) => !m.image);
    const inside = runsIn(box);
    // An image of a figure's size (icons and bullet glyphs are too small).
    const image = images.length > 0 && w >= pageWidth * 0.12 && h >= pageHeight * 0.04 &&
      images.reduce((n, m) => n + area(m.box), 0) >= area(box) * 0.25;
    // A vector drawing: ten or more painted paths, most of them shapes
    // rather than rules, with little text among them. A ruled table or a
    // framed listing is rules around dense text.
    const ink = inside.reduce((n, r) => n + r.items.reduce((m, i) => m + i.w * i.size, 0), 0);
    const drawn = paths.length >= 10 && paths.filter((m) => m.thin).length < paths.length * 0.5 &&
      area(box) >= pageArea * 0.03 && ink < area(box) * 0.12;
    if (image && !inside.some(isPageText)) found.push({ box, drawn: false });
    else if (!image && drawn && !inside.some(isBodyLine)) found.push({ box, drawn: true });
  }

  // Captions: the short lines right under a graphic, inside its width, set
  // apart from the text (smaller, italic, or centered under it) — a photo
  // grid's names, a newsletter's caption. A "Figure N" caption is the
  // captioned figures' own (attachFigureRegions).
  const taken = new Set<TextRun>();
  const captionOf = (graphic: Box): TextRun[] => {
    const under = runs
      .filter((r) => !taken.has(r) && r.box.x1 >= graphic.x1 - r.size && r.box.x2 <= graphic.x2 + r.size && r.box.y2 <= graphic.y1 + r.size * 0.5)
      .sort((a, b) => b.box.y2 - a.box.y2);
    const out: TextRun[] = [];
    let bottom = graphic.y1;
    for (const r of under) {
      if (bottom - r.box.y2 > r.size * (out.length === 0 ? 1.2 : 0.8)) break;
      if (out.length >= 3 || r.size >= textSize * 1.3 || (out.length === 0 && CAPTION_RE.test(r.items.map((i) => i.str).join(" ")))) break;
      out.push(r);
      bottom = r.box.y1;
    }
    const chars = out.reduce((n, r) => n + r.chars, 0);
    if (out.length === 0 || chars > 200) return [];
    // A caption is words: a row of numbers under a chart is its axis.
    const letters = out.reduce((n, r) => n + r.items.reduce((m, i) => m + (i.str.match(/\p{L}/gu)?.length ?? 0), 0), 0);
    if (letters < 4 || letters < chars * 0.5) return [];
    const size = Math.max(...out.map((r) => r.size));
    const italic = out.reduce((n, r) => n + r.italic, 0) >= chars * 0.6;
    // Centered: each line as far in from both edges, give or take, and one
    // line clearly narrower than the graphic (a justified paragraph fills it).
    const margins = out.map((r) => [r.box.x1 - graphic.x1, graphic.x2 - r.box.x2, r.size]);
    const centered =
      margins.every(([l, r, sz]) => l >= -sz * 0.5 && r >= -sz * 0.5 && Math.abs(l - r) <= Math.max(sz * 2, (graphic.x2 - graphic.x1) * 0.1)) &&
      margins.some(([l, r, sz]) => l + r >= sz);
    return size < textSize * 0.95 || italic || centered ? out : [];
  };

  // Graphics on one row (a left and a right chart) are one figure, unless
  // each has a caption of its own or text runs between them.
  found.sort((a, b) => b.box.y2 - a.box.y2 || a.box.x1 - b.box.x1);
  const merged: Found[] = [];
  for (const { box, drawn } of found) {
    const near = merged.find(({ box: m }) => {
      const overlap = Math.min(m.y2, box.y2) - Math.max(m.y1, box.y1);
      const shorter = Math.min(m.y2 - m.y1, box.y2 - box.y1);
      const gap = Math.max(box.x1 - m.x2, m.x1 - box.x2);
      if (!(overlap > shorter * 0.5 && gap < pageWidth * 0.08)) return false;
      const between = { x1: Math.min(m.x2, box.x2), x2: Math.max(m.x1, box.x1), y1: Math.max(m.y1, box.y1), y2: Math.min(m.y2, box.y2) };
      if (between.x2 > between.x1 && runs.some((r) => shareInside(r.box, between) >= 0.5)) return false;
      return captionOf(m).length === 0 || captionOf(box).length === 0;
    });
    if (near) {
      near.box = unionBox(near.box, box);
      near.drawn = near.drawn && drawn;
    } else merged.push({ box: { ...box }, drawn });
  }

  // A chart's axis labels sit just outside its plot: the ticks under it and
  // beside it, a short word or number each, no farther off than a line
  // (arXiv 2609.29669 p7: a bar chart's years read as its caption and as a
  // paragraph).
  const axisOf = (plot: Box): TextRun[] =>
    runs.filter((r) => {
      if (taken.has(r) || r.chars > 12 || shareInside(r.box, plot) >= 0.7) return false;
      if (/[.!?;:,]$/.test(r.items.map((i) => i.str).join("").trim())) return false;
      const reach = Math.max(r.size, textSize) * 1.2;
      const cx = (r.box.x1 + r.box.x2) / 2;
      const cy = (r.box.y1 + r.box.y2) / 2;
      const across = cx > plot.x1 && cx < plot.x2;
      const along = cy > plot.y1 && cy < plot.y2;
      return (
        (across && r.box.y2 <= plot.y1 + r.size && r.box.y2 >= plot.y1 - reach) ||
        (across && r.box.y1 >= plot.y2 - r.size && r.box.y1 <= plot.y2 + reach) ||
        (along && r.box.x2 <= plot.x1 + r.size && r.box.x2 >= plot.x1 - reach) ||
        (along && r.box.x1 >= plot.x2 - r.size && r.box.x1 <= plot.x2 + reach)
      );
    });

  return merged.map(({ box: plot, drawn }) => {
    const axis = drawn ? axisOf(plot) : [];
    for (const r of axis) taken.add(r);
    const box = axis.reduce((b, r) => unionBox(b, r.box), plot);
    const caption = captionOf(box);
    for (const r of caption) taken.add(r);
    const labels = [...axis, ...runsIn(box).filter((r) => !(drawn ? isBodyLine(r) : isPageText(r)) && !taken.has(r))];
    // Page text that reaches over one side of the graphic (a slide's
    // quotation over the dark half of its photo) leaves that side out of
    // the crop, when at least half the graphic is left.
    const over = runs.filter(
      (r) => !labels.includes(r) && !taken.has(r) && r.box.x1 < box.x2 && r.box.x2 > box.x1 && r.box.y1 < box.y2 && r.box.y2 > box.y1,
    );
    const middle = (box.x1 + box.x2) / 2;
    const cut = { ...box };
    if (over.length > 0 && over.every((r) => (r.box.x1 + r.box.x2) / 2 < middle)) cut.x1 = Math.max(...over.map((r) => r.box.x2)) + 2;
    if (over.length > 0 && over.every((r) => (r.box.x1 + r.box.x2) / 2 > middle)) cut.x2 = Math.min(...over.map((r) => r.box.x1)) - 2;
    const kept = cut.x2 - cut.x1 >= (box.x2 - box.x1) * 0.5 ? cut : box;
    return { box: kept, labels: labels.flatMap((r) => r.items), caption: caption.flatMap((r) => r.items) };
  });
}

// The drawing inside a band of a column: the union of the paths and images
// whose vertical center lies in the band and that reach into the column. A
// clip paints nothing (the synthetic paper's page-wide clip made a caption's
// figure span both columns and swallow the left one), and a box reaching a
// quarter of the column past its edge is a figure's white ground, not its
// drawing (arXiv 2411.19946 p4: a left-column figure's crop took in the
// right column's words).
function drawingIn(drawing: Drawn, y1: number, y2: number, x1: number, x2: number): Box | null {
  let box: Box | null = null;
  const reach = (x2 - x1) * 0.25;
  for (const b of [...drawing.paths, ...drawing.images]) {
    const cy = (b.y1 + b.y2) / 2;
    if (("clip" in b && b.clip) || cy < y1 || cy > y2 || b.x2 < x1 || b.x1 > x2) continue;
    if (b.x1 < x1 - reach || b.x2 > x2 + reach) continue;
    box = box ? unionBox(box, b) : { ...b };
  }
  return box;
}

function overlapsDrawing(box: Box, drawing: Drawn): boolean {
  return [...drawing.paths, ...drawing.images].some(
    (b) => b.x1 < box.x2 && b.x2 > box.x1 && b.y1 < box.y2 && b.y2 > box.y1 && (b.x2 - b.x1 > 2 || b.y2 - b.y1 > 2),
  );
}

export function attachFigureRegions(
  segments: Segment[],
  lines: Line[],
  ctx: PageContext,
  pageWidth: number,
  pageHeight: number,
  graphics: Graphic[],
  page: number, // 0-based
): Segment[] {
  const images = figureImages(ctx.drawing.images, pageWidth, pageHeight);
  const drawing: Drawn = { images, paths: ctx.drawing.paths };
  const toRegion = (box: Box) => regionOf(box, pageWidth, pageHeight);
  const rowGap = ctx.bodySize * ctx.leading;

  // 1. Display equations are math/display.ts's: index.ts reads them first.
  const withMath = segments;

  // 2. Captioned figures.
  const textLeft = lines.length > 0 ? Math.min(...lines.map((l) => l.x)) : 0;
  const textRight = lines.length > 0 ? Math.max(...lines.map((l) => l.xEnd)) : pageWidth;
  // The column the caption sits in: the extent of the page's lines that
  // overlap it horizontally (the whole text width on a one-column page),
  // leaving out the few that reach well past the others — a title across
  // both columns made a right-column figure swallow the left column.
  const columnOf = (cap: Box): [number, number] => {
    // The column pageLines read the caption in, when it knows it.
    const own = lines.find((l) => l.x >= cap.x1 - 1 && l.xEnd <= cap.x2 + 1 && l.y >= cap.y1 && l.y <= cap.y2);
    const read = own ? lineColumn(own) : undefined;
    if (read) return read;
    const overlapping = lines.filter((l) => l.x < cap.x2 && l.xEnd > cap.x1);
    if (overlapping.length === 0) return [textLeft, textRight];
    const left = median(overlapping.map((l) => l.x)) - ctx.bodySize * 2;
    const right = median(overlapping.map((l) => l.xEnd)) + ctx.bodySize * 2;
    const column = overlapping.filter((l) => l.x >= left && l.xEnd <= right);
    const kept = column.length > 0 ? column : overlapping;
    return [Math.min(...kept.map((l) => l.x)), Math.max(...kept.map((l) => l.xEnd))];
  };
  const pageTop = pageHeight * 0.94;
  const pageBottom = pageHeight * 0.06;
  const out: Segment[] = [];
  // Segments a figure took below its caption: debris, and the caption's
  // second paragraph.
  const consumed = new Set<Segment>();
  for (let c = 0; c < withMath.length; c++) {
    const cap = withMath[c];
    if (consumed.has(cap)) continue;
    if (
      cap.type !== "PARAGRAPH" ||
      !cap.box ||
      !CAPTION_RE.test(cap.text) ||
      TABLE_CAPTION_RE.test(cap.text)
    ) {
      out.push(cap);
      continue;
    }
    // The caption's neighbors are in its column: on a page read as columns,
    // the segment before it may end the other column (a synthetic paper's
    // caption took the left column's last line for the figure's top).
    const [x1, x2] = columnOf(cap.box);
    const inColumn = (s: Segment) => s.box !== undefined && s.box.x1 < x2 && s.box.x2 > x1;
    // Above the caption: debris up to the previous body segment. A table
    // under its own "Table N" caption is data, not debris.
    const column = out.filter(inColumn);
    const swept: Segment[] = [];
    while (column.length > 0) {
      const prev = column[column.length - 1];
      // A legend or a hidden title inside the drawing is debris whatever it
      // read as, a long title too when it is one line (a panel figure's
      // title bar, arXiv 2609.29669 p15); an attached figure never is.
      const oneLine = prev.box !== undefined && prev.box.y2 - prev.box.y1 <= (prev.lineSize ?? ctx.bodySize) * 1.8;
      const inDrawing =
        prev.box !== undefined &&
        !(prev.type === "FIGURE" && prev.region) &&
        prev.type !== "EQUATION" &&
        (prev.text.length < 80 || oneLine) &&
        overlapsDrawing(prev.box, drawing);
      // A line set just outside a graphic (a chart's ticks, its axis years,
      // its title above the plot: arXiv 2609.29669 p9 read them as headings)
      // is the graphic's too.
      const byGraphic =
        oneLine &&
        prev.type !== "FIGURE" &&
        graphics.some((g) => shareInside(prev.box!, grow(g.box, ctx.bodySize * 2)) >= 0.7);
      // Words between the caption and a graphic over it in the column, up to
      // a title just over the graphic, short and with no sentence end, are
      // the figure's: panel names and panel titles run together (arXiv
      // 2609.29669 p7). A paragraph of the text is longer (2411.19946 p4).
      const underGraphic =
        (prev.type === "PARAGRAPH" || prev.type === "SEPARATOR") &&
        prev.text.length <= 100 &&
        !/[.!?:;]["”’)]?$/.test(prev.text.trim()) &&
        graphics.some(
          (g) =>
            g.box.x1 < x2 &&
            g.box.x2 > x1 &&
            g.box.y1 >= cap.box!.y2 &&
            prev.box!.y1 >= cap.box!.y2 &&
            prev.box!.y1 <= g.box.y2 + ctx.bodySize * 2,
        );
      if (!isFigureDebris(prev, ctx) && !inDrawing && !byGraphic && !underGraphic) break;
      // What reaches well past the column (a table across both columns) is
      // no debris of a figure in it.
      if (prev.box && (prev.box.x1 < x1 - ctx.bodySize * 2 || prev.box.x2 > x2 + ctx.bodySize * 2)) break;
      if (prev.type === "TABLE" && column.length >= 2 && TABLE_CAPTION_RE.test(column[column.length - 2].text)) break;
      swept.unshift(column.pop()!);
    }
    const above = column[column.length - 1];
    // The band ends under the previous segment, its caption included (a
    // figure's box leaves its caption out).
    const top = above?.box
      ? Math.min(above.box.y1, above.captionBox?.y1 ?? Infinity) - ctx.bodySize * 0.6
      : pageTop;
    let box: Box | null = null;
    const drawnAbove = drawingIn(drawing, cap.box.y2, top, x1, x2);
    const next = withMath.slice(c + 1).filter((s) => inColumn(s) && !consumed.has(s));
    if (swept.length > 0 || top - cap.box.y2 > rowGap * 3 || drawnAbove) {
      for (const s of swept) out.splice(out.indexOf(s), 1);
      box = { x1, x2, y1: cap.box.y2 + ctx.bodySize * 0.2, y2: top };
      for (const s of swept) if (s.box) box = unionBox(box, s.box);
      // The drawing sets the width: a chart wider than the text column keeps
      // its axis labels.
      if (drawnAbove) box = unionBox(box, { ...drawnAbove, y1: Math.max(drawnAbove.y1, box.y1), y2: Math.min(drawnAbove.y2, box.y2) });
    } else {
      // Below the caption: debris down to the next body segment.
      let m = 0;
      while (m < next.length && isFigureDebris(next[m], ctx)) m++;
      const below = next[m];
      const bottom = below?.box ? below.box.y2 + ctx.bodySize * 0.6 : pageBottom;
      const drawnBelow = drawingIn(drawing, bottom, cap.box.y1, x1, x2);
      if (m > 0 || cap.box.y1 - bottom > rowGap * 3 || drawnBelow) {
        box = { x1, x2, y1: bottom, y2: cap.box.y1 - ctx.bodySize * 0.2 };
        for (const s of next.slice(0, m)) {
          if (s.box) box = unionBox(box, s.box);
          consumed.add(s);
        }
        if (drawnBelow) box = unionBox(box, { ...drawnBelow, y1: Math.max(drawnBelow.y1, box.y1), y2: Math.min(drawnBelow.y2, box.y2) });
        next.splice(0, m);
      }
    }
    if (!box) {
      out.push(cap);
      continue;
    }
    // A caption wrapped into a second paragraph: the same (smaller) font a
    // line below the caption continues it.
    let text = cap.text;
    let runs = cap.runs;
    let captionBox = cap.box;
    const follow = next[0];
    if (
      follow &&
      follow.type === "PARAGRAPH" &&
      follow.box &&
      follow.page === cap.page &&
      follow.lineSize !== undefined &&
      cap.lineSize !== undefined &&
      Math.abs(follow.lineSize - cap.lineSize) < 0.6 &&
      cap.box.y1 - follow.box.y2 <= cap.lineSize * ctx.leading * 0.9 &&
      (cap.lineSize < ctx.bodySize * 0.98 ||
        follow.text.length < 240 ||
        cap.box.y1 - follow.box.y2 <= cap.lineSize * 0.35)
    ) {
      const offset = text.length + 1;
      text = `${text} ${follow.text}`;
      runs = [
        ...(runs ?? []),
        ...(follow.runs ?? []).map((r) => ({ ...r, start: r.start + offset, end: r.end + offset })),
      ];
      captionBox = unionBox(captionBox, follow.box);
      consumed.add(follow);
    }
    out.push({
      type: "FIGURE",
      text,
      page: cap.page,
      runs,
      box,
      captionBox,
      region: toRegion(box),
      lineSize: cap.lineSize,
      mathShare: 0,
    });
  }

  // 3. Graphics (images and vector drawings). One a captioned figure already
  // covers extends it; any other becomes a FIGURE of its own, with the
  // caption found under it, at its place in the reading order (pageLines
  // put it after a line: the FIGURE follows that line's segment).
  const inside = (inner: Box, outer: Box) => shareInside(inner, outer) >= 0.7;
  let placed = out;
  const own = new Set<Segment>();
  for (const graphic of [...graphics].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const box = graphic.box;
    const covering = placed.find((s) => s.type === "FIGURE" && s.box && inside(box, s.box));
    if (covering) continue;
    const overlapping = placed.find((s) => s.type === "FIGURE" && s.box && inside(s.box, box));
    if (overlapping && overlapping.box) {
      overlapping.box = unionBox(overlapping.box, box);
      overlapping.region = toRegion(overlapping.box);
      continue;
    }
    const captionLines = buildLines(graphic.caption, page);
    const caption = joinGroup(captionLines, true);
    const figure: Segment = {
      type: "FIGURE",
      text: caption.text.replace(/\n/g, " "),
      // The page's own number: a page with no text has no segment to read it from.
      page,
      runs: caption.runs,
      box,
      region: toRegion(box),
      lineSize: captionLines[0]?.size ?? ctx.bodySize,
      mathShare: 0,
    };
    if (captionLines.length > 0) {
      figure.captionBox = captionLines
        .map((l) => ({ x1: l.x, x2: l.xEnd, y1: l.yMin - l.size * 0.3, y2: l.yMax + l.size * 0.85 }))
        .reduce((a, b) => unionBox(a, b));
    }
    own.add(figure);
    placed = [...placed];
    placed.splice(placeOf(placed, graphic, own), 0, figure);
  }
  // Text inside a figure's box (a hidden chart title, a stray label) is part
  // of the graphic. A graphic's labels never became text, and what text is
  // left over it is the page's own (census class 2).
  const boxes = placed.filter((s) => s.type === "FIGURE" && s.region && s.box && !own.has(s)).map((s) => s.box!);
  return placed.filter((s) => (s.type === "FIGURE" && s.region) || !s.box || !boxes.some((f) => inside(s.box!, f)));
}

// Where a graphic's FIGURE goes: after the segment that holds the line read
// just before it, and after the figures already placed there.
function placeOf(segments: Segment[], graphic: Graphic, own: Set<Segment>): number {
  const line = graphic.after;
  if (!line) {
    let k = 0;
    while (k < segments.length && own.has(segments[k])) k++;
    return k;
  }
  let best = -1;
  let bestArea = Infinity;
  segments.forEach((s, k) => {
    const b = s.box;
    if (!b || own.has(s) || s.page !== line.page) return;
    const x = Math.min(line.xEnd, line.x + line.size);
    if (x < b.x1 - 0.5 || x > b.x2 + 0.5 || line.y < b.y1 - 0.5 || line.y > b.y2 + 0.5) return;
    if (area(b) < bestArea) [best, bestArea] = [k, area(b)];
  });
  if (best < 0) {
    // The line left the page (running furniture, a footnote): by position.
    const center = (graphic.box.y1 + graphic.box.y2) / 2;
    const at = segments.findIndex((s) => s.box && !own.has(s) && (s.box.y1 + s.box.y2) / 2 < center);
    return at < 0 ? segments.length : at;
  }
  let k = best + 1;
  while (k < segments.length && own.has(segments[k])) k++;
  return k;
}

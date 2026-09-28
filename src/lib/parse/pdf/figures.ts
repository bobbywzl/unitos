// Figures: display equations, captioned figures, and embedded images become
// FIGURE blocks with a region to crop. The page's drawing (images and vector
// paths) comes from its operator list.

import { regionOf, unionBox } from "@/lib/parse/pdf/geometry";
import { BULLET_RE } from "@/lib/parse/pdf/segment";
import type { Box, Line, PageContext, Segment } from "@/lib/parse/pdf/types";

// ── Figure regions ──────────────────────────────────────────────────────────
// A PDF carries no figure objects the text layer can name: a vector chart is
// its tick labels and legend, a display equation its glyphs, a raster picture
// nothing at all. What the page shows at that spot is the figure, so the block
// becomes a FIGURE whose region the figure image route crops (SPEC.md §16):
// display equations by their math glyphs, captioned figures by the space and
// the debris above (or below) their "Figure N" caption. Import compare loop
// finding: charts read as tables of ticks, equations as tables, figures shown
// as whole pages.

export const CAPTION_RE = /^(fig\.|figure|table|tab\.)\s*(\d+|[A-Z]\d+)[a-z]?\s*[.:|–—-]\s*/i;
const TABLE_CAPTION_RE = /^(table|tab\.)\s*(\d+|[A-Z]\d+)/i;

// A numbered display equation: "… = softmax(QKᵀ/√d)V   (1)". Its words are
// roman (function names), so the math share alone misses it.
const EQUATION_NUMBER_RE = /\(\d{1,3}[a-z]?\)\s*$/;

function isMathSegment(s: Segment, ctx: PageContext): boolean {
  if (s.type !== "PARAGRAPH" && s.type !== "TABLE" && s.type !== "FIGURE") return false;
  if (s.region || !s.box) return false;
  const numbered =
    EQUATION_NUMBER_RE.test(s.text) &&
    s.text.length <= 90 &&
    s.box.x1 > ctx.columnLeft + 2 &&
    // A line of nothing but "(1) (2) (3)" is a row of superscripts.
    !/^(\s*\(\d{1,3}[a-z]?\)\s*)+$/.test(s.text);
  if (!numbered && (s.mathShare ?? 0) < 0.25) return false;
  // A lone symbol (a footnote marker, a sum limit) is not an equation.
  if (s.text.replace(/\s/g, "").length < 4) return false;
  // Prose with inline math starts at the column edge and runs long, or
  // carries words ("Here χ = 1 if … and zero otherwise." — import compare
  // loop finding: a short sentence under a display merged into its crop).
  const words = (s.text.match(/\p{L}{3,}/gu) ?? []).length;
  const prose =
    s.box.x1 <= ctx.columnLeft + 2 && (s.mathShare ?? 0) < 0.6 && (s.text.length > 50 || words >= 3);
  return !prose;
}

// A line of an equation whose glyphs are mostly roman (function names, an
// equation number, a fraction's denominator): short, off the column edge,
// body-sized. Joins an equation it sits against.
function isEquationShaped(s: Segment, ctx: PageContext): boolean {
  if (s.type !== "PARAGRAPH" && s.type !== "TABLE" && s.type !== "FIGURE") return false;
  if (s.region || !s.box) return false;
  const size = s.lineSize ?? ctx.bodySize;
  // A big operator (an integral or sum sign with its limits) is a math glyph
  // set larger than the text: still a line of the equation.
  const bigOperator = (s.mathShare ?? 0) >= 0.5 && size <= ctx.bodySize * 3;
  // Words at a list indent are an item, not a line of the equation: an
  // equation line is math, a fragment of a few glyphs (a fraction's
  // numerator, an equation number, a function name), or a label set deep in
  // the column (an underbrace's caption).
  const mathOrFragment = (s.mathShare ?? 0) >= 0.2 || s.text.replace(/\s/g, "").length <= 12;
  const deep = !BULLET_RE.test(s.text) && s.box.x1 > ctx.columnLeft + size * 6;
  return (
    s.text.length <= 60 &&
    s.box.x1 > ctx.columnLeft + 2 &&
    (mathOrFragment || deep) &&
    (size <= ctx.bodySize * 1.1 || bigOperator)
  );
}

// Chart text, equation glyphs, ticks: what a figure leaves in the text layer.
function isFigureDebris(s: Segment, ctx: PageContext): boolean {
  if (s.region || s.type === "HEADING" || s.type === "CODE") return false;
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
// pdf.js operator numbers (pdfjs OPS): the walk tracks the current transform
// and maps each painted image's unit square onto the page.
const OP_SAVE = 10;
const OP_RESTORE = 11;
const OP_TRANSFORM = 12;
const OP_FORM_BEGIN = 74;
const OP_FORM_END = 75;
const OP_IMAGE_MASK = 83;
const OP_IMAGE = 85;
const OP_INLINE_IMAGE = 86;
const OP_IMAGE_REPEAT = 88;

type Matrix = [number, number, number, number, number, number];

function multiply(m: Matrix, n: Matrix): Matrix {
  // m then n: the product n × m in PDF's row-vector convention.
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

// The boxes of the images a page paints, in PDF points (y up). Icons and
// bullet glyphs are too small to be figures; a page-sized image is a scan or
// a background, whose text layer stays text.
const OP_PATH = 91;

export type PageDrawing = { images: Box[]; paths: Box[] };

export function imageBoxes(
  ops: { fnArray: number[]; argsArray: unknown[] },
  pageWidth: number,
  pageHeight: number,
): PageDrawing {
  const boxes: Box[] = [];
  const paths: Box[] = [];
  const stack: Matrix[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const formStack: Matrix[] = [];
  for (let k = 0; k < ops.fnArray.length; k++) {
    const fn = ops.fnArray[k];
    const args = ops.argsArray[k];
    if (fn === OP_SAVE) stack.push(ctm);
    else if (fn === OP_RESTORE) ctm = stack.pop() ?? ctm;
    else if (fn === OP_TRANSFORM && Array.isArray(args) && args.length === 6) {
      ctm = multiply(args as Matrix, ctm);
    } else if (fn === OP_FORM_BEGIN && Array.isArray(args)) {
      formStack.push(ctm);
      const matrix = args[0];
      if (Array.isArray(matrix) && matrix.length === 6) ctm = multiply(matrix as Matrix, ctm);
    } else if (fn === OP_FORM_END) {
      ctm = formStack.pop() ?? ctm;
    } else if (fn === OP_PATH && Array.isArray(args)) {
      // A vector path: its local bounds mapped through the transform. Chart
      // lines, bars, ticks and rules all arrive here.
      const mm = args[2] as ArrayLike<number> | undefined;
      if (mm && mm.length === 4 && Number.isFinite(mm[0])) {
        const pts = [
          [mm[0], mm[1]],
          [mm[2], mm[1]],
          [mm[0], mm[3]],
          [mm[2], mm[3]],
        ].map(([u, v]) => [ctm[0] * u + ctm[2] * v + ctm[4], ctm[1] * u + ctm[3] * v + ctm[5]]);
        const xs = pts.map((c) => c[0]);
        const ys = pts.map((c) => c[1]);
        const box = { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
        if (box.x2 - box.x1 < pageWidth * 0.9 || box.y2 - box.y1 < pageHeight * 0.9) paths.push(box);
      }
    } else if (fn === OP_IMAGE || fn === OP_INLINE_IMAGE || fn === OP_IMAGE_MASK || fn === OP_IMAGE_REPEAT) {
      // The image fills the unit square under the current transform.
      const corners = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map(([u, v]) => [ctm[0] * u + ctm[2] * v + ctm[4], ctm[1] * u + ctm[3] * v + ctm[5]]);
      const xs = corners.map((c) => c[0]);
      const ys = corners.map((c) => c[1]);
      const box = { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
      const w = box.x2 - box.x1;
      const h = box.y2 - box.y1;
      if (w < pageWidth * 0.12 || h < pageHeight * 0.04) continue;
      if (w * h > pageWidth * pageHeight * 0.85) continue;
      boxes.push(box);
    }
  }
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
  return { images: merged, paths };
}

// The drawing inside a vertical band: the union of paths and images whose
// vertical center lies in it.
function drawingIn(drawing: PageDrawing, y1: number, y2: number): Box | null {
  let box: Box | null = null;
  for (const b of [...drawing.paths, ...drawing.images]) {
    const cy = (b.y1 + b.y2) / 2;
    if (cy < y1 || cy > y2) continue;
    box = box ? unionBox(box, b) : { ...b };
  }
  return box;
}

function overlapsDrawing(box: Box, drawing: PageDrawing): boolean {
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
  drawing: PageDrawing,
  page: number, // 0-based
): Segment[] {
  const images = drawing.images;
  const toRegion = (box: Box) => regionOf(box, pageWidth, pageHeight);
  const rowGap = ctx.bodySize * ctx.leading;

  // 1. Display equations: a math segment and the equation-shaped segments
  // against it become one FIGURE.
  const near = (a: Segment, b: Segment) => a.box!.y1 - b.box!.y2 < rowGap * 1.5;
  const withMath: Segment[] = [];
  for (let k = 0; k < segments.length; ) {
    if (!isMathSegment(segments[k], ctx)) {
      withMath.push(segments[k]);
      k++;
      continue;
    }
    // Backward over equation-shaped lines already pushed.
    let start = k;
    while (
      withMath.length > 0 &&
      isEquationShaped(withMath[withMath.length - 1], ctx) &&
      near(withMath[withMath.length - 1], segments[start])
    ) {
      start = segments.indexOf(withMath.pop()!);
    }
    let m = k + 1;
    while (
      m < segments.length &&
      (isMathSegment(segments[m], ctx) || isEquationShaped(segments[m], ctx)) &&
      near(segments[m - 1], segments[m])
    ) {
      m++;
    }
    const group = segments.slice(start, m);
    let box = group[0].box!;
    for (const g of group) box = unionBox(box, g.box!);
    // The lines' boxes already carry ascent and descent; a small pad keeps
    // the neighboring prose lines out of the crop.
    // Subscripts and lowered limits hang under the line box: more room
    // below than above.
    const size = group[0].lineSize ?? ctx.bodySize;
    // A big delimiter at the edge reaches past the last glyph's advance:
    // room for it on both sides.
    box = { x1: box.x1 - size * 0.8, y1: box.y1 - size * 0.45, x2: box.x2 + size * 0.8, y2: box.y2 - size * 0.1 };
    // The pad never reaches the neighboring text's box: a display set tight
    // over its paragraph cropped the tops of the next line (import compare
    // loop finding).
    const above = withMath[withMath.length - 1];
    const below = segments[m];
    if (above?.box && above.page === group[0].page && above.box.y1 > box.y1) box.y2 = Math.min(box.y2, above.box.y1 - 1);
    if (below?.box && below.page === group[0].page && below.box.y2 < box.y2) box.y1 = Math.max(box.y1, below.box.y2 + 1);
    withMath.push({
      type: "FIGURE",
      text: group
        .map((g) => g.text.replace(/[\t\n]+/g, " "))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
      page: group[0].page,
      box,
      region: toRegion(box),
      lineSize: group[0].lineSize,
      mathShare: 1,
    });
    k = m;
  }

  // 2. Captioned figures.
  const textLeft = lines.length > 0 ? Math.min(...lines.map((l) => l.x)) : 0;
  const textRight = lines.length > 0 ? Math.max(...lines.map((l) => l.xEnd)) : pageWidth;
  // The column the caption sits in: the extent of the page's lines that
  // overlap it horizontally (the whole text width on a one-column page).
  const columnOf = (cap: Box): [number, number] => {
    const overlapping = lines.filter((l) => l.x < cap.x2 && l.xEnd > cap.x1);
    if (overlapping.length === 0) return [textLeft, textRight];
    return [Math.min(...overlapping.map((l) => l.x)), Math.max(...overlapping.map((l) => l.xEnd))];
  };
  const pageTop = pageHeight * 0.94;
  const pageBottom = pageHeight * 0.06;
  const out: Segment[] = [];
  for (let c = 0; c < withMath.length; c++) {
    const cap = withMath[c];
    if (
      cap.type !== "PARAGRAPH" ||
      !cap.box ||
      !CAPTION_RE.test(cap.text) ||
      TABLE_CAPTION_RE.test(cap.text)
    ) {
      out.push(cap);
      continue;
    }
    // Above the caption: debris up to the previous body segment. A table
    // under its own "Table N" caption is data, not debris.
    const swept: Segment[] = [];
    while (out.length > 0) {
      const prev = out[out.length - 1];
      // A legend or a hidden title inside the drawing is debris whatever it
      // read as; an attached figure never is.
      const inDrawing =
        prev.box !== undefined &&
        !(prev.type === "FIGURE" && prev.region) &&
        prev.text.length < 80 &&
        overlapsDrawing(prev.box, drawing);
      if (!isFigureDebris(prev, ctx) && !inDrawing) break;
      if (prev.type === "TABLE" && out.length >= 2 && TABLE_CAPTION_RE.test(out[out.length - 2].text)) break;
      swept.unshift(out.pop()!);
    }
    const above = out[out.length - 1];
    // The band ends under the previous segment, its caption included (a
    // figure's box leaves its caption out).
    const top = above?.box
      ? Math.min(above.box.y1, above.captionBox?.y1 ?? Infinity) - ctx.bodySize * 0.6
      : pageTop;
    let box: Box | null = null;
    const drawnAbove = drawingIn(drawing, cap.box.y2, top);
    if (swept.length > 0 || top - cap.box.y2 > rowGap * 3 || drawnAbove) {
      const [x1, x2] = columnOf(cap.box);
      box = { x1, x2, y1: cap.box.y2 + ctx.bodySize * 0.2, y2: top };
      for (const s of swept) if (s.box) box = unionBox(box, s.box);
      // The drawing sets the width: a chart wider than the text column keeps
      // its axis labels.
      if (drawnAbove) box = unionBox(box, { ...drawnAbove, y1: Math.max(drawnAbove.y1, box.y1), y2: Math.min(drawnAbove.y2, box.y2) });
    } else {
      out.push(...swept);
      // Below the caption: debris down to the next body segment.
      let m = c + 1;
      while (m < withMath.length && isFigureDebris(withMath[m], ctx)) m++;
      const below = withMath[m];
      const bottom = below?.box ? below.box.y2 + ctx.bodySize * 0.6 : pageBottom;
      const drawnBelow = drawingIn(drawing, bottom, cap.box.y1);
      if (m > c + 1 || cap.box.y1 - bottom > rowGap * 3 || drawnBelow) {
        const [x1, x2] = columnOf(cap.box);
        box = { x1, x2, y1: bottom, y2: cap.box.y1 - ctx.bodySize * 0.2 };
        for (const s of withMath.slice(c + 1, m)) if (s.box) box = unionBox(box, s.box);
        if (drawnBelow) box = unionBox(box, { ...drawnBelow, y1: Math.max(drawnBelow.y1, box.y1), y2: Math.min(drawnBelow.y2, box.y2) });
        c = m - 1;
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
    const follow = withMath[c + 1];
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
      c++;
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

  // 3. Embedded images. An image a captioned figure already covers extends
  // that figure; any other becomes a FIGURE of its own with no caption. Text
  // inside the image's box (chart labels, legends) is part of the picture.
  const inside = (inner: Box, outer: Box) => {
    const w = Math.max(0, Math.min(inner.x2, outer.x2) - Math.max(inner.x1, outer.x1));
    const h = Math.max(0, Math.min(inner.y2, outer.y2) - Math.max(inner.y1, outer.y1));
    const area = (inner.x2 - inner.x1) * (inner.y2 - inner.y1);
    return area > 0 && (w * h) / area >= 0.7;
  };
  let placed = out;
  for (const img of images) {
    const covering = placed.find((s) => s.type === "FIGURE" && s.box && inside(img, s.box));
    if (covering) continue;
    const overlapping = placed.find((s) => s.type === "FIGURE" && s.box && inside(s.box, img));
    if (overlapping && overlapping.box) {
      overlapping.box = unionBox(overlapping.box, img);
      overlapping.region = toRegion(overlapping.box);
      placed = placed.filter((s) => s === overlapping || !(s.box && s.type !== "FIGURE" && inside(s.box, img)));
      continue;
    }
    const kept = placed.filter((s) => !(s.box && s.type !== "FIGURE" && inside(s.box, img)));
    const center = (img.y1 + img.y2) / 2;
    let at = kept.findIndex((s) => s.box && (s.box.y1 + s.box.y2) / 2 < center);
    if (at < 0) at = kept.length;
    kept.splice(at, 0, {
      type: "FIGURE",
      text: "",
      // The page's own number: a page with no text has no segment to read it from.
      page,
      box: img,
      region: toRegion(img),
      lineSize: ctx.bodySize,
      mathShare: 0,
    });
    placed = kept;
  }
  return placed;
}

// The page's drawing, read in one walk over its operator list: every glyph
// with its font, character code, origin, advance, and size; the rules (a
// fraction bar, a table border) and filled boxes (cell shading, a frame);
// and the boxes of the images and vector paths it paints. It reports what is
// drawn; what makes a figure is figures.ts's call.
//
// The text layer (getTextContent) keeps a string per run of glyphs and the
// run's origin, and its string is whatever the PDF's font maps each code to:
// a TeX math font without a Unicode map reads ϵ as a control character, ℓ as
// a backtick, and ≠ as "6=" (memo P0-F §1.2). The character code names the
// symbol whatever the producer, and a formula's layout needs each glyph's
// box. The walk mirrors pdf.js's own drawing of text (canvas.js showText):
// on amsbook notes, a Word form, a Google Docs export, and a pdfLaTeX
// paper, every text item's origin is a glyph origin here.

import { mathFamily, namedGlyphs, unicodeMath, type MathFamily, type MathVariant } from "@/lib/parse/pdf/glyphs";
import type { Box } from "@/lib/parse/pdf/types";

export type Glyph = {
  font: string; // pdf.js's id of the font, as on a text item (Item.font)
  base: string; // the font's name without its subset prefix ("CMMI10")
  family: MathFamily | null;
  // The character code in the font; for a math font set in Unicode (KaTeX's,
  // an OpenType math font), the code of the same symbol in TeX's font of
  // its family (glyphs.ts unicodeMath).
  code: number;
  unicode: string; // what pdf.js reads the code as
  // A math font set in Unicode: the glyph's height and depth in em where
  // its font draws it otherwise than TeX's (a KaTeX_Size ∑ stands on the
  // baseline, TeX's extension font hangs its ∑ from it), and the alphabet
  // where the font's name does not say it (𝐱 is \mathbf{x}).
  box?: [number, number];
  variant?: MathVariant;
  x: number; // the origin, in PDF points (y grows upward)
  y: number;
  w: number; // the advance
  size: number;
  // The text render mode: 0 fill, 1 stroke, 2 fill and stroke (Word's and
  // Google Docs' bold for a font with no bold face), 3 invisible (an OCR
  // layer over a scan).
  mode: number;
  // What the glyph adds to its item's text where the parse built that text
  // from the glyphs (glyphs.ts itemText): a math glyph read by its code, a
  // composite's character on its first glyph, "" for a glyph that reads as
  // nothing. Unset where the item keeps the text layer's string.
  text?: string;
  // Drawn outside the clip in effect or outside the page box: the glyph
  // shows nothing (a figure's labels past its crop, arXiv 2411.19946 p4).
  hidden?: true;
  // Read by its glyph name where the font has no Unicode map (glyphs.ts
  // namedGlyphs): unicode holds what the name says.
  named?: true;
  // Its fill color as it shows over white (#rrggbb); absent where no plain
  // color fills it (a pattern).
  color?: string;
};
// A drawn line: a stroked segment, or a filled box at most 2 pt thick.
// Horizontal: y1 = y2. Vertical: x1 = x2.
export type Rule = { dir: "h" | "v"; x1: number; y1: number; x2: number; y2: number; thickness: number };
// A filled box: cell shading, a frame, a highlight; its color as it shows
// over white, absent for a pattern.
export type Fill = Box & { color?: string };
// A path's box; clip marks a path that only clips and paints nothing.
export type PathBox = Box & { clip?: true };
export type PageDrawing = { glyphs: Glyph[]; rules: Rule[]; fills: Fill[]; images: Box[]; paths: PathBox[]; shades: Box[] };
// A font by pdf.js's id: its name, font matrix, and writing direction.
// differences: the glyph name of each code, where the font's encoding gives
// one (pdf.js's font with fontExtraProperties).
export type FontLookup = (id: string) => { name: string; fontMatrix?: ArrayLike<number>; vertical?: boolean; differences?: ArrayLike<string | null | undefined> } | null;

// pdf.js operator numbers (OPS, pdf.js 6.1).
const OP = {
  setLineWidth: 2,
  setGState: 9,
  save: 10,
  restore: 11,
  transform: 12,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
  endPath: 28,
  clip: 29,
  eoClip: 30,
  beginText: 31,
  setCharSpacing: 33,
  setWordSpacing: 34,
  setHScale: 35,
  setLeading: 36,
  setFont: 37,
  setTextRenderingMode: 38,
  setTextRise: 39,
  moveText: 40,
  setLeadingMoveText: 41,
  setTextMatrix: 42,
  nextLine: 43,
  showText: 44,
  showSpacedText: 45,
  formBegin: 74,
  formEnd: 75,
  beginAnnotation: 80,
  endAnnotation: 81,
  imageMask: 83,
  image: 85,
  inlineImage: 86,
  imageRepeat: 88,
  solidColorImageMask: 90,
  constructPath: 91,
  setFillColorN: 55,
  setFillRGBColor: 59,
  setFillTransparent: 93,
  shadingFill: 62,
} as const;
const STROKES = new Set<number>([OP.stroke, OP.closeStroke, OP.fillStroke, OP.eoFillStroke, OP.closeFillStroke, OP.closeEOFillStroke]);
const FILLS = new Set<number>([OP.fill, OP.eoFill, OP.fillStroke, OP.eoFillStroke, OP.closeFillStroke, OP.closeEOFillStroke]);
const EVEN_ODD = new Set<number>([OP.eoFill, OP.eoFillStroke, OP.closeEOFillStroke]);
// Path codes inside constructPath's data (pdf.js DrawOPS).
const MOVE_TO = 0;
const LINE_TO = 1;
const CURVE_TO = 2;
const QUAD_TO = 3;
const CLOSE = 4;

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

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

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

// A matrix argument: pdf.js passes transform's six numbers flat and
// setTextMatrix's and a form's as one Float32Array.
function matrixOf(value: unknown): Matrix | null {
  const m = (Array.isArray(value) && value.length === 1 ? value[0] : value) as ArrayLike<number> | null;
  if (!m || typeof m !== "object" || m.length !== 6) return null;
  const out = Array.from(m) as Matrix;
  return out.every(Number.isFinite) ? out : null;
}

// pdf.js saves the text matrices with the graphics state (its text layer
// does too), so a q/Q inside a text object restores them.
type State = {
  ctm: Matrix;
  tm: Matrix;
  tlm: Matrix;
  lineWidth: number;
  font: string | null;
  fontSize: number;
  charSpacing: number;
  wordSpacing: number;
  hScale: number;
  leading: number;
  rise: number;
  mode: number;
  // The clip in effect, as a box; null is the whole page. An image shows
  // only inside it (a slide crops each photo of a grid to its frame).
  clip: Box | null;
  // The fill color (#rrggbb; null for a pattern or none) and its opacity:
  // pdf.js turns every color space's fill into one RGB color.
  fill: string | null;
  alpha: number;
};

type PdfGlyph = { originalCharCode?: number; unicode?: string; width?: number; isSpace?: boolean };

export function readDrawing(
  ops: { fnArray: number[]; argsArray: unknown[] },
  fonts: FontLookup,
  pageWidth: number,
  pageHeight: number,
  // The page box (pdf.js's page.view), in the operators' coordinates.
  view: Box = { x1: 0, y1: 0, x2: pageWidth, y2: pageHeight },
): PageDrawing {
  const glyphs: Glyph[] = [];
  const rules: Rule[] = [];
  const fills: Fill[] = [];
  const images: Box[] = [];
  const paths: PathBox[] = [];
  const shades: Box[] = [];
  let state: State = {
    ctm: IDENTITY,
    tm: IDENTITY,
    tlm: IDENTITY,
    lineWidth: 1,
    font: null,
    fontSize: 0,
    charSpacing: 0,
    wordSpacing: 0,
    hScale: 1,
    leading: 0,
    rise: 0,
    mode: 0,
    clip: null,
    fill: "#000000",
    alpha: 1,
  };
  const stack: State[] = [];
  const forms: State[] = [];
  // Annotation appearances (a form field's value, a stamp) are drawn on the
  // page but are not in the text layer: their glyphs and lines stay out.
  let annotation = 0;
  // pdf.js sends W (clip) just before the path it clips to.
  let clipping = false;
  const fontCache = new Map<string, { base: string; family: MathFamily | null; scale: number; vertical: boolean; named: Map<number, string> | null }>();
  const fontOf = (id: string) => {
    let hit = fontCache.get(id);
    if (!hit) {
      const font = fonts(id);
      const base = (font?.name ?? "").replace(/^[A-Z]{6}\+/, "");
      hit = { base, family: mathFamily(base), scale: font?.fontMatrix?.[0] ?? 0.001, vertical: font?.vertical === true, named: namedGlyphs(base, font?.differences) };
      fontCache.set(id, hit);
    }
    return hit;
  };

  for (let k = 0; k < ops.fnArray.length; k++) {
    const fn = ops.fnArray[k];
    const args = ops.argsArray[k] as unknown[] | null;
    switch (fn) {
      case OP.save:
        stack.push(state);
        state = { ...state };
        break;
      case OP.restore:
        state = stack.pop() ?? state;
        break;
      case OP.transform: {
        const m = matrixOf(args);
        if (m) state.ctm = multiply(m, state.ctm);
        break;
      }
      case OP.formBegin: {
        // A form draws inside a saved state, under its own matrix.
        forms.push(state);
        state = { ...state };
        const m = matrixOf(args?.[0]);
        if (m) state.ctm = multiply(m, state.ctm);
        // pdf.js clips a form to its bounding box.
        const bbox = args?.[1] as ArrayLike<number> | null | undefined;
        if (bbox && bbox.length === 4) {
          const box = boxOf([
            apply(state.ctm, bbox[0], bbox[1]),
            apply(state.ctm, bbox[2], bbox[1]),
            apply(state.ctm, bbox[0], bbox[3]),
            apply(state.ctm, bbox[2], bbox[3]),
          ]);
          state.clip = state.clip ? intersect(state.clip, box) : box;
        }
        break;
      }
      case OP.formEnd:
        state = forms.pop() ?? state;
        break;
      case OP.beginAnnotation:
        annotation++;
        break;
      case OP.endAnnotation:
        annotation = Math.max(0, annotation - 1);
        break;
      case OP.clip:
      case OP.eoClip:
        clipping = true;
        break;
      case OP.setLineWidth:
        if (typeof args?.[0] === "number") state.lineWidth = args[0];
        break;
      case OP.setGState:
        for (const entry of (args?.[0] as unknown[] | undefined) ?? []) {
          if (!Array.isArray(entry)) continue;
          const [key, value] = entry as [string, unknown];
          if (key === "LW" && typeof value === "number") state.lineWidth = value;
          if (key === "ca" && typeof value === "number") state.alpha = value;
          if (key === "Font" && Array.isArray(value)) {
            state.font = String(value[0]);
            state.fontSize = Number(value[1]) || 0;
          }
        }
        break;
      case OP.beginText:
        state.tm = IDENTITY;
        state.tlm = IDENTITY;
        break;
      case OP.setFont:
        state.font = String(args?.[0] ?? "");
        state.fontSize = Number(args?.[1]) || 0;
        break;
      case OP.setCharSpacing:
        state.charSpacing = Number(args?.[0]) || 0;
        break;
      case OP.setWordSpacing:
        state.wordSpacing = Number(args?.[0]) || 0;
        break;
      case OP.setHScale:
        state.hScale = (Number(args?.[0]) || 100) / 100;
        break;
      case OP.setLeading:
        state.leading = Number(args?.[0]) || 0;
        break;
      case OP.setTextRenderingMode:
        state.mode = Number(args?.[0]) || 0;
        break;
      case OP.setFillRGBColor:
        state.fill = typeof args?.[0] === "string" && /^#[0-9a-f]{6}$/i.test(args[0]) ? args[0].toLowerCase() : null;
        break;
      case OP.setFillColorN:
      case OP.setFillTransparent:
        state.fill = null;
        break;
      case OP.setTextRise:
        state.rise = Number(args?.[0]) || 0;
        break;
      case OP.moveText:
        state.tlm = multiply([1, 0, 0, 1, Number(args?.[0]) || 0, Number(args?.[1]) || 0], state.tlm);
        state.tm = state.tlm;
        break;
      case OP.setLeadingMoveText:
        state.leading = -(Number(args?.[1]) || 0);
        state.tlm = multiply([1, 0, 0, 1, Number(args?.[0]) || 0, Number(args?.[1]) || 0], state.tlm);
        state.tm = state.tlm;
        break;
      case OP.setTextMatrix: {
        const m = matrixOf(args);
        if (m) {
          state.tm = m;
          state.tlm = m;
        }
        break;
      }
      case OP.nextLine:
        state.tlm = multiply([1, 0, 0, 1, 0, -state.leading], state.tlm);
        state.tm = state.tlm;
        break;
      case OP.showText:
      case OP.showSpacedText: {
        const font = state.font === null ? null : fontOf(state.font);
        const list = args?.[0];
        if (!font || !Array.isArray(list)) break;
        const { fontSize, charSpacing, wordSpacing, hScale, rise } = state;
        const trm = multiply(state.tm, state.ctm);
        const size = Math.abs(fontSize) * Math.hypot(trm[2], trm[3]);
        // What shows: the page box, and in it the clip in effect. A glyph
        // whose box falls outside it is hidden, and so is one whose middle
        // is off the page box (a scan's OCR read the paper's edge as "—").
        const shown = state.clip ? intersect(state.clip, view) : view;
        const color = paint(state);
        let x = 0; // the advance in text space, before the horizontal scale
        for (const g of list as (number | PdfGlyph | null)[]) {
          if (typeof g === "number") {
            x -= (g * fontSize) / 1000; // a TJ adjustment
            continue;
          }
          if (!g || typeof g !== "object") continue;
          const advance = (g.width ?? 0) * font.scale * fontSize;
          // Vertical writing moves down the page; its glyphs are not read.
          if (!font.vertical && annotation === 0) {
            // apply(trm, …) inline: no two arrays for each of a long book's
            // millions of glyphs.
            const px = trm[0] * (x * hScale) + trm[2] * rise + trm[4];
            const py = trm[1] * (x * hScale) + trm[3] * rise + trm[5];
            const ex = trm[0] * ((x + advance) * hScale) + trm[2] * rise + trm[4];
            const glyph: Glyph = {
              font: state.font!,
              base: font.base,
              family: font.family,
              code: g.originalCharCode ?? 0,
              unicode: g.unicode ?? "",
              x: px,
              y: py,
              w: ex - px,
              size,
              mode: state.mode,
            };
            if (color) glyph.color = color;
            const named = font.named?.get(glyph.code);
            if (named !== undefined) {
              glyph.unicode = named;
              glyph.named = true;
            }
            if (
              Math.max(px, ex) <= shown.x1 - 0.5 ||
              Math.min(px, ex) >= shown.x2 + 0.5 ||
              py + size * 0.75 <= shown.y1 - 0.5 ||
              py - size * 0.25 >= shown.y2 + 0.5 ||
              (px + ex) / 2 < view.x1 ||
              (px + ex) / 2 > view.x2 ||
              py + size * 0.25 < view.y1 ||
              py + size * 0.25 > view.y2
            ) {
              glyph.hidden = true;
            }
            glyphs.push(glyph);
          }
          x += advance + charSpacing + (g.isSpace ? wordSpacing : 0);
        }
        state.tm = multiply([1, 0, 0, 1, x * hScale, 0], state.tm);
        break;
      }
      case OP.constructPath: {
        // A page-sized path is the page's background.
        const box = pathBox(args, state.ctm);
        if (clipping && box) state.clip = state.clip ? intersect(state.clip, box) : box;
        clipping = false;
        // A painted path shows only inside the clip in effect, as an image
        // does: a chart's white ground ran 30 pt past its clip, and its
        // figure reached across the page's gutter (arXiv 2502.02648 p5).
        if (box && (box.x2 - box.x1 < pageWidth * 0.9 || box.y2 - box.y1 < pageHeight * 0.9)) {
          const shown = args?.[0] === OP.endPath ? { ...box, clip: true as const } : shownPart(box, state.clip);
          if (shown) paths.push(shown);
        }
        if (annotation === 0) readPath(args, state, rules, fills);
        break;
      }
      case OP.image:
      case OP.inlineImage:
      case OP.imageMask:
      case OP.imageRepeat: {
        // The image fills the unit square under the current transform; what
        // shows is its part inside the clip.
        const box = boxOf([apply(state.ctm, 0, 0), apply(state.ctm, 1, 0), apply(state.ctm, 0, 1), apply(state.ctm, 1, 1)]);
        const shown = shownPart(box, state.clip);
        if (shown) images.push(shown);
        break;
      }
      case OP.shadingFill: {
        // A shading paints the clip in effect: Beamer draws its item
        // bullets so, a ball in its form's box (synth-slides-tex: read as
        // no bullet at all).
        if (annotation === 0 && state.clip) shades.push({ ...state.clip });
        break;
      }
      case OP.solidColorImageMask: {
        // A one-pixel mask painted in the fill color over the unit square:
        // dvips draws every rule so — Grinstead–Snell's fraction bars (9 on
        // its p. 26, and no rule read) and its tables' \hline.
        if (annotation > 0) break;
        const box = shownPart(boxOf([apply(state.ctm, 0, 0), apply(state.ctm, 1, 0), apply(state.ctm, 0, 1), apply(state.ctm, 1, 1)]), state.clip);
        if (box) addFilledBox(box, null, rules, fills, paint(state));
        break;
      }
    }
  }
  return { glyphs: unicodeMath(glyphs), rules, fills, images, paths, shades };
}

// Two boxes' overlap; empty (x2 ≤ x1 or y2 ≤ y1) when they do not meet.
function intersect(a: Box, b: Box): Box {
  return { x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), x2: Math.min(a.x2, b.x2), y2: Math.min(a.y2, b.y2) };
}

// What of a box the clip in effect shows: its part inside, or null when none
// of it shows. Images and rules are cut alike: KaTeX draws a \sqrt's bar
// 400 em long and clips it to its formula (synth-math-html read rules
// 5,300 pt long). A line has no extent across it: it shows when it lies
// inside. slack lets a rule on the clip's very edge (a table's outer
// border, a hairline) stay whole.
const RULE_SLACK = 0.5;
function shownPart(box: Box, clip: Box | null, slack = 0): Box | null {
  if (!clip) return box;
  const out = intersect({ x1: clip.x1 - slack, y1: clip.y1 - slack, x2: clip.x2 + slack, y2: clip.y2 + slack }, box);
  const shows = (lo: number, hi: number, from: number, to: number) => (hi > lo ? to > from : to >= from);
  return shows(box.x1, box.x2, out.x1, out.x2) && shows(box.y1, box.y2, out.y1, out.y2) ? out : null;
}

function boxOf(points: [number, number][]): Box {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}

// A vector path's box: its local bounds mapped through the transform. Chart
// lines, bars, ticks, and rules all arrive here.
function pathBox(args: unknown[] | null, ctm: Matrix): Box | null {
  const mm = args?.[2] as ArrayLike<number> | null | undefined;
  if (!mm || mm.length !== 4 || !Number.isFinite(mm[0])) return null;
  return boxOf([
    apply(ctm, mm[0], mm[1]),
    apply(ctm, mm[2], mm[1]),
    apply(ctm, mm[0], mm[3]),
    apply(ctm, mm[2], mm[3]),
  ]);
}

// Rules and filled boxes from one painted path (memo P0-F §1.6). pdfTeX
// strokes every rule (a fraction bar is one 0.4 pt segment); Word, Chrome,
// and LibreOffice fill thin rectangles. A stroked straight segment along an
// axis is a rule as thick as the line width; a filled rectangle at most 2 pt
// thick is a rule; any other filled rectangle is a filled box.
function readPath(args: unknown[] | null, state: State, rules: Rule[], fills: Fill[]) {
  const op = args?.[0] as number;
  const data = (args?.[1] as unknown[] | undefined)?.[0] as ArrayLike<number> | null | undefined;
  const stroke = STROKES.has(op);
  const fill = FILLS.has(op);
  if (!data || (!stroke && !fill)) return;
  const ctm = state.ctm;
  // Subpaths as point lists; a curve makes its subpath no rule and no box.
  type Subpath = { points: [number, number][]; curved: boolean; closed: boolean };
  const subpaths: Subpath[] = [];
  let current: Subpath | null = null;
  for (let i = 0; i < data.length; ) {
    const code = data[i];
    if (code === MOVE_TO) {
      current = { points: [apply(ctm, data[i + 1], data[i + 2])], curved: false, closed: false };
      subpaths.push(current);
      i += 3;
    } else if (code === LINE_TO) {
      current?.points.push(apply(ctm, data[i + 1], data[i + 2]));
      i += 3;
    } else if (code === CURVE_TO) {
      if (current) {
        current.curved = true;
        current.points.push(apply(ctm, data[i + 5], data[i + 6]));
      }
      i += 7;
    } else if (code === QUAD_TO) {
      if (current) {
        current.curved = true;
        current.points.push(apply(ctm, data[i + 3], data[i + 4]));
      }
      i += 5;
    } else if (code === CLOSE) {
      if (current) current.closed = true;
      i += 1;
    } else {
      return; // an unknown code: the rest cannot be read
    }
  }
  const scale = Math.hypot(ctm[0], ctm[1]);
  // What the fill paints of each subpath: its box, or the bands around the
  // holes cut out of it (paintedBoxes).
  const painted = paintedBoxes(
    subpaths.map((sub) => (fill && !sub.curved ? filledBox(sub.points) : null)),
    EVEN_ODD.has(op),
  );
  for (const [k, sub] of subpaths.entries()) {
    if (sub.curved) continue;
    const pts = sub.points;
    if (stroke) {
      const thickness = state.lineWidth * scale;
      const last = sub.closed && pts.length > 2 ? pts.length : pts.length - 1;
      for (let i = 0; i < last; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[(i + 1) % pts.length];
        if (Math.abs(y0 - y1) < 0.1 && Math.abs(x0 - x1) >= 0.1) {
          const y = (y0 + y1) / 2;
          const shown = shownPart({ x1: Math.min(x0, x1), y1: y, x2: Math.max(x0, x1), y2: y }, state.clip, RULE_SLACK);
          if (shown) rules.push({ dir: "h", x1: shown.x1, y1: y, x2: shown.x2, y2: y, thickness });
        } else if (Math.abs(x0 - x1) < 0.1 && Math.abs(y0 - y1) >= 0.1) {
          const x = (x0 + x1) / 2;
          const shown = shownPart({ x1: x, y1: Math.min(y0, y1), x2: x, y2: Math.max(y0, y1) }, state.clip, RULE_SLACK);
          if (shown) rules.push({ dir: "v", x1: x, y1: shown.y1, x2: x, y2: shown.y2, thickness });
        }
      }
    }
    for (const box of painted[k]) addFilledBox(box, state.clip, rules, fills, paint(state));
  }
}

// A subpath the fill paints as a box: a rectangle, or a sliver 2 pt thin or
// less that fills its box, whatever its corners (OpenStax draws a grid's
// lines as pieces with one corner cut 0.75 pt in: its Tables 6.3 and 6.4
// read as one cell, or as paragraphs). turn: the sign of its area, the way
// it winds.
type FilledBox = { box: Box; turn: number };
function filledBox(pts: [number, number][]): FilledBox | null {
  if (pts.length < 4 || pts.length > 5) return null;
  const box = boxOf(pts);
  const onEdge = (v: number, a: number, b: number) => Math.abs(v - a) < 0.1 || Math.abs(v - b) < 0.1;
  const area = pts.reduce((sum, [x, y], k) => sum + x * pts[(k + 1) % pts.length][1] - pts[(k + 1) % pts.length][0] * y, 0) / 2;
  const sliver = Math.min(box.x2 - box.x1, box.y2 - box.y1) <= 2 && Math.abs(area) >= (box.x2 - box.x1) * (box.y2 - box.y1) * 0.8;
  if (!sliver && !pts.every(([x, y]) => onEdge(x, box.x1, box.x2) && onEdge(y, box.y1, box.y2))) return null;
  return { box, turn: Math.sign(area) };
}

// What a path's filled boxes paint, subpath by subpath. A box inside other
// boxes of the path is a hole when the fill rule leaves it empty: inside an
// odd count of them under the even-odd rule, or its turn and theirs summing
// to zero under the nonzero rule. A hole paints nothing, and the box right
// around it paints only the bands around the hole. OpenStax draws each
// table's border so: a box with a box 0.75 pt smaller cut out of it, filled
// even-odd, whose hole read as a black box under every cell of the table.
// A path of more than 1,000 boxes (a chart's marks) is read box by box: the
// search looks at every pair.
function paintedBoxes(boxes: (FilledBox | null)[], evenOdd: boolean): Box[][] {
  const drawn = boxes.filter((b) => b !== null);
  if (drawn.length < 2 || drawn.length > 1000) return boxes.map((b) => (b ? [b.box] : []));
  const area = (b: Box) => (b.x2 - b.x1) * (b.y2 - b.y1);
  const inside = (a: Box, b: Box) => a.x1 >= b.x1 - 0.01 && a.x2 <= b.x2 + 0.01 && a.y1 >= b.y1 - 0.01 && a.y2 <= b.y2 + 0.01 && area(a) < area(b);
  const around = new Map(drawn.map((b) => [b, drawn.filter((o) => inside(b.box, o.box))]));
  const holes = new Set(
    drawn.filter((b) => {
      const out = around.get(b) ?? [];
      return b.turn !== 0 && (evenOdd ? out.length % 2 === 1 : out.reduce((sum, o) => sum + o.turn, b.turn) === 0);
    }),
  );
  return boxes.map((b) => {
    if (!b || holes.has(b)) return [];
    const depth = around.get(b)?.length ?? 0;
    const own = [...holes].filter((h) => around.get(h)?.length === depth + 1 && around.get(h)?.includes(b));
    return own.length > 0 ? bands(b.box, own.map((h) => h.box)) : [b.box];
  });
}

// A box less the holes cut out of it, as boxes: the rows between the holes'
// lower and upper edges, each less the holes across it. A frame's sides are
// four bands: under its hole, over it, and one on each side of it.
function bands(box: Box, holes: Box[]): Box[] {
  const ys = [...new Set([box.y1, box.y2, ...holes.flatMap((h) => [h.y1, h.y2])])].sort((a, b) => a - b);
  const out: Box[] = [];
  for (let k = 0; k + 1 < ys.length; k++) {
    const [y1, y2] = [ys[k], ys[k + 1]];
    let x = box.x1;
    for (const h of holes.filter((h) => h.y1 <= y1 && h.y2 >= y2).sort((a, b) => a.x1 - b.x1)) {
      if (h.x1 > x) out.push({ x1: x, y1, x2: h.x1, y2 });
      x = Math.max(x, h.x2);
    }
    if (box.x2 > x) out.push({ x1: x, y1, x2: box.x2, y2 });
  }
  return out.filter((b) => b.x2 - b.x1 > 0.01 && b.y2 - b.y1 > 0.01);
}

// The fill color as it shows over white: a see-through fill (a highlight
// Chrome draws at an opacity) is mixed with the white under it.
function paint(state: State): string | undefined {
  if (state.fill === null || state.alpha <= 0) return undefined;
  if (state.alpha >= 1) return state.fill;
  const mix = (at: number) => Math.round(parseInt(state.fill!.slice(at, at + 2), 16) * state.alpha + 255 * (1 - state.alpha));
  return `#${[1, 3, 5].map((at) => mix(at).toString(16).padStart(2, "0")).join("")}`;
}

// A filled box at most 2 pt thick is a rule; any other is a filled box.
// Each is what the clip shows of it.
// A rule is what the clip shows of it; a filled box stays as drawn (cut to
// its clip, a figure's clipped background read as a lone box in a figure and
// took its labels: arXiv 2411.19946 p. 1).
function addFilledBox(box: Box, clip: Box | null, rules: Rule[], fills: Fill[], color?: string) {
  const w = box.x2 - box.x1;
  const h = box.y2 - box.y1;
  if (h <= 2 && w > h) {
    const shown = shownPart(box, clip, RULE_SLACK);
    const y = (box.y1 + box.y2) / 2;
    if (shown) rules.push({ dir: "h", x1: shown.x1, y1: y, x2: shown.x2, y2: y, thickness: h });
  } else if (w <= 2 && h > w) {
    const shown = shownPart(box, clip, RULE_SLACK);
    const x = (box.x1 + box.x2) / 2;
    if (shown) rules.push({ dir: "v", x1: x, y1: shown.y1, x2: x, y2: shown.y2, thickness: w });
  } else {
    fills.push(color ? { ...box, color } : box);
  }
}

// ── Text items and their glyphs ─────────────────────────────────────────────
// pdf.js builds a text item from consecutive glyphs of one font and keeps
// the first one's origin. An item's glyphs: the glyph at its origin, then
// the glyphs after it in the stream while they keep its font, start before
// its end, and open no other item. A word space is a glyph too; in a math
// family it stays, since there a code the text layer read as a space is a
// symbol (⊖ in CMSY with no Unicode map).
export type TextOrigin = { font: string; x: number; y: number; w: number; size: number };

export function itemGlyphs(items: TextOrigin[], glyphs: Glyph[]): (Glyph[] | undefined)[] {
  // The glyphs by the whole points of their origin's x, then y (a string
  // key made for each glyph took a third of a scanned book's matching).
  const cells = new Map<number, Map<number, number[]>>();
  glyphs.forEach((g, i) => {
    const x = Math.round(g.x);
    let byY = cells.get(x);
    if (!byY) cells.set(x, (byY = new Map()));
    const y = Math.round(g.y);
    const list = byY.get(y);
    if (list) list.push(i);
    else byY.set(y, [i]);
  });
  const taken = new Set<number>();
  const starts = items.map((item) => {
    const at: number[] = [];
    for (const dx of [0, -1, 1]) {
      const byY = cells.get(Math.round(item.x + dx));
      for (const dy of [0, -1, 1]) {
        for (const i of byY?.get(Math.round(item.y + dy)) ?? []) {
          const g = glyphs[i];
          if (g.font === item.font && Math.abs(g.x - item.x) <= 0.01 && Math.abs(g.y - item.y) <= 0.01) at.push(i);
        }
      }
    }
    // The same glyph drawn twice at one spot (an overprinted bold) makes two
    // items: each takes its own copy, in stream order.
    at.sort((a, b) => a - b);
    const first = at.find((i) => !taken.has(i)) ?? at[0] ?? -1;
    if (first >= 0) taken.add(first);
    return first;
  });
  // pdf.js's text layer gives a combining mark no advance, so the items after
  // a \vec sit left of their glyphs by the mark's width (2 of 440,792 items in
  // the corpus): such an item takes the nearest free glyph of its font on its
  // baseline within an em.
  const shift = items.map(() => 0);
  const byFont = new Map<string, number[]>();
  glyphs.forEach((g, i) => {
    const list = byFont.get(g.font);
    if (list) list.push(i);
    else byFont.set(g.font, [i]);
  });
  items.forEach((item, n) => {
    if (starts[n] >= 0) return;
    let best = -1;
    for (const i of byFont.get(item.font) ?? []) {
      const g = glyphs[i];
      if (taken.has(i) || Math.abs(g.y - item.y) > 0.01 || Math.abs(g.x - item.x) > item.size) continue;
      if (best < 0 || Math.abs(g.x - item.x) < Math.abs(glyphs[best].x - item.x)) best = i;
    }
    if (best < 0) return;
    starts[n] = best;
    shift[n] = glyphs[best].x - item.x;
    taken.add(best);
  });
  return items.map((item, n) => {
    const start = starts[n];
    if (start < 0) return undefined;
    const run: Glyph[] = [glyphs[start]];
    const end = item.x + item.w + shift[n] + 0.01;
    for (let i = start + 1; i < glyphs.length; i++) {
      const g = glyphs[i];
      // pdf.js runs two fonts of one embedded file into one item (a T1 and
      // an OT1 LMRoman10-Regular: "ExactlyOne(mp", arXiv 2506.06752 p. 6):
      // the glyphs of either are the item's.
      if ((g.font !== item.font && g.base !== glyphs[start].base) || taken.has(i) || g.x > end || Math.abs(g.y - item.y) > item.size) break;
      if (g.family === null && !g.named && g.unicode.trim() === "") continue;
      run.push(g);
    }
    return run;
  });
}

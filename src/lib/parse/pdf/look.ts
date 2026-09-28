// What the drawing shows of the words beyond their fonts' flags (decision 3
// of the parse loop's round 2): a rule under a run's baseline is an
// underline, a rule through its middle a strikethrough, a filled box behind
// it a highlight of the box's color, and its glyphs' fill color its text
// color; and the face and size the run is set in (faces.ts). The owner's
// Google Docs notes underline their labels and highlight phrases in yellow,
// and the parse read none of it.

import type { Glyph, PageDrawing } from "@/lib/parse/pdf/drawing";
import { faceOf } from "@/lib/parse/pdf/faces";
import { CONTROL_CHARS_RE, itemText, normalizeGlyphs } from "@/lib/parse/pdf/glyphs";
import type { Box, Item, Look } from "@/lib/parse/pdf/types";

/** A font by pdf.js's id: its name and pdf.js's fallback name ("serif",
    "sans-serif", "monospace"). */
export type FontObject = (id: string) => { name?: string; fallbackName?: string } | null | undefined;

type Marks = { color?: string; highlight?: string; underline?: true; strike?: true };

// One object per look, so runs compare looks by reference (glyphs.ts
// sameFlags) and join where the look goes on.
const interned = new Map<string, Look>();
function intern(look: Look): Look {
  const key = `${look.face}|${look.size}|${look.color ?? ""}|${look.highlight ?? ""}|${look.underline ? "u" : ""}${look.strike ? "s" : ""}`;
  let hit = interned.get(key);
  if (!hit) {
    if (interned.size > 50_000) interned.clear();
    interned.set(key, (hit = look));
  }
  return hit;
}

// ── Colors ──────────────────────────────────────────────────────────────────

const channels = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

/** Black and near-black are the page's ink, no color: pdf.js reads a CMYK
    black as #231f20, and a web page sets its words in #333. A dark color
    stays one (Word's navy #1f3864). */
export function isInk(hex: string): boolean {
  const c = channels(hex);
  return Math.max(...c) <= 0x40 && Math.max(...c) - Math.min(...c) <= 0x20;
}

/** The relative luminance of a color, 0 for black to 1 for white. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// A link's blue is the link's, no color of its words (Google Docs' #1155cc,
// Word's #0563c1, a browser's #0000ee and its visited purple).
const isBlue = (hex: string) => {
  const [r, g, b] = channels(hex);
  return b >= r + 0x30 && b >= g;
};

// ── Rules and boxes ─────────────────────────────────────────────────────────

// A glyph of text: shown, not a space, and not a math font's (a fraction's
// numerator stands over its bar as underlined words do).
const texty = (g: Glyph) => !g.hidden && g.mode !== 3 && g.unicode.trim() !== "" && (g.family === null || g.family === "ot1");
const middle = (g: Glyph) => g.x + g.w / 2;
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

// The glyphs over [x1, x2] on one baseline that a line or a box at y marks,
// by rise (their baseline over y, in their size), with the glyphs sorted by
// baseline for the search.
function marked(byY: Glyph[], x1: number, x2: number, y: number, from: number, to: number): Glyph[] {
  let lo = 0;
  let hi = byY.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (byY[mid].y < y - 40) lo = mid + 1;
    else hi = mid;
  }
  const out: Glyph[] = [];
  for (let k = lo; k < byY.length && byY[k].y <= y + 40; k++) {
    const g = byY[k];
    const rise = (g.y - y) / g.size;
    if (rise >= from && rise <= to && middle(g) >= x1 && middle(g) <= x2) out.push(g);
  }
  return out;
}

// The glyphs a mark over [x1, x2] belongs to: on one baseline, and running
// as far as the mark does, to half an em (a signature line, a table's rule,
// or a rule under a heading runs past its words; a shaded cell past its
// cell's words).
function owners(glyphs: Glyph[], x1: number, x2: number): Glyph[] {
  if (glyphs.length === 0) return [];
  const base = median(glyphs.map((g) => g.y));
  const size = median(glyphs.map((g) => g.size));
  if (glyphs.some((g) => Math.abs(g.y - base) > size * 0.2)) return [];
  const from = Math.min(...glyphs.map((g) => g.x));
  const to = Math.max(...glyphs.map((g) => g.x + g.w));
  return x1 >= from - size * 0.5 && x2 <= to + size * 0.5 ? glyphs : [];
}

// Glyphs standing alone under a rule, the next line's words not running on
// past its ends: a fraction's denominator, so the rule is its bar.
function overDenominator(byY: Glyph[], x1: number, x2: number, y: number): boolean {
  const under = marked(byY, x1, x2, y, -0.8, -0.01);
  if (under.length === 0) return false;
  const base = median(under.map((g) => g.y));
  const size = median(under.map((g) => g.size));
  const around = marked(byY, x1 - size * 1.5, x2 + size * 1.5, base, -0.2 * (size / size), 0.2);
  return !around.some((g) => middle(g) < x1 || middle(g) > x2);
}

/** Each text glyph's underline, strikethrough, and highlight on a page. */
function drawnMarks(glyphs: Glyph[], drawing: PageDrawing): Map<Glyph, Marks> {
  const out = new Map<Glyph, Marks>();
  const byY = glyphs.filter(texty).sort((a, b) => a.y - b.y);
  if (byY.length === 0) return out;
  const set = (list: Glyph[], marks: Marks) => {
    for (const g of list) out.set(g, { ...out.get(g), ...marks });
  };
  for (const rule of drawing.rules) {
    if (rule.dir !== "h" || rule.x2 - rule.x1 < 2 || rule.thickness > 3) continue;
    // An underline: the rule under the words' baseline, down to a
    // descender's depth (Google Docs a tenth of an em, TeX's \underline
    // under the descenders); a strikethrough: through their x-height.
    const thin = (list: Glyph[]) => list.filter((g) => rule.thickness <= g.size * 0.15);
    const under = owners(thin(marked(byY, rule.x1, rule.x2, rule.y1, 0.02, 0.45)), rule.x1, rule.x2);
    if (under.length > 0 && !overDenominator(byY, rule.x1, rule.x2, rule.y1)) set(under, { underline: true });
    const through = owners(thin(marked(byY, rule.x1, rule.x2, rule.y1, -0.45, -0.15)), rule.x1, rule.x2);
    if (through.length > 0) set(through, { strike: true });
  }
  for (const fill of drawing.fills) {
    if (!fill.color || luminance(fill.color) > 0.97) continue;
    // A box from under the baseline to over the x-height, about a line
    // tall: a highlight. A shaded frame holds lines, a cell its padding.
    const inside = marked(byY, fill.x1, fill.x2, fill.y1, -1.7, 0.1).filter(
      (g) => fill.y2 >= g.y + g.size * 0.55 && fill.y2 - fill.y1 <= g.size * 2.4,
    );
    const lit = owners(inside, fill.x1, fill.x2);
    if (lit.length > 0) set(lit, { highlight: fill.color });
  }
  return out;
}

// A glyph's text color: its fill, unless ink, a link's blue, or too light
// to read on the page — kept on a dark highlight (white words on a dark
// label).
function textColor(g: Glyph, item: Item, highlight: string | undefined): string | undefined {
  const color = g.mode === 3 ? undefined : g.color;
  if (!color || isInk(color) || (item.href && isBlue(color))) return undefined;
  if (luminance(color) > 0.8 && !(highlight && luminance(highlight) < 0.4)) return undefined;
  return color;
}

// ── Items ───────────────────────────────────────────────────────────────────

const half = (size: number) => Math.round(size * 2) / 2;
const sameMarks = (a: Marks, b: Marks) =>
  a.color === b.color && a.highlight === b.highlight && a.underline === b.underline && a.strike === b.strike;

/** Each item's look (Item.look): its face (none for a math font's and an
    OCR layer's words), its size, and what the drawing marks on its glyphs.
    An item whose glyphs look two ways is cut where the look changes, each
    part an item with its own link (Google Docs draws a highlighted phrase
    and the words after it as one run of one font). hrefAt: the link at a
    place (index.ts). */
export function lookItems(items: Item[], drawing: PageDrawing, fonts: FontObject, hrefAt: (x: number, y: number, w: number, size: number) => string | null) {
  const faces = new Map<string, string>();
  const faceFor = (item: Item) => {
    if (item.math || !item.font || (item.glyphs?.length && item.glyphs.every((g) => g.mode === 3))) return "";
    let face = faces.get(item.font);
    if (face === undefined) {
      let font: ReturnType<FontObject> = null;
      try {
        font = fonts(item.font);
      } catch {
        font = null;
      }
      face = font?.name ? faceOf(font.name.replace(/^[A-Z]{6}\+/, ""), font.fallbackName) : "";
      faces.set(item.font, face);
    }
    return face;
  };
  const drawn = drawnMarks(
    items.flatMap((i) => (i.math ? [] : (i.glyphs ?? []))),
    drawing,
  );
  const out: Item[] = [];
  for (const item of items) {
    const face = faceFor(item);
    const size = half(item.size);
    const glyphs = item.glyphs ?? [];
    // Each glyph's marks; a space takes the marks of the glyph before it.
    const marks: Marks[] = [];
    glyphs.forEach((g, k) => {
      const d = drawn.get(g) ?? {};
      const own: Marks = { ...d, color: textColor(g, item, d.highlight) };
      marks.push(g.unicode.trim() === "" && k > 0 ? marks[k - 1] : own);
    });
    const cuts = marks.flatMap((m, k) => (k > 0 && !sameMarks(m, marks[k - 1]) ? [k] : []));
    const lookOf = (m: Marks | undefined) =>
      intern({
        face,
        size,
        ...(m?.color ? { color: m.color } : {}),
        ...(m?.highlight ? { highlight: m.highlight } : {}),
        ...(m?.underline ? { underline: true as const } : {}),
        ...(m?.strike ? { strike: true as const } : {}),
      });
    const parts = cuts.length > 0 ? split(item, glyphs, [0, ...cuts, glyphs.length]) : null;
    if (!parts) {
      // One look, or glyphs whose text is not the item's: the look most of
      // its glyphs take.
      item.look = lookOf(majority(marks));
      out.push(item);
      continue;
    }
    for (const part of parts) {
      part.look = lookOf(marks[glyphs.indexOf(part.glyphs![0])]);
      part.href = hrefAt(part.x, part.y, part.w, part.size);
      out.push(part);
    }
  }
  items.splice(0, items.length, ...out);
}

// The marks most glyphs take.
function majority(marks: Marks[]): Marks | undefined {
  let best: Marks | undefined;
  let most = 0;
  for (const m of marks) {
    const n = marks.filter((o) => sameMarks(o, m)).length;
    if (n > most) {
      best = m;
      most = n;
    }
  }
  return best;
}

// An item cut at glyph indexes (bounds, from 0 to the glyphs' count), each
// part's text read from its glyphs as the item's was; null when the glyphs
// do not spell the item's text (the text layer's own string differs), and
// the item stays whole.
function split(item: Item, glyphs: Glyph[], bounds: number[]): Item[] | null {
  const texts = new Map(glyphs.flatMap((g) => (g.text !== undefined ? [[g, g.text] as const] : [])));
  const clean = (s: string) => normalizeGlyphs(s.replace(CONTROL_CHARS_RE, ""));
  const whole = itemText(glyphs, texts);
  if (!whole || clean(whole.str) !== item.str) return null;
  const parts: Item[] = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const run = glyphs.slice(bounds[k], bounds[k + 1]);
    const read = itemText(run, texts);
    if (!read || clean(read.str).trim() === "") continue;
    parts.push({ ...item, str: clean(read.str), x: read.x, w: read.w, glyphs: run });
  }
  return parts.length > 1 ? parts : null;
}

export type { Box };

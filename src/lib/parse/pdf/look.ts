// What the drawing shows of the words beyond their fonts' flags (decision 3
// of the parse loop's round 2): a rule under a run's baseline is an
// underline, a rule through its middle a strikethrough, a filled box behind
// it a highlight of the box's color, and its glyphs' fill color its text
// color; and the face and size the run is set in (faces.ts). Google Docs
// exports underline labels and highlight phrases, and the parse read none
// of it.

import type { Glyph, PageDrawing } from "@/lib/parse/pdf/drawing";
import { faceOf } from "@/lib/parse/pdf/faces";
import { CONTROL_CHARS_RE, itemText, normalizeGlyphs, symbolFont, symbolText } from "@/lib/parse/pdf/glyphs";
import type { Item, Look } from "@/lib/parse/pdf/types";
import type { ParsedBlock, TextFont } from "@/lib/parse/types";

/** A font by pdf.js's id: its name and pdf.js's fallback name ("serif",
    "sans-serif", "monospace"). */
export type FontObject = (id: string) => { name?: string; fallbackName?: string } | null | undefined;

type Marks = { color?: string; highlight?: string; underline?: true; strike?: true };
/** The link at a place on the page (index.ts). */
type HrefAt = (x: number, y: number, w: number, size: number) => string | null;

// One object per look, so runs compare looks by reference (glyphs.ts
// sameFlags) and join where the look goes on.
const interned = new Map<string, Look>();
function intern(look: Look): Look {
  const key = `${look.face}|${look.size}|${look.capitals ?? ""}|${look.color ?? ""}|${look.highlight ?? ""}|${look.underline ? "u" : ""}${look.strike ? "s" : ""}`;
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

// A light gray: a shading, not a highlighter's color.
const isShading = (hex: string) => {
  const c = channels(hex);
  return Math.max(...c) - Math.min(...c) <= 0x0c && luminance(hex) >= 0.55;
};

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

// A rule that sits on the glyphs under it, within a quarter em of their
// tops: a fraction's bar over its denominator, an overline over its letter
// on the line below. An underline stands clear of the next line (TeX's
// overlines underlined single letters of the line above them).
function onGlyphsBelow(byY: Glyph[], x1: number, x2: number, y: number): boolean {
  return marked(byY, x1, x2, y, -1.3, -0.01).some((g) => y - (g.y + g.size * 0.7) < g.size * 0.25);
}

// A mark that starts or ends inside a word: the glyph beside its first or
// last touches it, edge to edge within 0.15 em, both letters. A table's
// rule drawn cell by cell put a piece under one letter of a column header;
// TeX's rules under single letters inside words, and a radical's bar on
// the line under "Theorem 6" underlined "heorem" (arxiv-2506-08494 p4).
function cutsWord(byY: Glyph[], run: Glyph[]): boolean {
  const word = (g: Glyph) => /[\p{L}\p{N}]/u.test(g.unicode);
  const sorted = [...run].sort((a, b) => a.x - b.x);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const near = marked(byY, first.x - first.size * 1.5, last.x + last.w + last.size * 1.5, first.y, -0.1, 0.1).filter(
    (g) => !run.includes(g) && word(g),
  );
  const touching = (edge: Glyph, gap: (g: Glyph) => number) =>
    word(edge) && near.some((g) => Math.abs(g.y - edge.y) < edge.size * 0.1 && Math.abs(gap(g)) <= edge.size * 0.15);
  return touching(first, (g) => first.x - (g.x + g.w)) || touching(last, (g) => g.x - (last.x + last.w));
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
    if (under.length > 0 && !onGlyphsBelow(byY, rule.x1, rule.x2, rule.y1) && !cutsWord(byY, under)) set(under, { underline: true });
    const through = owners(thin(marked(byY, rule.x1, rule.x2, rule.y1, -0.45, -0.15)), rule.x1, rule.x2);
    if (through.length > 0 && !cutsWord(byY, through)) set(through, { strike: true });
  }
  for (const fill of drawing.fills) {
    // White is the page, a light gray a table's shading (apple-fy24q4's
    // rows set every number on #efefef), no highlighter's color.
    if (!fill.color || luminance(fill.color) > 0.97 || isShading(fill.color)) continue;
    // A box from under the baseline to over the x-height, about a line
    // tall: a highlight. A shaded frame holds lines, a cell its padding.
    const inside = marked(byY, fill.x1, fill.x2, fill.y1, -0.1, 0.9).filter(
      (g) => fill.y2 >= g.y + g.size * 0.55 && fill.y2 - fill.y1 <= g.size * 2.4,
    );
    const lit = owners(inside, fill.x1, fill.x2);
    if (lit.length > 0) set(lit, { highlight: fill.color });
  }
  return out;
}

// A glyph's text color: its fill, unless ink, a link's blue (the glyph in a
// link's area), or too light to read on the page — kept on a dark highlight
// (white words on a dark label).
function textColor(g: Glyph, hrefAt: HrefAt, highlight: string | undefined): string | undefined {
  const color = g.mode === 3 ? undefined : g.color;
  if (!color || isInk(color) || (isBlue(color) && hrefAt(g.x, g.y, g.w, g.size))) return undefined;
  if (luminance(color) > 0.8 && !(highlight && luminance(highlight) < 0.4)) return undefined;
  return color;
}

// The characters of a text that are no space.
const letters = (text: string) => text.replace(/\s/g, "").length;
// Han, kana, and Hangul.
const CJK_RE = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}]/u;

// ── Items ───────────────────────────────────────────────────────────────────

const half = (size: number) => Math.round(size * 2) / 2;
const sameMarks = (a: Marks, b: Marks) =>
  a.color === b.color && a.highlight === b.highlight && a.underline === b.underline && a.strike === b.strike;

/** Each item's look (Item.look): its face (none for an OCR layer's
    words), its size, and what the drawing marks on its glyphs.
    An item whose glyphs look two ways is cut where the look changes, each
    part an item with its own link (Google Docs draws a highlighted phrase
    and the words after it as one run of one font). hrefAt: the link at a
    place (index.ts). */
export function lookItems(items: Item[], drawing: PageDrawing, fonts: FontObject, hrefAt: HrefAt) {
  const fontOf = (id: string): ReturnType<FontObject> => {
    try {
      return fonts(id);
    } catch {
      return null;
    }
  };
  // Each font's name without its subset prefix.
  const bases = new Map<string, string>();
  const baseOf = (id: string): string => {
    let base = bases.get(id);
    if (base === undefined) bases.set(id, (base = (fontOf(id)?.name ?? "").replace(/^[A-Z]{6}\+/, "")));
    return base;
  };
  // A symbol font's codes read as the symbols it draws (glyphs.ts), and
  // small capitals drawn inside one run come apart into runs of one size.
  const drawnCaps = new Map<Item, number>();
  const read: Item[] = [];
  for (const item of items) {
    const symbols = item.font ? symbolFont(baseOf(item.font)) : null;
    if (symbols) item.str = symbolText(symbols, item.str, item.glyphs);
    read.push(...((!symbols && sizeRuns(item, drawnCaps)) || [item]));
  }
  items.splice(0, items.length, ...read);
  // The fonts that set CJK characters on the page (faces.ts: their one
  // width is no monospace).
  const cjk = new Set(items.flatMap((i) => (i.font && CJK_RE.test(i.str) ? [i.font] : [])));
  // The page's fonts by name.
  const byName = new Map<string, string>();
  for (const item of items) if (item.font && !byName.has(baseOf(item.font))) byName.set(baseOf(item.font), item.font);
  const faces = new Map<string, string>();
  const fontFace = (id: string): string => {
    let face = faces.get(id);
    if (face === undefined) {
      const base = baseOf(id);
      // A subfont cut from a face for one block of Unicode is that face:
      // Advent 3B2's "AdvOTdd63dae3+fb" sets the ligatures fi and fl of
      // "AdvOTdd63dae3", "+03" its Greek, "+22" its minus. Its own flags
      // say monospace for a few glyphs of one width, and Nature's "fi" read
      // as Courier New. With no parent on the page, and for a symbol font,
      // no face of its own: it takes the face of the words around it.
      const cut = /^(.+)\+[0-9a-f]{2}$/i.exec(base)?.[1];
      const parent = cut !== undefined ? byName.get(cut) : undefined;
      if (parent && parent !== id) face = fontFace(parent);
      else if (!base || cut !== undefined || symbolFont(base)) face = "";
      else face = faceOf(base, fontOf(id)?.fallbackName, cjk.has(id));
      faces.set(id, face);
    }
    return face;
  };
  const faceFor = (item: Item) =>
    !item.font || (item.glyphs?.length && item.glyphs.every((g) => g.mode === 3)) ? "" : fontFace(item.font);
  const drawn = drawnMarks(
    items.flatMap((i) => (i.math ? [] : (i.glyphs ?? []))),
    drawing,
  );
  const smallCaps = drawnSmallCaps(items, faceFor);
  for (const [item, size] of drawnCaps) smallCaps.set(item, size);
  const out: Item[] = [];
  for (const item of items) {
    const face = faceFor(item);
    const size = half(item.size);
    const capitals = smallCaps.get(item);
    const from = out.length;
    // The glyphs, when they spell the item's words: a text item may run on
    // past its glyphs in the stream (Chrome draws a link's words apart from
    // the words after them), and the glyphs' marks would paint the rest.
    const glyphs = item.glyphs && letters(item.glyphs.map((g) => g.unicode).join("")) >= letters(item.str) * 0.9 ? item.glyphs : [];
    // Each glyph's marks; a space takes the marks of the glyph before it.
    const marks: Marks[] = [];
    glyphs.forEach((g, k) => {
      const d = drawn.get(g) ?? {};
      const own: Marks = { ...d, color: textColor(g, hrefAt, d.highlight) };
      marks.push(g.unicode.trim() === "" && k > 0 ? marks[k - 1] : own);
    });
    const cuts = marks.flatMap((m, k) => (k > 0 && !sameMarks(m, marks[k - 1]) ? [k] : []));
    const lookOf = (m: Marks | undefined) =>
      intern({
        face,
        size,
        ...(capitals !== undefined ? { capitals: half(capitals) } : {}),
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
    } else {
      for (const part of parts) {
        part.look = lookOf(marks[glyphs.indexOf(part.glyphs![0])]);
        part.href = hrefAt(part.x, part.y, part.w, part.size);
        out.push(part);
      }
    }
    if (capitals !== undefined) for (const part of out.slice(from)) part.smallCaps = true;
  }
  items.splice(0, items.length, ...out);
}

// Small capitals drawn inside one run: capitals at the run's size and
// capitals at about 0.8 of it, all on one baseline (a court's opinion sets
// "PER CURIAM." and "ET AL." so, each one text item in two sizes). The run
// is cut where the size changes, each part at its glyphs' size, and each
// smaller part is small caps (caps: the part and its capitals' size).
function sizeRuns(item: Item, caps: Map<Item, number>): Item[] | null {
  const glyphs = item.glyphs;
  if (!glyphs || glyphs.length < 2 || item.math) return null;
  const big = Math.max(...glyphs.map((g) => g.size));
  const small = (g: Glyph) => g.size < big * 0.9;
  if (!glyphs.some((g) => small(g) && /\p{Lu}/u.test(g.unicode))) return null;
  const capitals = glyphs.every(
    (g) =>
      Math.abs(g.y - glyphs[0].y) <= big * 0.05 &&
      (!small(g) || (g.size >= big * 0.6 && g.size <= big * 0.85 && !/\p{Ll}/u.test(g.unicode))),
  );
  if (!capitals) return null;
  const bounds = [0];
  for (let k = 1; k < glyphs.length; k++) if (small(glyphs[k]) !== small(glyphs[k - 1])) bounds.push(k);
  bounds.push(glyphs.length);
  const parts = split(item, glyphs, bounds);
  for (const part of parts ?? []) {
    part.size = Math.max(...part.glyphs!.map((g) => g.size));
    if (part.size < big * 0.9) caps.set(part, big);
  }
  return parts;
}

// Small capitals a browser or Word draws for a face with none: each
// lowercase letter a capital at about 0.7 of the size (Chrome sets each
// letter as an item), on the baseline of the capital before it. Read as
// capitals set small, they set a paper's headings in 6.5 pt
// (synth-paper-html). Such an item is small caps, and its look keeps the
// capitals' size (Look.capitals), the size the map gives: the block's
// font counts its letters at that size. A run starts at a capital it
// touches, in the capital's face, and goes on through the words after it
// at its size, an em apart at most.
function drawnSmallCaps(items: Item[], faceFor: (item: Item) => string): Map<Item, number> {
  const out = new Map<Item, number>();
  const caps = (i: Item) => !i.math && !i.mono && /\p{Lu}/u.test(i.str) && !/\p{Ll}/u.test(i.str);
  if (!items.some(caps)) return out;
  // The items by baseline, each baseline's from left to right.
  const sorted = items.filter((i) => i.str.trim() !== "").sort((a, b) => b.y - a.y);
  const baselines: Item[][] = [];
  for (const i of sorted) {
    const last = baselines[baselines.length - 1];
    if (last && Math.abs(last[0].y - i.y) <= Math.min(last[0].size, i.size) * 0.05) last.push(i);
    else baselines.push([i]);
  }
  for (const line of baselines) {
    line.sort((a, b) => a.x - b.x);
    for (let k = 1; k < line.length; k++) {
      const [p, c] = [line[k - 1], line[k]];
      if (!caps(c)) continue;
      const gap = c.x - (p.x + p.w);
      if (gap < -c.size * 0.2) continue;
      const run = out.get(p);
      if (run !== undefined) {
        if (Math.abs(p.size - c.size) <= 0.1 && gap <= c.size) out.set(c, run);
        continue;
      }
      const ratio = c.size / p.size;
      if (ratio >= 0.6 && ratio <= 0.85 && gap <= c.size * 0.15 && /\p{Lu}\P{L}*$/u.test(p.str) && !p.math && faceFor(p) === faceFor(c)) {
        out.set(c, p.size);
      }
    }
  }
  return out;
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

// ── The body ────────────────────────────────────────────────────────────────

// A paragraph with a role of the page: a caption, a footnote, a kicker, a
// byline, a pull quote (the block reader's layout tokens, SPEC.md §6).
const ROLE_RE = /^<[a-z][a-z0-9]*\b[^>]*?\bclass="[^"]*\b(?:kicker|meta|label|contents|display|quote|caption|footnote)\b/;

/** The body's look (ParsedDocument.bodyFont, the import's Normal text): the
    face, size, and color most characters of the body's paragraphs take (no
    role of the page), or of every paragraph and list where the body's
    paragraphs hold under 400 characters (a slide's or a résumé's lists are
    its body). A paper's reference list at 7 pt outweighed its body at 9 pt,
    and every body paragraph carried a size (arxiv-2609-29669).
    Taken out of the blocks: a color span in the body's own color is Normal
    text's, no span of its own (a page set in #595959 gray colored every
    word). */
export function takeBodyFont(blocks: ParsedBlock[]): TextFont | undefined {
  const texts = blocks.filter((b) => b.font && (b.type === "PARAGRAPH" || b.type === "LIST"));
  const body = texts.filter((b) => b.type === "PARAGRAPH" && !ROLE_RE.test(b.html ?? ""));
  const tally = new Map<string, number>();
  const add = (key: string, n: number) => tally.set(key, (tally.get(key) ?? 0) + n);
  for (const b of body.reduce((n, b) => n + b.text.length, 0) >= 400 ? body : texts) {
    if (!b.font) continue;
    const n = b.text.length;
    add(`family|${b.font.family}`, n);
    add(`size|${b.font.size}`, n);
    add(`color|${b.font.color ?? ""}`, n);
  }
  const top = (kind: string) =>
    [...tally].filter(([k]) => k.startsWith(`${kind}|`)).sort((a, b) => b[1] - a[1])[0]?.[0].slice(kind.length + 1);
  const family = top("family");
  const size = top("size");
  if (!family || !size) return undefined;
  const color = top("color");
  if (color) {
    for (const b of blocks) {
      const kept = b.styles?.filter((s) => s.style !== `color:${color}`);
      if (kept && kept.length !== b.styles?.length) b.styles = kept.length > 0 ? kept : undefined;
    }
  }
  return { family, size: Number(size), ...(color ? { color } : {}) };
}

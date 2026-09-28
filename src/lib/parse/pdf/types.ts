// The parser's internal types: an Item is one pdf.js text item, a Line the
// items on one baseline, a Segment a block before the passes across pages.

import type { Glyph, PageDrawing, Rule } from "@/lib/parse/pdf/drawing";
import type { Grid } from "@/lib/parse/pdf/lattice";
import type { ParsedBlock } from "@/lib/parse/types";

// sup and sub: set smaller than its line and raised or lowered off the line's
// baseline (a footnote reference, "1st", H₂O). The line decides (lines.ts
// buildLine); a font says nothing of it.
export type Flags = {
  bold: boolean;
  italic: boolean;
  mono: boolean;
  smallCaps: boolean;
  href: string | null;
  sup?: boolean;
  sub?: boolean;
  zone?: MathZone;
  look?: Look;
};
// What the drawing shows of a run beyond its font's flags (look.ts): the
// face as the page editor names it, the size in points to a half point, its
// glyphs' fill color, the filled box behind it, and a rule under it or
// through it; for small capitals drawn as capitals set small, the
// capitals' size. One object per look, so runs compare it by reference, as
// a zone.
export type Look = { face: string; size: number; capitals?: number; color?: string; highlight?: string; underline?: true; strike?: true };
// An inline formula (math/zones.ts): its glyphs, the size of the text it
// sits in, and its LaTeX once read. Items and runs inside it point to it;
// ok when the LaTeX passed the check against the glyphs. open: it ends in a
// relation or an operator, where TeX breaks a formula across lines.
export type MathZone = { glyphs: Glyph[]; size: number; latex: string; ok: boolean; open: boolean };
// math: the glyph comes from a math font (Computer Modern math and symbol
// fonts, AMS fonts, Cambria Math, STIX) — display equations are made of them.
// glyphs: the item's glyphs from the page's drawing, in stream order (a
// composed accent's glyph joins its letter's item); absent when the text
// layer's origin matched no glyph.
export type Item = Flags & {
  str: string;
  x: number;
  y: number;
  w: number;
  size: number;
  math: boolean;
  font?: string;
  glyphs?: Glyph[];
  table?: TableRegion; // a ruled table's place in the text flow (ruled.ts takeTables)
};
export type Run = Flags & { start: number; end: number };
export type Cell = { x: number; text: string; runs: Run[] };
export type Line = {
  cells: Cell[];
  text: string; // cells joined with \t
  runs: Run[]; // style runs over text; every run's chars share one Flags value
  items: Item[]; // kept for table column re-splitting
  x: number;
  xEnd: number;
  y: number;
  size: number;
  page: number;
  firstWordWidth: number;
  mathChars: number; // glyphs from math fonts, for equation detection
  yMin: number; // lowest and highest glyph baselines in the line (a raised
  yMax: number; // superscript, a lowered limit): the line's vertical extent
  display?: boolean; // a display equation's lines joined (math/display.ts)
  table?: TableRegion; // a ruled table's place in reading order: no cells, no text
};
export type UriRegion = { href: string; x1: number; y1: number; x2: number; y2: number };
// A box in PDF points: y1 the bottom edge, y2 the top edge (y grows upward).
export type Box = { x1: number; y1: number; x2: number; y2: number };
// A table the page's rules draw, taken out of the text flow before the
// column split: its box, its text and the text's lines, the grid of a fully
// ruled table (none when only horizontal rules bound it: rows and columns
// come from the text), the horizontal rules inside it, and the page's
// drawing (a cell's formulas read their glyphs and rules from it).
export type TableRegion = { box: Box; items: Item[]; lines: Line[]; grid: Grid | null; rules: Rule[]; drawing: PageDrawing };

// A page start inside a joined segment: where a later page's words begin in
// the text. page is 0-based, like Segment.page.
export type PageBreak = { offset: number; page: number };

// Internal block: ParsedBlock plus what the cross-page passes need.
export type Segment = ParsedBlock & {
  page: number; // 0-based: the page the segment was cut from; a join leaves it, the merge compares it
  firstPage?: number; // 0-based page of the first words, when a join put an earlier page's words first
  breaks?: PageBreak[]; // each later page's start, after joins across page breaks, in order
  rawSize?: number; // heading candidate size, for level ranking
  runs?: Run[]; // style runs over text; spans emit after all merges
  listItem?: boolean; // lone indented item; may join a LIST across the page break
  tocEntries?: { start: number; end: number; num: number }[];
  headingNum?: number; // leading number of a numbered heading ("3." → 3)
  box?: Box; // the lines' extent on the page, for figure regions
  captionBox?: Box; // a captioned FIGURE: where its caption sits (outside box)
  lineSize?: number; // the lines' median font size
  mathShare?: number; // share of glyphs from math fonts
  align?: "center" | "right"; // a heading's alignment (a paragraph's is a token of its html)
};

export type PageContext = {
  bodySize: number;
  leading: number; // line leading as a multiple of font size
  columnLeft: number;
  // Some PDFs expose no bold flags at all (font subsetting); heading rules
  // that require bold would then match nothing.
  hasBold: boolean;
  // The page's leftmost text x, and the content column beside a label column
  // (times in a timeline, dates in a résumé) when the page has one.
  pageMinX: number;
  labelColumn: number | null;
  // Framed boxes drawn on the page (a verbatim prompt, a literature entry):
  // the text inside sits at the frame's inset, which is not a list indent.
  frames: Box[];
  // What the page draws: its glyphs, rules, filled boxes, images, and paths.
  // Only a TeX page keeps its glyphs past the page loop (parsePdf).
  drawing: PageDrawing;
  // The page sets TeX's math fonts (math/display.ts isTexPage), and it is an
  // OCR layer over a scan (paragraphs.ts isOcrLayer).
  tex: boolean;
  ocr: boolean;
};

// What a segment reader cut from a page's lines: its segments, and the index
// of the first line it left.
export type Step = { segments: Segment[]; next: number };

// The parser's internal types: an Item is one pdf.js text item, a Line the
// items on one baseline, a Segment a block before the passes across pages.

import type { ParsedBlock } from "@/lib/parse/types";

export type Flags = { bold: boolean; italic: boolean; mono: boolean; href: string | null };
// math: the glyph comes from a math font (Computer Modern math and symbol
// fonts, AMS fonts, Cambria Math, STIX) — display equations are made of them.
export type Item = Flags & { str: string; x: number; y: number; w: number; size: number; math: boolean; font?: string };
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
};
export type UriRegion = { href: string; x1: number; y1: number; x2: number; y2: number };
// A box in PDF points: y1 the bottom edge, y2 the top edge (y grows upward).
export type Box = { x1: number; y1: number; x2: number; y2: number };

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
};

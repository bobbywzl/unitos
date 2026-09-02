import type { BlockType } from "@prisma/client";
import type { Region } from "@/lib/video/types";

// One entry in the document's reference list. Formal entries come from the
// article's own reference list; the rest come from hyperlinks in the article
// text. Stored on Document.references.
export type DocumentReference = {
  id: string; // "r1", "r2", … stable within the document
  label: string; // display number in the References section
  text: string; // the reference text
  url: string | null; // outbound target; null when the entry has no link
};

// One in-text citation: a span of block text that points at a reference.
// Stored on Block.citations. Offsets are against block plain text; quotedText
// re-resolves the span after edits and re-parses, like every other anchor.
export type CitationSpan = {
  start: number;
  end: number;
  refId: string; // DocumentReference.id
  quotedText: string;
};

// One inline decoration span over block plain text. "code" marks monospace
// runs (identifiers, badges) inside prose. Stored on Block.styles; quotedText
// re-resolves the span after edits and re-parses, like every other anchor.
export type StyleSpan = {
  start: number;
  end: number;
  style: "bold" | "italic" | "underline" | "code";
  quotedText: string;
};

// One link span in block text. Contents entries carry targetOrder (the target
// heading's block order); hyperlinks from PDF link annotations carry href.
// Stored on Block.links; quotedText re-resolves the span like styles.
export type LinkSpan = {
  start: number;
  end: number;
  quotedText: string;
  targetOrder?: number;
  href?: string;
};

export type ParsedBlock = {
  type: BlockType;
  text: string;
  html?: string;
  page?: number; // FIGURE blocks from a PDF: 1-based page, for the figure image route
  region?: Region; // FIGURE blocks from a PDF: the figure's region on its page (percent coordinates)
  citations?: CitationSpan[];
  styles?: StyleSpan[];
  links?: LinkSpan[];
};

export type ParsedDocument = {
  title: string | null;
  blocks: ParsedBlock[];
  references?: DocumentReference[];
  // How many leading references came from the article's own reference list.
  // The rest came from hyperlinks; pruneReferences drops the uncited ones
  // after the model passes settle which blocks survive.
  formalReferences?: number;
};

/** Document.references as stored Json → typed entries. Defensive: bad rows drop. */
export function documentReferences(json: unknown): DocumentReference[] {
  if (!Array.isArray(json)) return [];
  return json.filter(
    (r): r is DocumentReference =>
      typeof r === "object" &&
      r !== null &&
      typeof (r as DocumentReference).id === "string" &&
      typeof (r as DocumentReference).label === "string" &&
      typeof (r as DocumentReference).text === "string" &&
      ((r as DocumentReference).url === null || typeof (r as DocumentReference).url === "string"),
  );
}

// Progress reported while a URL parses: "extract" when the fetch lands and
// extraction begins, again with a detail line when extraction finishes.
export type UrlParseProgress = (stage: "extract", detail?: string) => void;

// Version of the parse pipeline that produced a document's blocks. Bump when
// parsing improves; documents stamped with an older version re-parse
// automatically — on open, and when their URL is added again.
// 2: structural DOM walk + structure pass. 3: core pass separates article from page chrome.
// 4: marker lists (icon or numbered rows → LIST) and styled dividers → SEPARATOR.
// 5: in-text citations resolve to reference entries; the reference list moves to Document.references.
// 6: PDF parse keeps fonts and geometry — bold/italic/code style spans, CODE blocks,
//    glyphless lists, tables with header rows and wrapped cells, field rows,
//    letter-spaced caps collapsed, repeated page furniture dropped, Contents
//    entries linked to their section headings, PDF hyperlinks kept.
// 7: table html carries invisible cell separators so table DOM text equals block
//    text — text anchors inside tables resolve.
// 8: blockquotes with their own blocks recurse; <br>-run paragraphs split.
// 9: compare-loop round 1 — layout tables recurse, rowspan/colspan grids,
//    MathML and MediaWiki math, junk pruning, PDF column detection tuned.
// 10: compare-loop round 2 — nested lists inside wrapper divs kept, footnote
//    markers kept inline, promo rails and comment sections dropped, collapsed
//    accordion content kept, PDF columns split by shape alone, PDF titles
//    merge across wrapped lines.
// 11: import compare loop round 1 — MediaWiki TeX unwrapped as whole brace
//     groups (unbalanced braces broke KaTeX), inline MediaWiki math reads as
//     glyph text instead of raw TeX, display math inside list items, table
//     cells, headings, and captions keeps its readable text instead of vanishing,
//     a formula alone on its line (MediaWiki's <dd> indentation) is an EQUATION.
// 12: import compare loop round 2 (PDF) — label columns (timeline times) read as
//     paragraphs, CJK vector-bullet lists keep their items, tabs stay out of
//     paragraphs, table rows anchored on first-column lines, number columns
//     split at one em, captioned figures and display equations become FIGURE
//     blocks with a region the figure image route crops.
// 13: embedded PDF images become FIGURE blocks with a region (a chart or a
//     drawing with no caption, its in-image text with it); captioned figures
//     take their extent from the page's vector paths; a first-line indent
//     starts a paragraph and a paragraph gap ends one; hanging-indent
//     references stay one entry; line-end hyphens drop unless the document
//     hyphenates the compound; CJK wraps join without a space; Kangxi
//     radicals map to ideographs; Computer Modern and Nimbus font names give
//     bold, italic and mono; letter-numbered and wrapped headings, levels by
//     numbering depth; contents entries lose leaders and page numbers; bullet
//     glyphs become list markers; a page-top float no longer splits a
//     paragraph. URL: a link's citation token stays inline so a card or a
//     section with a button keeps its heading and paragraphs; a wrapper
//     around one container of several text blocks descends into it; a
//     media-less <figure> is its text; a marker list needs visible markers;
//     an opening heading that repeats the title drops.
// 14: import compare loop round 3 — PDF: a line's baseline is the median of
//     its full-size glyphs; superscripts, limits and accents join their line;
//     math-glyph lines never start or join a table run; a one-column table is
//     a paragraph; monospace runs are one CODE block with their indentation;
//     the math extension font's codes map to operators and delimiters; an
//     equation crop leaves room for big delimiters; a label-like bold lead
//     on an isolated line is a heading; a title is set larger than the body;
//     framed boxes are not list indents; a bold label after a ragged line
//     opens a paragraph; a numeric marker splits only after a ragged line;
//     an outdented marker or a display equation ends an item; an unfinished
//     paragraph continues across the page whatever the next word's case;
//     floats lift off a list break; an acronym keeps its wrap hyphen; an
//     accent split across items composes. URL: a figure the sanitizer emptied
//     is its caption; a run of inline elements is one paragraph; a container
//     with two paragraphs is not a composite figure; screen-reader text under
//     any class name drops; an image's inline or attribute width caps its
//     display width; block boundaries and adjacent inline elements space
//     their text; duplicate responsive siblings drop; icons up to 48px are not
//     figure media; a heading that wraps an image emits the figure; a kicker
//     heading before a headline stays; a promo label and its rail drop; the
//     page title loses its site suffix and the banner heading anywhere in the
//     opening blocks drops.
export const PARSER_VERSION = 14;

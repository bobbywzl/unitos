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
// targetFragment is the element id a URL contents entry points at, in memory
// only: resolveContentsLinks (lib/parse/url.ts) turns it into targetOrder
// after the model passes and strips it before the blocks are saved.
export type LinkSpan = {
  start: number;
  end: number;
  quotedText: string;
  targetOrder?: number;
  href?: string;
  targetFragment?: string;
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
  // URL blocks, in memory only: the id of the element the block came from
  // (its own id, or the id of a wrapper whose first block it is), the target
  // a contents entry's targetFragment resolves against. Stripped before save.
  fragment?: string;
};

// The media check (lib/parse/figures.ts checkMedia): the images, videos,
// iframes, and charts in the page's content, how many a block carries, and
// the names of those none does. Travels with a URL parse to the upload
// assistant, the progress card, and the document bar (SPEC.md §15).
export type MediaCheck = {
  onPage: number;
  kept: number;
  lost: string[];
};

export type ParsedDocument = {
  title: string | null;
  blocks: ParsedBlock[];
  // URL parses: the media check.
  mediaCheck?: MediaCheck;
  references?: DocumentReference[];
  // How many leading references came from the article's own reference list.
  // The rest came from hyperlinks; pruneReferences drops the uncited ones
  // after the model passes settle which blocks survive.
  formalReferences?: number;
  // The page's body font family, read from the baked <body data-font>
  // (lib/parse/figure-style.ts); stored in Document.font on creation.
  font?: "sans" | "serif" | "mono";
  // The page's text column width in px, as a 1280×900 desktop browser lays
  // it out, read from the baked <body data-column-px>; stored in
  // Document.columnWidth, the reader's column width for the document.
  columnWidth?: number;
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
//     accent split across items composes; an operator sign (∫ ∑ ∏ √) joins
//     the line under its center; a glyph set stays on its own line when that
//     is nearer, a group of superscripts alone joins the nearest line; an
//     accent keeps its base letter's line; an equation crop stops at the text
//     beside it; a line of words at the column edge is prose, not math; a
//     wholly bold ragged line closes its block; a bitmap font with a fixed
//     advance is monospace; lines pushed apart by tall glyphs stay one
//     paragraph. URL: a figure the sanitizer emptied
//     is its caption; a run of inline elements is one paragraph; a container
//     with two paragraphs is not a composite figure; screen-reader text under
//     any class name drops; an image's inline or attribute width caps its
//     display width; block boundaries and adjacent inline elements space
//     their text; duplicate responsive siblings drop; icons up to 48px are not
//     figure media; a heading that wraps an image emits the figure; a kicker
//     heading before a headline stays; a promo label and its rail drop; the
//     page title loses its site suffix and the banner heading anywhere in the
//     opening blocks drops.
// 15: figures keep their look — the page's stylesheets load at parse, a chart
//     svg carries the page's colors, fonts, and backdrop as inline style, and
//     an image carries the backdrop the page drew behind it.
// 16: replica fidelity — a page's hidden tree is pruned by its stylesheet, a contents list keeps its links to the article's headings, sub-headings set as styled paragraphs and headings sized by the page become headings by level, the kicker, metadata line, pull quotes, and captions carry their layout, bold, italic, underline, and code runs become style spans, the page's font family travels with the document, figures keep the page's widths and rows, a scripted chart renders in a browser where one is configured.
// 17: the page's width — the text column's width travels with the document
//     and is the reader's column; a figure the page sets wider than its text
//     column draws wider in the reader too; a chart the page's scripts
//     animate settles before the parse, and a looping one is captured as a
//     GIF of one loop (browser render only).
// 18: a figure's words stay out of its caption and keep the page's look —
//     text in a box the page paints its own background under, or sets in
//     its own font around a chart (a chart's title, legend, axis labels,
//     source line), is the figure's, the caption is the text outside the
//     box, the words carry their font size, weight, color, and alignment,
//     a legend swatch its size and color, and the box its background and
//     padding; a Markdown file imports through the URL walk.
// 19: nothing lost — an image, video, or chart set inside a paragraph of text
//     is a figure between the text's parts; two uncaptioned figures in the
//     document head are two figures; the media check reads every image,
//     video, iframe, and chart of the page against the blocks after the walk
//     and rebuilds what no block carries where the page set it; a figure the
//     model passes dropped between two kept blocks is restored.
export const PARSER_VERSION = 19;

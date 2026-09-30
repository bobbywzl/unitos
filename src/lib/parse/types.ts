import type { BlockType } from "@prisma/client";
import type { CustomColor, HighlightStyle } from "@/lib/text-style";
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
// runs (identifiers, badges) inside prose. "smallCaps" marks words set in a
// small-caps font (a theorem label, a legal defined term). "sub" and "sup"
// mark lowered and raised runs outside math (H₂O, 10³, "1st", a footnote
// mark). A PDF's drawing gives "underline" (a rule under the run's
// baseline), "strike" (a rule through its middle), "color:#rrggbb" (its
// glyphs' fill; black, near-black, and a link's blue are none), and
// "highlight:#rrggbb" (a filled box behind it), in the vocabulary of
// lib/text-style.ts. "font:<face>" and "size:<points>" mark a run set in
// another face or size than its block's (ParsedBlock.font). Stored on
// Block.styles; quotedText re-resolves the span after edits and re-parses,
// like every other anchor.
export type StyleSpan = {
  start: number;
  end: number;
  style:
    | "bold"
    | "italic"
    | "underline"
    | "strike"
    | "code"
    | "smallCaps"
    | "sub"
    | "sup"
    | CustomColor
    | HighlightStyle
    | `font:${string}`
    | `size:${number}`;
  quotedText: string;
};

// The look of words as the page sets them (a PDF parse): the face as the
// page editor names it (lib/parse/pdf/faces.ts), the size in points to a
// half point, bold, italic, and the color (#rrggbb; none for black).
export type TextFont = { family: string; size: number; bold?: true; italic?: true; color?: string };

// An indent as the page sets it, in points, the way the page editor stores a
// paragraph's (indentLeft, indentFirstLine, indentRight): left, how far in
// from the column's left edge the lines start; first, where the first line
// starts against them (a first-line indent; negative, a hanging indent);
// right, how far in from the column's right edge the lines end (a Word
// paragraph's w:ind right). A list depth whose words follow its marker on
// the first line (first ≥ 0) also says where they start, from the marker's
// start (hang).
export type Indent = { left: number; first: number; hang?: number; right?: number };

// One inline formula over block plain text: the text keeps the formula's
// readable characters (σ(𝒜α)), latex is the formula (\sigma(\mathcal{A}_\alpha)).
// A block document draws the text; an import turns the span into an inline
// equation the page editor draws with KaTeX.
export type MathSpan = { start: number; end: number; latex: string };

// A footnote reference in block text: the footnote's label where the text
// prints it, raised ("1", "*"), and the order of the footnote's block. A
// block document keeps the label as words; an import turns it into the page
// editor's footnote number.
export type FootnoteRef = { start: number; end: number; targetOrder: number };

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

// Where a page of a PDF begins inside a block that runs across a page break
// (a paragraph, a list, a table the parse joined): offset is the character
// offset in the block's text where the page's words begin, page the 1-based
// page. In a list, a page that begins with an item begins at the item's line,
// its marker included; in a table, at the row.
export type PageStart = { offset: number; page: number };

export type ParsedBlock = {
  type: BlockType;
  text: string;
  html?: string;
  // PDF blocks: the 1-based page the block's first words are on. FIGURE
  // blocks: the page the figure image route renders.
  page?: number;
  // PDF blocks joined across a page break: each later page's start, in
  // order. Absent when the block stays on one page.
  pageStarts?: PageStart[];
  region?: Region; // FIGURE blocks from a PDF: the figure's region on its page (percent coordinates)
  citations?: CitationSpan[];
  styles?: StyleSpan[];
  links?: LinkSpan[];
  // PDF blocks: the inline formulas over the block's text, in order, none
  // overlapping. The import reads them; a block document stores the text only.
  math?: MathSpan[];
  // PDF blocks: a footnote, the words printed at a page's foot under a short
  // rule, and its label as printed ("1", "*", "¶¶"; "" when it has none). A
  // PARAGRAPH whose html is <p class="footnote"> and whose text opens with
  // the label. It stands after the block that cites it; a table's notes
  // stand after their table.
  footnote?: { label: string };
  // PDF blocks: the footnote references in the text, in order.
  footnoteRefs?: FootnoteRef[];
  // PDF text blocks: the look most of the block's characters take. The
  // import reads it for the named styles, and for a block set in another
  // face, size, or color than its named style.
  font?: TextFont;
  // PDF text blocks: the space between the block and the next text block in
  // its column on the same page, beyond the text's line pitch, in points (a
  // blank line, a Word paragraph's space after); absent where a figure, a
  // table, or the page's end follows. The import's space after.
  spaceAfter?: number;
  // PDF paragraphs: the indent the page sets; absent where every line starts
  // at the column's edge. The html's indent token names its kind.
  indent?: Indent;
  // PDF lists: each depth's indent (an item's marker stands at left + first,
  // its wrapped lines at left), and the space the page leaves between two
  // items beyond the line pitch, in points (absent: none). A list's
  // alignment is a token of its html, as a paragraph's.
  listIndents?: Indent[];
  itemSpace?: number;
  // Word paragraphs: the borders the paragraph's style and its own
  // properties draw (w:pBdr: a rule under a heading, a bar beside a quote,
  // a box), each side as the page editor stores a paragraph's: "<width pt>
  // <solid|dotted|dashed> #rrggbb <padding pt>". between: the line between
  // two paragraphs of one box (w:between).
  borders?: { top?: string; right?: string; bottom?: string; left?: string; between?: string };
  // Word paragraphs: the background (w:shd) as the page editor stores a
  // paragraph's shading: "#rrggbb <padding pt>".
  shading?: string;
  // PDF FIGUREs: the crop of a display equation that failed the glyph check.
  // Its text is the display's glyphs as the text layer reads them (often
  // garbled), so the import shows it with no caption.
  mathCrop?: true;
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
  // Slides and sheets (SPEC.md §27): the stored file's format, kept on
  // Document.format so a re-parse picks the same parser.
  format?: "slides" | "sheets";
  // Slides: the slide's width over its height; sets the reader's column.
  slideAspect?: number;
  // PDF parses: the first page's size in points (1/72 inch), as pdf.js
  // reads it at scale 1 (the crop box, turned by the page's rotation).
  pageSize?: { width: number; height: number };
  // PDF parses: the PDF's own page labels, one per page ("xii", "1043"),
  // only when the PDF names its pages otherwise than 1..n. A page the PDF
  // leaves unnamed among named ones has the number its neighbors imply, or
  // none (""). Stored on Document.pageLabels.
  pageLabels?: string[];
  // PDF parses: the body's look (the import's Normal text), and the title's
  // look and alignment when the title came from the page (the import's
  // Title).
  bodyFont?: TextFont;
  titleFont?: TextFont;
  titleAlign?: "center" | "right";
  // PDF parses: the title's lines where the writer broke it (a title set as
  // two centered lines), when it has more than one. `title` stays one line:
  // it is the document's name.
  titleLines?: string[];
  // PDF parses: the PDF's page the title stands on, when words of an
  // earlier page come before it (an archive's notice page, a deck's first
  // slide). The import's Title opens that page.
  titlePage?: number;
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
// 20: the parse loop's round 1 (SPEC.md §31) — PDF: a glyph's text comes
//     from its character code, a TeX math glyph from TeX's font tables;
//     inline formulas are LaTeX spans and a TeX page's display equations
//     EQUATION blocks, each checked against the glyphs (a display that fails
//     stays a crop); running heads, feet, and page numbers drop on evidence
//     from other pages; a table the page's rules draw is found before the
//     column split; a graphic keeps its labels; footnotes are their own
//     blocks, linked to their marks; small caps, sub, and sup are styles;
//     reading order is a recursive XY-cut; list markers are read by family;
//     a drop cap joins its word. A Word file parses from its own structure.
// 21: the parse loop's round 2 (SPEC.md §30, §31) — PDF: the page's look
//     travels: each block's font (face, size, weight, color), the body's and
//     the title's font and the title's alignment, and a run in another face,
//     size, or color; underline, strikethrough, highlight, and text color
//     come from the drawing; a line centered, flush right, or justified says
//     so. Math set in KaTeX's fonts or an OpenType math font reads as TeX, as
//     TeX's own fonts do; an array keeps its rules, and a label over a
//     relation or under a brace joins its formula. A table's header cell
//     spans the columns under it, a cell keeps its scripts, styles, and
//     formulas, and a caption keeps its face and size. A figure's caption
//     takes its panels' captions and its note or source line. A scan's
//     footnotes, author notes, title notes, and notes in table cells link to
//     their marks. Headings go to level six, a slide ranks its own sizes,
//     running heads may mirror on facing pages, and an OCR layer's widths are
//     fitted. A CID font reads through pdf.js's CMaps (Japanese, Chinese).
//     The import draws the page's list markers at every level. Word: the
//     same look, space after paragraphs, notes in table cells, and a contents
//     field built from its headings.
// 22: the parse loop's round 3 (SPEC.md §30, §31) — PDF: columns with a
//     narrow gutter, and three columns, split; blocks side by side read in
//     order; a scan's overlapping word boxes keep their spaces. A paragraph's
//     indent is measured in points; a list keeps each depth's indents, the
//     space between its items, and its justified items; an algorithm's lines
//     and a references list with no markers are lists with no marker; a
//     bullet the page draws opens an item, and no bullet is invented.
//     Division labels, a statement's title, and a centered title on the
//     first page are headings; a page number with a period and a roman one
//     drop; a first page's notes are footnotes; a pull quote is a quote. More
//     math fonts read as TeX's; a formula that fails its check keeps its
//     scripts; an equation number keeps its side; a display crop carries no
//     caption; a list's bullet never joins a formula. A figure's crop never
//     takes in a running head, a running foot, a page number, or a footnote.
//     Word: paragraph borders, indents, the space between list items, and
//     cell borders.
// 23: the parse loop's round 4 (SPEC.md §30, §31) — PDF: a page no single
//     cut reads may still hold one band of columns, and a side column reads
//     beside the paragraph it stands by; a paragraph cut by a page or column
//     break joins its other half past the floats and short lines between
//     them, and "et al." ends no sentence; a double-spaced page reads at its
//     own leading. A symbol font with no Unicode map reads by its codes, a
//     face by the shape its name says, and capitals drawn at 0.8 of their
//     size are small caps. A banner is a graphic, a caption in a side column
//     is its graphic's, and a chart's tick labels are in its crop. A title
//     wraps onto lines of its size and look and stands on the title page,
//     the lines before it paragraphs; heading levels follow the numbered
//     headings' sizes; a run-in lead is a run-in heading. A box to tick
//     reads ☐; a grid open at one side closes; a grid the page does not show
//     is no table; a merged cell whose words stand in columns is those
//     columns' cells; a ruled row keeps its height; a scan's printer's mark
//     drops. STIX's size fonts read; a lone italic letter is a formula where
//     the page sets math, and small tight letters after a formula are its
//     script; rows aligned at a relation join one display, and a label on a
//     row of its own is the display's. Word: the right indent, a display's
//     spacing, the cells' margins, and a paragraph's shading and the line
//     between the paragraphs of a box.
// Slides and sheets (SPEC.md §27) parse with their own parsers
// (lib/parse/slides.ts, lib/parse/sheets.ts) and re-parse only on request:
// they carry no version of their own.
export const PARSER_VERSION = 23;

import type { BlockType } from "@prisma/client";

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
export const PARSER_VERSION = 10;

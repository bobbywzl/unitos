/**
 * The parse benchmark's reference model: what a perfect parse of a document holds.
 * A reference (`RefDoc`) is written against this model; the adapters turn a parse and an import into the same model.
 */

/** A run of a block's words with one set of styles. Inline math: `latex` is the formula's LaTeX and
    `text` its plain reading (the characters a reader sees, e.g. "σ(A_α)" may read "σ(Aα)"). `color` is the
    words' color where it is not black or near-black (a link's own blue is the link's, never a color) and
    `highlight` the fill drawn behind them, both "#rrggbb". A link's underline is the link's too. */
export type Span = {
  text: string;
  latex?: string;
  mathml?: string; // presentation MathML when a source gives it (LaTeXML); compared before latex
  bold?: true; italic?: true; underline?: true; strike?: true; code?: true; smallCaps?: true; sub?: true; sup?: true;
  href?: string;
  color?: string;
  highlight?: string;
};
/** A line's alignment where it is not flush left. "justify": every line but the last ends at the column's
    right edge, which only a paragraph that wraps shows. */
export type Align = "center" | "right" | "justify";
/** A face as the page sets it: its shape, its size in points, whether it is bold, and its color ("#rrggbb";
    none for black and near-black). The page editor draws a face of the same shape (a PDF's font by its
    name, else by its shape). */
export type Font = { shape: "serif" | "sans" | "mono"; size: number; bold?: true; color?: string };
/** The roles a document's fonts are scored by: the body (paragraphs and list items), the title, each
    heading level, captions (a figure's, a table's), and footnotes. */
export type FontRole = "body" | "title" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "caption" | "footnote";
/** Each role's font as the page sets it; a block that the page sets otherwise than its role carries its own `font`. */
export type Fonts = { body: Font } & Partial<Record<Exclude<FontRole, "body">, Font>>;
export type RefBlock =
  | { kind: "title"; spans: Span[]; align?: Align; font?: Font }
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; spans: Span[]; align?: Align; font?: Font }
  | { kind: "paragraph"; spans: Span[]; align?: Align; indent?: "first" | "hanging" | "block"; font?: Font }
  | { kind: "list"; items: { depth: number; marker: string; spans: Span[]; checked?: boolean }[]; font?: Font } // depth 0 = outermost; marker as printed: "(a)", "1.", "•", "☐"
  | { kind: "equation"; latex: string; mathml?: string; label?: string } // display math; the label "(1.2)" never inside latex
  | { kind: "table"; caption?: Span[]; rows: { cells: { spans: Span[]; header?: true; colspan?: number; rowspan?: number }[] }[]; font?: Font } // font: the caption's
  | { kind: "figure"; caption?: Span[]; font?: Font } // image, chart, or diagram; its inner labels are not text; font: the caption's
  | { kind: "code"; text: string }
  | { kind: "quote"; spans: Span[] }
  | { kind: "footnote"; label: string; spans: Span[]; font?: Font }
  | { kind: "separator" };
export type RefDoc = {
  id: string; // kebab-case, unique across the corpus
  category: "math-tex" | "paper" | "textbook" | "legal" | "form" | "financial" | "report" | "notes" | "book" | "newsletter" | "cjk" | "slides" | "word";
  source: { pdf?: string; docx?: string; url?: string }; // pdf/docx: a path under .bench/ (repo-relative); url: where it came from
  pages?: [number, number]; // the scored pages, 1-based, inclusive; the parse outside them is not scored
  blocks: RefBlock[]; // reading order; a float (figure, table) may sit where the source puts it
  furniture: string[]; // exact strings printed as running heads, running feet, page numbers ("9", "Page 2 of 13"): never in a parse
  /** The fonts each role takes; a reference without them leaves fonts unscored. */
  fonts?: Fonts;
  license: "open" | "public-domain" | "private" | "copyrighted";
  provenance: "generated" | "latexml" | "hand";
  notes?: string;
};
export type Category = RefDoc["category"];

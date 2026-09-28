/**
 * The parse benchmark's reference model: what a perfect parse of a document holds.
 * A reference (`RefDoc`) is written against this model; the adapters turn a parse and an import into the same model.
 */

/** A run of a block's words with one set of styles. Inline math: `latex` is the formula's LaTeX and
    `text` its plain reading (the characters a reader sees, e.g. "σ(A_α)" may read "σ(Aα)"). */
export type Span = {
  text: string;
  latex?: string;
  mathml?: string; // presentation MathML when a source gives it (LaTeXML); compared before latex
  bold?: true; italic?: true; underline?: true; code?: true; smallCaps?: true; sub?: true; sup?: true;
  href?: string;
};
export type RefBlock =
  | { kind: "title"; spans: Span[] }
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; spans: Span[] }
  | { kind: "paragraph"; spans: Span[]; align?: "center" | "right"; indent?: "first" | "hanging" | "block" }
  | { kind: "list"; items: { depth: number; marker: string; spans: Span[]; checked?: boolean }[] } // depth 0 = outermost; marker as printed: "(a)", "1.", "•", "☐"
  | { kind: "equation"; latex: string; mathml?: string; label?: string } // display math; the label "(1.2)" never inside latex
  | { kind: "table"; caption?: Span[]; rows: { cells: { spans: Span[]; header?: true; colspan?: number; rowspan?: number }[] }[] }
  | { kind: "figure"; caption?: Span[] } // image, chart, or diagram; its inner labels are not text
  | { kind: "code"; text: string }
  | { kind: "quote"; spans: Span[] }
  | { kind: "footnote"; label: string; spans: Span[] }
  | { kind: "separator" };
export type RefDoc = {
  id: string; // kebab-case, unique across the corpus
  category: "math-tex" | "paper" | "textbook" | "legal" | "form" | "financial" | "report" | "notes" | "book" | "newsletter" | "cjk" | "slides" | "word";
  source: { pdf?: string; docx?: string; url?: string }; // pdf/docx: a path under .bench/ (repo-relative); url: where it came from
  pages?: [number, number]; // the scored pages, 1-based, inclusive; the parse outside them is not scored
  blocks: RefBlock[]; // reading order; a float (figure, table) may sit where the source puts it
  furniture: string[]; // exact strings printed as running heads, running feet, page numbers ("9", "Page 2 of 13"): never in a parse
  license: "open" | "public-domain" | "private" | "copyrighted";
  provenance: "generated" | "latexml" | "hand";
  notes?: string;
};
export type Category = RefDoc["category"];

/**
 * The arXiv papers of the parse benchmark. Each has a LaTeXML HTML version (arxiv.org/html/<id>);
 * build.mts turns that HTML into the paper's reference, fetch.mts downloads everything from the ids alone.
 * The id carries its version, so the PDF and the HTML stay the ones the reference was built from.
 */
import type { Category } from "../model";

export type Paper = {
  id: string; // arXiv id with its version
  field: string;
  layout: string;
  category: Category;
  pages: [number, number]; // the scored pages
  /** The paper's own macros (from its source) that KaTeX does not know, as KaTeX macro bodies with #1… */
  macros?: Record<string, string>;
  /** The class prints \cite in parentheses (ACL's natbib); LaTeXML writes it as running text. */
  parenCite?: true;
  /** The class prints numeric citations, "[91]" (ACM's numeric style); LaTeXML writes author and year. */
  numericCite?: true;
  /** The class prints no comma between author and year, "(Acciari et al. 2011)" (MNRAS); LaTeXML writes one. */
  citeNoComma?: true;
  /** The class prints three or more numeric citations in a row as a range, "[5–8]" (revtex); LaTeXML lists each. */
  citeCompress?: true;
  /** Lines the class prints on its pages that are not the paper's text (a journal's license block). */
  furniture?: RegExp[];
  /** Where LaTeXML prints other words than the PDF: [LaTeXML's text, the PDF's text]; each must match one span. */
  fixes?: [string, string][];
};

export const PAPERS: Paper[] = [
  { id: "2411.09614v2", field: "probability", layout: "article, one column, printed contents", category: "math-tex", pages: [1, 8] },
  { id: "2506.08494v1", field: "analysis", layout: "amsart, running heads", category: "math-tex", pages: [1, 8] },
  {
    id: "2410.04586v2",
    field: "algebra and geometry",
    layout: "amsart, running heads",
    category: "math-tex",
    pages: [1, 8],
    macros: { "\\mathbbm": "\\mathbb{#1}", "\\Sym": "\\operatorname{Sym}", "\\reg": "\\operatorname{reg}" },
  },
  { id: "2302.12627v3", field: "statistics", layout: "article, one column, A4", category: "math-tex", pages: [1, 8], macros: { "\\mathbbm": "\\mathbb{#1}" } },
  { id: "2502.02648v2", field: "physics (random matrices)", layout: "revtex, two columns", category: "paper", pages: [1, 8], macros: { "\\Ecal": "\\mathcal{E}" }, citeCompress: true },
  { id: "2504.02736v2", field: "physics (topological order)", layout: "revtex letter, two columns, run-in heads", category: "paper", pages: [1, 5], citeCompress: true },
  { id: "2411.19946v2", field: "computer vision", layout: "CVPR, two columns", category: "paper", pages: [1, 8] },
  { id: "2503.10997v2", field: "natural language processing", layout: "ACL, two columns", category: "paper", pages: [1, 8], parenCite: true },
  {
    id: "2609.29669v1",
    field: "robotics survey",
    layout: "ACM journal, one column, many tables",
    category: "paper",
    pages: [1, 10],
    numericCite: true,
  },
  {
    id: "2506.06752v1",
    field: "quantum computing, algorithms",
    layout: "LIPIcs, algorithms",
    category: "paper",
    pages: [1, 8],
    fixes: [["Coupling map", "Input: Coupling map"]], // LaTeXML drops algorithmicx's \Require label
  },
  { id: "2506.06352v1", field: "AI and philosophy", layout: "one column, small page, many footnotes", category: "paper", pages: [1, 8], macros: { "\\mdmathbb": "\\mathbb{#1}" } },
  { id: "2506.08209v1", field: "economics", layout: "one column, double spaced, tables", category: "paper", pages: [1, 10] },
  {
    id: "2503.22874v2",
    field: "astronomy",
    layout: "MNRAS, two columns, tables",
    category: "paper",
    pages: [1, 8],
    citeNoComma: true,
    furniture: [/^© \d{4} The Authors$/],
  },
];

/** The reference id: "arxiv-2411-09614" for 2411.09614v2. */
export function refId(paper: Paper): string {
  return `arxiv-${paper.id.replace(/v\d+$/, "").replace(/\./g, "-")}`;
}

/** Where fetch.mts puts a paper's files: `.bench/arxiv/<id>.pdf`, `.html`, `.abs.html`, `.src`. */
export function benchFile(paper: Paper, ext: "pdf" | "html" | "abs.html" | "src"): string {
  return `.bench/arxiv/${paper.id}.${ext}`;
}

// pdf.js on Node 22 (SPEC.md §16): the runtime pdf.js needs before it loads.
// pdf.js's TrueType sanitizer sums glyph table sizes with Math.sumPrecise,
// which Node 22 does not have. Without it every embedded TrueType font fails
// to load, pdf.js warns and draws nothing for its text, and a vector
// figure's labels — matplotlib, Graphviz, Illustrator exports are TrueType
// — vanish from the rendered page while the Type 1 body text stays. Every
// file that loads unpdf imports this file first. Node 24 has the function;
// this install steps aside when it is there.
import { join } from "node:path";

declare global {
  interface Math {
    sumPrecise?(values: Iterable<number>): number;
  }
}

// Neumaier's compensated sum: exact for the integer byte counts pdf.js
// sums, and within one rounding of the spec's result for anything else.
function sumPrecise(values: Iterable<number>): number {
  let sum = 0;
  let compensation = 0;
  for (const value of values) {
    const next = sum + value;
    compensation += Math.abs(sum) >= Math.abs(value) ? sum - next + value : value - next + sum;
    sum = next;
  }
  return sum + compensation;
}

if (typeof Math.sumPrecise !== "function") {
  Math.sumPrecise = sumPrecise;
}

// A CID font with no ToUnicode map says what its codes are only through
// Adobe's CMaps, and pdf.js without them drops the font's text whole: in the
// parse, in a page's text, and in the page render. pLaTeX and dvipdfmx papers
// and many Japanese PDFs set their CJK text that way (JNLP 31(1) p. 1 parsed
// to its Latin words alone: the Japanese title, authors, and abstract were
// gone). unpdf looks for the CMaps in a pdfjs-dist install, which the app does
// not have, so they live in src/lib/parse/pdf/cmaps/: the cmaps folder of
// pdfjs-dist@6.1.200, the pdf.js version unpdf bundles, with Adobe's BSD-3
// license. When unpdf's pdf.js changes version, the files must change to that
// version's. next.config.ts traces the folder into the API functions. Every
// call that opens a PDF passes these options; pdf.js wants the trailing slash.
export const PDF_CMAPS = { cMapUrl: `${join(process.cwd(), "src", "lib", "parse", "pdf", "cmaps")}/`, cMapPacked: true };

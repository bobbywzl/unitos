// Conversion (SPEC.md §16): handwritten pages → text blocks. The attached
// images are consecutive pages of a handwritten document; the model transcribes
// them into blocks that imitate the notes' formatting. Runs as a background
// job through lib/handwritten/convert.ts, not through /api/derive — like the
// connect scan. Rules 2, 3, and 9 follow notes2latex's reading of handwritten
// pages (MIT, Advay Pakhale): corrections win, margins land in reading order,
// ambiguity takes the standard reading.
export function convertPrompt(params: { firstPage: number; lastPage: number; pageCount: number }): string {
  const range =
    params.firstPage === params.lastPage
      ? `page ${params.firstPage}`
      : `pages ${params.firstPage}-${params.lastPage}`;
  return [
    `The attached images are ${range} of a ${params.pageCount}-page handwritten document, in order. Transcribe them into text blocks.`,
    "",
    "1. Transcribe the words exactly as written. Never paraphrase, summarize, complete, or correct the author's wording. Expand an abbreviation only when the expansion is written on the page.",
    "2. Crossed-out text was deleted by the author: leave it out. The replacement written beside or above it is the text. A correction in another ink color is the author's final version.",
    "3. A margin note, an arrow, or an insertion mark says where its text belongs: put the text there, in reading order. Never describe the arrow.",
    "4. Imitate the formatting: a title or underlined/boxed/larger heading becomes HEADING (level 1-3 by prominence); bulleted, dashed, or numbered lines become LIST; a drawn grid of rows and columns becomes TABLE; a standalone mathematical expression becomes EQUATION; everything else becomes PARAGRAPH.",
    '5. LIST text: one line per item, each line starting with "- " (or "1. " for numbered items), two leading spaces per nesting level.',
    "6. TABLE text: one line per row, cells separated by tabs. The first row is the header row when the notes have one.",
    "7. EQUATION text: the expression as LaTeX that KaTeX renders — standard math commands and amsmath environments (aligned, cases, pmatrix, bmatrix) only; no packages, no custom macros, no $ delimiters. Math inside a sentence stays inside the PARAGRAPH text as the symbols the author wrote.",
    "8. A drawing, diagram, or sketch that words cannot carry becomes a PARAGRAPH describing it in one sentence, wrapped in brackets: [Drawing: …]. Transcribe its labels verbatim inside the description.",
    "9. Illegible words become [illegible]. Never guess a word you cannot read. A symbol you can read that has two readings takes the mathematically standard one in context.",
    "10. Keep the pages' order. Set each block's page to the page the content is on. A paragraph continuing across a page break is one block on the page it starts.",
    "11. Write in the notes' language.",
    "",
    'Return ONLY JSON: {"blocks": [{"type": "HEADING" | "PARAGRAPH" | "LIST" | "TABLE" | "EQUATION", "level": 1, "page": 1, "text": "…"}]}. level only on HEADING.',
  ].join("\n");
}

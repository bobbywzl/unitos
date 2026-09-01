// Conversion (SPEC.md §14): handwritten pages → text blocks. The attached
// images are consecutive pages of a handwritten document; the model transcribes
// them into blocks that imitate the notes' formatting. Runs as a background
// job through lib/handwritten/convert.ts, not through /api/derive — like the
// connect scan.
export function convertPrompt(params: { firstPage: number; lastPage: number; pageCount: number }): string {
  const range =
    params.firstPage === params.lastPage
      ? `page ${params.firstPage}`
      : `pages ${params.firstPage}-${params.lastPage}`;
  return [
    `The attached images are ${range} of a ${params.pageCount}-page handwritten document, in order. Transcribe them into text blocks.`,
    "",
    "1. Transcribe the words exactly as written. Never paraphrase, summarize, complete, or correct the author's wording. Expand an abbreviation only when the expansion is written on the page.",
    "2. Imitate the formatting: a title or underlined/boxed/larger heading becomes HEADING (level 1-3 by prominence); bulleted, dashed, or numbered lines become LIST; a drawn grid of rows and columns becomes TABLE; a standalone mathematical expression becomes EQUATION; everything else becomes PARAGRAPH.",
    '3. LIST text: one line per item, each line starting with "- " (or "1. " for numbered items), two leading spaces per nesting level.',
    "4. TABLE text: one line per row, cells separated by tabs. The first row is the header row when the notes have one.",
    "5. EQUATION text: the expression as LaTeX, nothing else.",
    "6. A drawing, diagram, or sketch that words cannot carry becomes a PARAGRAPH describing it in one sentence, wrapped in brackets: [Drawing: …]. Transcribe its labels verbatim inside the description.",
    "7. Illegible words become [illegible]. Never guess a word you cannot read.",
    "8. Keep the pages' order. Set each block's page to the page the content is on. A paragraph continuing across a page break is one block on the page it starts.",
    "9. Write in the notes' language.",
    "",
    'Return ONLY JSON: {"blocks": [{"type": "HEADING" | "PARAGRAPH" | "LIST" | "TABLE" | "EQUATION", "level": 1, "page": 1, "text": "…"}]}. level only on HEADING.',
  ].join("\n");
}

// A scan (SPEC.md §16): printed or typed pages whose PDF has no usable text
// layer — a scanned book, a photocopied article, a typed letter. The attached
// images are consecutive pages; the model reads the words off them into text
// blocks that keep the print's structure. Runs inside the add through
// lib/handwritten/convert.ts (transcribePages), not through /api/derive.
// Same output as conversion (lib/prompts/convert.ts).
export function scanPrompt(params: { firstPage: number; lastPage: number; pageCount: number }): string {
  const range =
    params.firstPage === params.lastPage
      ? `page ${params.firstPage}`
      : `pages ${params.firstPage}-${params.lastPage}`;
  return [
    `The attached images are ${range} of a ${params.pageCount}-page scan of printed text, in order. Transcribe them into text blocks.`,
    "",
    "1. Transcribe the words exactly as printed. Never paraphrase, summarize, complete, translate, or correct the wording.",
    "2. Leave out the page's furniture: running heads, running feet, page numbers, and marks from the scanner or the photocopier.",
    "3. A word broken by a hyphen at a line end is one word: write it whole. A hyphen that belongs to the word stays.",
    "4. One block per printed paragraph: join the lines of a paragraph into one text. A paragraph continuing across a page break is one block on the page it starts.",
    "5. Keep the structure: a chapter, part, or section title becomes HEADING (level 1-3 by prominence); bulleted or numbered lines become LIST; a table of rows and columns becomes TABLE; a standalone formula becomes EQUATION; everything else becomes PARAGRAPH. A section number printed before a passage (\"12.\", \"§ 4\") stays at the start of its paragraph.",
    '6. LIST text: one line per item, each line starting with "- " (or "1. " for numbered items), two leading spaces per nesting level.',
    "7. TABLE text: one line per row, cells separated by tabs. The first row is the header row when the table has one.",
    "8. EQUATION text: the expression as LaTeX that KaTeX renders — standard math commands and amsmath environments only; no packages, no custom macros, no $ delimiters.",
    "9. A footnote becomes a PARAGRAPH after the paragraph that ends the page, starting with its mark as printed (\"1 \", \"* \"). The mark in the text stays where it is printed.",
    "10. A picture or a drawing becomes a PARAGRAPH describing it in one sentence, wrapped in brackets: [Figure: …]. Its caption follows as printed.",
    "11. A word the scan made unreadable becomes [illegible]. Never guess a word you cannot read.",
    "12. Keep the pages' order. Set each block's page to the page the content is on.",
    "13. Write in the print's language.",
    "",
    'Return ONLY JSON: {"blocks": [{"type": "HEADING" | "PARAGRAPH" | "LIST" | "TABLE" | "EQUATION", "level": 1, "page": 1, "text": "…"}]}. level only on HEADING.',
  ].join("\n");
}

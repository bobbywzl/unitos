// Import PDF classification (SPEC.md §16): the attached images are sample
// pages of an uploaded PDF. The model judges whether the PDF is a computer-text
// article (parse to text blocks) or handwritten notes and drawings (keep the
// pages). Runs only when text extraction yielded little or junk — a PDF with a
// real text layer is an article without asking.
export function classifyPrompt(params: {
  pageCount: number;
  textChars: number;
  junk: boolean;
}): string {
  return [
    `The attached images are sample pages of an uploaded PDF (${params.pageCount} pages). Text extraction yielded ${params.textChars} characters across the whole PDF.` +
      (params.junk
        ? " The extracted text is garbled — long runs of letters with no word breaks, the mark of a handwriting app's embedded recognition output."
        : ""),
    "",
    "Decide what this PDF is:",
    '- "article": typeset computer text — a paper, report, book, slides, or a scan of printed text whose text layer captured the content.',
    '- "handwritten": rough handwritten notes, drawings, sketches, whiteboard or notebook photos, or scanned pages whose content the text layer missed or garbled.',
    "Judge from what is on the pages, not from the character count alone. Mixed pages count as handwritten when the handwriting or drawings carry the content.",
    "",
    'Return ONLY JSON: {"kind": "article" | "handwritten"}',
  ].join("\n");
}

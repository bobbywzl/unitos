// Import PDF classification (SPEC.md §16): the attached images are sample
// pages of an uploaded PDF. The model judges whether the PDF is a computer-text
// article (parse the text layer), a scan of print (read the words off the
// pages), or handwritten notes and drawings (keep the pages). Runs only when
// text extraction yielded little or junk — a PDF with a real text layer is an
// article without asking.
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
    '- "article": typeset computer text whose text layer captured the content — a paper, report, book, or slides, made on a computer or scanned with a working text layer.',
    '- "scan": printed or typed pages — a book, an article, a report, a typed letter — scanned or photographed, whose content the text layer missed or garbled. The words must be read off the page.',
    '- "handwritten": rough handwritten notes, drawings, sketches, whiteboard or notebook photos.',
    "Judge from what is on the pages, not from the character count alone. Mixed pages count as handwritten when the handwriting or drawings carry the content. Printed pages with a few handwritten marks in the margin are a scan.",
    "",
    'Return ONLY JSON: {"kind": "article" | "scan" | "handwritten"}',
  ].join("\n");
}

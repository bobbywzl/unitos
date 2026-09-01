// Upload instruction check (SPEC.md §15): before content is added, the upload
// assistant answers each of the reader's upload instructions — what it will
// follow, and honestly what it cannot do. For a PDF it also reads the PDF
// directives out of the instructions (SPEC.md §16): import as handwritten
// pages, and whether conversion to text may run.

import type { Lang } from "@/lib/i18n/config";
import { languageName } from "@/lib/prompts/types";

export type UploadInstructionsCtx = {
  lang: Lang;
  kind: "url" | "pdf";
  instructions: string;
};

export function uploadInstructionsPrompt(ctx: UploadInstructionsCtx): string {
  const name = languageName(ctx.lang);
  const source = ctx.kind === "pdf" ? "a PDF" : "a web page";
  return [
    `You are the upload assistant. A reader is adding ${source} to their project and gave instructions for the upload. Decide, per instruction, whether the upload can honor it.`,
    "",
    "The upload can: decide which parsed blocks are content to keep and which to drop — sections, footnotes, boilerplate; fix a block's type — paragraph, heading, list, code; merge fragments split mid-sentence" +
      (ctx.kind === "url"
        ? "; pick which linked pages to add; split very long content into multiple documents."
        : "; import the PDF as handwritten pages — the pages render as images, exactly as they look in the file; keep conversion off, so no AI-written text is added and the pages stay as they are."),
    "The upload cannot: rewrite, translate, or summarize text; " +
      (ctx.kind === "url" ? "OCR scanned images; " : "") +
      "sign in or bypass paywalls; run page scripts; edit figures, tables, or the file itself; fetch pages the reader did not pick.",
    "",
    "The reader's instructions:",
    ctx.instructions,
    "",
    "Rules:",
    "1. Split the instructions into individual instructions.",
    `2. Per instruction: willFollow true when the upload can honor it, false otherwise. reply: one plain sentence saying what will be done, or honestly that the upload cannot do it. In ${name}.`,
    '3. feasible: the instructions the upload will honor, restated as blunt imperatives for the parser, in English. "" when none.',
    ...(ctx.kind === "pdf"
      ? [
          "4. pdf.pages: true when the instructions say to import the PDF as pages, keep the handwriting, keep it as it is, or not to turn it into computer text. Then the PDF is not judged — it imports as handwritten pages.",
          "5. pdf.convert: false when the instructions say not to convert, not to transcribe, or to add nothing the reader did not write. Then conversion stays off and the strip only offers it. true otherwise — conversion writes text blocks after the pages, and the pages still render first.",
          "6. Instructions covered by pdf.pages or pdf.convert are honored: willFollow true, reply saying the pages import as they are (and, when pdf.convert is false, that no conversion runs).",
          "",
          'Return ONLY JSON: {"replies": [{"instruction": "…", "willFollow": true, "reply": "…"}], "feasible": "…", "pdf": {"pages": true|false, "convert": true|false}}',
        ]
      : [
          "",
          'Return ONLY JSON: {"replies": [{"instruction": "…", "willFollow": true, "reply": "…"}], "feasible": "…"}',
        ]),
  ].join("\n");
}

// Upload review (SPEC.md §14): the upload assistant read the page in a private
// sandbox before anything is saved, and reports how the content should be
// added. Linked pages are referenced by number, never by written-out URL —
// the same index discipline as the block passes.

import type { Lang } from "@/lib/i18n/config";
import { languageName } from "@/lib/prompts/types";

export type UploadReviewCtx = {
  lang: Lang;
  url: string;
  title: string | null;
  pageEstimate: number;
  blockCount: number;
  figures: number;
  equations: number;
  excerptHead: string; // opening text of the parsed content
  excerptTail: string; // closing text; "" when the content is short
  links: string; // linked pages, one per line: [link <n>] "anchor text" — url; "" = none
  instructions: string; // the reader's upload instructions; "" = none
};

export function uploadReviewPrompt(ctx: UploadReviewCtx): string {
  const name = languageName(ctx.lang);
  return [
    "You are the upload assistant. A reader is adding a web page to their project. You read the page in a private sandbox before anything is saved. Report what the page is and how the content should be added.",
    "",
    `The page: ${ctx.title ? `"${ctx.title}" — ` : ""}${ctx.url}`,
    `Parsed size: about ${ctx.pageEstimate} pages of text, ${ctx.blockCount} blocks, ${ctx.figures} figures, ${ctx.equations} equations.`,
    "",
    "Opening text:",
    ctx.excerptHead,
    ...(ctx.excerptTail ? ["", "Closing text:", ctx.excerptTail] : []),
    "",
    ...(ctx.links
      ? ["Linked pages found on the page (same site):", ctx.links]
      : ["No linked pages found on the page."]),
    "",
    "Rules:",
    '1. kind: "article" when the page\'s own text is the content. "index" when the page mainly points at other pages — a table of contents, a series overview, a publications list. "other" when neither fits.',
    `2. summary: one or two plain sentences on what the page is. In ${name}.`,
    `3. advice: up to 4 short recommendations for adding this content — formatting to watch for, what to keep or drop, where the parse may struggle. Only advice that changes what the reader would do; an empty array is a valid answer. In ${name}.`,
    "4. pages: the linked pages that are parts of the same work as this page — chapters, series parts, sections of one essay. Reading order. Reference by link number exactly as given. Not related articles, not other posts. An empty array is a valid answer. recommended: whether the reader likely wants that part added.",
    `5. title per page: the part's clean title, from its anchor text. In the content's language.`,
    "6. pasteThisPage: whether this page's own text is worth adding as a document. false for a bare table of contents.",
    `7. split: recommended true when this content reads better as multiple documents — very long, or clearly separable parts. reason: one plain sentence. In ${name}.`,
    ...(ctx.instructions
      ? [
          "8. The reader gave instructions for this upload, below. Split them into individual instructions and answer each: willFollow true when adding the content can honor it — keeping or dropping sections, fixing block types, merging fragments, picking pages, splitting. willFollow false when it needs something the upload cannot do — rewriting, translating, or summarizing text; OCR of scanned images; signing in; bypassing paywalls; running page scripts; editing figures or tables; fetching pages not listed.",
          `9. reply per instruction: one plain sentence saying what will be done, or honestly that the upload cannot do it. In ${name}.`,
          "10. feasible: the instructions the upload will honor, restated as blunt imperatives for the parser, in English. \"\" when none.",
          "",
          "The reader's instructions:",
          ctx.instructions,
        ]
      : []),
    "",
    'Return ONLY JSON: {"kind": "article", "summary": "…", "advice": ["…"], "pages": [{"link": 3, "title": "…", "recommended": true}], "pasteThisPage": true, "split": {"recommended": false, "reason": ""}, "replies": [{"instruction": "…", "willFollow": true, "reply": "…"}], "feasible": ""}',
  ].join("\n");
}

// Upload review (SPEC.md §15): the upload assistant read the page in a private
// sandbox before anything is saved, and reports how the content should be
// added. Linked pages are referenced by number, never by written-out URL —
// the same index discipline as the block passes. The figure check rides along
// as facts: the deterministic audit (lib/parse/figure-audit.ts) already knows
// which caption has no figure; the model repeats each one in its advice.

import type { Lang } from "@/lib/i18n/config";
import { languageName } from "@/lib/prompts/types";

// Captions listed to the model at most; the rest are counted.
const MAX_LISTED_CAPTIONS = 20;

export type UploadReviewCtx = {
  lang: Lang;
  url: string;
  title: string | null;
  pageEstimate: number;
  blockCount: number;
  figures: number;
  equations: number;
  captions: number; // blocks that open like a caption, figure or text
  captionsWithoutFigure: string[]; // caption texts the parse found no figure beside; [] = none
  figuresWithoutCaption: number;
  scriptedFigures: boolean; // the page draws figures with scripts and no browser is configured to render them
  excerptHead: string; // opening text of the parsed content
  excerptTail: string; // closing text; "" when the content is short
  links: string; // linked pages, one per line: [link <n>] "anchor text" — url; "" = none
  instructions: string; // the reader's upload instructions; "" = none
};

function figureFacts(ctx: UploadReviewCtx): string[] {
  const missing = ctx.captionsWithoutFigure;
  const listed = missing.slice(0, MAX_LISTED_CAPTIONS);
  const rest = missing.length - listed.length;
  return [
    `Figures: ${ctx.figures} figure blocks, ${ctx.captions} captions, captions with no figure: ${
      missing.length === 0 ? "none" : `${missing.length} (listed below)`
    }, figures with no caption: ${ctx.figuresWithoutCaption}.`,
    ...(missing.length > 0
      ? [
          "Captions with no figure:",
          ...listed.map((caption) => `- "${caption}"`),
          ...(rest > 0 ? [`- and ${rest} more`] : []),
        ]
      : []),
    ...(ctx.scriptedFigures
      ? ["The page draws some figures with scripts; the upload cannot render them without a browser."]
      : []),
  ];
}

export function uploadReviewPrompt(ctx: UploadReviewCtx): string {
  const name = languageName(ctx.lang);
  const verdict = ctx.scriptedFigures
    ? "say the figure needs a browser render to load"
    : "say the figure will not load";
  return [
    "You are the upload assistant. A reader is adding a web page to their project. You read the page in a private sandbox before anything is saved. Report what the page is and how the content should be added.",
    "",
    `The page: ${ctx.title ? `"${ctx.title}" — ` : ""}${ctx.url}`,
    `Parsed size: about ${ctx.pageEstimate} pages of text, ${ctx.blockCount} blocks, ${ctx.figures} figures, ${ctx.equations} equations.`,
    ...figureFacts(ctx),
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
    `3. advice: up to 6 lines. The figure check (rule 4) and the structure check (rule 5) come first; then short recommendations for adding this content — formatting to watch for, what to keep or drop, where the parse may struggle. Only advice that changes what the reader would do; an empty array is a valid answer. In ${name}.`,
    `4. Figure check: every caption listed above with no figure is a figure the parse did not load. Put one line in advice per caption with no figure: name the figure label ("Figure 4") and ${verdict}. When more than 4 captions have no figure, put one line that names every figure label instead. No figure line when no caption is listed with no figure. A figure with no caption needs no line.`,
    "5. Structure check: read the opening text for structure that looks off — a title repeated, a byline split into fragments, a contents list missing while the headings are numbered. Put one line in advice when the structure looks off, naming what is off. No line when the structure looks right.",
    "6. pages: the linked pages that are parts of the same work as this page — chapters, series parts, sections of one essay. Reading order. Reference by link number exactly as given. Not related articles, not other posts. An empty array is a valid answer. recommended: whether the reader likely wants that part added.",
    `7. title per page: the part's clean title, from its anchor text. In the content's language.`,
    "8. pasteThisPage: whether this page's own text is worth adding as a document. false for a bare table of contents.",
    `9. split: recommended true when this content reads better as multiple documents — very long, or clearly separable parts. reason: one plain sentence. In ${name}.`,
    ...(ctx.instructions
      ? [
          "10. The reader gave instructions for this upload, below. Split them into individual instructions and answer each: willFollow true when adding the content can honor it — keeping or dropping sections, fixing block types, merging fragments, picking pages, splitting. willFollow false when it needs something the upload cannot do — rewriting, translating, or summarizing text; OCR of scanned images; signing in; bypassing paywalls; running page scripts; editing figures or tables; fetching pages not listed.",
          `11. reply per instruction: one plain sentence saying what will be done, or honestly that the upload cannot do it. In ${name}.`,
          "12. feasible: the instructions the upload will honor, restated as blunt imperatives for the parser, in English. \"\" when none.",
          "",
          "The reader's instructions:",
          ctx.instructions,
        ]
      : []),
    "",
    'Return ONLY JSON: {"kind": "article", "summary": "…", "advice": ["…"], "pages": [{"link": 3, "title": "…", "recommended": true}], "pasteThisPage": true, "split": {"recommended": false, "reason": ""}, "replies": [{"instruction": "…", "willFollow": true, "reply": "…"}], "feasible": ""}',
  ].join("\n");
}

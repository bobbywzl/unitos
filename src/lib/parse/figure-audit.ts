import type { ParsedBlock } from "@/lib/parse/types";

// The figure audit (SPEC.md §15): a deterministic check of a parsed block
// list against the figures the page describes. A caption that reached the
// block list as text with no FIGURE beside it is a figure the parse lost; a
// FIGURE whose text is only "Figure" has no caption. The upload assistant
// reports the audit before anything is saved, the progress card carries its
// counts, and the review reads it again on Review again.

// "Figure 2.", "Fig. 3:", "Figure 6.1", "Table 4", "图 2", "表 1" — a caption's
// opening label.
const CAPTION_LABEL_RX =
  /^(?:(?:figure|fig\.?|table|chart|plate|exhibit|diagram|image|photo|illustration|listing|scheme)\s*\d+(?:\.\d+)*[a-z]?|[图表]\s*\d+(?:\.\d+)*)\s*[.:)\]—–-]?(?:\s|$)/i;

/** Does this text open like a figure or table caption? */
export function isFigureCaption(text: string): boolean {
  return CAPTION_LABEL_RX.test(text.trim());
}

/** The caption's label alone ("Figure 6.1"), for reports. */
export function captionLabel(text: string): string | null {
  const m = /^(?:(?:figure|fig\.?|table|chart|plate|exhibit|diagram|image|photo|illustration|listing|scheme)\s*\d+(?:\.\d+)*[a-z]?|[图表]\s*\d+(?:\.\d+)*)/i.exec(text.trim());
  return m ? m[0].replace(/\s+/g, " ") : null;
}

export type FigureAudit = {
  // FIGURE blocks in the list.
  figures: number;
  // Blocks whose text opens like a caption: FIGURE blocks with a caption, and
  // text blocks that are a caption on their own.
  captions: number;
  // Caption texts that stand as text blocks with no FIGURE directly before or
  // after them: figures the parse did not load.
  captionsWithoutFigure: string[];
  // FIGURE blocks with no caption of their own ("Figure", or an alt text).
  figuresWithoutCaption: number;
};

function hasMedia(block: ParsedBlock): boolean {
  return block.type === "FIGURE" && (block.html === undefined || /<(?:img|video|iframe|svg)\b/i.test(block.html));
}

/** Audit a block list: which captions have their figure, which do not. */
export function auditFigures(blocks: ParsedBlock[]): FigureAudit {
  const audit: FigureAudit = { figures: 0, captions: 0, captionsWithoutFigure: [], figuresWithoutCaption: 0 };
  blocks.forEach((block, i) => {
    if (block.type === "FIGURE") {
      audit.figures += 1;
      if (isFigureCaption(block.text)) audit.captions += 1;
      else {
        // A caption block right beside the figure captions it.
        const beside = [blocks[i - 1], blocks[i + 1]].some(
          (b) => b !== undefined && b.type !== "FIGURE" && isFigureCaption(b.text),
        );
        if (!beside) audit.figuresWithoutCaption += 1;
      }
      return;
    }
    if (block.type !== "PARAGRAPH" && block.type !== "HEADING") return;
    if (!isFigureCaption(block.text)) return;
    audit.captions += 1;
    const beside = [blocks[i - 1], blocks[i + 1]].some((b) => b !== undefined && hasMedia(b));
    if (!beside) audit.captionsWithoutFigure.push(block.text.trim());
  });
  return audit;
}

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
  // Captions in the list: every caption line of a FIGURE's text (a figure
  // row carries one per column), and text blocks that are a caption on
  // their own.
  captions: number;
  // Caption texts that stand as text blocks with no FIGURE directly before or
  // after them: figures the parse did not load.
  captionsWithoutFigure: string[];
  // FIGURE blocks with no caption of their own ("Figure", or an alt text).
  figuresWithoutCaption: number;
};

// A parsed block or a stored Block row: both audit alike.
export type AuditBlock = { type: string; text: string; html?: string | null };

function hasMedia(block: AuditBlock): boolean {
  return block.type === "FIGURE" && (block.html == null || /<(?:img|video|iframe|svg)\b/i.test(block.html));
}

// A text block that opens like a caption with no figure beside it.
function isCaptionGap(blocks: AuditBlock[], i: number): boolean {
  const block = blocks[i];
  if (block.type !== "PARAGRAPH" && block.type !== "HEADING") return false;
  if (!isFigureCaption(block.text)) return false;
  return ![blocks[i - 1], blocks[i + 1]].some((b) => b !== undefined && hasMedia(b));
}

/** The captions left without their figure, with their blocks: the reader
    marks each figure's place while a browser render tries to bring it over
    (components/reader/figure-capture.tsx). */
export function captionGaps<B extends AuditBlock & { id: string }>(blocks: B[]): { id: string; label: string }[] {
  return blocks.flatMap((block, i) =>
    isCaptionGap(blocks, i) ? [{ id: block.id, label: captionLabel(block.text) ?? block.text.trim().slice(0, 24) }] : [],
  );
}

/** The caption lines of a figure's text. */
function captionLines(block: ParsedBlock): number {
  return block.text.split("\n").filter((line) => isFigureCaption(line)).length;
}

/** Audit a block list: which captions have their figure, which do not. */
export function auditFigures(blocks: ParsedBlock[]): FigureAudit {
  const audit: FigureAudit = { figures: 0, captions: 0, captionsWithoutFigure: [], figuresWithoutCaption: 0 };
  blocks.forEach((block, i) => {
    if (block.type === "FIGURE") {
      audit.figures += 1;
      const lines = captionLines(block);
      if (lines > 0) audit.captions += lines;
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
    if (isCaptionGap(blocks, i)) audit.captionsWithoutFigure.push(block.text.trim());
  });
  return audit;
}

import { JEV_MODEL, jevEnabled, mapLimit, systemOne } from "@/lib/jev";
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

/** A figure with something to show: an image, a video, an embed, or an SVG
    (a PDF figure's html is null and its media is the page render). The
    parse passes never drop one, whatever the model says (structure.ts,
    layout.ts). */
export function hasMedia(block: AuditBlock): boolean {
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

// The caption check on Jev (SPEC.md §15): the label regex knows "Figure 2",
// "Table 4", "图 3"; a caption in another language or another form ("The
// pipeline, end to end.", "Source: ...", "Abb. 4") reaches the block list
// as a text block and the audit misses it. With Jev configured, every short
// text block the regex passed over and no figure stands beside is asked
// one yes/no — is this line a caption — and the ones Jev is sure of count
// as captions without their figure. The threshold is high: a false yes
// keeps the upload box open for a figure that never was.
const CAPTION_MIN = 0.8;
const CANDIDATE_MAX_CHARS = 240;
const CANDIDATE_MIN_CHARS = 8;
const CANDIDATES_MAX = 400;
const CHUNK = 32;
const PARALLEL = 4;

/** The audit, then Jev over the lines the regex passed over. Without Jev,
    or when Jev fails, the deterministic audit alone. */
export async function auditFiguresWithJev(blocks: ParsedBlock[], title: string | null): Promise<FigureAudit> {
  const audit = auditFigures(blocks);
  if (!jevEnabled()) return audit;
  const candidates = blocks.flatMap((block, i) => {
    if (block.type !== "PARAGRAPH" && block.type !== "HEADING") return [];
    const text = block.text.trim();
    if (text.length < CANDIDATE_MIN_CHARS || text.length > CANDIDATE_MAX_CHARS) return [];
    if (isFigureCaption(text)) return [];
    if ([blocks[i - 1], blocks[i + 1]].some((b) => b !== undefined && hasMedia(b))) return [];
    return [{ n: i, text }];
  });
  if (candidates.length === 0) return audit;
  const chunks: { n: number; text: string }[][] = [];
  for (let i = 0; i < Math.min(candidates.length, CANDIDATES_MAX); i += CHUNK) chunks.push(candidates.slice(i, i + CHUNK));
  const found: string[] = [];
  await mapLimit(chunks, PARALLEL, async (chunk) => {
    const result = await systemOne({
      state: { document: title ?? "", lines: chunk.map((c) => ({ n: c.n, text: c.text })) },
      questions: Object.fromEntries(
        chunk.map((c) => [
          `line_${c.n}`,
          {
            type: "noul" as const,
            instructions: `Line ${c.n} is a caption: a label or a description of a figure, table, chart, or picture that stands with it, not a sentence of the running text.`,
            criteria: {
              true: "The line names or describes a figure, table, chart, or picture, or credits its source.",
              false: "The line is a sentence, a heading, a list item, or a note of the running text.",
            },
          },
        ]),
      ),
      usage: { userId: null, feature: "figure-audit", model: JEV_MODEL },
      label: "FIGURE_AUDIT",
    });
    if (!result.ok) {
      console.warn("[figure-audit] jev failed:", result.error);
      return;
    }
    for (const c of chunk) {
      const a = result.answers[`line_${c.n}`];
      if (a?.type === "noul" && a.noul >= CAPTION_MIN) found.push(c.text);
    }
  });
  if (found.length === 0) return audit;
  return {
    ...audit,
    captions: audit.captions + found.length,
    captionsWithoutFigure: [...audit.captionsWithoutFigure, ...found],
  };
}

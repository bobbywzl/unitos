import { z } from "zod";
import { resolveAnchor, type AnchorInput, type ResolvedAnchor } from "@/lib/anchors/resolve";

// A passage (SPEC.md §5): one selection over one or more blocks, in reading
// order. The reader sends the first block's anchor as `anchor` and, when the
// selection crossed blocks, every block's anchor as `segments` — the first
// segment is the anchor. Each segment resolves through the ladder on its own;
// the segments that resolve are the passage, and every one becomes a source
// of the note, so the note's marks cover the whole selection.

export const anchorInputSchema = z.object({
  blockId: z.string().min(1),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(0),
  // The quote selectors (SPEC.md §5): when the block id or the offsets no
  // longer match — a re-parse gave the blocks new ids, an edit moved the
  // words — the quote re-finds the selection in the document.
  quotedText: z.string().max(10_000).optional(),
  prefix: z.string().max(64).optional(),
  suffix: z.string().max(64).optional(),
});

// Blocks a selection may cross, at most.
export const MAX_SEGMENTS = 40;

export const segmentsSchema = z.array(anchorInputSchema).min(1).max(MAX_SEGMENTS).optional();

/** The passage's segments, resolved: every segment that resolves, one per
    block, in the document's block order. Empty when none resolves. */
export function resolvePassage(
  blocks: { id: string; text: string }[],
  anchor: AnchorInput,
  segments: AnchorInput[] | undefined,
): ResolvedAnchor[] {
  const order = new Map(blocks.map((b, i) => [b.id, i]));
  const byBlock = new Map<string, ResolvedAnchor>();
  for (const segment of segments && segments.length > 0 ? segments : [anchor]) {
    if (segment.endOffset <= segment.startOffset) continue;
    const resolved = resolveAnchor(blocks, segment);
    if (resolved && !byBlock.has(resolved.blockId)) byBlock.set(resolved.blockId, resolved);
  }
  return [...byBlock.values()].sort((a, b) => (order.get(a.blockId) ?? 0) - (order.get(b.blockId) ?? 0));
}

/** The passage's text: the segments' quotes, one paragraph each. */
export function passageText(segments: { quotedText: string }[]): string {
  return segments.map((s) => s.quotedText).join("\n\n");
}

/** The source rows a note gets for the passage. */
export function passageSources(documentId: string, segments: ResolvedAnchor[]) {
  return segments.map((s) => ({
    documentId,
    blockId: s.blockId,
    startOffset: s.startOffset,
    endOffset: s.endOffset,
    quotedText: s.quotedText,
    prefix: s.prefix,
    suffix: s.suffix,
  }));
}

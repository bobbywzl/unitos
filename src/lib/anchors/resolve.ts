import type { Source } from "@prisma/client";
import { db } from "@/lib/db";
import { matchInText } from "@/lib/anchors/match";

export type ResolvedSource = {
  id: string;
  noteId: string;
  blockId: string;
  start: number;
  end: number;
  orphaned: boolean;
};

// Resolve every source anchored in a document. Ladder per source (SPEC.md §5):
// 1. Stored blockId + offsets still match quotedText → keep.
// 2. Re-find the quote inside the stored block.
// 3. Re-find the quote across all blocks (handles re-parse with new block ids).
// 4. Give up → orphaned, quoted text preserved. Never silently drop.
// Rebinds and orphan flags are written back so resolution self-heals.
export async function resolveDocumentSources(documentId: string): Promise<ResolvedSource[]> {
  const [sources, blocks] = await Promise.all([
    db.source.findMany({ where: { documentId } }),
    db.block.findMany({
      where: { documentId },
      orderBy: { order: "asc" },
      select: { id: true, type: true, text: true },
    }),
  ]);
  const blockById = new Map(blocks.map((b) => [b.id, b]));

  const resolved: ResolvedSource[] = [];
  const writes: ReturnType<typeof db.source.update>[] = [];

  for (const source of sources) {
    // Video anchor (SPEC.md §11): a time range, not a text span. It skips the
    // text ladder and never orphans — the video file never changes.
    if (source.startTime !== null) {
      resolved.push({
        id: source.id,
        noteId: source.noteId,
        blockId: source.blockId,
        start: source.startOffset,
        end: source.endOffset,
        orphaned: false,
      });
      continue;
    }
    // Page anchor (SPEC.md §14): a drawn region on a PAGE block, not a text
    // span. It skips the text ladder — pages never change. When the PAGE
    // blocks were rebuilt (shape switch), the quoted text "Page N" re-finds
    // the page under its new id; only a document with no such page orphans.
    if (source.region !== null) {
      let blockId = source.blockId;
      let orphaned = blockById.get(source.blockId)?.type !== "PAGE";
      if (orphaned) {
        const match = blocks.find((b) => b.type === "PAGE" && b.text === source.quotedText);
        if (match) {
          blockId = match.id;
          orphaned = false;
        }
      }
      resolved.push({
        id: source.id,
        noteId: source.noteId,
        blockId,
        start: source.startOffset,
        end: source.endOffset,
        orphaned,
      });
      if (orphaned !== source.orphaned || blockId !== source.blockId) {
        writes.push(
          db.source.update({ where: { id: source.id }, data: { blockId, orphaned } }),
        );
      }
      continue;
    }
    const r = resolveOne(source, blockById, blocks);
    resolved.push({ id: source.id, noteId: source.noteId, ...r });
    const changed =
      r.orphaned !== source.orphaned ||
      r.blockId !== source.blockId ||
      r.start !== source.startOffset ||
      r.end !== source.endOffset;
    if (changed) {
      writes.push(
        db.source.update({
          where: { id: source.id },
          data: {
            blockId: r.blockId,
            startOffset: r.start,
            endOffset: r.end,
            orphaned: r.orphaned,
          },
        }),
      );
    }
  }
  if (writes.length > 0) await db.$transaction(writes);
  return resolved;
}

function resolveOne(
  source: Source,
  blockById: Map<string, { id: string; text: string }>,
  blocks: { id: string; text: string }[],
): { blockId: string; start: number; end: number; orphaned: boolean } {
  const selector = {
    quotedText: source.quotedText,
    prefix: source.prefix,
    suffix: source.suffix,
  };
  const stored = blockById.get(source.blockId);

  if (stored && stored.text.slice(source.startOffset, source.endOffset) === source.quotedText) {
    return {
      blockId: source.blockId,
      start: source.startOffset,
      end: source.endOffset,
      orphaned: false,
    };
  }
  if (stored) {
    const hit = matchInText(stored.text, selector);
    if (hit) return { blockId: stored.id, ...hit, orphaned: false };
  }
  for (const block of blocks) {
    if (stored && block.id === stored.id) continue;
    const hit = matchInText(block.text, selector);
    if (hit) return { blockId: block.id, ...hit, orphaned: false };
  }
  return {
    blockId: source.blockId,
    start: source.startOffset,
    end: source.endOffset,
    orphaned: true,
  };
}

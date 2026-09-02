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

// An anchor as the reader captured it (SPEC.md §5): the position, plus the
// quote selectors when the caller has them.
export type AnchorInput = {
  blockId: string;
  startOffset: number;
  endOffset: number;
  quotedText?: string;
  prefix?: string;
  suffix?: string;
};

// An anchor that resolved: the position in the document as it is now, with
// the quote and its context re-read from that block, ready to store.
export type ResolvedAnchor = {
  blockId: string;
  startOffset: number;
  endOffset: number;
  quotedText: string;
  prefix: string;
  suffix: string;
};

const CONTEXT = 32; // prefix/suffix length (SPEC.md §5)

// Resolve one anchor against a document's blocks. The ladder (SPEC.md §5):
// 1. blockId + offsets still slice the quote → keep.
// 2. Re-find the quote inside the stored block (an edit moved the words).
// 3. Re-find the quote across all blocks (a re-parse gave every block a new
//    id; an open reader still sends the old ones).
// 4. Nothing → null. Never a guess.
// Without a quote, the offsets stand only while they slice non-empty text.
export function resolveAnchor(
  blocks: { id: string; text: string }[],
  anchor: AnchorInput,
): ResolvedAnchor | null {
  const stored = blocks.find((b) => b.id === anchor.blockId);
  const quote = anchor.quotedText ?? "";
  if (stored) {
    const sliced = stored.text.slice(anchor.startOffset, anchor.endOffset);
    if (quote ? sliced === quote : sliced.trim() !== "") {
      return captured(stored, anchor.startOffset, anchor.endOffset);
    }
  }
  if (!quote) return null;
  const selector = { quotedText: quote, prefix: anchor.prefix ?? "", suffix: anchor.suffix ?? "" };
  if (stored) {
    const hit = matchInText(stored.text, selector);
    if (hit) return captured(stored, hit.start, hit.end);
  }
  for (const block of blocks) {
    if (stored && block.id === stored.id) continue;
    const hit = matchInText(block.text, selector);
    if (hit) return captured(block, hit.start, hit.end);
  }
  return null;
}

function captured(block: { id: string; text: string }, start: number, end: number): ResolvedAnchor {
  return {
    blockId: block.id,
    startOffset: start,
    endOffset: end,
    quotedText: block.text.slice(start, end),
    prefix: block.text.slice(Math.max(0, start - CONTEXT), start),
    suffix: block.text.slice(end, end + CONTEXT),
  };
}

// A document's blocks in reading order, the shape resolveAnchor reads.
export function documentBlocks(documentId: string): Promise<{ id: string; text: string }[]> {
  return db.block.findMany({
    where: { documentId },
    orderBy: { order: "asc" },
    select: { id: true, text: true },
  });
}

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
    // Page anchor (SPEC.md §16): a drawn region on a PAGE block, not a text
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
    const r = resolveOne(source, blocks);
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
  blocks: { id: string; text: string }[],
): { blockId: string; start: number; end: number; orphaned: boolean } {
  const hit = resolveAnchor(blocks, source);
  if (hit) return { blockId: hit.blockId, start: hit.startOffset, end: hit.endOffset, orphaned: false };
  return {
    blockId: source.blockId,
    start: source.startOffset,
    end: source.endOffset,
    orphaned: true,
  };
}

"use client";

import { BlockView, type BlockData, type Highlight } from "@/components/reader/block-view";

// The reading column: 720px of airy, book-like text (design 1a). The document
// title sits above it as a quiet kicker, not a header bar.
export function Reader({
  title,
  blocks,
  highlightsByBlock,
  swaps,
  onRevertSwap,
}: {
  title: string;
  blocks: BlockData[];
  highlightsByBlock: Record<string, Highlight[]>;
  swaps: Record<string, string>;
  onRevertSwap: (blockId: string) => void;
}) {
  return (
    <article className="reader-prose mx-auto w-[720px] max-w-full px-6 py-11">
      <p className="mb-2.5 text-[11px] font-bold tracking-[0.09em] text-clay-700 uppercase">
        Document · {blocks.length} blocks
      </p>
      <h2 className="mb-[26px] text-[33px]">{title}</h2>
      {blocks.map((block) => (
        <BlockView
          key={block.id}
          block={block}
          highlights={highlightsByBlock[block.id]}
          swap={swaps[block.id]}
          onRevertSwap={onRevertSwap}
        />
      ))}
      {blocks.length === 0 && (
        <p className="text-sm text-sand-600">This document has no blocks. Re-parse it.</p>
      )}
    </article>
  );
}

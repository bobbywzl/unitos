"use client";

import { BlockView, type BlockData, type Highlight } from "@/components/reader/block-view";

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
    <article className="mx-auto max-w-2xl px-8 py-6">
      <h1 className="mb-4 border-b border-neutral-200 pb-3 text-lg font-semibold text-neutral-500 dark:border-neutral-800">
        {title}
      </h1>
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
        <p className="text-sm text-neutral-500">This document has no blocks. Re-parse it.</p>
      )}
    </article>
  );
}

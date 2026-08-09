import { BlockView, type BlockData, type Highlight } from "@/components/reader/block-view";

export function Reader({
  title,
  blocks,
  highlightsByBlock,
}: {
  title: string;
  blocks: BlockData[];
  highlightsByBlock?: Map<string, Highlight[]>;
}) {
  return (
    <article className="mx-auto max-w-2xl px-8 py-6">
      <h1 className="mb-4 border-b border-neutral-200 pb-3 text-lg font-semibold text-neutral-500 dark:border-neutral-800">
        {title}
      </h1>
      {blocks.map((block) => (
        <BlockView key={block.id} block={block} highlights={highlightsByBlock?.get(block.id)} />
      ))}
      {blocks.length === 0 && (
        <p className="text-sm text-neutral-500">This document has no blocks. Re-parse it.</p>
      )}
    </article>
  );
}

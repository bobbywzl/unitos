"use client";

import { useState } from "react";
import { PencilIcon } from "@/components/icons";
import { BlockView, type BlockData, type Highlight } from "@/components/reader/block-view";

const TEXT_TYPES = new Set(["PARAGRAPH", "HEADING", "LIST", "CODE", "EQUATION"]);

// The reading column: 720px of airy, book-like text (design 1a). The document
// title sits above it as a quiet kicker, not a header bar. Text blocks carry a
// hover pencil for in-place editing; every save lands in the Edits panel.
export function Reader({
  title,
  blocks,
  highlightsByBlock,
  swaps,
  onRevertSwap,
  editingBlockId,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
}: {
  title: string;
  blocks: BlockData[];
  highlightsByBlock: Record<string, Highlight[]>;
  swaps: Record<string, string>;
  onRevertSwap: (blockId: string) => void;
  editingBlockId: string | null;
  onStartEdit: (blockId: string) => void;
  onSaveEdit: (blockId: string, text: string) => Promise<void>;
  onCancelEdit: () => void;
}) {
  return (
    <article className="reader-prose mx-auto w-[720px] max-w-full px-6 py-11">
      <p className="mb-2.5 text-[11px] font-bold tracking-[0.09em] text-clay-700 uppercase">
        Document · {blocks.length} blocks
      </p>
      <h2 className="mb-[26px] text-[33px]">{title}</h2>
      {blocks.map((block) => (
        <div key={block.id} className="group/block relative">
          {editingBlockId === block.id ? (
            <BlockEditor
              block={block}
              onSave={(text) => onSaveEdit(block.id, text)}
              onCancel={onCancelEdit}
            />
          ) : (
            <>
              <BlockView
                block={block}
                highlights={highlightsByBlock[block.id]}
                swap={swaps[block.id]}
                onRevertSwap={onRevertSwap}
              />
              {TEXT_TYPES.has(block.type) && swaps[block.id] === undefined && (
                <button
                  onClick={() => onStartEdit(block.id)}
                  aria-label="Edit this block"
                  title="Edit this block"
                  className="absolute top-1 -left-10 flex size-8 items-center justify-center rounded-full text-sand-500 opacity-0 transition-opacity group-hover/block:opacity-100 focus-visible:opacity-100 hover:bg-clay-100 hover:text-clay-800"
                >
                  <PencilIcon size={14} />
                </button>
              )}
            </>
          )}
        </div>
      ))}
      {blocks.length === 0 && (
        <p className="text-sm text-sand-600">This document has no blocks. Re-parse it.</p>
      )}
    </article>
  );
}

function BlockEditor({
  block,
  onSave,
  onCancel,
}: {
  block: BlockData;
  onSave: (text: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(block.text);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    const trimmed = draft.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await onSave(trimmed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="my-4 rounded-2xl bg-card p-4 shadow-soft outline-2 outline-clay-400">
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
          if (e.key === "Escape") onCancel();
        }}
        rows={Math.min(18, Math.max(3, draft.split("\n").length + 1))}
        className="w-full resize-y bg-transparent text-[15px] leading-[1.6] outline-none"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => void save()}
          disabled={busy || !draft.trim()}
          className="rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
        >
          Cancel
        </button>
        <span className="ml-auto text-[11px] text-sand-500">⌘⏎ save · esc cancel</span>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { PencilIcon, PlusIcon } from "@/components/icons";
import { BlockView, type BlockData, type Highlight } from "@/components/reader/block-view";

const TEXT_TYPES = new Set(["PARAGRAPH", "HEADING", "LIST", "CODE", "EQUATION"]);

/** Text offset within `container` for a click position, for caret placement. */
function caretOffsetAtPoint(e: React.MouseEvent, container: HTMLElement): number | null {
  type CaretDoc = Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  const doc = document as CaretDoc;
  let node: Node | null = null;
  let offset = 0;
  if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(e.clientX, e.clientY);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  } else if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(e.clientX, e.clientY);
    if (pos) {
      node = pos.offsetNode;
      offset = pos.offset;
    }
  }
  if (!node || !container.contains(node)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(container);
  pre.setEnd(node, offset);
  return pre.toString().length;
}

// The reading column: 720px of airy, book-like text (design 1a) — and the whole
// document is editable in place. Click a paragraph to put a caret in it; drag to
// select for annotation tools; hover between paragraphs to insert one. Edited
// text renders in the edited color, diffed against the document as parsed.
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
  onInsertBlock,
  onDeleteBlock,
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
  onInsertBlock: (afterBlockId: string) => Promise<void>;
  onDeleteBlock: (blockId: string) => Promise<void>;
}) {
  const [caret, setCaret] = useState<number | null>(null);

  function clickToEdit(e: React.MouseEvent, block: BlockData) {
    if (!TEXT_TYPES.has(block.type) || swaps[block.id] !== undefined) return;
    if (editingBlockId === block.id) return;
    // A drag is a selection for the annotation tools, not an edit.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    const target = e.target as HTMLElement;
    // Links navigate, marks focus their annotation, buttons do their own thing.
    if (target.closest("a, button, [data-selection-popover]")) return;
    const content = e.currentTarget.querySelector<HTMLElement>("[data-block-id]");
    setCaret(content ? caretOffsetAtPoint(e, content) : null);
    onStartEdit(block.id);
  }

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
              caret={caret}
              onSave={(text) => onSaveEdit(block.id, text)}
              onCancel={onCancelEdit}
              onDelete={() => onDeleteBlock(block.id)}
            />
          ) : (
            <>
              <div onClick={(e) => clickToEdit(e, block)}>
                <BlockView
                  block={block}
                  highlights={highlightsByBlock[block.id]}
                  swap={swaps[block.id]}
                  onRevertSwap={onRevertSwap}
                />
              </div>
              {TEXT_TYPES.has(block.type) && swaps[block.id] === undefined && (
                <button
                  onClick={() => {
                    setCaret(null);
                    onStartEdit(block.id);
                  }}
                  aria-label="Edit this block"
                  title="Edit this block"
                  className="absolute top-1 -left-10 flex size-8 items-center justify-center rounded-full text-sand-500 opacity-0 transition-opacity group-hover/block:opacity-100 focus-visible:opacity-100 hover:bg-clay-100 hover:text-clay-800"
                >
                  <PencilIcon size={14} />
                </button>
              )}
              <div className="relative -my-1.5 h-3">
                <button
                  onClick={() => void onInsertBlock(block.id)}
                  aria-label="Insert a paragraph here"
                  title="Insert a paragraph here"
                  className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-card px-2.5 py-0.5 text-[11px] font-semibold text-sand-600 opacity-0 shadow-soft transition-opacity hover:bg-clay-100 hover:text-clay-800 hover:opacity-100 focus-visible:opacity-100 group-hover/block:opacity-60"
                >
                  <PlusIcon size={10} />
                  paragraph
                </button>
              </div>
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
  caret,
  onSave,
  onCancel,
  onDelete,
}: {
  block: BlockData;
  caret: number | null;
  onSave: (text: string) => Promise<void>;
  onCancel: () => void;
  onDelete: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(block.text);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Put the caret where the click landed, like any document editor.
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.focus();
    const at = caret === null ? area.value.length : Math.min(caret, area.value.length);
    area.setSelectionRange(at, at);
  }, [caret]);

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
    <div
      ref={boxRef}
      className="my-4 rounded-2xl bg-card p-4 shadow-soft outline-2 outline-clay-400"
      onBlur={(e) => {
        // Click-away saves, like a document editor. Focus moving within the
        // editor (its own buttons) is not a click-away.
        if (boxRef.current?.contains(e.relatedTarget as Node)) return;
        if (busy) return;
        if (draft.trim() && draft !== block.text) void save();
        else onCancel();
      }}
    >
      <textarea
        ref={areaRef}
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
        <button
          onClick={() => {
            if (confirm("Remove this paragraph? Notes anchored to it will show as unresolved."))
              void onDelete();
          }}
          className="text-xs text-red-500 hover:text-red-700"
        >
          Remove
        </button>
        <span className="ml-auto text-[11px] text-sand-500">
          click away or ⌘⏎ save · esc cancel
        </span>
      </div>
    </div>
  );
}

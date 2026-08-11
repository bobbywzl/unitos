"use client";

import { useRef, useState } from "react";
import { PlusIcon } from "@/components/icons";
import { BlockView, type BlockData, type Highlight } from "@/components/reader/block-view";

const TEXT_TYPES = new Set(["PARAGRAPH", "HEADING", "LIST", "CODE", "EQUATION"]);

const FONT_STACK: Record<string, string | undefined> = {
  default: undefined,
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
};

function headingLevel(html: string | null): 1 | 2 | 3 {
  const m = html?.match(/^<h([1-3])/);
  return m ? (Number(m[1]) as 1 | 2 | 3) : 2;
}

function blockKind(block: BlockData): "paragraph" | "h1" | "h2" | "h3" {
  if (block.type !== "HEADING") return "paragraph";
  return `h${headingLevel(block.html)}` as "h1" | "h2" | "h3";
}

// The reading column: 720px of airy, book-like text (design 1a). Reading mode
// is exactly that — reading, with selection tools. Edit mode turns the whole
// body into one seamlessly editable page: no boxes, a format bar on top, and
// every change lands in the edit history.
export function Reader({
  title,
  blocks,
  highlightsByBlock,
  swaps,
  onRevertSwap,
  mode,
  font,
  onSaveText,
  onFormatBlock,
  onToggleStyle,
  onInsertBlock,
  onDeleteBlock,
}: {
  title: string;
  blocks: BlockData[];
  highlightsByBlock: Record<string, Highlight[]>;
  swaps: Record<string, string>;
  onRevertSwap: (blockId: string) => void;
  mode: "read" | "edit";
  font: string | null;
  onSaveText: (blockId: string, text: string) => Promise<void>;
  onFormatBlock: (blockId: string, kind: "paragraph" | "h1" | "h2" | "h3") => Promise<void>;
  onToggleStyle: (
    blockId: string,
    start: number,
    end: number,
    style: "bold" | "italic",
  ) => Promise<void>;
  onInsertBlock: (afterBlockId: string) => Promise<void>;
  onDeleteBlock: (blockId: string) => Promise<void>;
}) {
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const fontFamily = FONT_STACK[font ?? "default"];
  const focusedBlock = blocks.find((b) => b.id === focusedBlockId) ?? null;

  // Bold/italic apply to the current selection inside the focused editable.
  function applyStyle(style: "bold" | "italic") {
    if (!focusedBlockId) return;
    const el = document.querySelector<HTMLElement>(`[data-edit-block="${focusedBlockId}"]`);
    const selection = window.getSelection();
    if (!el || !selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return;
    const pre = document.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    const end = start + range.toString().length;
    if (end <= start) return;
    void onToggleStyle(focusedBlockId, start, end, style);
  }

  const barButton =
    "rounded-full px-2.5 py-1 text-[11.5px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40";
  const keep = (e: React.MouseEvent) => e.preventDefault(); // keep focus/selection in the page

  return (
    // Scrolling belongs to the interactions container above; sticky works
    // against that ancestor.
    <div className="relative">
      {mode === "edit" && (
        <div className="sticky top-3 z-30 mx-auto flex w-fit items-center gap-0.5 rounded-full bg-card px-2 py-1.5 shadow-float">
          {(["paragraph", "h1", "h2", "h3"] as const).map((kind) => (
            <button
              key={kind}
              onMouseDown={keep}
              disabled={!focusedBlock}
              onClick={() => focusedBlockId && void onFormatBlock(focusedBlockId, kind)}
              className={
                focusedBlock && blockKind(focusedBlock) === kind
                  ? "rounded-full bg-clay-100 px-2.5 py-1 text-[11.5px] font-semibold text-clay-800"
                  : barButton
              }
            >
              {kind === "paragraph" ? "¶" : kind.toUpperCase()}
            </button>
          ))}
          <span aria-hidden className="mx-1 h-4 w-px bg-line" />
          <button onMouseDown={keep} disabled={!focusedBlock} onClick={() => applyStyle("bold")} className={`${barButton} font-bold`}>
            B
          </button>
          <button onMouseDown={keep} disabled={!focusedBlock} onClick={() => applyStyle("italic")} className={`${barButton} italic`}>
            I
          </button>
          <span aria-hidden className="mx-1 h-4 w-px bg-line" />
          <button
            onMouseDown={keep}
            disabled={!focusedBlock}
            onClick={() => {
              if (
                focusedBlockId &&
                confirm("Remove this paragraph? Notes anchored to it will show as unresolved.")
              ) {
                void onDeleteBlock(focusedBlockId);
              }
            }}
            className="rounded-full px-2.5 py-1 text-[11.5px] font-semibold text-red-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950"
          >
            Remove ¶
          </button>
        </div>
      )}

      <article className="reader-prose mx-auto w-[720px] max-w-full px-6 py-11" style={{ fontFamily }}>
        <p className="mb-2.5 text-[11px] font-bold tracking-[0.09em] text-clay-700 uppercase">
          Document · {blocks.length} blocks{mode === "edit" ? " · editing" : ""}
        </p>
        <h2 className="mb-[26px] text-[33px]">{title}</h2>

        {blocks.map((block) =>
          mode === "edit" ? (
            <div key={block.id} className="group/block">
              {TEXT_TYPES.has(block.type) ? (
                <EditableBlock
                  block={block}
                  onSave={onSaveText}
                  onFocusBlock={setFocusedBlockId}
                />
              ) : (
                <BlockView block={block} highlights={[]} />
              )}
              <div className="relative -my-1.5 h-3">
                <button
                  onMouseDown={keep}
                  onClick={() => void onInsertBlock(block.id)}
                  aria-label="Insert a paragraph here"
                  title="Insert a paragraph here"
                  className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-card px-2.5 py-0.5 text-[11px] font-semibold text-sand-600 opacity-0 shadow-soft transition-opacity hover:bg-clay-100 hover:text-clay-800 hover:opacity-100 focus-visible:opacity-100 group-hover/block:opacity-60"
                >
                  <PlusIcon size={10} />
                  paragraph
                </button>
              </div>
            </div>
          ) : (
            <BlockView
              key={block.id}
              block={block}
              highlights={highlightsByBlock[block.id]}
              swap={swaps[block.id]}
              onRevertSwap={onRevertSwap}
            />
          ),
        )}
        {blocks.length === 0 && (
          <p className="text-sm text-sand-600">This document has no blocks. Re-parse it.</p>
        )}
      </article>
    </div>
  );
}

// One seamlessly editable block: the text itself is editable in place, styled
// exactly like reading mode. Blur saves; the DOM text is the source of truth
// for the save, so offsets stay honest.
function EditableBlock({
  block,
  onSave,
  onFocusBlock,
}: {
  block: BlockData;
  onSave: (blockId: string, text: string) => Promise<void>;
  onFocusBlock: (blockId: string) => void;
}) {
  const ref = useRef<HTMLElement | null>(null);

  const shared = {
    ref: (el: HTMLElement | null) => {
      ref.current = el;
    },
    contentEditable: "plaintext-only" as const,
    suppressContentEditableWarning: true,
    "data-edit-block": block.id,
    onFocus: () => onFocusBlock(block.id),
    onBlur: () => {
      const next = ref.current?.textContent ?? "";
      if (next.trim() && next !== block.text) void onSave(block.id, next);
    },
    className: "",
    children: block.text,
  };
  const editable = "rounded-lg outline-none focus:bg-card/60 whitespace-pre-wrap";

  // The refresh after a save re-mounts with the stored text.
  const key = `${block.id}:${block.text}`;

  switch (block.type) {
    case "HEADING": {
      const level = headingLevel(block.html);
      if (level === 1)
        return <h1 key={key} {...shared} className={`mt-10 mb-3 text-[26px] ${editable}`} />;
      if (level === 2)
        return <h2 key={key} {...shared} className={`mt-8 mb-2.5 text-[22px] ${editable}`} />;
      return <h3 key={key} {...shared} className={`mt-6 mb-2.5 text-[20px] ${editable}`} />;
    }
    case "LIST":
      return <div key={key} {...shared} className={`my-4 pl-5 ${editable}`} />;
    case "CODE":
    case "EQUATION":
      return (
        <pre
          key={key}
          {...shared}
          className={`my-4 overflow-x-auto rounded-2xl bg-sand-200 p-4 text-sm ${editable}`}
        />
      );
    default:
      return <p key={key} {...shared} className={`my-4 ${editable}`} />;
  }
}

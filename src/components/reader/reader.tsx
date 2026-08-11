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

type Kind = "paragraph" | "h1" | "h2" | "h3";
type StyleSpan = { start: number; end: number; style: "bold" | "italic" };

function headingLevel(html: string | null): 1 | 2 | 3 {
  const m = html?.match(/^<h([1-3])/);
  return m ? (Number(m[1]) as 1 | 2 | 3) : 2;
}

function blockKind(block: BlockData): Kind {
  if (block.type !== "HEADING") return "paragraph";
  return `h${headingLevel(block.html)}` as Kind;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Decorated text as one HTML string. React sets it once and never reconciles
// inside, so the browser owns the region while the user types — the fight
// between React and contentEditable never starts.
function decoratedHtml(text: string, spans: StyleSpan[], edited: { start: number; end: number }[]): string {
  const bounds = new Set<number>([0, text.length]);
  for (const s of spans) {
    bounds.add(Math.max(0, Math.min(s.start, text.length)));
    bounds.add(Math.max(0, Math.min(s.end, text.length)));
  }
  for (const r of edited) {
    bounds.add(Math.max(0, Math.min(r.start, text.length)));
    bounds.add(Math.max(0, Math.min(r.end, text.length)));
  }
  const points = [...bounds].sort((a, b) => a - b);
  let html = "";
  for (let i = 0; i < points.length - 1; i++) {
    const [from, to] = [points[i], points[i + 1]];
    if (from === to) continue;
    const segment = escapeHtml(text.slice(from, to));
    const bold = spans.some((s) => s.style === "bold" && s.start <= from && s.end >= to);
    const italic = spans.some((s) => s.style === "italic" && s.start <= from && s.end >= to);
    const isEdited = edited.some((r) => r.start <= from && r.end >= to);
    const cls = `${isEdited ? "edited-text " : ""}${bold ? "font-bold " : ""}${italic ? "italic" : ""}`.trim();
    html += cls ? `<span class="${cls}">${segment}</span>` : segment;
  }
  return html;
}

/** Select [start, end) inside an element's text, walking its text nodes. */
function selectRange(el: HTMLElement, start: number, end: number) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let startNode: Node | null = null;
  let startOffset = 0;
  let endNode: Node | null = null;
  let endOffset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const len = node.textContent?.length ?? 0;
    if (!startNode && offset + len >= start) {
      startNode = node;
      startOffset = start - offset;
    }
    if (offset + len >= end) {
      endNode = node;
      endOffset = end - offset;
      break;
    }
    offset += len;
  }
  if (!startNode || !endNode) return;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

// The reading column: 720px of airy, book-like text (design 1a). Reading mode
// is exactly that. Edit mode turns the whole body into one seamlessly editable
// page — decorations render live, and format/style changes apply optimistically
// the instant they are clicked, with the server syncing behind.
export function Reader({
  title,
  blocks,
  highlightsByBlock,
  swaps,
  onRevertSwap,
  mode,
  font,
  stylesByBlock,
  editedByBlock,
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
  stylesByBlock: Record<string, StyleSpan[]>;
  editedByBlock: Record<string, { start: number; end: number }[]>;
  onSaveText: (blockId: string, text: string) => Promise<void>;
  onFormatBlock: (blockId: string, kind: Kind) => Promise<void>;
  onToggleStyle: (blockId: string, start: number, end: number, style: "bold" | "italic") => Promise<void>;
  onInsertBlock: (afterBlockId: string) => Promise<void>;
  onDeleteBlock: (blockId: string) => Promise<void>;
}) {
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  // Optimistic overrides: applied the instant a bar button is clicked, cleared
  // when the server round-trip lands (the blocks prop identity changes then).
  const [localKinds, setLocalKinds] = useState<Record<string, Kind>>({});
  const [localStyles, setLocalStyles] = useState<Record<string, StyleSpan[]>>({});
  const [prevBlocks, setPrevBlocks] = useState(blocks);
  if (prevBlocks !== blocks) {
    setPrevBlocks(blocks);
    setLocalKinds({});
    setLocalStyles({});
  }
  const restoreSelectionRef = useRef<{ blockId: string; start: number; end: number } | null>(null);

  const fontFamily = FONT_STACK[font ?? "default"];
  const focusedBlock = blocks.find((b) => b.id === focusedBlockId) ?? null;
  const effectiveKind = (block: BlockData): Kind => localKinds[block.id] ?? blockKind(block);
  const effectiveStyles = (block: BlockData): StyleSpan[] =>
    localStyles[block.id] ?? stylesByBlock[block.id] ?? [];

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
    // Instant: toggle locally (repaints this block), keep the selection, then sync.
    const blockId = focusedBlockId;
    const block = blocks.find((b) => b.id === blockId);
    if (!block) return;
    setLocalStyles((prev) => {
      const current = prev[blockId] ?? stylesByBlock[blockId] ?? [];
      const existing = current.findIndex(
        (s) => s.style === style && s.start === start && s.end === end,
      );
      const next =
        existing >= 0
          ? current.filter((_, i) => i !== existing)
          : [...current, { start, end, style }];
      return { ...prev, [blockId]: next };
    });
    restoreSelectionRef.current = { blockId, start, end };
    void onToggleStyle(blockId, start, end, style);
  }

  function applyFormat(kind: Kind) {
    if (!focusedBlockId) return;
    setLocalKinds((prev) => ({ ...prev, [focusedBlockId]: kind }));
    void onFormatBlock(focusedBlockId, kind);
  }

  const barButton =
    "rounded-full px-2.5 py-1 text-[11.5px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40";
  const keep = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className="relative">
      {mode === "edit" && (
        <div className="sticky top-3 z-30 mx-auto flex w-fit items-center gap-0.5 rounded-full bg-card px-2 py-1.5 shadow-float">
          {(["paragraph", "h1", "h2", "h3"] as const).map((kind) => (
            <button
              key={kind}
              onMouseDown={keep}
              disabled={!focusedBlock}
              onClick={() => applyFormat(kind)}
              className={
                focusedBlock && effectiveKind(focusedBlock) === kind
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
                  kind={effectiveKind(block)}
                  spans={effectiveStyles(block)}
                  edited={editedByBlock[block.id] ?? []}
                  restoreSelectionRef={restoreSelectionRef}
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

const KIND_CLASS: Record<Kind, string> = {
  paragraph: "my-4",
  h1: "mt-10 mb-3 text-[26px] font-display",
  h2: "mt-8 mb-2.5 text-[22px] font-display",
  h3: "mt-6 mb-2.5 text-[20px] font-display",
};

// One seamlessly editable block. Decorations (bold, italic, edited color) are
// visible WHILE editing: the initial content is decorated HTML the browser owns.
// Blur reads textContent — the decoration spans flatten back to plain text, so
// offsets stay honest.
function EditableBlock({
  block,
  kind,
  spans,
  edited,
  restoreSelectionRef,
  onSave,
  onFocusBlock,
}: {
  block: BlockData;
  kind: Kind;
  spans: StyleSpan[];
  edited: { start: number; end: number }[];
  restoreSelectionRef: React.MutableRefObject<{ blockId: string; start: number; end: number } | null>;
  onSave: (blockId: string, text: string) => Promise<void>;
  onFocusBlock: (blockId: string) => void;
}) {
  const ref = useRef<HTMLElement | null>(null);

  const html = decoratedHtml(block.text, spans, edited);
  // Remount whenever content or decorations change server- or optimistic-side.
  const key = `${block.id}:${block.text.length}:${html.length}:${kind}`;

  const shared = {
    ref: (el: HTMLElement | null) => {
      ref.current = el;
      // A style toggle replaced the DOM; put the selection back where it was.
      const pending = restoreSelectionRef.current;
      if (el && pending && pending.blockId === block.id) {
        restoreSelectionRef.current = null;
        requestAnimationFrame(() => {
          el.focus();
          selectRange(el, pending.start, pending.end);
        });
      }
    },
    contentEditable: "plaintext-only" as const,
    suppressContentEditableWarning: true,
    "data-edit-block": block.id,
    onFocus: () => onFocusBlock(block.id),
    onBlur: () => {
      const next = ref.current?.textContent ?? "";
      if (next.trim() && next !== block.text) void onSave(block.id, next);
    },
    dangerouslySetInnerHTML: { __html: html },
  };
  const editable = "rounded-lg outline-none focus:bg-card/60 whitespace-pre-wrap";

  const base = block.type === "CODE" || block.type === "EQUATION"
    ? "my-4 overflow-x-auto rounded-2xl bg-sand-200 p-4 text-sm"
    : block.type === "LIST"
      ? "my-4 pl-5"
      : KIND_CLASS[kind];

  if (block.type === "CODE" || block.type === "EQUATION") {
    return <pre key={key} {...shared} className={`${base} ${editable}`} />;
  }
  if (kind === "h1") return <h1 key={key} {...shared} className={`${base} ${editable}`} />;
  if (kind === "h2") return <h2 key={key} {...shared} className={`${base} ${editable}`} />;
  if (kind === "h3") return <h3 key={key} {...shared} className={`${base} ${editable}`} />;
  if (block.type === "LIST") return <div key={key} {...shared} className={`${base} ${editable}`} />;
  return <p key={key} {...shared} className={`${base} ${editable}`} />;
}

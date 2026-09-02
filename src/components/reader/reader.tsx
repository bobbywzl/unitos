"use client";

import { useRef, useState } from "react";
import { PlusIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { BlockView, type BlockData, type Highlight } from "@/components/reader/block-view";
import { CircleGlow } from "@/components/reader/circle-glow";
import type { TKey } from "@/lib/i18n/dictionaries";
import { ConversionStrip, type ConversionInfo } from "@/components/reader/conversion-strip";
import { PageBlock, type PageMark } from "@/components/reader/page-block";
import { DocumentTitle } from "@/components/reader/document-title";

const TEXT_TYPES = new Set(["PARAGRAPH", "HEADING", "LIST", "CODE", "EQUATION"]);

const FONT_STACK: Record<string, string | undefined> = {
  default: undefined,
  // CJK serif fallbacks: without them Windows falls back to SimSun for
  // Chinese glyphs, a poor long-form reading face.
  serif: "Georgia, 'Times New Roman', 'Songti SC', 'Noto Serif CJK SC', 'Source Han Serif SC', serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
};

type Kind = "paragraph" | "h1" | "h2" | "h3" | "list" | "numbered";
// The text colors, one class each in globals.css (text-color-*).
export type TextColor = "color-clay" | "color-sage" | "color-gold" | "color-plum";
export const TEXT_COLORS: { style: TextColor; dot: string }[] = [
  { style: "color-clay", dot: "var(--clay-500)" },
  { style: "color-sage", dot: "var(--sage-600)" },
  { style: "color-gold", dot: "#d9a54a" },
  { style: "color-plum", dot: "#a78bfa" },
];
// "code" spans come from the parser (monospace runs); the toolbar toggles the rest.
type StyleKind = "bold" | "italic" | "underline" | "code" | TextColor;
type ToggleStyleKind = "bold" | "italic" | "underline" | TextColor;
type StyleSpan = { start: number; end: number; style: StyleKind };

const COLOR_NAME_KEY: Record<TextColor, TKey> = {
  "color-clay": "reader.colorClay",
  "color-sage": "reader.colorSage",
  "color-gold": "reader.colorGold",
  "color-plum": "reader.colorPlum",
};

function headingLevel(html: string | null): 1 | 2 | 3 {
  const m = html?.match(/^<h([1-3])/);
  return m ? (Number(m[1]) as 1 | 2 | 3) : 2;
}

function blockKind(block: BlockData): Kind {
  if (block.type === "LIST") return /^\s*\d{1,3}[.)]\s/.test(block.text) ? "numbered" : "list";
  if (block.type !== "HEADING") return "paragraph";
  return `h${headingLevel(block.html)}` as Kind;
}

// List markers live in the text ("- " / "N. ", two-space indents — the parser's
// convention). Converting a block rewrites its line markers.
function stripMarkers(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/^(\s*)(?:-|\d{1,3}[.)])\s+/, "$1"))
    .join("\n");
}

function withMarkers(text: string, kind: "list" | "numbered"): string {
  const counters: number[] = [];
  return stripMarkers(text)
    .split("\n")
    .map((line) => {
      const indent = /^\s*/.exec(line)![0];
      const body = line.slice(indent.length);
      if (!body) return line;
      if (kind === "list") return `${indent}- ${body}`;
      const depth = Math.floor(indent.length / 2);
      counters.length = depth + 1;
      counters[depth] = (counters[depth] ?? 0) + 1;
      return `${indent}${counters[depth]}. ${body}`;
    })
    .join("\n");
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
    const underline = spans.some((s) => s.style === "underline" && s.start <= from && s.end >= to);
    const code = spans.some((s) => s.style === "code" && s.start <= from && s.end >= to);
    const color = spans.find((s) => s.style.startsWith("color-") && s.start <= from && s.end >= to);
    const isEdited = edited.some((r) => r.start <= from && r.end >= to);
    const cls = `${isEdited ? "edited-text " : ""}${bold ? "font-bold " : ""}${italic ? "italic " : ""}${underline ? "underline " : ""}${color ? `text-${color.style} ` : ""}${code ? "code-mark" : ""}`.trim();
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
  mode,
  font,
  stylesByBlock,
  editedByBlock,
  documentId,
  pages,
  onSaveText,
  onFormatBlock,
  onToggleStyle,
  onInsertBlock,
  onDeleteBlock,
}: {
  title: string;
  blocks: BlockData[];
  highlightsByBlock: Record<string, Highlight[]>;
  mode: "read" | "edit";
  font: string | null;
  stylesByBlock: Record<string, StyleSpan[]>;
  editedByBlock: Record<string, { start: number; end: number }[]>;
  documentId?: string; // PDF figure blocks render their page via the figure image route
  // Handwritten document (SPEC.md §16): PAGE blocks render with Circle & ask
  // and their stored marks; the conversion strip sits after the last page.
  pages?: {
    notebookId: string;
    canEdit: boolean;
    marksByBlock: Record<string, PageMark[]>;
    conversion: ConversionInfo;
  } | null;
  onSaveText: (blockId: string, text: string) => Promise<void>;
  onFormatBlock: (blockId: string, kind: Kind, text?: string) => Promise<void>;
  onToggleStyle: (blockId: string, start: number, end: number, style: ToggleStyleKind) => Promise<void>;
  onInsertBlock: (afterBlockId: string) => Promise<string | null>;
  onDeleteBlock: (blockId: string) => Promise<void>;
}) {
  const t = useT();
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  // Optimistic overrides: applied the instant a bar button is clicked, cleared
  // when the server round-trip lands (the blocks prop identity changes then).
  const [localKinds, setLocalKinds] = useState<Record<string, Kind>>({});
  const [localStyles, setLocalStyles] = useState<Record<string, StyleSpan[]>>({});
  const [localTexts, setLocalTexts] = useState<Record<string, string>>({});
  const [prevBlocks, setPrevBlocks] = useState(blocks);
  if (prevBlocks !== blocks) {
    setPrevBlocks(blocks);
    setLocalKinds({});
    setLocalStyles({});
    setLocalTexts({});
  }
  const restoreSelectionRef = useRef<{ blockId: string; start: number; end: number } | null>(null);
  // Focus a just-inserted paragraph the moment it renders.
  const pendingFocusRef = useRef<string | null>(null);
  // Style syncs serialize: the route rewrites the block's whole styles array,
  // so two in-flight toggles would clobber each other's span.
  const styleSyncRef = useRef<Promise<unknown>>(Promise.resolve());

  const fontFamily = FONT_STACK[font ?? "default"];
  // Handwritten document: the Circle & ask hint rides the first page; the
  // conversion strip renders after the last page (SPEC.md §16).
  const firstPageIndex = blocks.findIndex((b) => b.type === "PAGE");
  const lastPageIndex = blocks.reduce((last, b, i) => (b.type === "PAGE" ? i : last), -1);
  const hasTextBlocks = blocks.some((b) => b.type !== "PAGE");
  const focusedBlock = blocks.find((b) => b.id === focusedBlockId) ?? null;
  const effectiveKind = (block: BlockData): Kind => localKinds[block.id] ?? blockKind(block);
  const effectiveStyles = (block: BlockData): StyleSpan[] =>
    localStyles[block.id] ?? stylesByBlock[block.id] ?? [];
  const effectiveText = (block: BlockData): string => localTexts[block.id] ?? block.text;

  // Bar buttons prevent blur, so unsaved typing must be saved by hand before a
  // format or style rebuilds the block — otherwise the typed words are lost.
  function flushFocused(): Promise<void> | null {
    if (!focusedBlockId) return null;
    const block = blocks.find((b) => b.id === focusedBlockId);
    const el = document.querySelector<HTMLElement>(`[data-edit-block="${focusedBlockId}"]`);
    if (!block || !el) return null;
    const live = el.textContent ?? "";
    if (live === effectiveText(block)) return null;
    const blockId = focusedBlockId;
    setLocalTexts((prev) => ({ ...prev, [blockId]: live }));
    return onSaveText(blockId, live);
  }

  function applyStyle(style: ToggleStyleKind) {
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
    const flush = flushFocused();
    setLocalStyles((prev) => {
      const current = prev[blockId] ?? stylesByBlock[blockId] ?? [];
      const existing = current.findIndex(
        (s) => s.style === style && s.start === start && s.end === end,
      );
      // One color per span: a new color replaces another color on the same
      // range — mirroring the style route.
      const isColor = style.startsWith("color-");
      const next =
        existing >= 0
          ? current.filter((_, i) => i !== existing)
          : [
              ...current.filter(
                (s) =>
                  !(isColor && s.style.startsWith("color-") && s.start === start && s.end === end),
              ),
              { start, end, style },
            ];
      return { ...prev, [blockId]: next };
    });
    restoreSelectionRef.current = { blockId, start, end };
    // Unsaved typing saves first — the style offsets refer to the saved text.
    styleSyncRef.current = styleSyncRef.current
      .then(() => flush)
      .then(() => onToggleStyle(blockId, start, end, style));
  }

  function applyFormat(kind: Kind) {
    if (!focusedBlockId) return;
    const blockId = focusedBlockId;
    const block = blocks.find((b) => b.id === blockId);
    if (!block) return;
    // Keep the caret where it was through the remount.
    const el = document.querySelector<HTMLElement>(`[data-edit-block="${blockId}"]`);
    const selection = window.getSelection();
    if (el && selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (el.contains(range.commonAncestorContainer)) {
        const pre = document.createRange();
        pre.selectNodeContents(el);
        pre.setEnd(range.startContainer, range.startOffset);
        const start = pre.toString().length;
        restoreSelectionRef.current = { blockId, start, end: start + range.toString().length };
      }
    }
    const flush = flushFocused();
    // List conversions rewrite line markers; leaving a list strips them.
    const liveText = el?.textContent ?? effectiveText(block);
    const current = effectiveKind(block);
    let nextText: string | undefined;
    if (kind === "list" || kind === "numbered") nextText = withMarkers(liveText, kind);
    else if (current === "list" || current === "numbered") nextText = stripMarkers(liveText);
    if (nextText === liveText) nextText = undefined;
    setLocalKinds((prev) => ({ ...prev, [blockId]: kind }));
    if (nextText !== undefined) {
      const text = nextText;
      setLocalTexts((prev) => ({ ...prev, [blockId]: text }));
    }
    if (flush) void flush.then(() => onFormatBlock(blockId, kind, nextText));
    else void onFormatBlock(blockId, kind, nextText);
  }

  // Indent or outdent the caret's line by two spaces (the list nesting step).
  function applyIndent(delta: 1 | -1) {
    if (!focusedBlockId) return;
    const blockId = focusedBlockId;
    const block = blocks.find((b) => b.id === blockId);
    const el = document.querySelector<HTMLElement>(`[data-edit-block="${blockId}"]`);
    if (!block || !el) return;
    const selection = window.getSelection();
    let caret = 0;
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (el.contains(range.commonAncestorContainer)) {
        const pre = document.createRange();
        pre.selectNodeContents(el);
        pre.setEnd(range.startContainer, range.startOffset);
        caret = pre.toString().length;
      }
    }
    const text = el.textContent ?? "";
    const lineStart = text.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
    let next: string;
    let shift: number;
    if (delta === 1) {
      next = `${text.slice(0, lineStart)}  ${text.slice(lineStart)}`;
      shift = 2;
    } else {
      const lead = /^ {1,2}/.exec(text.slice(lineStart));
      if (!lead) return;
      next = text.slice(0, lineStart) + text.slice(lineStart + lead[0].length);
      shift = -lead[0].length;
    }
    setLocalTexts((prev) => ({ ...prev, [blockId]: next }));
    restoreSelectionRef.current = {
      blockId,
      start: Math.max(lineStart, caret + shift),
      end: Math.max(lineStart, caret + shift),
    };
    void onSaveText(blockId, next);
  }

  const barButton =
    "rounded-full px-2.5 py-1 text-[11.5px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40";
  const keep = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className="relative">
      <CircleGlow />
      {mode === "edit" && (
        <div className="sticky top-3 z-30 mx-auto flex w-fit items-center gap-0.5 rounded-full bg-card px-2 py-1.5 shadow-float print:hidden">
          {(
            [
              ["paragraph", "¶", "panes.formatParagraph"],
              ["h1", "H1", "panes.formatHeading1"],
              ["h2", "H2", "panes.formatHeading2"],
              ["h3", "H3", "panes.formatHeading3"],
              ["list", "•", "panes.formatBulletedList"],
              ["numbered", "1.", "panes.formatNumberedList"],
            ] as const
          ).map(([kind, label, titleKey]) => (
            <button
              key={kind}
              onMouseDown={keep}
              disabled={!focusedBlock}
              onClick={() => applyFormat(kind)}
              aria-label={t(titleKey)}
              data-tooltip={t(titleKey)}
              className={
                focusedBlock && effectiveKind(focusedBlock) === kind
                  ? "rounded-full bg-clay-100 px-2.5 py-1 text-[11.5px] font-semibold text-clay-800"
                  : barButton
              }
            >
              {label}
            </button>
          ))}
          <span aria-hidden className="mx-1 h-4 w-px bg-line" />
          <button onMouseDown={keep} disabled={!focusedBlock} onClick={() => applyStyle("bold")} aria-label={t("panes.bold")} data-tooltip={t("panes.bold")} className={`${barButton} font-bold`}>
            B
          </button>
          <button onMouseDown={keep} disabled={!focusedBlock} onClick={() => applyStyle("italic")} aria-label={t("panes.italic")} data-tooltip={t("panes.italic")} className={`${barButton} italic`}>
            I
          </button>
          <button onMouseDown={keep} disabled={!focusedBlock} onClick={() => applyStyle("underline")} aria-label={t("panes.underline")} data-tooltip={t("panes.underline")} className={`${barButton} underline`}>
            U
          </button>
          <span aria-hidden className="mx-1 h-4 w-px bg-line" />
          {TEXT_COLORS.map(({ style, dot }) => (
            <button
              key={style}
              onMouseDown={keep}
              disabled={!focusedBlock}
              onClick={() => applyStyle(style)}
              aria-label={t("panes.textColorIn", { color: t(COLOR_NAME_KEY[style]) })}
              data-tooltip={t("panes.textColorIn", { color: t(COLOR_NAME_KEY[style]) })}
              className="mx-0.5 size-[14px] rounded-full transition-transform hover:scale-110 disabled:opacity-40"
              style={{ background: dot }}
            />
          ))}
          <span aria-hidden className="mx-1 h-4 w-px bg-line" />
          <button onMouseDown={keep} disabled={!focusedBlock} onClick={() => applyIndent(-1)} aria-label={t("panes.outdentLine")} data-tooltip={t("panes.outdentLine")} className={barButton}>
            ⇤
          </button>
          <button onMouseDown={keep} disabled={!focusedBlock} onClick={() => applyIndent(1)} aria-label={t("panes.indentLine")} data-tooltip={t("panes.indentLine")} className={barButton}>
            ⇥
          </button>
          <span aria-hidden className="mx-1 h-4 w-px bg-line" />
          <button
            onMouseDown={keep}
            disabled={!focusedBlock}
            onClick={() => {
              if (focusedBlockId && confirm(t("panes.confirmRemoveParagraph"))) {
                void onDeleteBlock(focusedBlockId);
              }
            }}
            data-tooltip={t("panes.removeParagraphTitle")}
            className="rounded-full px-2.5 py-1 text-[11.5px] font-semibold text-red-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950"
          >
            {t("panes.removeParagraph")}
          </button>
        </div>
      )}

      <article className="reader-prose mx-auto w-full max-w-[720px] px-6 py-11 print:py-0" style={{ fontFamily }}>
        <p className="mb-2.5 text-[11px] font-bold tracking-[0.09em] text-clay-700 uppercase print:hidden">
          {t(mode === "edit" ? "panes.documentBlocksEditing" : "panes.documentBlocks", {
            n: blocks.length,
          })}
        </p>
        {documentId ? (
          <DocumentTitle documentId={documentId} title={title} />
        ) : (
          <h2 className="mb-[26px] text-[33px]">{title}</h2>
        )}

        {blocks.map((block, i) =>
          block.type === "PAGE" && pages && documentId ? (
            <div key={block.id}>
              <PageBlock
                documentId={documentId}
                notebookId={pages.notebookId}
                blockId={block.id}
                text={block.text}
                marks={pages.marksByBlock[block.id] ?? []}
                canEdit={pages.canEdit && mode === "read"}
                hint={i === firstPageIndex}
              />
              {i === lastPageIndex && (
                <ConversionStrip
                  documentId={documentId}
                  conversion={pages.conversion}
                  hasText={hasTextBlocks}
                  canEdit={pages.canEdit}
                />
              )}
            </div>
          ) : mode === "edit" ? (
            <div key={block.id} className="group/block">
              {TEXT_TYPES.has(block.type) ? (
                <EditableBlock
                  block={block}
                  text={effectiveText(block)}
                  kind={effectiveKind(block)}
                  spans={effectiveStyles(block)}
                  edited={editedByBlock[block.id] ?? []}
                  restoreSelectionRef={restoreSelectionRef}
                  pendingFocusRef={pendingFocusRef}
                  onSave={onSaveText}
                  onFocusBlock={setFocusedBlockId}
                />
              ) : (
                <BlockView block={block} highlights={[]} documentId={documentId} />
              )}
              <div className="relative -my-1.5 h-3">
                <button
                  onMouseDown={keep}
                  onClick={() =>
                    void onInsertBlock(block.id).then((id) => {
                      if (id) pendingFocusRef.current = id;
                    })
                  }
                  aria-label={t("panes.insertParagraphHere")}
                  data-tooltip={t("panes.insertParagraphHere")}
                  className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-card px-2.5 py-0.5 text-[11px] font-semibold text-sand-600 opacity-0 shadow-soft transition-opacity hover:bg-clay-100 hover:text-clay-800 hover:opacity-100 focus-visible:opacity-100 group-hover/block:opacity-60"
                >
                  <PlusIcon size={10} />
                  {t("panes.paragraphLower")}
                </button>
              </div>
            </div>
          ) : (
            <BlockView
              key={block.id}
              block={block}
              highlights={highlightsByBlock[block.id]}
              documentId={documentId}
            />
          ),
        )}
        {blocks.length === 0 && (
          <p className="text-sm text-sand-600">{t("panes.noBlocks")}</p>
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
  list: "my-4 pl-5",
  numbered: "my-4 pl-5",
};

// One seamlessly editable block. Decorations (bold, italic, edited color) are
// visible WHILE editing: the initial content is decorated HTML the browser owns.
// Blur reads textContent — the decoration spans flatten back to plain text, so
// offsets stay honest.
function EditableBlock({
  block,
  text,
  kind,
  spans,
  edited,
  restoreSelectionRef,
  pendingFocusRef,
  onSave,
  onFocusBlock,
}: {
  block: BlockData;
  text: string;
  kind: Kind;
  spans: StyleSpan[];
  edited: { start: number; end: number }[];
  restoreSelectionRef: React.MutableRefObject<{ blockId: string; start: number; end: number } | null>;
  pendingFocusRef: React.MutableRefObject<string | null>;
  onSave: (blockId: string, text: string) => Promise<void>;
  onFocusBlock: (blockId: string) => void;
}) {
  const t = useT();
  const ref = useRef<HTMLElement | null>(null);

  const html = decoratedHtml(text, spans, edited);
  // Remount whenever content or decorations change server- or optimistic-side.
  const key = `${block.id}:${text.length}:${html.length}:${kind}`;

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
      // A just-inserted paragraph starts focused, ready to type into.
      if (el && pendingFocusRef.current === block.id) {
        pendingFocusRef.current = null;
        requestAnimationFrame(() => el.focus());
      }
    },
    contentEditable: "plaintext-only" as const,
    suppressContentEditableWarning: true,
    "data-edit-block": block.id,
    "data-placeholder": t("panes.typeHere"),
    onFocus: () => onFocusBlock(block.id),
    onBlur: () => {
      const next = ref.current?.textContent ?? "";
      if (next !== text) void onSave(block.id, next);
    },
    dangerouslySetInnerHTML: { __html: html },
  };
  const editable =
    "rounded-lg outline-none focus:bg-card/60 whitespace-pre-wrap empty:before:content-[attr(data-placeholder)] empty:before:text-sand-500";

  const isList = kind === "list" || kind === "numbered" || block.type === "LIST";
  const base = block.type === "CODE" || block.type === "EQUATION"
    ? "my-4 overflow-x-auto rounded-2xl bg-sand-200 p-4 text-sm"
    : isList
      ? "my-4 pl-5"
      : KIND_CLASS[kind];

  if (block.type === "CODE" || block.type === "EQUATION") {
    return <pre key={key} {...shared} className={`${base} ${editable}`} />;
  }
  if (kind === "h1") return <h1 key={key} {...shared} className={`${base} ${editable}`} />;
  if (kind === "h2") return <h2 key={key} {...shared} className={`${base} ${editable}`} />;
  if (kind === "h3") return <h3 key={key} {...shared} className={`${base} ${editable}`} />;
  if (isList) return <div key={key} {...shared} className={`${base} ${editable}`} />;
  return <p key={key} {...shared} className={`${base} ${editable}`} />;
}

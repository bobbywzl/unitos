"use client";

import type { Editor } from "@tiptap/core";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal, flushSync } from "react-dom";
import { api } from "@/lib/api";
import { formatKind, type BlockKind, type FormatKind } from "@/lib/block-kind";
import { defineKey, defineWord, definableSelection } from "@/lib/define";
import { MARK_SWEPT_EVENT, type MarkSweptDetail } from "@/lib/mark-sweep";
import {
  ACCOUNT_SAVE_MAX_MS,
  ACCOUNT_SAVE_SETTLE_MS,
  applyReadingPosition,
  atReadingPosition,
  chooseReadingPosition,
  LEFT_OFF_MIN_SHARE,
  parseReadingPosition,
  POSITION_HOLD_MS,
  READING_LINE_PX,
  readingPositionKey,
  readingPositionScroll,
  readReadingPosition,
  type BlockPosition,
  type ReadingPosition,
} from "@/lib/reading-position";
import { ACCOUNT_HEADER } from "@/lib/constants";
import { tabAccount } from "@/lib/tab-account";
import type { SourceInput } from "@/lib/anchors/input";
import { anchorableOffset, anchorablePieces, anchorableText } from "@/lib/anchors/dom";
import {
  parseSimplified,
  splitSentences,
  stripSimplifyMarkers,
  type SentenceSpan,
  type SimplifiedSentence,
} from "@/lib/sentences";
import type {
  AnnotationItem,
  AssistantAction,
  AssistantPlan,
  Distillation,
  DistillationView,
  ExtractionView,
  NoteView,
  SectionView,
} from "@/lib/types";
import type { DocumentReference } from "@/lib/parse/types";
import { splitStreamError, splitStreamNote } from "@/lib/derive/config";
import {
  type ChatTurn,
  type ConversationLog,
  parseTranscript,
  type ToolKind,
} from "@/lib/conversation";
import { TranslationBar } from "@/components/reader/translation-bar";
import type { TextStyle, ToggleStyle } from "@/lib/text-style";
import { findWeblinks } from "@/lib/weblinks";
import { isImeKey, useImeGuard } from "@/lib/ime";
import { imageFigureHtml, isImageFile } from "@/lib/images";
import { markdownStyleKey } from "@/lib/markdown-style";
import { reportError } from "@/lib/error-log";
import { isOffline, offlinePremium, queueWrite, refreshWhenOnline } from "@/lib/offline/queue";
import { addEscapeSource, nextLayerSeq } from "@/lib/escape-layers";
import { rememberCollapsedDocument } from "@/lib/collapse-memory";
import { parseYouTubeId, youtubeWatchUrl } from "@/lib/video/youtube";
import type { TFunc, TKey } from "@/lib/i18n/dictionaries";
import {
  ANSWER_MARK,
  AnswerTint,
  AnswerToolbar,
  CommentBox,
  CommentList,
  QuoteChip,
  quoteMessage,
  SideChatChips,
  SideChatHeader,
  useAnswerSelection,
  type AnswerComment,
} from "@/components/assistant/answer-tools";
import type { Person } from "@/lib/person";
import { ThinkingChips, useThinking } from "@/components/assistant/thinking-chips";
import { useWeb, WebChip } from "@/components/assistant/web-chip";
import { SaveAsNote } from "@/components/assistant/save-as-note";
import { QueuedList, queuedKey, type QueuedText } from "@/components/assistant/queued-list";
import { useLang, useT } from "@/components/lang-provider";
import { clipWords, markdownPreview } from "@/lib/markdown-preview";
import { noteTitle } from "@/lib/note-title";
import { AnnotationGrip } from "@/components/outline/annotation-grip";
import { useCardDropOpen } from "@/components/outline/use-card-drop";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckIcon,
  CollapseIcon,
  CommentIcon,
  DefineIcon,
  ExpandIcon,
  TrashIcon,
  ExtractIcon,
  LinkIcon,
  NotesIcon,
  QuestionIcon,
  QuoteIcon,
  ChartIcon,
  RegenerateIcon,
  VisualizeIcon,
  SparkleIcon,
  SpinnerIcon,
  StopIcon,
  SummaryIcon,
  UnlinkIcon,
  VolumeIcon,
} from "@/components/icons";
import { Markdown } from "@/components/markdown";
import { RatingButtons } from "@/components/rating-buttons";
import { Collapse, Presence } from "@/components/presence";
import { StopPill, ThinkingIndicator } from "@/components/thinking";
import { type BlockData, type Highlight, ToolSymbol } from "@/components/reader/block-view";
import { ArticleErrors } from "@/components/reader/article-errors";
import { Bibliography, referenceCard, setReferenceCards } from "@/components/reader/bibliography";
import type { ConversionInfo } from "@/components/reader/conversion-strip";
import { HIGHLIGHT_HUES, HUE_DOT, HUE_KEY } from "@/components/reader/hues";
import type { PageMark } from "@/components/reader/page-block";
import type { PageSize } from "@/lib/handwritten/pages";
import { useCollab } from "@/components/collab/collab-context";
import { TierMark } from "@/components/tier-mark";
import { QUOTE_LANDED_EVENT, useNoteDrop, type DroppedImage } from "@/components/use-note-drop";
import { AuthorChip } from "@/components/collab/person-badge";
import { ConversationView } from "@/components/reader/conversation-view";
import { DistillPage } from "@/components/reader/distill-page";
import { ContentsMenu } from "@/components/reader/contents-menu";
import { NotePicker } from "@/components/reader/note-picker";
import { PANE_HEADER } from "@/components/reader/reader-panes";
import type { FigureRenderInfo } from "@/components/reader/figure-capture";
import { Reader, type TranscriptVariant } from "@/components/reader/reader";
import { setQuoteDragImage, writeQuoteDrag, type QuoteDrag } from "@/lib/quote-drag";
import { blockIdOfKey, coreKey, isCoreKey } from "@/lib/anchors/core-key";
import { MAX_SEGMENTS } from "@/lib/anchors/passage-limit";
import { collapseUnits } from "@/lib/collapse-units";
import { deriveBlocks } from "@/lib/docs/blocks";
import { coreHiding } from "@/components/docs/layer/core-slot";
import { announceCollapseView } from "@/components/panels/layer-switch";
import { startCardDrag } from "@/lib/card-drag";
import { pointsAtText, skipsDrag, watchHold } from "@/lib/hold-drag";
import {
  ANNOTATION_PARAM,
  annotationReferenceHref,
  referenceContent,
  referenceWords,
  type AnnotationReference,
} from "@/lib/annotation-reference";
import { ANNOTATION_KIND_KEY, annotationKindColor } from "@/lib/annotations/kind";
import { NEW_GLOW_CLASS, NewPill, useNewFeature } from "@/components/new-feature";
import type { PageSetup, RichNode } from "@/lib/docs/schema";
import type { DocsMedia, Imported } from "@/components/docs/docs-editor";
import { pageCellSelection, pageEditorIn, pageSelectionOfRange, wordAtCaret } from "@/components/docs/layer/anchor";
import { CardColumn, CommentCard } from "@/components/docs/layer/comment-card";
import { setCommentResolved } from "@/lib/annotations/resolve";
import { COMMENTS_EVENT, flashInPage, PAGE_EDITED_EVENT, type CommentsView } from "@/components/docs/layer/events";
import { registerDocumentFlush } from "@/components/docs/layer/flush";
import { CLOSE_TOOLBAR_EVENT, DOCS_EVENT, fireDocs, type ModeRequest } from "@/components/docs/typing/events";
import { matchesCombo } from "@/components/docs/keys";
import {
  assistantAuthor,
  type ResolvedOp,
  type SuggestEvent,
  type SuggestResult,
} from "@/lib/docs/assistant-suggestions";
import type { SuggestCommand } from "@/lib/prompts/suggest";
import { readNdjson } from "@/lib/ndjson";
import { conflictLabels, saveNoteText } from "@/lib/notes/save-text";
import { reconcileNoteText } from "@/lib/notes/conflict";
import {
  cardCommentKey,
  caretToEnd,
  clearToolbarDraft,
  loadCardDraftBases,
  loadCardDrafts,
  onCardDraftsChange,
  readToolbarDraft,
  useToolbarDraft,
  useToolbarDraftRestore,
  writeCardDrafts,
  writeToolbarDraft,
} from "@/lib/toolbar-drafts";
import {
  publishSuggestRun,
  SUGGEST_EVENT,
  SuggestionRow,
  type SuggestRequest,
} from "@/components/assistant/suggestion-row";
import { FIGURE_ASSISTANT_EVENT, publishFigureSuggestion, splitFigureSuggestions } from "@/components/reader/figure-suggestion";
import {
  belowSlot,
  marginPlace,
  pageGeometry,
  slotAt,
  toolbarLeft,
  toolbarShift,
  type PageGeometry,
} from "@/components/docs/layer/margin";
import { VoiceTypingButton } from "@/components/voice/voice-typing-button";

// One block's span of a selection (SPEC.md §5).
type Segment = Omit<SourceInput, "documentId">;
// A selection: the first block's span, plus every block's span when the
// selection crossed blocks (lib/anchors/passage.ts) — the first segment is
// the anchor itself. Every tool works on the whole passage; the routes take
// `segments` beside `anchor` and give the note one source per block.
type Anchor = Segment & { segments?: Segment[] };

/** The passage's segments: one per block, the anchor alone when the
    selection stayed in one block. */
function segmentsOf(anchor: Anchor): Segment[] {
  return anchor.segments && anchor.segments.length > 0 ? anchor.segments : [anchor];
}

/** Two selections over the same words: every block's span alike. */
function sameAnchor(a: Anchor, b: Anchor): boolean {
  const x = segmentsOf(a);
  const y = segmentsOf(b);
  return (
    x.length === y.length &&
    x.every(
      (s, i) =>
        s.blockId === y[i].blockId &&
        s.startOffset === y[i].startOffset &&
        s.endOffset === y[i].endOffset &&
        s.layer === y[i].layer,
    )
  );
}

/** The element that draws a block's words: a core key's core (SPEC.md §28),
    else the block's whole text. Null when those words are not drawn. */
function drawnBlock(container: HTMLElement, blockId: string): HTMLElement | null {
  const el = isCoreKey(blockId)
    ? container.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockIdOfKey(blockId))}"][data-collapsed]`)
    : container.querySelector<HTMLElement>(
        `[data-block-id="${CSS.escape(blockId)}"]:not([data-collapsed]), [data-edit-block="${CSS.escape(blockId)}"]`,
      );
  return el && el.getClientRects().length > 0 ? el : null;
}

/** Where a passage is drawn, in the container's coordinates: the top of its
    first line, the bottom of its last line, and the bottom of the block that
    holds its last line. Null when no segment's block is drawn. */
function passageBox(
  container: HTMLElement,
  anchor: Anchor,
): { top: number; bottom: number; blockBottom: number; blockId: string } | null {
  const crect = container.getBoundingClientRect();
  const toY = (y: number) => y - crect.top + container.scrollTop;
  let top = Infinity;
  let bottom = -Infinity;
  let blockBottom = -Infinity;
  let blockId = "";
  for (const segment of segmentsOf(anchor)) {
    const el = drawnBlock(container, segment.blockId);
    if (!el) continue;
    const b = el.getBoundingClientRect();
    // The words' own line boxes when the text is walkable; else the block's box.
    let first = b.top;
    let last = b.bottom;
    try {
      const pieces = anchorablePieces(el);
      const at = (offset: number, end: boolean) => {
        const piece = pieces.find((p) =>
          p.node && (end ? offset > p.start && offset <= p.start + p.text.length : offset >= p.start && offset < p.start + p.text.length),
        );
        return piece?.node ? { node: piece.node, offset: offset - piece.start } : null;
      };
      const from = at(segment.startOffset, false);
      const to = at(segment.endOffset, true);
      if (from && to) {
        const range = document.createRange();
        range.setStart(from.node, from.offset);
        range.setEnd(to.node, to.offset);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
        if (rects.length > 0) {
          first = Math.min(...rects.map((r) => r.top));
          last = Math.max(...rects.map((r) => r.bottom));
        }
      }
    } catch {
      // The block's box stands in.
    }
    top = Math.min(top, toY(first));
    if (toY(last) >= bottom) {
      bottom = toY(last);
      blockBottom = toY(b.bottom);
      blockId = segment.blockId;
    }
  }
  return Number.isFinite(top) ? { top, bottom, blockBottom, blockId } : null;
}

/** The passage's text: the segments' quotes, one paragraph each. */
function passageText(anchor: Anchor): string {
  return segmentsOf(anchor)
    .map((s) => s.quotedText)
    .join("\n\n");
}

type Popover = {
  anchor: Anchor;
  x: number;
  y: number;
  yTop: number;
  textLeft: number;
  truncated: boolean; // the selection crossed an equation or a page, which the passage leaves out
  figure?: boolean; // opened by the hold-and-circle gesture on a figure, equation, or table: the anchor is the whole block
  term?: boolean; // opened by clicking a key term; Extract leads, recommended
  page?: { geo: PageGeometry }; // the page editor's page as the toolbar opened (SPEC.md §29)
  // Placement, by proximity to open tool blocks: right of the text first, then
  // left, then directly below the highlighted text. Bases are container coords.
  side: "right" | "left" | "below";
  rightBase: number;
  cw: number;
  // Container coords of the top of the words' first line. A toolbox under
  // the words with no room below them goes above them (above), its bottom
  // over this line.
  wordsTop?: number;
  above?: boolean;
};

// Where the browser's own editing commands belong: a text box, or any
// editable the reader is typing in. Copy, undo, and redo leave these alone —
// the field undoes its own typing, the article's history answers everywhere
// else.
function isTextEntry(el: HTMLElement): boolean {
  return (
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable
  );
}

// Without Shift, these keys drop a selection made with the keyboard.
/** A call that needs a model, outside api() (a stream, or a call that
    must not count in the save indicator). Offline it fails at once with the
    plain message (SPEC.md §17), as api() does, and a request the network
    drops while offline says the same. */
async function fetchWithModel(path: string, init: RequestInit, offlineMessage: string): Promise<Response> {
  if (isOffline()) throw new Error(offlineMessage);
  try {
    return await fetch(path, init);
  } catch (err) {
    if (!init.signal?.aborted && err instanceof TypeError && isOffline()) throw new Error(offlineMessage);
    throw err;
  }
}

/** Whether the browser is online, as React state. */
function subscribeOnline(listener: () => void): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

const CARET_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

// How long a reading position waits for the page editor's words to come
// (its code loads on demand; a long import takes a while to stand).
const PAGE_WAIT_MS = 30_000;

/** The mark a source paints on: its own, or, on stacked words, the mark
    whose words it shares (block-view.tsx data-source-ids). */
function markOfSource(root: ParentNode, sourceId: string): HTMLElement | null {
  return (
    root.querySelector<HTMLElement>(`[data-source-id="${sourceId}"]`) ??
    root.querySelector<HTMLElement>(`[data-source-ids~="${sourceId}"]`)
  );
}

// A jump flashes the mark or the block it lands on; the page editor paints it.
function flashElement(el: HTMLElement) {
  if (flashInPage(el)) return;
  el.classList.add("anchor-flash");
  setTimeout(() => el.classList.remove("anchor-flash"), 2000);
}

// A jump to words in a collapsed unit (SPEC.md §28) reads the unit whole
// first, as the unit's own button does; the rest of the article stays as it
// is. True while the words of any of the blocks are hidden: the jump looks
// again once they are drawn.
function wordsHidden(pane: Element, blockIds: string[], readWhole: (unitId: string) => void): boolean {
  let hidden = false;
  for (const blockId of blockIds) {
    const unitId = coreHiding(pane, blockId)?.dataset.blockId;
    if (!unitId) continue;
    readWhole(unitId);
    hidden = true;
  }
  return hidden;
}

// A block's words in the pane, never the core drawn in their place.
function wordsOf(pane: Element, blockId: string): HTMLElement | null {
  const id = CSS.escape(blockId);
  return pane.querySelector<HTMLElement>(`[data-block-id="${id}"]:not([data-collapsed]), [data-edit-block="${id}"]`);
}

// The rows of a unit (lib/collapse-units.ts): a block document's unit is its
// block; the page's is read from its text, null until the page stands.
function unitRows(pane: Element | null, unitId: string, richText: boolean): string[] | null {
  if (!richText) return [unitId];
  const doc = pageEditorIn(pane)?.state.doc.toJSON() as RichNode | undefined;
  if (!doc) return null;
  return collapseUnits(deriveBlocks(doc), doc).find((u) => u.id === unitId)?.rows ?? [unitId];
}

// Collapse is remembered per document in this browser (SPEC.md §28).
function collapseRemembered(storeKey: string): boolean {
  try {
    return localStorage.getItem(storeKey) === "on";
  } catch {
    return false;
  }
}

// The layer the reader's tools sit on, over the article: the toolbar a
// selection opens, and every card it opens. Above the floating note card
// (z-30) — the tools are what the reader just asked for, and a note card left
// over the article must never cover them — and below the surfaces that take
// the whole window (z-50: the dialogs, the graph, the distilled page).
const TOOL_LAYER = "z-40";
// The selection toolbox is the newest layer whenever it is open: it stands
// over the cards, so a card under it never hides a row the reader is about
// to press (the narrow reader puts cards in the text, under the words).
const TOOLBOX_LAYER = "z-[41]";

// One toolbar per content kind (SPEC.md §6). The popover shows the tools of
// the kind under the selection and nothing else: a tool missing from a
// kind's list is not offered there. The first tool of a kind after the
// assistant is its lead tool and reads as recommended. Define comes before
// the assistant, and only on a selection of one word (offersDefine): the
// first row, right under the highlight colors.
type ContentKind = "text" | "figure" | "equation";
type Tool =
  | "define"
  | "assistant"
  | "analyze"
  | "explain"
  | "simplify"
  | "visualize"
  | "comment"
  | "link"
  | "highlight"
  | "addToNotes"
  | "readAloud";

const TOOLBARS: Record<ContentKind, readonly Tool[]> = {
  text: ["define", "assistant", "explain", "simplify", "visualize", "comment", "link", "highlight", "addToNotes", "readAloud"],
  figure: ["define", "assistant", "analyze", "explain", "comment", "link", "highlight", "addToNotes"],
  equation: ["assistant", "explain", "visualize", "comment", "link", "highlight", "addToNotes"],
};

// The blocks the hold-and-circle gesture opens a toolbar on, whole. A table
// is text (SPEC.md §6): its cells are rendered text, selected like any.
const CIRCLED_TYPES = new Set(["FIGURE", "EQUATION"]);

// A document with one of these blocks takes no new block, a dropped image's
// figure included (lib/block-takes.ts): slides, sheets, a video's or an
// audio's document.
const NO_NEW_BLOCKS = new Set(["SLIDE", "SHEET", "VIDEO", "TRANSCRIPT"]);

function contentKindOf(type: string | undefined): ContentKind {
  if (type === "FIGURE") return "figure";
  if (type === "EQUATION") return "equation";
  return "text";
}

/** Whether the popover offers Define: one whole word selected in one block,
    never a piece of a word, a phrase, words across two table cells, or
    Chinese text (lib/define.ts). Never on the hold-and-circle gesture, whose
    anchor is the whole block. */
function offersDefine(popover: Popover): boolean {
  const { quotedText, prefix, suffix } = popover.anchor;
  return !popover.figure && segmentsOf(popover.anchor).length === 1 && definableSelection(quotedText, prefix, suffix);
}

// Define's output for one popover (SPEC.md §6): the meaning of the selected
// word, shown under the Define row. glossary: the glossary's definition of
// a key term, read with no model call.
type Definition = {
  key: string;
  text: string;
  streaming: boolean;
  error: string | null;
  glossary: boolean;
};

const KIND_LABEL: Record<Exclude<ContentKind, "text">, TKey> = {
  figure: "reader.figureTools",
  equation: "reader.equationTools",
};

type PendingLink = { fromDocumentId: string; anchor: Anchor };

// Opening another document is a navigation that remounts the reader, so a
// pending link held only in state died there — links could close only inside
// one article or an already-open split view. sessionStorage keeps the pending
// link per tab across that remount; scoped to one project, so another
// project's leftover never restores.
const PENDING_LINK_STORE = "unitos-pending-link";

function readStoredPendingLink(notebookId: string): PendingLink | null {
  try {
    const raw = sessionStorage.getItem(PENDING_LINK_STORE);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<PendingLink> & { notebookId?: string };
    if (stored.notebookId !== notebookId) return null;
    if (!stored.fromDocumentId || !stored.anchor?.blockId || !stored.anchor.quotedText) return null;
    return { fromDocumentId: stored.fromDocumentId, anchor: stored.anchor as Anchor };
  } catch {
    return null;
  }
}

function storePendingLink(notebookId: string, pending: PendingLink | null) {
  try {
    if (pending) {
      sessionStorage.setItem(PENDING_LINK_STORE, JSON.stringify({ notebookId, ...pending }));
    } else {
      sessionStorage.removeItem(PENDING_LINK_STORE);
    }
  } catch {
    // Storage can be unavailable (private mode); the link then lives in memory only.
  }
}

// Hold the pointer on a figure and draw a small circle: the figure's tools open.
// Total turning angle ≥ 300° reads as a circle; a straight drag never does.
function circleSweepDegrees(points: { x: number; y: number }[]): number {
  let sweep = 0;
  let prev: { x: number; y: number } | null = null;
  let prevAngle: number | null = null;
  for (const point of points) {
    if (!prev) {
      prev = point;
      continue;
    }
    const dx = point.x - prev.x;
    const dy = point.y - prev.y;
    if (Math.hypot(dx, dy) < 3) continue;
    const angle = Math.atan2(dy, dx);
    if (prevAngle !== null) {
      let d = angle - prevAngle;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      sweep += d;
    }
    prevAngle = angle;
    prev = point;
  }
  return Math.abs((sweep * 180) / Math.PI);
}

// Live geometry of the open tool blocks, in container content coordinates.
// Measured from the DOM so dragged and resized cards count where they are.
type CardRect = { left: number; right: number; top: number; bottom: number };

function measureSideCards(container: HTMLElement | null, excludeKind?: string) {
  if (!container) {
    return { rects: [] as CardRect[], articleLeft: 0, articleRight: 0, wordsLeft: 0, wordsRight: 0, cw: 1200 };
  }
  const crect = container.getBoundingClientRect();
  const arect = container.querySelector("article")?.getBoundingClientRect();
  const cw = container.clientWidth;
  const articleLeft = arect ? arect.left - crect.left : cw;
  const articleRight = arect ? arect.right - crect.left : 0;
  // The words' edges: the article's box less its padding, where a toolbox
  // may still sit without covering a word.
  const article = container.querySelector("article");
  const pad = article ? getComputedStyle(article) : null;
  const wordsLeft = articleLeft + (pad ? parseFloat(pad.paddingLeft) || 0 : 0);
  const wordsRight = articleRight - (pad ? parseFloat(pad.paddingRight) || 0 : 0);
  const rects = [...container.querySelectorAll<HTMLElement>("[data-side-card]")]
    // A card still playing its exit (Presence) holds no place.
    .filter((el) => el.dataset.sideCard !== excludeKind && !el.closest(".presence-exit"))
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left - crect.left,
        right: r.right - crect.left,
        top: r.top - crect.top + container.scrollTop,
        bottom: r.bottom - crect.top + container.scrollTop,
      };
    });
  return { rects, articleLeft, articleRight, wordsLeft, wordsRight, cw };
}

/** The toolbox's side for words whose first line starts at `top` (container
    coords), in the block reader (SPEC.md §6): right of the words when that
    side is clear, else left, else directly below them. A side takes the
    toolbox only with the room for it beside the words: in a narrow pane (a
    split pane, a small window) the toolbox landed on the words it was opened
    for. The toolbox at rest is 176px with a 6px edge margin; pressed against
    the pane's edge it may ride over the words' box by a sliver (the last line
    rarely reaches the box's edge), never by more. */
function toolboxSide(container: HTMLElement, top: number): "right" | "left" | "below" {
  const { rects, articleLeft, articleRight, wordsLeft, wordsRight, cw } = measureSideCards(container);
  const articleMid = (articleLeft + articleRight) / 2;
  const POPOVER_ESTIMATE = 280;
  const TOOLBOX_EDGE = 176 + 6;
  const SLIVER = 40;
  const roomRight = wordsRight - (cw - TOOLBOX_EDGE) <= SLIVER;
  const roomLeft = TOOLBOX_EDGE + 10 - wordsLeft <= SLIVER;
  if (roomRight && blocksOnSide(rects, articleMid, "right", top, POPOVER_ESTIMATE).length === 0) return "right";
  if (roomLeft && blocksOnSide(rects, articleMid, "left", top, POPOVER_ESTIMATE).length === 0) return "left";
  return "below";
}

function blocksOnSide(
  rects: CardRect[],
  articleMid: number,
  side: "right" | "left",
  top: number,
  height: number,
): CardRect[] {
  return rects.filter((r) => {
    const mid = (r.left + r.right) / 2;
    const onSide = side === "right" ? mid >= articleMid : mid < articleMid;
    return onSide && r.top < top + height && r.bottom > top;
  });
}

const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n)}…` : s);

// Format targets of a format_block action, shown in the plan card.
const FORMAT_KIND_KEY: Record<BlockKind, TKey> = {
  paragraph: "reader.kindParagraph",
  h1: "reader.kindH1",
  h2: "reader.kindH2",
  h3: "reader.kindH3",
  list: "reader.kindList",
  numbered: "reader.kindNumbered",
};

/** The concrete target of a plan action, shown before Apply so approval is
    informed: the quote, the section, the color — not just a label. */
function actionDetail(
  action: AssistantAction,
  blocks: BlockData[],
  documents: { id: string; title: string }[],
  t: TFunc,
): string | null {
  const blockText = (id: string) => blocks.find((b) => b.id === id)?.text ?? "";
  switch (action.type) {
    case "highlight":
      return `${t(HUE_KEY[action.color])} · “${clip(action.anchor.quotedText)}”`;
    case "comment":
    case "style":
      return `“${clip(action.anchor.quotedText)}”`;
    case "add_note": {
      const where = action.sectionTitle ?? t("reader.theSection");
      return t("reader.detailInto", { where, quote: clip(action.content) });
    }
    case "add_section":
      return `“${action.title}”`;
    case "edit_block":
      return t("reader.detailTo", { text: clip(action.newText) });
    case "insert_paragraph":
      return `${action.kind && action.kind !== "paragraph" ? `${t(FORMAT_KIND_KEY[action.kind])} · ` : ""}“${clip(action.text)}”`;
    case "remove_block":
      return `“${clip(blockText(action.blockId))}”`;
    case "link": {
      const target =
        action.href ?? documents.find((d) => d.id === action.toDocumentId)?.title ?? t("reader.aDocument");
      return `“${clip(action.anchor.quotedText, 60)}” → ${target}`;
    }
    case "format_block":
      return `“${clip(blockText(action.blockId), 60)}” → ${t(FORMAT_KIND_KEY[action.kind])}`;
    case "move_block":
      return action.afterBlockId === null
        ? t("reader.detailMoveStart", { what: clip(blockText(action.blockId), 50) })
        : t("reader.detailMoveAfter", { what: clip(blockText(action.blockId), 50), after: clip(blockText(action.afterBlockId), 50) });
    case "join_lines":
      return t("reader.detailJoinLines", { first: clip(blockText(action.blockId), 45), second: clip(blockText(action.nextBlockId), 45) });
    case "split_line":
      return t("reader.detailSplitLine", { before: clip(blockText(action.blockId).slice(0, action.offset).trim(), 45), after: clip(action.quote, 45) });
    case "set_speaker":
      return `“${clip(blockText(action.blockId), 60)}” → ${action.name}`;
    case "rename_speaker":
      return `${action.previousName} → ${action.name}`;
    default:
      return null;
  }
}

const ACTION_LABEL_KEY: Record<AssistantAction["type"], TKey> = {
  edit_block: "reader.actionEdit",
  insert_paragraph: "reader.actionAddParagraph",
  remove_block: "reader.actionRemove",
  highlight: "reader.actionHighlight",
  comment: "reader.actionComment",
  add_note: "reader.actionNote",
  add_section: "reader.actionSection",
  link: "reader.actionLink",
  format_block: "reader.actionFormat",
  style: "reader.actionStyle",
  move_block: "reader.actionMove",
  suggest: "reader.actionSuggest",
  revise: "reader.actionRevise",
  join_lines: "reader.actionJoinLines",
  split_line: "reader.actionSplitLine",
  set_speaker: "reader.actionSetSpeaker",
  rename_speaker: "reader.actionRenameSpeaker",
};

// The assistant's commands on selected words (SPEC.md §29), in the chips'
// order: the name the act route takes, and the chip's label.
type Chip = { name: SuggestCommand; key: TKey };
const SUGGEST_CHIPS: Chip[] = [
  { name: "rephrase", key: "reader.commandRephrase" },
  { name: "shorten", key: "reader.commandShorten" },
  { name: "elaborate", key: "reader.commandElaborate" },
  { name: "formal", key: "reader.commandFormal" },
  { name: "casual", key: "reader.commandCasual" },
  { name: "bulleted", key: "reader.commandBulleted" },
  { name: "fix", key: "reader.commandFix" },
];
// The chips on an image (SPEC.md §7, words from a figure): in the bar and in
// the toolbox's Assistant box on a figure. Each sends its command as the
// reader's message and puts the words under the image as a suggestion; a
// typed question is answered in the chat.
const FIGURE_CHIPS: { label: TKey; command: TKey }[] = [
  { label: "reader.figureText", command: "reader.figureTextUnder" },
  { label: "reader.figureKeyPoints", command: "reader.figureKeyPointsUnder" },
];

// A tool's output continued into a conversation — Explain+, Simplify+,
// Analyze+, Visualize+ (SPEC.md §21). Continue opens the box; the turns
// persist on the tool's annotation (Note.conversation) and reopen with it.
// How far the left-off mark's ribbon reaches above its block (reader.tsx
// LeftOffMark): a block whose top is less than this under the pane's top
// edge would hide the mark.
const LEFT_OFF_RIBBON_PX = 16;

// The tinted words of the open toolbar (.selection-mark) as one range.
function tintRange(container: HTMLElement): Range | null {
  const marks = container.querySelectorAll(".selection-mark");
  if (marks.length === 0) return null;
  const last = marks[marks.length - 1];
  const range = document.createRange();
  range.setStart(marks[0], 0);
  range.setEnd(last, last.childNodes.length);
  return range;
}

type ToolChat = {
  conversation: ChatTurn[];
  chatOpen: boolean; // the box is open: Continue was pressed, or turns exist
  input: string;
  busy: boolean; // a turn is in flight
  queue: QueuedText[]; // messages sent while a turn runs; they go out in order (SPEC.md §7)
  // Why the last message did not go: a failed request, or offline. Its words
  // are back in the box (rule zero: nothing typed is lost).
  sendError?: string | null;
};
const NO_CHAT: ToolChat = { conversation: [], chatOpen: false, input: "", busy: false, queue: [], sendError: null };
// What Save as note sends for a tool's card (SPEC.md §7): the output and every
// turn of the conversation it continued into — the reader's messages as the
// question, the output and each answer as the answer.
const savedQuestion = (card: ToolChat) =>
  card.conversation.filter((turn) => turn.role === "user").map((turn) => turn.content).join("\n\n");
const savedAnswer = (output: string, card: ToolChat) =>
  [output, ...card.conversation.filter((turn) => turn.role === "assistant").map((turn) => turn.content)].join("\n\n");

// The card EXPLAIN and ANALYZE stream into (SPEC.md §4, §6): one card, the
// kind sets its title and glyph.
type ExplainBubble = ToolChat & {
  kind: "explain" | "analyze" | "visualize";
  left: number;
  top: number;
  width: number;
  side: "right" | "left"; // which article edge the card docks to
  text: string;
  streaming: boolean;
  error: string | null;
  // VISUALIZE only (SPEC.md §20): the model declined to draw, and this is why.
  declined: string | null;
  anchor: Anchor | null; // the highlighted text this bubble explains
  noteId: string | null; // the persisted annotation; Delete removes it and its mark
  run?: number; // the run streaming into this card (toolRunsRef); none once reopened from a mark
  runError?: string | null; // a Regenerate that did not land: why, under the output that stands
};

// suggestKey: an answer that landed suggestions in the text (SPEC.md §29);
// its row reads the run by this key.
type ChatMessage = ChatTurn & { suggestKey?: string };

// The log card (SPEC.md §21): hovering a mark whose annotation holds a
// conversation shows the conversation's condensed log where the card would
// open — one line per message. Leaving the mark closes it; a click opens the
// card in its place.
type LogCard = {
  sourceId: string;
  noteId: string;
  tool: ToolKind | "assistant";
  anchor: Anchor | null;
  left: number;
  top: number;
  width: number;
  side: "right" | "left";
  log: ConversationLog | null; // null while it loads
  failed: boolean;
};
// Logs fetched this session, by note id: a log is written once per
// conversation length, so a hover on the same conversation asks once.
const logCache = new Map<string, { turns: number; log: ConversationLog }>();
const HOVER_LOG_DELAY = 320;
const HOVER_LOG_LINGER = 220;

// The tool card's title and symbol, with the plus once its output continued
// into a conversation.
const TOOL_PLUS_KEY: Record<ToolKind, TKey> = {
  explain: "reader.explainPlus",
  simplify: "reader.simplifyPlus",
  analyze: "reader.analyzePlus",
  visualize: "reader.visualizePlus",
};
// The assistant as a miniature chat, docked beside the article. anchor = the
// selection the conversation started from; every turn keeps applying to it.
type AssistantChat = {
  anchor: Anchor | null;
  noteId: string | null; // the persisted conversation note; turns update it
  left: number;
  top: number;
  width: number;
  side: "right" | "left";
  messages: ChatMessage[];
  input: string;
  busy: boolean;
  // Side chats off a quote of an answer (SPEC.md §7): each one its own
  // conversation, kept with this one and out of assistant history. openKey =
  // the side chat on screen; quote = the words the next message carries.
  sideChats?: ReaderSideChat[];
  openKey?: string | null;
  quote?: string | null;
  // Messages sent while an answer runs (SPEC.md §7): each goes out, in
  // order, into the thread that was open when it was queued.
  queue?: (QueuedText & { openKey: string | null })[];
  // The box's words of the threads not on screen, by thread ("" the
  // conversation, else the side chat's key): each thread keeps its own.
  inputs?: Record<string, string>;
  // Why the last message did not go; its words are back in the box.
  sendError?: string | null;
};

// Two lots of the reader's words in one box, the older first.
function joinWords(first: string, then: string): string {
  if (!first.trim()) return then;
  if (!then.trim()) return first;
  return `${first.trim()}\n\n${then}`;
}
// A card's draft: the messages queued under it, which never went out, then
// the box's words. A card closed before its queue went out reopens with them
// in its box (SPEC.md §7).
function withQueued(input: string, queued: readonly QueuedText[]): string {
  return queued.reduceRight((text, q) => joinWords(q.content, text), input);
}
// A thread of the assistant card: null the conversation, else a side chat.
function threadInput(chat: AssistantChat, key: string | null): string {
  return (chat.openKey ?? null) === key ? chat.input : (chat.inputs?.[key ?? ""] ?? "");
}
function queuedIn(chat: AssistantChat, key: string | null): QueuedText[] {
  return (chat.queue ?? []).filter((q) => q.openKey === key);
}
// The box shows another thread: the words on screen stay with the thread
// they were typed in, and the other thread's words come back (or `kept`,
// its stored draft).
function switchThread(chat: AssistantChat, key: string | null, kept = ""): AssistantChat {
  const from = chat.openKey ?? null;
  if (from === key) return chat;
  const inputs = { ...chat.inputs, [from ?? ""]: chat.input };
  const input = inputs[key ?? ""] ?? kept;
  delete inputs[key ?? ""];
  return { ...chat, inputs, input, openKey: key, quote: null, sendError: null };
}
// The user message a failed request pushed, taken back out: its words go
// back to the box, never into a turn nobody stored.
function withoutSent<T extends ChatTurn>(turns: T[], sent: string): T[] {
  const last = turns[turns.length - 1];
  return last && last.role === "user" && last.content === sent ? turns.slice(0, -1) : turns;
}
type ReaderSideChat = {
  key: string;
  noteId: string | null;
  quote: string;
  messages: ChatMessage[];
};

// One command's run of the assistant's suggestions (SPEC.md §29), as this
// reader holds it: what it was asked and answered, the suggestions it
// landed, the reasons for the changes it skipped, the notes for the run (a
// failed window, a cap), its stream.
type SuggestionRun = {
  input: string;
  ops: ResolvedOp[];
  ids: string[];
  count: number;
  skipped: string[];
  notes: string[];
  summary: string;
  running: boolean;
  controller: AbortController | null;
};

// The assistant's bar (SPEC.md §29): on a blank document, the commands on
// the selected words run from a bar at the bottom of the pane. Its
// conversation is the selection chat's, anchored to the words; yTop places
// the chat card it can go on in.
type AssistantBar = {
  key: string;
  anchor: Anchor;
  // Opened on an image (SPEC.md §7, words from a figure): its chips read the image.
  figure?: boolean;
  yTop: number;
  wordsBottom: number; // the selection's last line's bottom, container coords
  noteId: string | null;
  messages: ChatMessage[];
  input: string;
  busy: boolean;
  error: string | null;
};

// The page editor's suggestion code, loaded with the first command: the
// reader loads for every document, this code only for a blank document.
const suggestCode = () =>
  Promise.all([import("@/components/docs/ext/suggest"), import("@/components/docs/suggest/assistant")]).then(
    ([ext, assistant]) => ({
      readSuggestions: ext.readSuggestions,
      settleSuggestions: ext.settleSuggestions,
      applyAssistantOps: assistant.applyAssistantOps,
    }),
  );

// SIMPLIFY output: a translucent bubble beside the article, level with the
// selection. The selection stays tinted while the bubble is open (SPEC.md §6).
type SimplifyCard = ToolChat & {
  anchor: Anchor;
  top: number;
  left: number;
  width: number;
  side: "right" | "left";
  text: string;
  streaming: boolean;
  error: string | null;
  noteId: string | null; // the persisted annotation; Delete removes it and its mark
  // Set when the stream ends and the output carried source markers: one entry
  // per simplified sentence. active = the pressed sentence, mirrored in the text.
  sentences: SimplifiedSentence[] | null;
  active: number | null;
  run?: number; // the run streaming into this card (toolRunsRef); none once reopened from a mark
  runError?: string | null; // a Regenerate that did not land: why, under the output that stands
};

// The card that opens once a link closes: the two ends, and a box for what
// the link is about (stored as the link's reason; shown in the link's tip and
// in the Annotations tab).
type LinkCard = {
  linkId: string;
  anchor: Anchor; // this document's end the card docks beside
  fromQuote: string;
  toQuote: string;
  left: number;
  top: number;
  width: number;
  side: "right" | "left";
  draft: string;
  busy: boolean;
};

// A link made in this session, painted before the refresh delivers the
// server's copy — one entry per end that lies in this document.
type LocalLink = {
  linkId: string;
  blockId: string;
  start: number;
  end: number;
  href: string;
  title: string;
  reason: string | null;
};

// The gap a pushed card keeps from the card above it (SPEC.md §6).
const SETTLE_GAP = 12;

// On-mark card for a highlight or comment: opens on its mark, edits the
// comment, recolors, deletes — no trip to the Annotations tab.
type AnnotationCard = {
  sourceId: string;
  noteId: string;
  kind: "highlight" | "comment";
  color: string | null;
  quotedText: string | null;
  draft: string;
  saved: string; // comment as loaded; Save enables on change
  top: number;
  left: number;
  width?: number; // set by the page editor's margin (SPEC.md §29) and the side dock; else 300
  side?: "right" | "left"; // the block reader docks it beside the words like a side card
  anchor?: Anchor | null; // the marked words, for the dock under them in a narrow reader
  busy: boolean;
};

// English plural suffix for count phrases ({s} in reader.* keys); zh templates
// omit {s}.
const plural = (n: number) => (n === 1 ? "" : "s");

// A side card never covers a word (SPEC.md §6): it is 260-320 wide and
// keeps 26px from the words — the marks' chips stand in that margin
// (block-view.tsx data-margin-chip) — and 8px from the pane's edge.
const CARD_MIN = 260;
const CARD_MAX = 320;
const CARD_EDGE = 8;
const CARD_WORDS_GAP = 26;

/** The column as it stands at rest with no room made for cards: what
    measureSideCards reads, less the shift the pane made (--cards-room). */
type ColumnAtRest = {
  articleLeft: number;
  articleRight: number;
  wordsLeft: number;
  wordsRight: number;
  cw: number;
};
function columnAtRest(
  m: { articleLeft: number; articleRight: number; wordsLeft: number; wordsRight: number; cw: number },
  shift: number,
): ColumnAtRest {
  return {
    articleLeft: m.articleLeft + shift,
    articleRight: m.articleRight + shift,
    wordsLeft: m.wordsLeft + shift,
    wordsRight: m.wordsRight + shift,
    cw: m.cw,
  };
}

/** Where cards fit beside the words (SPEC.md §6): a side whose margin holds a
    card takes one; when neither does, the column moves left (shift) to make
    the room on the right; when even that leaves no room, null — the narrow
    reader, where a card opens under the paragraph and the text below makes
    room for it. */
function cardRoom(col: ColumnAtRest): { right: boolean; left: boolean; shift: number } | null {
  const right = col.cw - col.wordsRight - CARD_WORDS_GAP - CARD_EDGE;
  const left = col.wordsLeft - CARD_WORDS_GAP - CARD_EDGE;
  if (right >= CARD_MIN || left >= CARD_MIN) return { right: right >= CARD_MIN, left: left >= CARD_MIN, shift: 0 };
  const need = Math.ceil(CARD_MIN - right);
  // The words keep 16px from the pane's left edge.
  if (col.wordsLeft - need >= 16) return { right: true, left: false, shift: need };
  return null;
}

/** Horizontal dock for a side card beside the words on its side, with the
    column moved left by `shift`. */
function dockSideCard(side: "right" | "left", col: ColumnAtRest, shift = 0) {
  if (side === "right") {
    const wordsRight = col.wordsRight - shift;
    const margin = col.cw - wordsRight - CARD_WORDS_GAP - CARD_EDGE;
    const width = Math.max(CARD_MIN, Math.min(CARD_MAX, margin));
    const left = Math.max(wordsRight + CARD_WORDS_GAP, Math.min(col.articleRight - shift + 16, col.cw - width - CARD_EDGE));
    return { left, width };
  }
  const margin = col.wordsLeft - CARD_WORDS_GAP - CARD_EDGE;
  const width = Math.max(CARD_MIN, Math.min(CARD_MAX, margin));
  const left = Math.min(col.wordsLeft - CARD_WORDS_GAP - width, Math.max(CARD_EDGE, col.articleLeft - width - 16));
  return { left, width };
}

/** Horizontal dock for a narrow reader: under the paragraph, at the column's
    width. The text below the paragraph moves down to make the room
    (layoutNarrowCards), so the card covers no word. */
function dockBelowCard(articleLeft: number, articleRight: number, cw: number) {
  const width = Math.min(Math.max(280, articleRight - articleLeft), cw - 16);
  const left = Math.max(8, Math.min(articleLeft, cw - width - 8));
  return { left, width };
}

/** Where a side card sits: what claimSideSlot returns, and what a card keeps
    when it regenerates in place. */
type SideSlot = { left: number; top: number; width: number; side: "right" | "left" };

/** One row of the match card: a quote that jumps to its text in the article.
    The origin phrase reads solid, a passage dashed — the same as the marks.
    A span the article no longer holds does not jump. */
function ExtractRow({
  span,
  origin,
  onJump,
  t,
}: {
  span: { blockId: string; start: number; end: number; quotedText: string; orphaned: boolean };
  origin?: boolean;
  onJump: (span: { blockId: string; start: number; end: number }) => void;
  t: TFunc;
}) {
  const border = origin ? "border-solid border-clay-400" : "border-dashed border-sand-300";
  if (span.orphaned) {
    return (
      <p
        data-tip={t("panes.anchorUnresolvedChanged")}
        className={`line-clamp-2 border-l-2 ${border} pl-2 text-xs text-sand-400`}
      >
        {span.quotedText}
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onJump(span)}
      data-track="extract-card-jump"
      data-tip={t("panes.jumpToPassage")}
      className={`line-clamp-2 border-l-2 ${border} pl-2 text-left text-xs text-sand-600 hover:border-clay-500 hover:text-ink`}
    >
      {span.quotedText}
    </button>
  );
}

// The anchors that paint, by block id (by core key for a core, lib/anchors/core-key.ts).
type AnchorHighlightMap = Record<
  string,
  {
    sourceId: string;
    start: number;
    end: number;
    color: string | null;
    annotation: boolean;
    comment: boolean;
    figureLabel: string | null;
    noteId: string;
  }[]
>;

// The account's copy of the reading position (SPEC.md §6,
// PUT /api/documents/[documentId]/position). Fire and forget, like click
// telemetry, and never in the save indicator: a lost save costs a place, not
// work. keepalive lets it outlive the page. The tab's account rides along, so
// a tab the browser has since signed into another account saves nothing.
function saveAccountPosition(documentId: string, position: BlockPosition, keepalive: boolean): void {
  const account = tabAccount();
  fetch(`/api/documents/${documentId}/position`, {
    method: "PUT",
    keepalive,
    headers: { "Content-Type": "application/json", ...(account ? { [ACCOUNT_HEADER]: account } : {}) },
    body: JSON.stringify({
      blockId: position.blockId,
      offset: position.offset,
      height: position.height,
      at: Math.round(position.at),
    }),
  }).catch(() => {
    // offline, or the network dropped: the tab's copy still holds the place
  });
}

// Client layer over the reader: selection capture, popover, EXPLAIN bubble,
// SIMPLIFY bubble, SALIENCE overlay toggle, DISTILL page, the article menu,
// jump-to-anchor.
export function ReaderInteractions({
  documentId,
  notebookId,
  sectionChoices,
  sections = [],
  attachedDocuments,
  title,
  blocks,
  anchorHighlights: wholeAnchorHighlights,
  coreHighlights,
  annotationsBySource,
  annotationBubbles,
  split = false,
  paneHeader,
  embedded,
  distillations,
  extractions,
  termsByBlock,
  linksByBlock,
  editedByBlock,
  stylesByBlock,
  contentsLinksByBlock,
  citationsByBlock,
  references,
  pageMarksByBlock,
  pageSizeByBlock,
  conversion,
  font,
  columnWidth,
  captionGaps,
  figureRender,
  translationAvailable,
  transcript,
  richText = null,
  accountPosition,
  collapsedCores = null,
}: {
  documentId: string;
  notebookId: string;
  /** The document's cores when this browser reads it collapsed (SPEC.md
      §28, lib/collapse-memory.ts), sent with the page so the article comes
      up collapsed on the first paint; null = whole. */
  collapsedCores?: Record<string, string> | null;
  /** The account's copy of the reading position in this document (SPEC.md
      §6), as the page read it; null = none yet. The reader opens there when
      it is newer than the tab's copy. */
  accountPosition?: BlockPosition | null;
  /** DEEPL_API_KEY is set: the Translate offer shows when the languages differ (SPEC.md §19). */
  translationAvailable: boolean;
  // A video document's transcript (SPEC.md §11): the blocks are its lines,
  // the player and the video tools render above them, and every text tool of
  // an article works on the lines. No edit mode, no article menu.
  transcript?: TranscriptVariant;
  sectionChoices: { id: string; label: string }[];
  /** The project's sections with their notes: the notes Add to a note… can
      append to (SPEC.md §6). Absent = the row is not offered. */
  sections?: SectionView[];
  attachedDocuments: { id: string; title: string }[];
  title: string;
  blocks: BlockData[];
  anchorHighlights: AnchorHighlightMap;
  // The collapsed view's anchors (SPEC.md §28), by block id: they paint on
  // the block's core. Merged with the rest under the "core:" key.
  coreHighlights?: AnchorHighlightMap;
  // Highlights and comments by source id: their marks open on-page edit
  // controls — recolor, comment text, delete.
  annotationsBySource: Record<
    string,
    {
      noteId: string;
      kind: "highlight" | "comment";
      color: string | null;
      content: string;
      quotedText: string | null;
      createdById?: string | null;
    }
  >;
  // Stored EXPLAIN, SIMPLIFY, ANALYZE, comment, and assistant conversation
  // content by source id: clicking their mark (or icon) reopens the card with
  // this content. conversation: the turns after a tool's output (Explain+,
  // Simplify+, Analyze+, Visualize+) or the assistant conversation's own;
  // a mark with turns shows the log on hover (SPEC.md §21).
  annotationBubbles: Record<
    string,
    {
      kind: "explain" | "simplify" | "analyze" | "visualize" | "comment" | "assistant";
      content: string;
      noteId: string;
      conversation: ChatTurn[];
      // Another block of a passage across blocks: the same card, and no
      // symbol of its own (the passage's first block carries it).
      chipless?: boolean;
    }
  >;
  // A split view (SPEC.md §6): the pane header row replaces the floating
  // chrome, and tool cards stay collapsed to their symbols until clicked.
  split?: boolean;
  // The pane's document select, at the head of the pane header.
  paneHeader?: React.ReactNode;
  /** The article card in the video pane (SPEC.md §11): the layer renders inside
      another reader's scroller. No article menu, no Extract, no reading
      position, no scroll box of its own; the selection toolbar, marks, links,
      and edit mode work as on any document. */
  embedded?: boolean;
  // Stored distillations for this document, newest first, quotes healed
  // against the current blocks.
  distillations: DistillationView[];
  // Stored extractions for this document, oldest first (labels M1…), spans
  // healed against the current blocks.
  extractions: ExtractionView[];
  termsByBlock: Record<string, { start: number; end: number; definition: string }[]>;
  linksByBlock: Record<
    string,
    {
      linkId: string;
      start: number;
      end: number;
      href: string;
      title: string;
      reason: string | null; // what the link is about, typed after Close link
    }[]
  >;
  editedByBlock: Record<string, { start: number; end: number }[]>;
  stylesByBlock: Record<
    string,
    {
      start: number;
      end: number;
      style: TextStyle;
    }[]
  >;
  // Contents links (targetBlockId: click scrolls the reader to that block) and
  // PDF hyperlinks (href: a plain hyperlink out of the app).
  contentsLinksByBlock: Record<
    string,
    { start: number; end: number; targetBlockId?: string; href?: string }[]
  >;
  citationsByBlock: Record<string, { start: number; end: number; referenceId: string }[]>;
  references: DocumentReference[];
  // Handwritten document (SPEC.md §16): stored marks per PAGE block, and the
  // conversion status for the strip under the pages. conversion null = not a
  // handwritten document.
  pageMarksByBlock: Record<string, PageMark[]>;
  // The stored page image's pixels per PAGE block: the page's shape before
  // its image arrives. Missing = the size is not known yet.
  pageSizeByBlock: Record<string, PageSize>;
  conversion: ConversionInfo | null;
  font: string | null;
  // The page's text column width in px (Document.columnWidth): the article
  // column's width. Null = the reader's default.
  columnWidth: number | null;
  // The captions left without their figure and the browser render's state
  // (figure-capture.tsx): the reader marks each figure's place.
  captionGaps: { id: string; label: string }[];
  figureRender: FigureRenderInfo;
  /** A blank document or an import (SPEC.md §29): its rich text, revision,
      and page setup, an import's page data, and the figures' media and page
      labels of an import or its copy. The page editor takes the article's
      place; there is no reading mode and no block edit mode, and every tool
      of this layer works on its text. */
  richText?: { doc: RichNode; rev: number; pageSetup: PageSetup; imported?: Imported | null; media?: DocsMedia | null } | null;
}) {
  // The whole text's anchors and the collapsed view's, one map: a core's
  // anchors under its core key, so marks, local marks, and cards find them
  // like any block's (SPEC.md §28).
  const anchorHighlights = useMemo<AnchorHighlightMap>(() => {
    if (!coreHighlights || Object.keys(coreHighlights).length === 0) return wholeAnchorHighlights;
    const merged: AnchorHighlightMap = { ...wholeAnchorHighlights };
    for (const [blockId, list] of Object.entries(coreHighlights)) merged[coreKey(blockId)] = list;
    return merged;
  }, [wholeAnchorHighlights, coreHighlights]);
  const router = useRouter();
  const searchParams = useSearchParams();
  // Stable translator: mount-time closures (effects, async handlers) keep this
  // identity but always read the current language through the ref.
  const tCtx = useT();
  // Viewers on a shared corpus read only: no selection tools, no edit mode,
  // no assistant. The server rejects their writes; this keeps the surface honest.
  const { canEdit, premium, ultra, billing, myId, people } = useCollab();
  // Billing on (SPEC.md §24): the Ultra message offers the plan page.
  const plansAction = billing
    ? { label: tCtx("billing.plans"), run: () => window.open("/billing", "_blank", "noopener") }
    : null;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const tRef = useRef(tCtx);
  tRef.current = tCtx;
  const t: TFunc = useCallback((key, params) => tRef.current(key, params), []);
  // The app language, read through a ref by mount-time closures (voice input).
  const langCtx = useLang();
  const langRef = useRef(langCtx);
  langRef.current = langCtx;
  const ime = useImeGuard();
  const containerRef = useRef<HTMLDivElement>(null);
  const [popover, setPopover] = useState<Popover | null>(null);
  // Read by the Ctrl/Cmd+C handler below, a mount-time effect with no deps.
  const popoverRef = useRef(popover);
  popoverRef.current = popover;
  // The popover's submenus (section list, link targets) are custom lists, not
  // native selects: the popover preventDefaults mousedown to keep the text
  // selection alive, which also keeps a native select from ever opening.
  const [submenu, setSubmenu] = useState<null | "add" | "ai" | "comment" | "define">(null);
  // Kept per selection as a toolbar draft (lib/toolbar-drafts.ts) until the save lands.
  const [commentDraft, setCommentDraft] = useToolbarDraft("comment", documentId, popover?.anchor ?? null);
  // The Add to notes bubble (SPEC.md §6): the comment that goes under the
  // quote, and whether the bubble lists the sections for a new note or the
  // notes to append to. Keyed to the selection it was typed for: a new
  // selection starts the bubble over, so a comment typed for one passage
  // does not go under another.
  const [addDraft, setAddDraft] = useState<{ key: string | null; comment: string; mode: "sections" | "notes" }>({
    key: null,
    comment: "",
    mode: "sections",
  });
  // The page editor's right-click Explain, waiting for its popover (below).
  const [pendingExplain, setPendingExplain] = useState(false);
  // The lead tool Jev predicts for a popover (SPEC.md §6), keyed by the
  // popover it answers: another popover reads it as null until its own
  // answer lands. Null answers: no key, no confident answer, a fixed lead.
  const [leadAnswer, setLeadAnswer] = useState<{ key: string; tool: Tool } | null>(null);
  // Define (SPEC.md §6): the open popover's definition, the call on its way,
  // and every definition read this session by block and word, so pressing
  // Define on the same word again costs no call.
  const [definition, setDefinition] = useState<Definition | null>(null);
  const defineAbortRef = useRef<AbortController | null>(null);
  const definitionCacheRef = useRef(new Map<string, string>());
  // The New glow (SPEC.md §18) on the Define row until it is pressed.
  const defineNew = useNewFeature("define");
  // The glossary's definitions by term (lib/glossary.ts): Define on a key
  // term shows the glossary's definition at once, with no model call.
  const glossaryDefinitions = useMemo(() => {
    const byTerm = new Map<string, string>();
    for (const block of blocks) {
      for (const term of termsByBlock[block.id] ?? []) {
        if (term.definition) byTerm.set(defineKey(block.text.slice(term.start, term.end)), term.definition);
      }
    }
    return byTerm;
  }, [blocks, termsByBlock]);
  // The page is only editable in edit mode; reading mode never opens editors.
  const [editMode, setEditMode] = useState(false);
  // A blank document's page editor is always the place to type: the block
  // edit mode, its double-click, and its hint never apply to it.
  const richTextRef = useRef(richText);
  richTextRef.current = richText;
  const [bubble, setBubble] = useState<ExplainBubble | null>(null);
  const [busy, setBusy] = useState(false);
  const [simplifyCard, setSimplifyCard] = useState<SimplifyCard | null>(null);
  // The cards as last drawn, for a run that lands after a later run took its card.
  const bubbleRef = useRef(bubble);
  bubbleRef.current = bubble;
  const simplifyCardRef = useRef(simplifyCard);
  simplifyCardRef.current = simplifyCard;
  // The distilled page: ask view (shownId null) or one distillation. A fresh
  // result shows from local state until the refresh delivers it as a prop.
  const [distillOpen, setDistillOpen] = useState(false);
  const distillOpenRef = useRef(false);
  distillOpenRef.current = distillOpen;
  // The full conversation view (SPEC.md §21): which open card's conversation
  // is read whole over the pane. The card stays open under it, so the same
  // box sends from either place.
  const [conversationView, setConversationView] = useState<
    "assistant" | "explain" | "simplify" | null
  >(null);
  const conversationViewRef = useRef(false);
  conversationViewRef.current = conversationView !== null;
  const conversationReturnScroll = useRef<number | null>(null);
  // The reading position survives a full page load, a remount, a new tab,
  // and another device (lib/reading-position.ts): a note, an annotation, or
  // an AI tool refreshes the page, and when the refresh turns into a full
  // load (a new deploy, a dropped response) the reader came back at the top
  // (reader report); and a reader who comes back another day starts where
  // they left off. Two copies, each the block at the reading line and its
  // offset: the tab's, saved as the reader scrolls, and the account's, saved
  // a little later. On open the newer one wins. The workspace's inline
  // script applies it before the first paint; this re-applies it after
  // hydration and holds it while the layout under it settles — a figure
  // above the position loading late moves everything below it — until the
  // reader scrolls. The left-off mark goes above the position's block. A
  // ?src, ?block, or ?link jump wins: with one in the URL nothing restores,
  // and the mark still shows.
  const positionStoreKey = readingPositionKey(documentId);
  const jumpOnOpen = useRef(
    Boolean(searchParams.get("src") || searchParams.get("block") || searchParams.get("link")),
  );
  // A transcript keeps the tab's copy alone (playback moves its pane) and
  // has no left-off mark; an embedded layer keeps no position at all.
  const isTranscript = transcript !== undefined;
  const keepsAccountCopy = !isTranscript && !embedded;
  // The account's copy as it was when the document opened: a refresh that
  // brings this tab's own later save moves neither the reader nor the mark.
  const [accountAtOpen] = useState(() => (keepsAccountCopy ? (accountPosition ?? null) : null));
  // When the reader last moved in this document, ms by this browser's clock:
  // the time both copies carry, so the newer copy wins on the next open.
  const lastMovedAt = useRef(0);
  // The block the left-off mark sits above (reader.tsx LeftOffMark).
  const [leftOffBlockId, setLeftOffBlockId] = useState<string | null>(null);
  // While the hold keeps the stored position, saves pause: a clamped
  // intermediate position must not overwrite the stored one.
  const positionHeld = useRef(false);
  useLayoutEffect(() => {
    const container = containerRef.current;
    // An embedded layer does not scroll: the pane around it keeps the position.
    if (!container || embedded) return;
    let tabCopy: ReadingPosition | null = null;
    try {
      tabCopy = parseReadingPosition(sessionStorage.getItem(positionStoreKey));
    } catch {
      tabCopy = null; // storage unavailable: the account's copy alone
    }
    const chosen = chooseReadingPosition(tabCopy, accountAtOpen);
    if (!chosen) return;
    const { position, resume } = chosen;
    lastMovedAt.current = position.at;
    // The mark shows once the position is past the first screen: a reader
    // still on it has no place to come back to.
    if (!isTranscript && "blockId" in position) {
      const top = readingPositionScroll(container, position, resume);
      if (top !== null && top >= container.clientHeight * LEFT_OFF_MIN_SHARE) {
        setLeftOffBlockId(position.blockId);
      }
    }
    if (jumpOnOpen.current) return;
    let expected = applyReadingPosition(container, position, resume);
    // The tab's copy restores the exact place, which can leave the block's
    // top above the pane's edge (the reader was past its first lines): the
    // mark then stands above the first block whose top shows, the block the
    // reader reads into next, as the page editor's does (docs/layer/left-off.ts).
    // A block that runs past the pane's bottom keeps it. The scroll never
    // moves for the mark.
    if (expected !== null && !resume && !isTranscript && !richTextRef.current && "blockId" in position) {
      const crect = container.getBoundingClientRect();
      const blockEls = [...container.querySelectorAll<HTMLElement>("article [data-block-id]")];
      const at = blockEls.findIndex((el) => el.dataset.blockId === position.blockId);
      const block = at >= 0 ? blockEls[at] : null;
      if (block && block.getBoundingClientRect().top < crect.top + LEFT_OFF_RIBBON_PX) {
        const next = blockEls
          .slice(at + 1)
          .find((el) => el.getClientRects().length > 0 && el.getBoundingClientRect().top >= crect.top + LEFT_OFF_RIBBON_PX);
        const nextId = next?.dataset.blockId;
        if (next && nextId && next.getBoundingClientRect().top < crect.bottom && block.getBoundingClientRect().bottom < crect.bottom) {
          setLeftOffBlockId((shown) => (shown === position.blockId ? nextId : shown));
        }
      }
    }
    // The page editor's words come after the pane: its code loads on demand,
    // and the editor stands a moment later. Until then the position waits
    // for its block (PAGE_WAIT_MS at most), then holds as on any document.
    let placed = expected !== null;
    const waits = !placed && richTextRef.current !== null && "blockId" in position;
    if (!placed && !waits) return; // the block is gone (a re-parse): nothing to hold
    positionHeld.current = true;
    // The browser's own scroll anchoring would keep whichever block it picked
    // at the pane's edge; while the hold runs, the stored block is the anchor.
    const overflowAnchor = container.style.overflowAnchor;
    container.style.overflowAnchor = "none";
    const article = container.querySelector("article") ?? container;
    let held = true;
    // The reader took over (a scroll, a touch, the timer): saves resume.
    const release = () => {
      if (!held) return;
      held = false;
      positionHeld.current = false;
      container.style.overflowAnchor = overflowAnchor;
      observer.disconnect();
      pageWatch.disconnect();
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("wheel", release);
      container.removeEventListener("touchmove", release);
      container.removeEventListener("pointerdown", release);
      clearTimeout(timer);
    };
    // The effect ends (a document switch, or a development re-run): the
    // stored position stands, so the save on unmount below skips.
    const cleanup = () => {
      if (!held) return;
      release();
      positionHeld.current = true;
    };
    const hold = () => {
      if (!positionHeld.current) return;
      const next = applyReadingPosition(container, position, resume);
      if (next === null) {
        // Not on screen: the page editor is still coming, or the block is gone.
        if (placed || pageEditorIn(container)) release();
        return;
      }
      expected = next;
      if (placed) return;
      // The page editor's words are here: the hold runs from now, and its
      // page's size changes (pagination, figures loading) hold the place.
      placed = true;
      if (!isTranscript && "blockId" in position) {
        const top = readingPositionScroll(container, position, resume);
        if (top !== null && top >= container.clientHeight * LEFT_OFF_MIN_SHARE) setLeftOffBlockId(position.blockId);
      }
      clearTimeout(timer);
      timer = setTimeout(release, POSITION_HOLD_MS);
      const page = container.querySelector("article");
      if (page) observer.observe(page);
    };
    const onScroll = () => {
      // The hold's own moves land on expected. Any other scroll is the
      // reader's, or a jump the reader asked for: the hold ends.
      if (container.scrollTop === expected || atReadingPosition(container, position, resume)) return;
      release();
    };
    const observer = new ResizeObserver(hold);
    observer.observe(article);
    // The page editor's words and its page breaks change the pane's content
    // without resizing a box the observer above watches.
    const pageWatch = new MutationObserver(hold);
    if (waits) pageWatch.observe(container, { childList: true, subtree: true });
    container.addEventListener("scroll", onScroll, { passive: true });
    container.addEventListener("wheel", release, { passive: true });
    container.addEventListener("touchmove", release, { passive: true });
    container.addEventListener("pointerdown", release);
    let timer = setTimeout(release, placed ? POSITION_HOLD_MS : PAGE_WAIT_MS);
    return cleanup;
  }, [positionStoreKey, embedded, isTranscript, accountAtOpen]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container || embedded) return;
    let raf = 0;
    // The account's copy saves once the reader stops scrolling
    // (ACCOUNT_SAVE_SETTLE_MS), at least every ACCOUNT_SAVE_MAX_MS while
    // they keep scrolling, and at once when the tab hides, the page goes, or
    // the document closes. Only a move since the last save sends one.
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let maxTimer: ReturnType<typeof setTimeout> | null = null;
    let accountDirty = false;
    // The position, read live while the pane shows the article, else the
    // last one read: a document switch removes the pane before this
    // effect's cleanup runs (a removed pane reads as the top of the
    // document), and a page opened over the article scrolls the pane.
    let lastRead: ReadingPosition | null = null;
    const readPosition = (): ReadingPosition | null => {
      if (container.isConnected && !distillOpenRef.current && !conversationViewRef.current) {
        lastRead = readReadingPosition(container, lastMovedAt.current);
      }
      return lastRead && { ...lastRead, at: lastMovedAt.current };
    };
    const saveAccount = (keepalive: boolean) => {
      if (settleTimer) clearTimeout(settleTimer);
      if (maxTimer) clearTimeout(maxTimer);
      settleTimer = null;
      maxTimer = null;
      if (!accountDirty || positionHeld.current) return;
      accountDirty = false;
      const position = readPosition();
      if (position && "blockId" in position) saveAccountPosition(documentId, position, keepalive);
    };
    const save = () => {
      raf = 0;
      // The distilled page and the extract page scroll the pane to the top while open; that
      // is not a reading position. While the hold above keeps the stored
      // position, the stored one stands.
      if (
        distillOpenRef.current ||
        conversationViewRef.current ||
        positionHeld.current
      )
        return;
      const position = readPosition();
      if (!position) return; // not read yet: the stored position stands
      try {
        sessionStorage.setItem(positionStoreKey, JSON.stringify(position));
      } catch {
        // storage unavailable: nothing to remember
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(save);
      // The reader moved — not the hold's own moves, not a page opened over
      // the article, not a layout shift in a tab out of sight.
      if (
        positionHeld.current ||
        distillOpenRef.current ||
        conversationViewRef.current ||
        document.visibilityState !== "visible"
      )
        return;
      lastMovedAt.current = Date.now();
      if (!keepsAccountCopy) return;
      accountDirty = true;
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => saveAccount(false), ACCOUNT_SAVE_SETTLE_MS);
      maxTimer ??= setTimeout(() => saveAccount(false), ACCOUNT_SAVE_MAX_MS);
    };
    const onPageHide = () => {
      save();
      saveAccount(true);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") saveAccount(true);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      container.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
      if (raf) cancelAnimationFrame(raf);
      save();
      saveAccount(true);
    };
  }, [positionStoreKey, embedded, keepsAccountCopy, documentId]);
  const [distillShownId, setDistillShownId] = useState<string | null>(null);
  const [distillRun, setDistillRun] = useState<{ question: string } | null>(null);
  const [distillError, setDistillError] = useState<string | null>(null);
  const [localDistillations, setLocalDistillations] = useState<DistillationView[]>([]);
  const [goneDistillations, setGoneDistillations] = useState<Set<string>>(new Set());
  // The running request, so Cancel can abort it. Cancel keeps the question in
  // the ask view for editing; nothing persists from an aborted run.
  const distillAbortRef = useRef<AbortController | null>(null);
  const distillReturnScroll = useRef<number | null>(null);
  // Every run of Explain, Analyze, Visualize, and Simplify, by its run number,
  // so Stop and ✕ abort the run of the card they sit on. A stopped stream
  // keeps what arrived; nothing persists (SPEC.md §6). A run whose card a new
  // run took over is not stopped: it lands its annotation, and a toast offers
  // its card (SPEC.md §6). A card carries the run that writes into it, and a
  // run writes only into its own card.
  const toolRunsRef = useRef(new Map<number, AbortController>());
  const toolRunSeqRef = useRef(0);
  function abortToolRun(run: number | undefined) {
    if (run === undefined) return;
    toolRunsRef.current.get(run)?.abort();
    toolRunsRef.current.delete(run);
  }
  // The span a jump landed on (a distilled quote, an extract origin): tinted
  // while the reader arrives.
  const [spanFlash, setSpanFlash] = useState<{
    blockId: string;
    start: number;
    end: number;
  } | null>(null);
  const spanFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stored extractions of the old Match-it tool (SPEC.md §4): the layer and
  // its card still show, and Delete still removes one; nothing makes new ones.
  const [localExtractions, setLocalExtractions] = useState<ExtractionView[]>([]);
  // The document's translation (SPEC.md §19), one text per block, shown
  // under each block while the reader has it on.
  const [translations, setTranslations] = useState<Record<string, string> | null>(null);
  // The card an extract span or its chip opens: the origin phrase, every
  // passage, and Delete. Each row jumps to its text.
  const [extractCard, setExtractCard] = useState<{ id: string; top: number; left: number } | null>(
    null,
  );
  // Voice: the bubble under the toolbar reads the highlighted text aloud.
  // The Edge voice through /api/speech — free neural voices, Chinese and
  // English alike; when the route fails, the most natural browser voice reads
  // instead. The reading outlives the toolbar; a floating Stop reading
  // control shows while it plays without a selection.
  const [voice, setVoice] = useState<"idle" | "loading" | "playing">("idle");
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const voiceRunRef = useRef(0);
  // Optimistic highlight marks: painted the instant a color dot is clicked,
  // cleared when the server's anchors arrive with the refresh. sourceId: the
  // stored source, once the save answers, so a mark whose words were typed
  // into meanwhile still finds its stored copy. tool: the assistant's
  // conversation mark paints as the stored copy will (block-view.tsx
  // anchorClass): the thin underline in the assistant's color, filled only
  // while its card is open and the assistant is not changing the passage.
  const [localAnchors, setLocalAnchors] = useState<
    Record<
      string,
      { start: number; end: number; color: string | null; comment?: boolean; sourceId?: string; tool?: Highlight["tool"] }[]
    >
  >({});
  // Spans made in this session: their marks sweep in left to right the first
  // time they paint (block-view.tsx mark-sweep). Keyed `${blockId}:${start}:${end}`,
  // so the server's copy of a span matches the optimistic one and the class
  // survives the refresh swap without restarting.
  const freshSpansRef = useRef(new Set<string>());
  function markFreshSpan(blockId: string, start: number, end: number) {
    freshSpansRef.current.add(`${blockId}:${start}:${end}`);
  }
  // The sweep ran once: the span is no longer fresh, so no later paint
  // sweeps it again or keeps the sweep's fill (lib/mark-sweep.ts).
  useEffect(() => {
    const onSwept = (e: Event) => {
      const { blockId, start, end } = (e as CustomEvent<MarkSweptDetail>).detail;
      freshSpansRef.current.delete(`${blockId}:${start}:${end}`);
    };
    window.addEventListener(MARK_SWEPT_EVENT, onSwept);
    return () => window.removeEventListener(MARK_SWEPT_EVENT, onSwept);
  }, []);
  /** Every segment of the passage sweeps in. */
  function markFreshAnchor(anchor: Anchor) {
    for (const s of segmentsOf(anchor)) markFreshSpan(s.blockId, s.startOffset, s.endOffset);
  }
  // A span an AI tool persisted keeps its mark after its card closes, until
  // the server's copy arrives — the same optimistic paint a color dot gets.
  // Every segment of the passage paints. The assistant passes its tool, so
  // its mark is the assistant's from the first paint, never a clay fill over
  // a passage its suggestions are changing.
  function addLocalAnchor(anchor: Anchor, tool?: Highlight["tool"]) {
    setLocalAnchors((prev) => {
      let next = prev;
      for (const s of segmentsOf(anchor)) {
        const list = next[s.blockId] ?? [];
        if (list.some((h) => h.start === s.startOffset && h.end === s.endOffset)) continue;
        next = { ...next, [s.blockId]: [...list, { start: s.startOffset, end: s.endOffset, color: null, tool }] };
      }
      return next;
    });
  }
  // Marks of notes deleted in this session, gone before the refresh lands:
  // "leaving" fades the mark (block-view.tsx), "gone" unpaints it. An entry
  // clears once the server's props no longer carry the note. Deletes from the
  // Annotations tab and the notes tray arrive as dissect:note-removed.
  const [removedNotes, setRemovedNotes] = useState<Record<string, "leaving" | "gone">>({});
  const removeNoteMarks = useCallback((noteId: string) => {
    setRemovedNotes((prev) => (prev[noteId] ? prev : { ...prev, [noteId]: "leaving" }));
    setTimeout(() => {
      setRemovedNotes((prev) =>
        prev[noteId] === "leaving" ? { ...prev, [noteId]: "gone" } : prev,
      );
    }, 320);
  }, []);
  const restoreNoteMarks = useCallback((noteId: string) => {
    setRemovedNotes((prev) => {
      if (!prev[noteId]) return prev;
      const next = { ...prev };
      delete next[noteId];
      return next;
    });
  }, []);
  // Every pane paints the marks of a deleted note at once, and a failed
  // delete puts them back — the events reach the other pane of a split view.
  function broadcastNoteRemoved(noteId: string) {
    window.dispatchEvent(new CustomEvent("dissect:note-removed", { detail: { noteId } }));
  }
  function broadcastNoteRestored(noteId: string) {
    window.dispatchEvent(new CustomEvent("dissect:note-restored", { detail: { noteId } }));
  }
  useEffect(() => {
    const onRemoved = (e: Event) =>
      removeNoteMarks((e as CustomEvent<{ noteId: string }>).detail.noteId);
    const onRestored = (e: Event) =>
      restoreNoteMarks((e as CustomEvent<{ noteId: string }>).detail.noteId);
    window.addEventListener("dissect:note-removed", onRemoved);
    window.addEventListener("dissect:note-restored", onRestored);
    return () => {
      window.removeEventListener("dissect:note-removed", onRemoved);
      window.removeEventListener("dissect:note-restored", onRestored);
    };
  }, [removeNoteMarks, restoreNoteMarks]);
  // Links made in this session paint the moment they close; the server's
  // copy replaces each once the refresh lands.
  const [localLinks, setLocalLinks] = useState<LocalLink[]>([]);
  // What a link is about, as typed in the link card: shown in the mark's tip
  // from the save on, until the server's copy carries it.
  const [linkReasons, setLinkReasons] = useState<Record<string, string>>({});
  const [prevLinksProp, setPrevLinksProp] = useState(linksByBlock);
  if (prevLinksProp !== linksByBlock) {
    setPrevLinksProp(linksByBlock);
    const served = Object.values(linksByBlock).flat();
    setLocalLinks((prev) => {
      const confirmed = new Set(served.map((l) => l.linkId));
      const keep = prev.filter((l) => !confirmed.has(l.linkId));
      return keep.length === prev.length ? prev : keep;
    });
    setLinkReasons((prev) => {
      const next = Object.fromEntries(
        Object.entries(prev).filter(
          ([linkId, reason]) => !served.some((l) => l.linkId === linkId && l.reason === reason),
        ),
      );
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }
  const [prevAnchorsProp, setPrevAnchorsProp] = useState(anchorHighlights);
  if (prevAnchorsProp !== anchorHighlights) {
    setPrevAnchorsProp(anchorHighlights);
    // Clear an optimistic mark only once a server mark covers its span in
    // the props: a refresh from an older action would otherwise blank the mark
    // until the next refresh lands. Covering, not equal: the stored offsets
    // of a segment can differ from the painted ones by a space, and an
    // optimistic mark left behind paints clay over the tool's own color.
    setLocalAnchors((prev) => {
      const next: typeof prev = {};
      for (const [blockId, list] of Object.entries(prev)) {
        const confirmed = anchorHighlights[blockId] ?? [];
        const keep = list.filter(
          (h) =>
            !confirmed.some(
              (c) => c.sourceId === h.sourceId || (c.start < h.end && c.end > h.start && c.start <= h.start + 2 && c.end >= h.end - 2),
            ),
        );
        if (keep.length > 0) next[blockId] = keep;
      }
      return next;
    });
    // A deleted note's entry clears once the server no longer paints it.
    setRemovedNotes((prev) => {
      const present = new Set(Object.values(anchorHighlights).flat().map((h) => h.noteId));
      const next = Object.fromEntries(Object.entries(prev).filter(([id]) => present.has(id)));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The toast's optional action: "Open as a video document" on a media figure.
  const [toastAction, setToastAction] = useState<{ label: string; run: () => void } | null>(null);

  // Weblinks: URL-shaped text renders as a hyperlink. Render-time only, so
  // every document gets them without a re-parse. CODE keeps its text plain.
  const weblinksByBlock = useMemo(() => {
    const out: Record<string, { start: number; end: number; href: string }[]> = {};
    for (const block of blocks) {
      if (block.type === "CODE" || block.type === "EQUATION" || block.type === "SEPARATOR") continue;
      const spans = findWeblinks(block.text);
      if (spans.length > 0) out[block.id] = spans;
    }
    return out;
  }, [blocks]);

  // Two-ended linking: the first selection waits here while the reader finds
  // the other end — in this document, another attached document, or the other
  // pane in a split view. Panes share the pending link through a window event;
  // sessionStorage carries it across the remount a document switch causes.
  const [pendingLink, setPendingLink] = useState<PendingLink | null>(null);
  const pendingLinkRef = useRef<PendingLink | null>(null);
  pendingLinkRef.current = pendingLink;
  const documentIdRef = useRef(documentId);
  documentIdRef.current = documentId;

  // A card over the article holds an annotation once it is persisted, and an
  // annotation goes into a note as an annotation reference (SPEC.md §6,
  // lib/annotation-reference.ts) by its grip — the same grip the Annotations
  // tab's rows carry, on the card the reader is reading — or by a hold
  // anywhere on the card, the way a hold lifts a note card. Both need a note
  // to drop it on — a note card of the tray, or the floating card: the grip
  // shows while there is one, and the hold lifts while there is one.
  const dropOpen = useCardDropOpen();
  const sourceIdOfNote = (noteId: string): string | null =>
    Object.values(anchorHighlights)
      .flat()
      .find((h) => h.noteId === noteId)?.sourceId ?? null;
  // The reference a card drags: the annotation, its kind, the words it is
  // anchored to (the quote the note gets), its content (the text, the
  // picture, or the turns of its conversation — a drop brings the
  // conversation's log into the note, SPEC.md §21), and its first words for
  // the ghost.
  const annotationReference = (input: {
    noteId: string | null | undefined;
    sourceId: string | null;
    kind: AnnotationItem["kind"];
    quote: string | null;
    content: string;
    turns?: number;
  }): AnnotationReference | null => {
    if (!input.noteId) return null;
    const name = t(ANNOTATION_KIND_KEY[input.kind]);
    return {
      annotationId: input.noteId,
      documentId,
      sourceId: input.sourceId,
      kind: input.kind,
      label: name,
      words: referenceWords(input.content, name),
      ...(input.quote ? { quote: input.quote } : {}),
      ...referenceContent(input.kind, input.content, input.quote, input.turns ?? 0),
    };
  };
  const annotationGrip = (reference: AnnotationReference | null) =>
    dropOpen && reference ? <AnnotationGrip reference={reference} className="-ml-1" /> : null;
  // A hold on the card's blank space, off its controls and off the header
  // that moves the card (data-no-drag), lifts the annotation. A press on the
  // card's text — where the pointer shows the I-beam — selects the text and
  // never lifts, hold or pull (pointsAtText). A pull from blank space never
  // lifts either: only the hold does.
  const holdAnnotation = (reference: AnnotationReference | null) => (e: React.PointerEvent) => {
    if (!reference || !dropOpen || e.button !== 0) return;
    const target = e.target as Element;
    if (skipsDrag(target) || target.closest("button, a, [data-no-drag]")) return;
    if (pointsAtText(e.clientX, e.clientY)) return;
    watchHold(
      e,
      (at) => {
        document.body.style.userSelect = "none";
        startCardDrag(
          { clientX: at.x, clientY: at.y },
          { kind: "annotation", ids: [reference.annotationId], label: reference.words, reference },
          () => {
            document.body.style.userSelect = "";
          },
        );
      },
      { pull: false },
    );
  };

  function broadcastPendingLink(next: PendingLink | null) {
    setPendingLink(next);
    pendingLinkRef.current = next;
    storePendingLink(notebookId, next);
    window.dispatchEvent(new CustomEvent("dissect:pending-link", { detail: next }));
  }
  useEffect(() => {
    const onPending = (e: Event) => {
      const next = (e as CustomEvent<PendingLink | null>).detail;
      setPendingLink(next ?? null);
      pendingLinkRef.current = next ?? null;
    };
    window.addEventListener("dissect:pending-link", onPending);
    return () => window.removeEventListener("dissect:pending-link", onPending);
  }, []);
  // Restore a pending link this tab holds — the reader started it, opened this
  // document, and still has to close it here. Post-hydration restore on
  // purpose: sessionStorage is client-only, so the SSR pass must render
  // without the pending link.
  useEffect(() => {
    if (pendingLinkRef.current) return;
    const stored = readStoredPendingLink(notebookId);
    if (!stored) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPendingLink(stored);
    pendingLinkRef.current = stored;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A highlight's broken chain starts a link from that highlight. Only the
  // pane that owns the clicked chain handles the event.
  useEffect(() => {
    const onStartLink = (e: Event) => {
      const { sourceId, origin } = (e as CustomEvent<{ sourceId: string; origin?: Element }>)
        .detail;
      const container = containerRef.current;
      if (!container || !origin || !container.contains(origin)) return;
      for (const [blockId, list] of Object.entries(anchorHighlightsRef.current)) {
        const hit = list.find((h) => h.sourceId === sourceId);
        if (!hit) continue;
        const block = blocksRef.current.find((b) => b.id === blockId);
        if (!block) return;
        const next = {
          fromDocumentId: documentIdRef.current,
          anchor: {
            blockId,
            startOffset: hit.start,
            endOffset: hit.end,
            quotedText: block.text.slice(hit.start, hit.end),
            prefix: "",
            suffix: "",
          },
        };
        setPendingLink(next);
        pendingLinkRef.current = next;
        storePendingLink(notebookId, next);
        window.dispatchEvent(new CustomEvent("dissect:pending-link", { detail: next }));
        showToast(t("reader.completeLinkToast"));
        return;
      }
    };
    window.addEventListener("dissect:start-link", onStartLink);
    return () => window.removeEventListener("dissect:start-link", onStartLink);
  }, [t, notebookId]);

  // The assistant as an actor: a command becomes a plan; the plan runs after
  // approval in the plan card, never before. The sidebar assistant's plan
  // (SPEC.md §7) arrives by event and takes the same card.
  // Fast Thinking or Deep Thinking (SPEC.md §7): one choice for every
  // assistant surface, remembered in this browser.
  const thinking = useThinking();
  const web = useWeb();
  const [aiCommand, setAiCommand] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  // The toolbar's question while it runs, and a failed run's message: shown
  // in the box of the toolbar that sent it (SPEC.md §6). The field itself is
  // free for the next question as soon as one is sent.
  const [aiSent, setAiSent] = useState<{ text: string; from: Anchor } | null>(null);
  const [aiError, setAiError] = useState<{ text: string; from: Anchor } | null>(null);
  // A Comment whose save failed: the toolbar opens again on its words with
  // the box, the kept draft, and this reason under it (SPEC.md §6).
  const [commentError, setCommentError] = useState<{ text: string; from: Anchor } | null>(null);
  // A highlight or an Add to notes the server refused (EDGE12-12): the
  // reason shows in the toolbar, under the row the reader pressed, and the
  // toolbar stays open on the words; the error log keeps it too.
  const [toolError, setToolError] = useState<{ text: string; from: Anchor; at: "highlight" | "add" } | null>(null);
  const [aiPlan, setAiPlan] = useState<AssistantPlan | null>(null);
  const [planChecked, setPlanChecked] = useState<Set<number>>(new Set());
  // Where the plan came from: the selection's chat card, or an Explain or
  // Simplify card's conversation, shows it under its answer, and only while
  // that card is open (SPEC.md §7); the panel's plan takes the card at the
  // window's foot. planNoteId is the conversation that proposed it.
  const [planFrom, setPlanFrom] = useState<"chat" | "tool" | "panel">("panel");
  const [planNoteId, setPlanNoteId] = useState<string | null>(null);
  // The plans of the threads not on screen, by the thread's note id
  // (TOOL13-03): a side chat's plan never takes the conversation's place,
  // and Back shows the conversation's plan again.
  type ParkedPlan = { plan: AssistantPlan; checked: Set<number>; from: "chat" | "tool" };
  const parkedPlansRef = useRef(new Map<string, ParkedPlan>());
  const planNowRef = useRef({ aiPlan, planChecked, planFrom, planNoteId });
  useEffect(() => {
    planNowRef.current = { aiPlan, planChecked, planFrom, planNoteId };
  }, [aiPlan, planChecked, planFrom, planNoteId]);
  // A new plan comes: the one on screen waits under its own thread.
  const parkPlan = (nextNoteId: string | null) => {
    const now = planNowRef.current;
    if (!now.aiPlan || now.planFrom === "panel" || !now.planNoteId || now.planNoteId === nextNoteId) return;
    parkedPlansRef.current.set(now.planNoteId, { plan: now.aiPlan, checked: now.planChecked, from: now.planFrom });
  };
  // The sidebar assistant's plan (SPEC.md §7): the panel sends the actions
  // the server validated for this document; the plan card takes them. A
  // split reader has two of these; the document id picks the one.
  useEffect(() => {
    const onPlan = (e: Event) => {
      const detail = (e as CustomEvent<{ documentId: string; actions: AssistantAction[]; warnings: string[] }>).detail;
      if (!detail || detail.documentId !== documentId) return;
      const actions = offerFigureSuggestionsRef.current(detail.actions);
      if (actions.length === 0) return;
      parkPlan(null);
      setAiPlan({ reply: null, actions, warnings: detail.warnings, conversationNoteId: null });
      setPlanFrom("panel");
      setPlanNoteId(null);
      setPlanChecked(new Set(actions.map((_, i) => i)));
    };
    window.addEventListener("dissect:assistant-plan", onPlan);
    return () => window.removeEventListener("dissect:assistant-plan", onPlan);
  }, [documentId]);
  const aiCommandRef = useRef("");
  aiCommandRef.current = aiCommand;
  // The question is kept per selection as a toolbar draft (lib/toolbar-drafts.ts) until the answer lands.
  useToolbarDraftRestore(submenu === "ai", "assistant", documentId, popover?.anchor ?? null, aiCommand, setAiCommand);
  // The running assistant turn, so Stop can abort it — the popover's Run
  // button before the chat card exists, or the chat card's Send button once
  // it does; only one is ever in flight at a time.
  const chatAbortRef = useRef<AbortController | null>(null);
  // A tool conversation's turn in flight (SPEC.md §21), one per card kind.
  const toolChatAbortRef = useRef<Record<"explain" | "simplify", AbortController | null>>({
    explain: null,
    simplify: null,
  });
  // The log card a hovered conversation mark shows (SPEC.md §21).
  const [logCard, setLogCard] = useState<LogCard | null>(null);
  const logCardRef = useRef(logCard);
  logCardRef.current = logCard;
  const editModeRef = useRef(editMode);
  editModeRef.current = editMode;
  // Opened in edit mode: the caret lands in the first block once its editable
  // mounts, so the reader can type at once.
  useEffect(() => {
    if (!editModeRef.current) return;
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = containerRef.current?.querySelector<HTMLElement>("[data-edit-block]");
        el?.focus();
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, []);
  const transcriptModeRef = useRef(false);
  transcriptModeRef.current = transcript !== undefined;
  const blocksRef = useRef(blocks);
  // The cores the reader has (SPEC.md §28), for mount-time closures.
  const coresRef = useRef<Record<string, string> | null>(null);
  blocksRef.current = blocks;
  const annotationBubblesRef = useRef(annotationBubbles);
  annotationBubblesRef.current = annotationBubbles;
  const annotationsBySourceRef = useRef(annotationsBySource);
  annotationsBySourceRef.current = annotationsBySource;
  const [annotationCard, setAnnotationCard] = useState<AnnotationCard | null>(null);
  // The chooser a click on stacked annotations opens: every annotation under
  // the click, by source id, at the click (container coords).
  const [stackChooser, setStackChooser] = useState<{ sources: string[]; left: number; top: number } | null>(null);
  const anchorHighlightsRef = useRef(anchorHighlights);
  anchorHighlightsRef.current = anchorHighlights;
  // Narrow reader (no card room, cardRoom), and every split pane: open cards dock
  // below the highlight, and stored cards collapse to their symbols.
  const narrowRef = useRef(false);
  // How far the column moves left so a side card covers no word (SPEC.md
  // §6): set when a card opens on a pane whose margin is too narrow for it,
  // back to 0 when the last card closes.
  const [cardsRoom, setCardsRoom] = useState(0);
  const cardsRoomRef = useRef(0);
  cardsRoomRef.current = cardsRoom;
  const splitRef = useRef(split);
  splitRef.current = split;
  // How far the page editor's page moves left for the cards in its margin
  // (--docs-shift, SPEC.md §29).
  const [docsShift, setDocsShift] = useState(0);
  const docsShiftRef = useRef(0);
  docsShiftRef.current = docsShift;
  const marginCardOpenRef = useRef(false);
  // View > Comments in the page editor: Hide comments unpaints them,
  // Minimize comments keeps their icons and no cards.
  const [commentsView, setCommentsView] = useState<CommentsView>("all");
  const commentsHidden = commentsView === "hidden";
  // The page editor's card column (layer/comment-card.tsx CardColumn): the
  // cards stand in it, inside the pane, never over the notes tray.
  const [columnHost, setColumnHost] = useState<HTMLDivElement | null>(null);
  const inColumn = (cards: React.ReactNode) => (columnHost ? createPortal(cards, columnHost) : cards);
  const [assistantChat, setAssistantChat] = useState<AssistantChat | null>(null);
  const assistantChatRef = useRef(assistantChat);
  assistantChatRef.current = assistantChat;
  // The card's box takes the focus when it replaces the box the reader typed
  // in (the toolbar's, the bar's), and after Start side chat and Ask about
  // this: the next words typed land in it, never on the page.
  const [chatFocusTick, setChatFocusTick] = useState(0);
  useLayoutEffect(() => {
    if (!chatFocusTick) return;
    const focusBox = () => {
      // The conversation view's box when the view is open, else the card's.
      const boxes = [...document.querySelectorAll<HTMLTextAreaElement>("textarea[data-chat-box]")];
      const box = boxes.find((b) => !b.closest("[data-side-card]")) ?? boxes[0];
      if (!box) return false;
      box.focus({ preventScroll: true });
      // The caret goes after the words carried over from the box the reader
      // typed in, so the next keys follow them instead of landing before them.
      box.setSelectionRange(box.value.length, box.value.length);
      return true;
    };
    // In the same commit that swaps the boxes, so no key pressed meanwhile
    // falls between them; a box that mounts a frame later is focused then.
    if (focusBox()) return;
    const raf = requestAnimationFrame(focusBox);
    return () => cancelAnimationFrame(raf);
  }, [chatFocusTick]);
  // The assistant's bar at the bottom of the pane (SPEC.md §29).
  const [bar, setBar] = useState<AssistantBar | null>(null);
  // Highlighting an answer in the chat card (SPEC.md §7): Start side chat,
  // Ask about this, Comment.
  const {
    selection: answerSelection,
    tintRects: answerTintRects,
    hold: holdAnswerSelection,
    clear: clearAnswerSelection,
  } = useAnswerSelection();
  const [chatComments, setChatComments] = useState<AnswerComment[]>([]);
  const [chatCommentPeople, setChatCommentPeople] = useState<Record<string, Person>>({});
  const [chatCommentQuote, setChatCommentQuote] = useState<string | null>(null);
  const [chatCommentBusy, setChatCommentBusy] = useState(false);
  const sideChatsLoadedFor = useRef<string | null>(null);
  // A stored comment, opened from its icon beside the text — editable in place.
  const [commentCard, setCommentCard] = useState<{
    left: number;
    top: number;
    width: number;
    side: "right" | "left";
    noteId: string | null; // null = comment not in annotationsBySource; read-only
    draft: string;
    saved: string;
    busy: boolean;
    anchor: Anchor | null;
  } | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  // The card a closed link opens: what is this link about?
  const [linkCard, setLinkCard] = useState<LinkCard | null>(null);
  // The pane's visible height: every tool card grows with its content up to
  // this, then its body scrolls (SPEC.md §6). 0 until measured.
  const [paneHeight, setPaneHeight] = useState(0);
  // The pane's width: a card resized by its corner stops 8px short of the
  // pane's right edge, so its buttons stay in view.
  const [paneWidth, setPaneWidth] = useState(0);
  // The mouseup that ends a hold-and-circle gesture must not run selection
  // capture — it would replace the figure popover it just opened.
  const suppressNextMouseUp = useRef(false);

  // Tool block placement, by proximity to the highlighted text: with nothing
  // beside it a new block goes right; with a block already close on the right
  // it goes left; with both sides taken it drops below the existing blocks —
  // right before left, top to bottom. Never over the article.
  const CARD_ESTIMATE = 360;
  const CARD_GAP = 14;
  function claimSideSlot(
    kind: "explain" | "simplify" | "assistant" | "comment" | "link" | "log" | "annotation",
    preferredTop: number,
    // The words the card is about: under them when there is no room beside.
    anchor?: Anchor | null,
  ) {
    const measured = measureSideCards(containerRef.current, kind);
    const { rects, articleLeft, articleRight, cw } = measured;
    const words = anchor && containerRef.current ? passageBox(containerRef.current, anchor) : null;
    const underWords = words ? words.bottom + 10 : Math.max(8, preferredTop) + 34;
    // The page editor (SPEC.md §29): one column in the page's right margin,
    // each card level with its words or below the card above; the page moves
    // left to make room, but not for a log card. No room: under the words.
    const shift = docsShiftRef.current;
    const page = richTextRef.current ? pageGeometry(containerRef.current, shift) : null;
    if (page) {
      const kept = kind === "log" ? slotAt(page, shift) : null;
      const place = splitRef.current ? null : kind === "log" ? (kept ? { shift, ...kept } : null) : marginPlace(page);
      if (!place) return { ...belowSlot(page, shift), top: underWords, side: "right" as const };
      const pageMid = (page.pageLeft + page.pageRight) / 2 - shift;
      let top = Math.max(8, preferredTop);
      for (let step = 0; step < 12; step++) {
        const taken = blocksOnSide(rects, pageMid, "right", top, CARD_ESTIMATE);
        if (taken.length === 0) break;
        top = Math.max(...taken.map((r) => r.bottom)) + CARD_GAP;
      }
      if (place.shift !== shift) setDocsShift(place.shift);
      return { left: place.left, width: place.width, top, side: "right" as const };
    }
    // Narrow reader: no room beside the words — the card opens under the
    // paragraph, and the text under it makes room (layoutNarrowCards).
    const col = columnAtRest(measured, cardsRoomRef.current);
    const room = narrowRef.current ? null : cardRoom(col);
    if (!room) {
      return {
        ...dockBelowCard(col.articleLeft, col.articleRight, cw),
        top: words ? words.blockBottom + 8 : underWords,
        side: "right" as const,
      };
    }
    // A margin too narrow for a card: the column moves left to make it
    // (SPEC.md §6), and stays there while a card is open.
    if (room.shift > 0 && room.shift !== cardsRoomRef.current) {
      cardsRoomRef.current = room.shift;
      setCardsRoom(room.shift);
    }
    const sides = (["right", "left"] as const).filter((s) => room[s]);
    const articleMid = (articleLeft + articleRight) / 2;
    let top = Math.max(8, preferredTop);
    let side: "right" | "left" = sides[0];
    for (let step = 0; step < 12; step++) {
      const free = sides.find((s) => blocksOnSide(rects, articleMid, s, top, CARD_ESTIMATE).length === 0);
      if (free) {
        side = free;
        break;
      }
      // Every side busy at this height: drop below whichever clears first.
      const clears = sides.map((s) =>
        Math.max(...blocksOnSide(rects, articleMid, s, top, CARD_ESTIMATE).map((r) => r.bottom)),
      );
      top = Math.min(...clears) + CARD_GAP;
      side = sides[0];
    }
    // Dropped under the window, the card would open out of view: it opens at
    // its words instead, and the older card above gives up height
    // (settleSideCards).
    const pane = containerRef.current;
    if (pane && top > Math.max(8, preferredTop) && top + CAP_MIN > pane.scrollTop + pane.clientHeight) {
      const over = blocksOnSide(rects, articleMid, sides[0], Math.max(8, preferredTop), CARD_ESTIMATE);
      top = Math.max(8, preferredTop, ...over.map((r) => r.top + CAP_MIN + CARD_GAP));
      side = sides[0];
    }
    return { ...dockSideCard(side, col, cardsRoomRef.current), top, side };
  }
  // Closing a card mid-stream stops its run: nobody will read the rest. A
  // tool conversation's turn in flight stops with its card too.
  function closeExplain() {
    abortToolRun(bubble?.run);
    stopToolChat("explain");
    setBubble(null);
  }
  function stopExplain() {
    abortToolRun(bubble?.run);
  }
  // Deleting is optimistic: the card leaves and the mark fades at once; the
  // server's refresh confirms, and a failure puts the mark back with a toast.
  async function deleteNote(noteId: string, removedMessage: string) {
    broadcastNoteRemoved(noteId);
    try {
      await api(`/api/notes/${noteId}`, "DELETE");
      router.refresh();
      showToast(removedMessage);
      return true;
    } catch (err) {
      broadcastNoteRestored(noteId);
      showError(err instanceof Error ? err.message : t("reader.deleteFailed"));
      return false;
    }
  }
  // Regenerate replaces (SPEC.md §4): the annotation a run replaced goes once
  // the new one is stored, so one selection never carries two of the same
  // tool's marks. No toast — the new output is the notice.
  async function discardNote(noteId: string) {
    broadcastNoteRemoved(noteId);
    try {
      await api(`/api/notes/${noteId}`, "DELETE");
    } catch {
      broadcastNoteRestored(noteId);
    }
  }
  async function deleteExplain() {
    const card = bubble;
    if (!card?.noteId || card.streaming || card.busy) return;
    setBubble(null);
    await deleteNote(
      card.noteId,
      t(
        card.kind === "analyze"
          ? "reader.analysisRemoved"
          : card.kind === "visualize"
            ? "reader.visualizationRemoved"
            : "reader.explanationRemoved",
      ),
    );
  }
  function closeSimplify() {
    abortToolRun(simplifyCard?.run);
    stopToolChat("simplify");
    setSimplifyCard(null);
  }
  function stopSimplify() {
    abortToolRun(simplifyCard?.run);
  }
  async function deleteSimplify() {
    const card = simplifyCard;
    if (!card?.noteId || card.streaming || card.busy) return;
    setSimplifyCard(null);
    await deleteNote(card.noteId, t("reader.simplifiedRemoved"));
  }
  // Regenerate: the tool runs again on the same selection, in the same card,
  // and the new output replaces the old (SPEC.md §4). Visualize regenerates
  // like the rest, and stays Unitos Ultra.
  async function regenerateBubble() {
    const card = bubble;
    if (!card || !card.anchor || card.streaming || card.busy) return;
    if (card.kind === "visualize" && !ultra) {
      showToast(t("reader.visualizeNeedsUltra"), plansAction);
      return;
    }
    const { kind, anchor } = card;
    const slot: SideSlot = { left: card.left, top: card.top, width: card.width, side: card.side };
    await runBubble(kind, anchor, slot, card);
  }
  async function regenerateSimplify() {
    const card = simplifyCard;
    if (!card || card.streaming || card.busy) return;
    const { anchor } = card;
    const slot: SideSlot = { left: card.left, top: card.top, width: card.width, side: card.side };
    await runSimplify(anchor, slot, card);
  }
  function closeAssistantChat() {
    clearAnswerSelection();
    // A turn in flight goes on: it lands on the conversation, and the mark
    // reopens the card with it. Stop stops a run, never a close (SPEC.md §6);
    // a message queued under it waits in the card's draft.
    setAssistantChat(null);
  }
  async function deleteAssistantConversation() {
    const chat = assistantChat;
    if (!chat?.noteId || chat.busy) return;
    setAssistantChat(null);
    await deleteNote(chat.noteId, t("reader.conversationRemoved"));
  }
  function closeCommentCard() {
    setCommentCard(null);
  }
  function closeLinkCard() {
    setLinkCard(null);
  }

  // Ctrl/Cmd+C copies the highlighted text (SPEC.md §6). The article tints the
  // highlighted text itself while the toolbar is open on it, and painting
  // that tint replaces the block's marks, which takes the browser's own
  // selection with it (the comment on
  // highlightsByBlock's "selection" kind explains why), so the system copy
  // would have nothing left to act on. The anchor's quotedText is the same
  // text, so this copies exactly what a working native copy would have.
  // Everywhere else — a real native selection anywhere on the page, any text
  // box — the browser's own copy runs, untouched.
  async function copySelection() {
    // Read through the refs, not the state: the Ctrl/Cmd+C effect below closes
    // over this function once, at mount, so a direct read would stay the
    // initial null forever.
    const quote = popoverRef.current?.anchor.quotedText;
    if (!quote) return;
    try {
      await navigator.clipboard.writeText(quote);
      showToast(t("reader.copied"));
    } catch {
      showToast(t("reader.copyFailed"));
    }
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== "c") return;
      if (!popoverRef.current) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && !active.closest("[data-edit-block]") && isTextEntry(active)) return;
      // A real native selection anywhere — the article's own editable while
      // editing, Explain's bubble, a card's text — is the browser's to copy.
      if (window.getSelection()?.toString()) return;
      e.preventDefault();
      void copySelection();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cards are freely moveable: drag the header. Buttons and inputs still work.
  function dragCard(
    getPos: () => { left: number; top: number } | null,
    apply: (left: number, top: number) => void,
  ) {
    return (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      if ((e.target as Element).closest("button, textarea, input, a")) return;
      const start = getPos();
      if (!start) return;
      e.preventDefault();
      const fromX = e.clientX;
      const fromY = e.clientY;
      const container = containerRef.current;
      // A dragged card follows the pointer at once: the slide a pushed card
      // makes (globals.css [data-side-card]) is off while the drag lasts.
      const card = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-side-card]");
      card?.setAttribute("data-dragging", "");
      // A card the reader moved stays where they put it: the narrow reader's
      // layout leaves it alone (layoutNarrowCards).
      const kind = card?.dataset.sideCard;
      let moved = false;
      const onMove = (ev: PointerEvent) => {
        if (!moved && kind) {
          moved = true;
          movedCardsRef.current.add(`${kind}:${layerSeenRef.current[kind] ?? ""}`);
        }
        const maxLeft = (container?.clientWidth ?? 1200) - 80;
        apply(
          Math.max(4, Math.min(start.left + ev.clientX - fromX, maxLeft)),
          Math.max(4, start.top + ev.clientY - fromY),
        );
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        card?.removeAttribute("data-dragging");
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };
  }
  // The fading hint that replaces the Edit button. Shows on document open until
  // the reader double-clicks into edit mode once.
  const [editHint, setEditHint] = useState(false);
  // Where the hint shows: beside the article, or as a row under the pane.
  const [hintBeside, setHintBeside] = useState(true);

  // Offline, the tools that need a model are off (SPEC.md §17): their rows
  // are dimmed, their tooltip says why, and a press shows the plain message.
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const aiFetch = (path: string, init: RequestInit) => fetchWithModel(path, init, t("common.offlineAi"));

  // Coarse pointer (tablet, phone): the selection tools dock under the
  // selection, the rows are tap-sized, and the colors and Add to notes sit
  // inside the same box instead of floating beside it.
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse)");
    const apply = () => setCoarse(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  // Switching documents client-side keeps this component mounted. Every piece
  // of selection-scoped state references the old document's blocks — drop it,
  // or a stale anchor writes an annotation into the wrong document.
  // Adjust-during-render, same pattern as useOutline's tree reset.
  const [prevDocumentId, setPrevDocumentId] = useState(documentId);
  if (prevDocumentId !== documentId) {
    setPrevDocumentId(documentId);
    setPopover(null);
    setSubmenu(null);
    setBubble(null);
    setSimplifyCard(null);
    setAssistantChat(null);
    setCommentCard(null);
    setCommentsView("all");
    setLinkCard(null);
    setAnnotationCard(null);
    setEditMode(false);
    setLocalAnchors({});
    setLocalLinks([]);
    setRemovedNotes({});
    freshSpansRef.current = new Set();
    setDistillOpen(false);
    setDistillShownId(null);
    setDistillRun(null);
    setDistillError(null);
    setLocalDistillations([]);
    setSpanFlash(null);
    setLocalExtractions([]);
    setExtractCard(null);
    distillAbortRef.current?.abort();
    for (const controller of toolRunsRef.current.values()) controller.abort();
    toolRunsRef.current.clear();
    distillReturnScroll.current = null;
    voiceRunRef.current += 1;
    voiceAudioRef.current?.pause();
    voiceAudioRef.current = null;
    window.speechSynthesis?.cancel();
    setVoice("idle");
  }

  // Selection → block-relative offsets via data-block-id (SPEC.md §5). DOM ranges are never persisted.
  // Edit mode marks blocks with data-edit-block instead; both carry the block id.
  // `given`: a range to read in place of the browser's selection — the
  // tint's, when the focus sits in a toolbar field (tintRange).
  const captureSelection = useCallback((given?: Range | null): Popover | null => {
    const container = containerRef.current;
    if (!container) return null;
    // A page editor's passage is read from its document (SPEC.md §29); a
    // drag across table cells selects the cells, and their words are the
    // passage.
    const pageEditor = richTextRef.current ? pageEditorIn(container) : null;
    const selection = window.getSelection();
    const selected =
      given ?? (selection && !selection.isCollapsed && selection.rangeCount > 0 ? selection.getRangeAt(0) : null);
    // A selection that starts in a core (SPEC.md §28) is the collapsed view's
    // words, drawn over the page's text: it is read as the block reader
    // reads it.
    const start = selected?.startContainer;
    const inCore = Boolean((start instanceof Element ? start : start?.parentElement)?.closest("[data-collapsed]"));
    const cells = pageEditor && !inCore && !given ? pageCellSelection(pageEditor) : null;
    const range = cells?.range ?? selected;
    if (!range || !container.contains(range.commonAncestorContainer)) return null;
    const pageSelection = cells ?? (pageEditor && !inCore ? pageSelectionOfRange(pageEditor, range) : null);
    const pageSegments = pageSelection?.segments ?? null;

    const blockOf = (node: Node): HTMLElement | null => {
      const el = node instanceof HTMLElement ? node : node.parentElement;
      return el?.closest("[data-block-id], [data-edit-block]") ?? null;
    };
    const startBlock = blockOf(range.startContainer);
    const endBlock = blockOf(range.endContainer);
    // A drag that starts off the blocks but on the article — the title, the
    // label over it, the space between blocks — still reads the blocks it
    // reaches: the first from its start, as a drag from the margin does.
    const startEl = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
    const onArticle =
      Boolean(startEl?.closest("article")) &&
      !startEl?.closest("[data-side-card], [data-log-card], [data-selection-popover], [data-anchor-skip]");
    if (!startBlock && !pageSegments && !onArticle) return null;
    // A layer inside this one (the article card in the video pane, SPEC.md
    // §11) takes its own selections: a block whose nearest reader root is
    // not this container belongs to that layer.
    const own = (el: Element) => el.closest("[data-reader-root]") === container;
    if (startBlock && !own(startBlock)) return null;

    // The passage: every block the selection touches, in reading order, one
    // segment per block (lib/anchors/passage.ts). A rendered equation's DOM
    // text is not the stored TeX, and a page's DOM text is its label and the
    // Circle & ask card, not stored text: neither takes a span, and a
    // selection that crosses one leaves it out (truncated says so).
    const blockEls = Array.from(
      container.querySelectorAll<HTMLElement>("[data-block-id], [data-edit-block]"),
    ).filter((el) => own(el) && (el === startBlock || el === endBlock || range.intersectsNode(el)));
    const segments: Segment[] = pageSegments ?? [];
    const segmentEls: HTMLElement[] = [];
    let truncated = pageSelection?.truncated ?? false;
    // A core's words (SPEC.md §28) take the core key: their anchor is in the
    // collapsed view's layer. A passage stays in one layer — the first
    // block's — and a block of the other layer is left out.
    const firstCore = startBlock?.hasAttribute("data-collapsed") ?? false;
    for (const el of pageSegments ? [] : blockEls) {
      const blockId = el.dataset.blockId ?? el.dataset.editBlock;
      // A block the page editor's collapsed view does not draw is no part
      // of what the reader sees between two cores.
      if (!blockId || el.getClientRects().length === 0) continue;
      const core = el.hasAttribute("data-collapsed");
      if (core !== firstCore) {
        truncated = true;
        continue;
      }
      const id = core ? coreKey(blockId) : blockId;
      const type = core ? undefined : blocksRef.current.find((b) => b.id === id)?.type;
      if (el.hasAttribute("data-math-block") || type === "PAGE" || type === "EQUATION") {
        truncated = true;
        continue;
      }
      // Offsets over the block's anchorable text, never Range.toString():
      // inline controls ([data-anchor-skip], e.g. extract chips) render text
      // the stored block text does not have, and counting it would shift
      // every offset after it. The quote is sliced from the same walked text,
      // so the anchor is exactly the selected text.
      const text = anchorableText(el);
      const start = el === startBlock ? anchorableOffset(el, range.startContainer, range.startOffset) : 0;
      const end = el === endBlock ? anchorableOffset(el, range.endContainer, range.endOffset) : text.length;
      if (end <= start) continue;
      const quote = text.slice(start, end);
      if (!quote.trim()) continue;
      segments.push({
        blockId: id,
        startOffset: start,
        endOffset: end,
        quotedText: quote,
        prefix: text.slice(Math.max(0, start - 32), start),
        suffix: text.slice(end, end + 32),
      });
      segmentEls.push(el);
    }
    if (segments.length === 0) return null;
    const first = segments[0];
    const { blockId, startOffset, endOffset, quotedText, prefix, suffix } = first;

    const containerRect = container.getBoundingClientRect();
    // The words' own lines: a drag that starts on the title or the label
    // over it reads from the first block (above), and the toolbox stands
    // level with that block's words, not with the title. The range's lines
    // are cut to the blocks the passage reads.
    const spanTop = segmentEls[0]?.getBoundingClientRect().top ?? -Infinity;
    const spanBottom = segmentEls[segmentEls.length - 1]?.getBoundingClientRect().bottom ?? Infinity;
    const lineRects = Array.from(range.getClientRects()).filter(
      (r) => r.width > 0 && r.height > 0 && r.bottom > spanTop && r.top < spanBottom,
    );
    const rect =
      lineRects.length > 0
        ? (() => {
            const left = Math.min(...lineRects.map((r) => r.left));
            const top = Math.min(...lineRects.map((r) => r.top));
            const right = Math.max(...lineRects.map((r) => r.right));
            const bottom = Math.max(...lineRects.map((r) => r.bottom));
            return new DOMRect(left, top, right - left, bottom - top);
          })()
        : range.getBoundingClientRect();
    const rawX = rect.left + rect.width / 2 - containerRect.left;
    const margin = Math.min(240, containerRect.width / 2);
    const articleRect = container.querySelector("article")?.getBoundingClientRect();
    const textLeft = articleRect ? articleRect.left - containerRect.left + 24 : 24;
    const yTop = Math.max(8, rect.top - containerRect.top + container.scrollTop);
    // The rail's side follows the tool blocks nearby and the room beside
    // the words (toolboxSide). The page editor (SPEC.md §29): beside the
    // page's right edge, else over its margin, else under the words.
    const { articleRight, cw } = measureSideCards(container);
    const shift = docsShiftRef.current;
    const pageGeo = pageEditor ? pageGeometry(container, shift) : null;
    const side = window.matchMedia("(pointer: coarse)").matches
      ? ("below" as const)
      : pageGeo
        ? toolbarLeft(pageGeo, shift, 176) === null && toolbarShift(pageGeo, shift, 176) === null
          ? ("below" as const)
          : ("right" as const)
        : toolboxSide(container, yTop);
    // The toolbox's first row centers on the selection's first line, as
    // Google Docs' buttons do.
    const firstLine = lineRects[0] ?? rect;
    const lineTop = firstLine.top + firstLine.height / 2 - 20;
    const headerBottom = pageGeo
      ? container.querySelector(".docs-header")?.getBoundingClientRect().bottom
      : undefined;
    // The toolbox stands clear of the page editor's toolbar.
    const pageTop = headerBottom !== undefined ? Math.max(lineTop, headerBottom + 56) : lineTop;
    // Near the pane's top edge on screen — the document's first lines, or
    // the line at the top after a scroll — the toolbox moves down clear of
    // the Collapse and Extract chips, which stick to the pane's top
    // (reader.tsx), so both stay in reach.
    const readerBelow = !pageGeo && side === "below";
    const nearTop = !pageGeo && (readerBelow || firstLine.top - containerRect.top < 100);
    const readerTop = nearTop ? Math.max(yTop, container.scrollTop + (side === "right" ? 56 : 48)) : yTop;
    return {
      anchor: {
        blockId,
        startOffset,
        endOffset,
        quotedText,
        prefix,
        suffix,
        ...(segments.length > 1 ? { segments } : {}),
      },
      x: Math.max(margin, Math.min(rawX, containerRect.width - margin)),
      y: rect.bottom - containerRect.top + container.scrollTop + (side === "below" ? 14 : 6),
      wordsTop: firstLine.top - containerRect.top + container.scrollTop,
      yTop:
        pageGeo && side === "right"
          ? Math.max(8, pageTop - containerRect.top + container.scrollTop)
          : readerTop,
      textLeft,
      truncated,
      side,
      rightBase: articleRight + 10,
      cw,
      ...(pageGeo ? { page: { geo: pageGeo } } : {}),
    };
  }, []);
  // Read by the drag-start handler below, a mount-time effect with no deps.
  const captureSelectionRef = useRef(captureSelection);
  captureSelectionRef.current = captureSelection;

  // The layers over the article, newest first for Escape (SPEC.md §6): each
  // layer's identity, and the order the layers opened in. A card that runs
  // again or opens on other words is a new layer.
  const layerSeenRef = useRef<Record<string, string | null>>({});
  const layerOpenedRef = useRef<Record<string, number>>({});
  const layerKeys: Record<string, string | null> = {
    popover: popover ? `${popover.anchor.blockId}:${popover.anchor.startOffset}:${popover.anchor.endOffset}` : null,
    pendingLink: pendingLink ? "pending" : null,
    explain: bubble ? `${bubble.run ?? ""}:${bubble.noteId ?? ""}:${bubble.kind}` : null,
    simplify: simplifyCard ? `${simplifyCard.run ?? ""}:${simplifyCard.noteId ?? ""}` : null,
    assistant: assistantChat ? `${assistantChat.noteId ?? ""}:${assistantChat.anchor?.blockId ?? ""}:${assistantChat.anchor?.startOffset ?? ""}` : null,
    bar: bar ? bar.key : null,
    comment: commentCard ? `${commentCard.noteId ?? ""}:${commentCard.anchor?.blockId ?? ""}` : null,
    link: linkCard ? linkCard.linkId : null,
    annotation: annotationCard ? annotationCard.sourceId : null,
    extract: extractCard ? extractCard.id : null,
    chooser: stackChooser ? stackChooser.sources.join(",") : null,
  };
  for (const [layer, key] of Object.entries(layerKeys)) {
    if (layerSeenRef.current[layer] === key) continue;
    layerSeenRef.current[layer] = key;
    if (key !== null) layerOpenedRef.current[layer] = nextLayerSeq();
  }
  // What a card's box holds that the reader typed and has not sent: kept by
  // the card's annotation, so a card closed by Escape or a click reopens from
  // its mark with the words still in its box.
  // Kept in localStorage too (unitos-card-drafts, by note id), so a reload or
  // a crash keeps them as well (SPEC.md §6). A comment's draft keeps the
  // text it was typed on (its base), so a reopen after a change made
  // elsewhere puts the two together instead of showing stale words.
  // This tab writes only the drafts it changed, over what storage holds now:
  // another tab on the same document keeps its own (toolbar-drafts.ts).
  const cardDraftsRef = useRef<Record<string, string> | null>(null);
  const cardBasesRef = useRef<Record<string, string> | null>(null);
  if (cardDraftsRef.current === null) cardDraftsRef.current = loadCardDrafts();
  if (cardBasesRef.current === null) cardBasesRef.current = loadCardDraftBases();
  const draftChangesRef = useRef(new Map<string, string | null>());
  const baseChangesRef = useRef(new Map<string, string | null>());
  // What this tab's open cards last held, by key: a card that shows the
  // same words again writes nothing, so it never undoes another tab's draft.
  const draftShownRef = useRef(new Map<string, string | null>());
  useEffect(() => {
    if (draftChangesRef.current.size === 0 && baseChangesRef.current.size === 0) return;
    writeCardDrafts(draftChangesRef.current, baseChangesRef.current);
    draftChangesRef.current = new Map();
    baseChangesRef.current = new Map();
  });
  // Another tab wrote: its drafts come in, and this tab's unwritten ones stay.
  useEffect(
    () =>
      onCardDraftsChange(() => {
        const drafts = loadCardDrafts();
        const bases = loadCardDraftBases();
        for (const [key, text] of draftChangesRef.current) {
          if (text === null) delete drafts[key];
          else drafts[key] = text;
        }
        for (const [key, base] of baseChangesRef.current) {
          if (base === null) delete bases[key];
          else bases[key] = base;
        }
        cardDraftsRef.current = drafts;
        cardBasesRef.current = bases;
      }),
    [],
  );
  /** Keep `text` as the draft under `key` (null drops it), with the text it
      was typed on when it has one. */
  function setCardDraft(key: string, text: string | null, base: string | null = null) {
    const drafts = (cardDraftsRef.current ??= {});
    const bases = (cardBasesRef.current ??= {});
    if (text === null) delete drafts[key];
    else drafts[key] = text;
    if (text === null || base === null) delete bases[key];
    else bases[key] = base;
    draftChangesRef.current.set(key, text);
    baseChangesRef.current.set(key, text === null ? null : base);
  }
  const keepCardDraft = (noteId: string | null | undefined, text: string, saved: string | null = null) => {
    if (!noteId) return;
    const next = text !== (saved ?? "") && text.trim() ? text : null;
    if (draftShownRef.current.has(noteId) && draftShownRef.current.get(noteId) === next) return;
    draftShownRef.current.set(noteId, next);
    setCardDraft(noteId, next, saved);
  };
  // Words that never reached the server go back to the card's draft when the
  // card is closed: they show in its box when its mark opens it again.
  const returnToCardDraft = (key: string, text: string) => {
    const kept = cardDraftsRef.current?.[key] ?? "";
    const next = joinWords(text, kept);
    draftShownRef.current.delete(key);
    setCardDraft(key, next, cardBasesRef.current?.[key] ?? null);
  };
  // A comment's draft when its card opens again (SPEC.md §6): as typed while
  // the stored comment is still the one it was typed on; after a change made
  // elsewhere, put together with the stored comment, as a note's editor does,
  // so the next Save never writes the old words over the change.
  const reopenedDraft = (noteId: string, stored: string): string => {
    const draft = cardDraftsRef.current?.[noteId];
    if (draft === undefined) return stored;
    const base = cardBasesRef.current?.[noteId];
    if (base === undefined || base.trim() === stored.trim()) return draft;
    return reconcileNoteText(base.trim(), stored.trim(), draft.trim(), conflictLabels()).text;
  };
  const reopenedDraftRef = useRef(reopenedDraft);
  reopenedDraftRef.current = reopenedDraft;
  if (bubble) keepCardDraft(bubble.noteId, withQueued(bubble.input, bubble.queue));
  if (simplifyCard) keepCardDraft(simplifyCard.noteId, withQueued(simplifyCard.input, simplifyCard.queue));
  if (assistantChat) {
    // Each thread keeps its own words: the conversation's, and each side
    // chat's under its own note.
    keepCardDraft(assistantChat.noteId, withQueued(threadInput(assistantChat, null), queuedIn(assistantChat, null)));
    for (const side of assistantChat.sideChats ?? []) {
      keepCardDraft(side.noteId, withQueued(threadInput(assistantChat, side.key), queuedIn(assistantChat, side.key)));
    }
  }
  if (commentCard) keepCardDraft(commentCard.noteId, commentCard.draft, commentCard.saved);
  if (annotationCard) keepCardDraft(annotationCard.noteId, annotationCard.draft, annotationCard.saved);
  // Close one layer. A run in it goes on: Stop stops a run, never Escape or a
  // click; what lands is kept on the annotation and its mark reopens it.
  function closeLayer(layer: string) {
    if (layer === "popover") {
      setPopover(null);
      setSubmenu(null);
      // The page editor keeps the selection, as Google Docs does.
      if (!richTextRef.current) window.getSelection()?.removeAllRanges();
    } else if (layer === "pendingLink") broadcastPendingLink(null);
    else if (layer === "explain") setBubble(null);
    else if (layer === "simplify") setSimplifyCard(null);
    else if (layer === "assistant") {
      clearAnswerSelection();
      setAssistantChat(null);
    } else if (layer === "bar") setBar(null);
    else if (layer === "comment") setCommentCard(null);
    else if (layer === "link") setLinkCard(null);
    else if (layer === "annotation") setAnnotationCard(null);
    else if (layer === "extract") setExtractCard(null);
    else if (layer === "chooser") setStackChooser(null);
  }
  const closeLayerRef = useRef(closeLayer);
  closeLayerRef.current = closeLayer;
  const openLayersRef = useRef<string[]>([]);
  openLayersRef.current = Object.entries(layerKeys)
    .filter(([, key]) => key !== null)
    .map(([layer]) => layer)
    .sort((a, b) => (layerOpenedRef.current[b] ?? 0) - (layerOpenedRef.current[a] ?? 0));
  // A click on the pane outside every card closes the cards that have
  // nothing left to do: no run in flight, no typed words in their box.
  function closeIdleCards() {
    setBubble((b) => (b && !b.streaming && !b.busy && !b.input.trim() ? null : b));
    setSimplifyCard((c) => (c && !c.streaming && !c.busy && !c.input.trim() ? null : c));
    setAssistantChat((c) => {
      if (!c || c.busy || c.input.trim() || (c.queue?.length ?? 0) > 0) return c;
      clearAnswerSelection();
      return null;
    });
    setCommentCard((c) => (c && !c.busy && c.draft === c.saved ? null : c));
    setLinkCard((c) => (c && !c.busy && !c.draft.trim() ? null : c));
    setAnnotationCard((c) => (c && !c.busy && c.draft === c.saved ? null : c));
    setExtractCard(null);
    setStackChooser(null);
  }
  const closeIdleCardsRef = useRef(closeIdleCards);
  closeIdleCardsRef.current = closeIdleCards;

  // A quote dragged from the selection landed in a note: the selection was
  // used, so its toolbar and tint go (SPEC.md §6).
  useEffect(() => {
    const onLanded = () => {
      if (!popoverRef.current || popoverRef.current.figure) return;
      setPopover(null);
      setSubmenu(null);
      if (!richTextRef.current) window.getSelection()?.removeAllRanges();
    };
    window.addEventListener(QUOTE_LANDED_EVENT, onLanded);
    return () => window.removeEventListener(QUOTE_LANDED_EVENT, onLanded);
  }, []);

  // Escape closes one layer, the newest first (SPEC.md §6): the toolbar, a
  // pending link, a card — or a menu of the page opened after them (the
  // document list, History, Contents: lib/escape-layers.ts). It stops no
  // run. With nothing open it leaves edit mode, saving unsaved typing on
  // the way out.
  useEffect(
    () =>
      addEscapeSource(() => {
        const top = openLayersRef.current[0];
        if (top) return { seq: layerOpenedRef.current[top] ?? 0, close: () => closeLayerRef.current(top) };
        if (editModeRef.current) return { seq: 0, close: () => leaveEditMode() };
        return null;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Where the press started: a click that ends a drag (a card moved by
    // its header, an annotation dragged by its grip) is no click outside.
    let press: { x: number; y: number } | null = null;
    const onPress = (e: PointerEvent) => {
      press = { x: e.clientX, y: e.clientY };
    };
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || editModeRef.current || richTextRef.current) return;
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target || !container.contains(target)) return;
      // A press on a card, a control, or a mark is its own; a drag that
      // selected words opens the toolbar.
      if (
        target.closest(
          "[data-selection-popover], [data-side-card], [data-log-card], [data-annotation-card], [data-anchor-skip], mark, a, button, input, textarea, select, [role=dialog], [contenteditable=true]",
        )
      )
        return;
      if (window.getSelection()?.isCollapsed === false) return;
      // A click on a core reads its block whole (SPEC.md §28); the button
      // beside it folds it again.
      const core = target.closest<HTMLElement>("[data-collapsed]");
      if (core?.dataset.blockId) {
        readWholeRef.current(core.dataset.blockId);
        return;
      }
      closeIdleCardsRef.current();
    };
    window.addEventListener("pointerdown", onPress, true);
    container.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("pointerdown", onPress, true);
      container.removeEventListener("click", onClick);
    };
  }, []);

  // Selection → popover, in reading AND edit mode: highlighting text while
  // editing offers the same tools.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // A press on the article, outside the toolbar and off the text under it,
    // closes the toolbar at once. The tint the toolbar keeps on its text is
    // the selection's color, so a toolbar left open under a new drag shows
    // two selections — the old tint and the new selection — while the tools
    // read only the old one. The text under the toolbar keeps it: a press
    // there starts a drag of the passage (dragstart below).
    const onContainerMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      if (!popoverRef.current) return;
      const target = event.target instanceof Element ? event.target : null;
      // The page editor's toolbar acts on the open selection: a press there keeps it.
      if (target?.closest("[data-selection-popover], .selection-mark, .link-pending-mark, [data-docs-editor] [data-edit-control]")) return;
      setPopover(null);
      setSubmenu(null);
    };
    // A drag that starts on the article and lets go outside the pane still
    // ends a selection: the mouseup listens on the document, and a press
    // that started outside the pane never opens or closes the toolbar.
    let pressStartedInside = false;
    let pressTarget: Element | null = null;
    // The pane the reader last pressed in, not a layer inside it: its keys
    // (Ctrl/Cmd+A) are its own.
    let lastPressInside = false;
    const onDocumentMouseDown = (event: MouseEvent) => {
      pressStartedInside = event.target instanceof Node && container.contains(event.target);
      lastPressInside = event.target instanceof Element && event.target.closest("[data-reader-root]") === container;
      pressTarget = event.target instanceof Element ? event.target : null;
    };
    const onMouseUp = (event: MouseEvent) => {
      if (!canEditRef.current) return;
      const inside = event.target instanceof Node && container.contains(event.target);
      if (!inside && !pressStartedInside) return;
      const startedInside = pressStartedInside;
      pressStartedInside = false;
      if (suppressNextMouseUp.current) {
        suppressNextMouseUp.current = false;
        return;
      }
      // A press on the page editor's toolbar is a command, not a selection.
      // Where the press began decides: a drag can end over a control that
      // came up under it (a table's border button at a cell's corner).
      const pressed = pressTarget ?? (event.target instanceof Element ? event.target : null);
      pressTarget = null;
      if (pressed?.closest("[data-selection-popover], [data-docs-editor] [data-edit-control]")) return;
      // A drag that started inside the comment box can end over the article —
      // that is text editing, not a new selection.
      if (document.activeElement?.closest("[data-selection-popover]")) return;
      requestAnimationFrame(() => {
        // A drag that began on the article and let go in the tray or the
        // header selects the page between: the selection is cut to the
        // article's blocks it crosses, as if the drag had stopped at the
        // pane's edge.
        if (startedInside) clipSelectionToPane(event.clientX, event.clientY);
        const captured = captureSelection();
        // The VIDEO block (the player's own block) refuses annotation: a
        // selection over it shows the refusal instead of tools. Transcript
        // lines take every text tool (SPEC.md §11).
        if (captured) {
          const block = blocksRef.current.find((b) => b.id === captured.anchor.blockId);
          if (block && block.type === "VIDEO") {
            window.getSelection()?.removeAllRanges();
            setPopover(null);
            setSubmenu(null);
            showToast(t("reader.videoNoEditAnnotate"));
            return;
          }
        }
        // captureSelection bails on math blocks — the rendered KaTeX text is
        // not the stored TeX — which left equations mute under a selection
        // attempt. Detect that case and open the whole-equation tools instead.
        if (!captured && event.detail < 2) {
          const selection = window.getSelection();
          const startNode =
            selection && selection.rangeCount > 0 ? selection.getRangeAt(0).startContainer : null;
          const startEl = startNode instanceof Element ? startNode : (startNode?.parentElement ?? null);
          const targetEl = event.target instanceof Element ? event.target : null;
          const mathId = (startEl?.closest<HTMLElement>("[data-math-block]") ??
            targetEl?.closest<HTMLElement>("[data-math-block]"))?.dataset.blockId;
          const mathBlock = mathId ? blocksRef.current.find((b) => b.id === mathId) : undefined;
          if (mathId && mathBlock?.type === "EQUATION") {
            openFigureTools(mathId, event.clientX, event.clientY);
            // openFigureTools arms the gesture path's mouseup suppression; this
            // call already is the mouseup, so disarm it.
            suppressNextMouseUp.current = false;
            return;
          }
          // A click on a figure's picture in the block reader opens its tools,
          // as a click on an image does in the page editor (TOOL13-04); the
          // circle stays for the same. A picture under a mark or a link
          // opens what that opens.
          const picture = richTextRef.current ? null : targetEl?.closest("img, svg, canvas, picture");
          const figureId = picture?.closest<HTMLElement>("[data-block-id]")?.dataset.blockId;
          if (
            picture &&
            figureId &&
            !picture.closest("a, [data-source-id]:not([data-source-id=''])") &&
            blocksRef.current.find((b) => b.id === figureId)?.type === "FIGURE"
          ) {
            openFigureTools(figureId, event.clientX, event.clientY);
            suppressNextMouseUp.current = false;
            return;
          }
        }
        showTools(captured);
        // A selection that began off the blocks (the title, the label over
        // it) leaves the browser's own selection drawn there after the tint
        // paints the blocks: the tint is the selection now, so the browser's
        // goes.
        if (captured && !richTextRef.current) {
          const sel = window.getSelection();
          const node = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).startContainer : null;
          const el = node instanceof Element ? node : node?.parentElement;
          if (el && !el.closest("[data-block-id], [data-edit-block]")) sel?.removeAllRanges();
        }
      });
    };
    // The browser's selection, cut to this pane when it runs out of it: the
    // end the press made stays, and the end outside moves to the words
    // nearest the release point inside the pane, as if the drag had stopped
    // at the pane's edge.
    const clipSelectionToPane = (x: number, y: number) => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      if (container.contains(selection.getRangeAt(0).commonAncestorContainer)) return;
      const anchorNode = selection.anchorNode;
      if (!anchorNode || !container.contains(anchorNode)) return;
      // Only a drag that began on the article's words: one from a card's
      // text keeps the browser's own selection.
      const anchorEl = anchorNode instanceof Element ? anchorNode : anchorNode.parentElement;
      if (
        !anchorEl?.closest("article") ||
        anchorEl.closest("[data-side-card], [data-log-card], [data-selection-popover], [data-anchor-skip]")
      )
        return;
      const blocks = Array.from(container.querySelectorAll<HTMLElement>("[data-block-id], [data-edit-block]")).filter(
        (el) => el.closest("[data-reader-root]") === container && el.getClientRects().length > 0,
      );
      if (blocks.length === 0) return;
      const pane = container.getBoundingClientRect();
      const py = Math.max(pane.top + 1, Math.min(y, pane.bottom - 1));
      // The block level with the release point, else the nearest one.
      let block = blocks[0];
      let distance = Infinity;
      for (const el of blocks) {
        const r = el.getBoundingClientRect();
        const d = py < r.top ? r.top - py : py > r.bottom ? py - r.bottom : 0;
        if (d < distance) {
          block = el;
          distance = d;
        }
        if (d === 0) break;
      }
      const r = block.getBoundingClientRect();
      const doc = document as Document & {
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
      };
      const cx = Math.max(r.left + 1, Math.min(x, r.right - 1));
      const cy = Math.max(r.top + 1, Math.min(py, r.bottom - 1));
      let node: Node = block;
      let offset = x > r.left + r.width / 2 ? block.childNodes.length : 0;
      const position = doc.caretPositionFromPoint?.(cx, cy);
      const caret = position
        ? { node: position.offsetNode, offset: position.offset }
        : (() => {
            const range = doc.caretRangeFromPoint?.(cx, cy);
            return range ? { node: range.startContainer, offset: range.startOffset } : null;
          })();
      if (caret && block.contains(caret.node)) {
        node = caret.node;
        offset = caret.offset;
      }
      selection.setBaseAndExtent(anchorNode, selection.anchorOffset, node, offset);
    };
    // The toolbar on a selection. With a link pending, Close link is its
    // first row, and pressing it closes the link there — an accidental
    // selection creates nothing.
    const showTools = (captured: Popover | null) => {
      setSubmenu(null);
      setPopover(captured);
      if (captured) yieldToSelection();
    };
    // A new selection's toolbar takes the place of the on-mark card and the
    // chooser of stacked annotations, so two boxes never stand over the
    // words. A press does this with the mouse; on a touch screen the hold
    // that selects words presses nothing. A card with typed words stays.
    const yieldToSelection = () => {
      setStackChooser(null);
      setAnnotationCard((c) => (c && !c.busy && c.draft === c.saved ? null : c));
    };
    // The page editor (SPEC.md §29): a keyboard selection opens the toolbar
    // once Shift, Ctrl, or Cmd is let go; a caret moved with the keys closes it.
    const onKeyUp = (e: KeyboardEvent) => {
      if (!richTextRef.current || !canEditRef.current) return;
      if (!(e.target instanceof Element) || !e.target.closest("[data-docs-body]")) return;
      const released = e.key === "Shift" || e.key === "Control" || e.key === "Meta";
      if (!released && !(CARET_KEYS.has(e.key) && !e.shiftKey)) return;
      requestAnimationFrame(() => {
        if (!released) {
          if (window.getSelection()?.isCollapsed && popoverRef.current) {
            setPopover(null);
            setSubmenu(null);
          }
          return;
        }
        const captured = captureSelection();
        const open = popoverRef.current;
        if (captured && JSON.stringify(open?.anchor) !== JSON.stringify(captured.anchor)) showTools(captured);
      });
    };
    // The block reader, which has no caret: a selection the keys change —
    // Shift with the arrows from a drag's selection, Ctrl/Cmd+A below —
    // opens the toolbar once Shift, Ctrl, or Cmd is let go, as the page
    // editor's does.
    const onReaderKeyUp = (e: KeyboardEvent) => {
      if (richTextRef.current || !canEditRef.current) return;
      if (e.key !== "Shift" && e.key !== "Control" && e.key !== "Meta") return;
      if (e.target instanceof HTMLElement && isTextEntry(e.target)) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      if (!container.contains(selection.getRangeAt(0).commonAncestorContainer)) return;
      requestAnimationFrame(() => {
        const captured = captureSelection();
        if (captured && JSON.stringify(popoverRef.current?.anchor) !== JSON.stringify(captured.anchor)) {
          showTools(captured);
        }
      });
    };
    // Ctrl/Cmd+A in the block reader selects the article's blocks — not the
    // page around them, its header and the tray — and opens the toolbar on
    // them. In edit mode and in a field, the browser's own Select all runs.
    const onSelectAll = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "a") return;
      if (!lastPressInside || richTextRef.current || editModeRef.current || !canEditRef.current) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && isTextEntry(active)) return;
      const blocks = Array.from(container.querySelectorAll<HTMLElement>("[data-block-id]")).filter(
        (el) => el.closest("[data-reader-root]") === container && el.getClientRects().length > 0,
      );
      const firstBlock = blocks[0];
      const lastBlock = blocks[blocks.length - 1];
      if (!firstBlock || !lastBlock) return;
      e.preventDefault();
      const range = document.createRange();
      range.setStart(firstBlock, 0);
      range.setEnd(lastBlock, lastBlock.childNodes.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      showTools(captureSelection());
    };
    // Touch: mouseup is unreliable after long-press selection, and adjusting
    // the selection handles fires no mouseup at all. pointerup covers the
    // lift; a debounced selectionchange covers handle drags. Opening only —
    // a collapsed selection never closes the popover from here.
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      onMouseUp(event as unknown as MouseEvent);
    };
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    let selectionTimer: ReturnType<typeof setTimeout> | null = null;
    const onSelectionChange = () => {
      if (!coarse || !canEditRef.current) return;
      if (selectionTimer) clearTimeout(selectionTimer);
      selectionTimer = setTimeout(() => {
        const captured = captureSelection();
        if (!captured) return;
        // The same words again (the tint repaints and puts the selection
        // back over its marks): the open toolbox stays as it stands, with
        // the place fitToolbox gave it, above the words when the room under
        // them ran past the bottom bar.
        const open = popoverRef.current;
        if (open && !open.term && !open.figure && sameAnchor(open.anchor, captured.anchor)) return;
        setPopover(captured);
        setSubmenu(null);
        yieldToSelection();
      }, 500);
    };
    container.addEventListener("mousedown", onContainerMouseDown);
    document.addEventListener("mousedown", onDocumentMouseDown);
    document.addEventListener("mouseup", onMouseUp);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("keyup", onKeyUp);
    document.addEventListener("keyup", onReaderKeyUp);
    document.addEventListener("keydown", onSelectAll);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      container.removeEventListener("mousedown", onContainerMouseDown);
      document.removeEventListener("mousedown", onDocumentMouseDown);
      document.removeEventListener("mouseup", onMouseUp);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("keyup", onReaderKeyUp);
      document.removeEventListener("keydown", onSelectAll);
      document.removeEventListener("selectionchange", onSelectionChange);
      if (selectionTimer) clearTimeout(selectionTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureSelection, documentId]);

  // A blank document's Add comment (the page editor's toolbar button and
  // Ctrl+Alt+M, SPEC.md §29) opens this layer's Comment tool on the
  // selection; a message from the page editor shows as this layer's toast.
  // Both come up from this pane's own page editor.
  useEffect(() => {
    const container = containerRef.current;
    if (!richText || !container) return;
    const onComment = () => {
      const editor = pageEditorIn(container);
      if (!editor) return;
      let captured = captureSelection();
      // A caret in a word: the comment takes the word, as in Google Docs.
      const word = captured ? null : wordAtCaret(editor);
      if (word) {
        editor.commands.setTextSelection(word);
        captured = captureSelection();
      }
      if (!captured) {
        showToast(t("docs.selectToComment"));
        return;
      }
      // Ctrl+Alt+M's keyup can come before React renders: it reads the ref
      // and leaves the Comment tool open.
      popoverRef.current = captured;
      // The field opens and takes the focus before this key's handling ends,
      // so no key typed after Ctrl+Alt+M reaches the page.
      flushSync(() => {
        // The new comment takes the margin from a saved comment card.
        setCommentCard((c) => (c && !c.busy && c.draft === c.saved ? null : c));
        setAnnotationCard(null);
        setPopover(captured);
        setSubmenu("comment");
      });
    };
    // The selection; for the assistant with none, the caret's paragraph. A
    // menu that took the focus gives the page its selection back first.
    const passage = (editor: Editor | null, orParagraph: boolean) => {
      if (editor && !editor.view.hasFocus()) editor.view.focus();
      const captured = captureSelection();
      const caret = editor?.state.selection.$from;
      if (captured || !orParagraph || !editor || !caret?.parent.isTextblock) return captured;
      editor.commands.setTextSelection({ from: caret.start(), to: caret.end() });
      return captureSelection();
    };
    // The page editor's right-click menu and Search the menus: Add to notes,
    // Explain, and Ask the assistant open the same tools on the selection as
    // this toolbar does. Where the page takes suggestions, the assistant is
    // its bar, and a command runs in it at once (SPEC.md §29).
    const onTool = (e: Event) => {
      const { tool, command } = (
        e as CustomEvent<{ tool: "add-to-notes" | "explain" | "assistant"; command?: string }>
      ).detail;
      const editor = pageEditorIn(container);
      const captured = passage(editor, tool === "assistant");
      if (!captured) {
        showToast(t("docsLayer.selectWordsFirst"));
        return;
      }
      if (tool === "assistant" && editor?.isEditable) {
        const opened = openBarRef.current(captured);
        const chip = SUGGEST_CHIPS.find((c) => c.name === command);
        if (chip) void runBarRef.current(opened, chip);
        return;
      }
      popoverRef.current = captured;
      setPopover(captured);
      setSubmenu(tool === "add-to-notes" ? "add" : tool === "assistant" ? "ai" : null);
      if (tool === "explain") setPendingExplain(true);
    };
    // Ctrl+Alt+G (⌘+Option+G) opens the assistant's bar on the selection.
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !matchesCombo(e, "Mod+Alt+G") || e.getModifierState("AltGraph")) return;
      const editor = pageEditorIn(container);
      if (!editor?.isEditable || !(e.target instanceof Node) || !editor.view.dom.contains(e.target)) return;
      e.preventDefault();
      const captured = passage(editor, true);
      if (captured) openBarRef.current(captured);
    };
    // A toast raised on no page editor shows in every pane.
    // The page editor's messages, some with an action (Switch to Editing).
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<{ text: string; action?: { label: string; run: () => void } }>).detail;
      if (detail?.text) showToast(detail.text, detail.action ?? null);
    };
    // A click on a figure object opens the figure's tools, as the circle
    // does. The figure fires at its own mouseup, before the document's, so
    // the mouseup's selection check stands down; an event with no mouseup
    // after it leaves nothing armed.
    let disarm = 0;
    const onFigureTools = (e: Event) => {
      const { blockId, x, y } = (e as CustomEvent<{ blockId: string; x: number; y: number }>).detail;
      openFigureToolsRef.current(blockId, x, y);
      cancelAnimationFrame(disarm);
      disarm = requestAnimationFrame(() => {
        suppressNextMouseUp.current = false;
      });
    };
    container.addEventListener(DOCS_EVENT.comment, onComment);
    container.addEventListener(DOCS_EVENT.tool, onTool);
    container.addEventListener(DOCS_EVENT.figureTools, onFigureTools);
    container.addEventListener("keydown", onKey);
    container.addEventListener("dissect:toast", onToast);
    // The page editor's link box (Ctrl+K) takes the keys: the selection
    // toolbar over the same words closes, so one layer is open at a time.
    const onCloseToolbar = () => {
      setPopover(null);
      setSubmenu(null);
    };
    container.addEventListener(CLOSE_TOOLBAR_EVENT, onCloseToolbar);
    return () => {
      container.removeEventListener(CLOSE_TOOLBAR_EVENT, onCloseToolbar);
      container.removeEventListener(DOCS_EVENT.comment, onComment);
      container.removeEventListener(DOCS_EVENT.tool, onTool);
      container.removeEventListener(DOCS_EVENT.figureTools, onFigureTools);
      container.removeEventListener("keydown", onKey);
      container.removeEventListener("dissect:toast", onToast);
      cancelAnimationFrame(disarm);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureSelection, Boolean(richText)]);

  // Double-click a text block to edit it in place. The hint card teaches this
  // once; after the first double-click it never shows again.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onDblClick = (e: MouseEvent) => {
      if (!canEditRef.current) return;
      if (editModeRef.current || richTextRef.current) return;
      // A transcript is not edited in place.
      if (transcriptModeRef.current) return;
      const target = e.target as Element;
      if (target.closest("[data-selection-popover]")) return;
      const blockEl = target.closest<HTMLElement>("[data-block-id]");
      const blockId = blockEl?.dataset.blockId;
      if (!blockId) return;
      const block = blocksRef.current.find((b) => b.id === blockId);
      if (
        !block ||
        block.type === "FIGURE" ||
        block.type === "TABLE" ||
        block.type === "SEPARATOR" ||
        block.type === "PAGE" ||
        block.type === "SLIDE" ||
        block.type === "SHEET"
      )
        return;
      // Video documents' blocks refuse edits outright.
      if (block.type === "VIDEO" || block.type === "TRANSCRIPT") {
        showToast(t("reader.videoNoEditAnnotate"));
        return;
      }
      window.getSelection()?.removeAllRanges();
      setPopover(null);
      setSubmenu(null);
      editModeRef.current = true;
      setEditMode(true);
      localStorage.setItem("unitos-edit-hint", "done");
      setEditHint(false);
      // Focus the clicked block once its editable mounts; land the caret where
      // the double-click happened.
      const { clientX, clientY } = e;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const el = document.querySelector<HTMLElement>(`[data-edit-block="${blockId}"]`);
          if (!el) return;
          el.focus();
          const doc = document as Document & {
            caretRangeFromPoint?: (x: number, y: number) => Range | null;
          };
          const range = doc.caretRangeFromPoint?.(clientX, clientY);
          const selection = window.getSelection();
          if (range && el.contains(range.startContainer) && selection) {
            selection.removeAllRanges();
            selection.addRange(range);
          }
        }),
      );
    };
    container.addEventListener("dblclick", onDblClick);
    return () => container.removeEventListener("dblclick", onDblClick);
  }, [t]);

  // Connector lines: each open tool block gets a faint line from the edge of
  // its highlighted text to the card, so the correspondence is visible even
  // with several cards open. Recomputed whenever a card opens, moves, or closes.
  const [connectors, setConnectors] = useState<
    { x1: number; y1: number; x2: number; y2: number }[]
  >([]);
  const [connectorHeight, setConnectorHeight] = useState(0);
  // The anchors the open cards point at, read by the measure below through a
  // ref so scroll and transition frames measure without re-subscribing.
  const cardAnchorsRef = useRef<Record<string, Anchor | null | undefined>>({});
  cardAnchorsRef.current = {
    explain: bubble?.anchor,
    simplify: simplifyCard?.anchor,
    assistant: assistantChat?.anchor,
    comment: commentCard?.anchor,
    link: linkCard?.anchor,
    log: logCard?.anchor,
    annotation: annotationCard?.anchor,
  };
  const measureConnectors = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      setConnectors([]);
      return;
    }
    const crect = container.getBoundingClientRect();
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    // The log card (data-log-card) gets its line too; it is not a side card,
    // so it never takes a slot or pushes a card.
    // The narrow reader's cards sit right under their paragraphs: no line.
    const narrowText = narrowRef.current && !richTextRef.current;
    for (const el of container.querySelectorAll<HTMLElement>("[data-side-card], [data-log-card]")) {
      if (el.closest(".presence-exit")) continue;
      if (narrowText && el.dataset.sideCard) continue;
      const anchor = cardAnchorsRef.current[el.dataset.sideCard ?? el.dataset.logCard ?? ""];
      if (!anchor) continue;
      const blockEl = container.querySelector<HTMLElement>(
        `[data-block-id="${anchor.blockId}"], [data-edit-block="${anchor.blockId}"]`,
      );
      if (!blockEl) continue;
      const b = blockEl.getBoundingClientRect();
      const c = el.getBoundingClientRect();
      const toY = (clientY: number) => clientY - crect.top + container.scrollTop;
      const cardMidX = (c.left + c.right) / 2;
      const blockMidX = (b.left + b.right) / 2;
      const cardOnRight = cardMidX >= blockMidX;
      const y1 = Math.min(Math.max(toY(c.top) + 20, toY(b.top) + 8), toY(b.bottom) - 8);
      lines.push({
        x1: (cardOnRight ? b.right : b.left) - crect.left,
        y1,
        x2: (cardOnRight ? c.left : c.right) - crect.left,
        y2: toY(c.top) + 20,
      });
    }
    setConnectors((prev) =>
      prev.length === lines.length &&
      prev.every(
        (l, i) =>
          l.x1 === lines[i].x1 && l.y1 === lines[i].y1 && l.x2 === lines[i].x2 && l.y2 === lines[i].y2,
      )
        ? prev
        : lines,
    );
    setConnectorHeight(container.scrollHeight);
  }, []);
  useEffect(() => {
    const raf = requestAnimationFrame(measureConnectors);
    return () => cancelAnimationFrame(raf);
  }, [bubble, simplifyCard, assistantChat, commentCard, linkCard, logCard, measureConnectors]);
  // The line follows its ends while they move: a scroll box inside the pane
  // (the transcript's) scrolls the text under a card, and a card pushed down
  // by a growing neighbor slides to its new place (globals.css
  // [data-side-card]) — every frame of the slide re-measures.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let raf = 0;
    const schedule = () => {
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          measureConnectors();
        });
      }
    };
    let following = 0;
    let stopAt = 0;
    const follow = () => {
      measureConnectors();
      following = performance.now() < stopAt ? requestAnimationFrame(follow) : 0;
    };
    const onTransitionRun = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target?.hasAttribute?.("data-side-card")) return;
      if ((e as TransitionEvent).propertyName !== "top") return;
      stopAt = performance.now() + 400;
      if (!following) following = requestAnimationFrame(follow);
    };
    const onTransitionEnd = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target?.hasAttribute?.("data-side-card")) schedule();
    };
    container.addEventListener("scroll", schedule, true);
    container.addEventListener("transitionrun", onTransitionRun);
    container.addEventListener("transitionend", onTransitionEnd);
    return () => {
      container.removeEventListener("scroll", schedule, true);
      container.removeEventListener("transitionrun", onTransitionRun);
      container.removeEventListener("transitionend", onTransitionEnd);
      if (raf) cancelAnimationFrame(raf);
      if (following) cancelAnimationFrame(following);
    };
  }, [measureConnectors]);

  // Every tool card grows with its content up to the pane's height. When a
  // growing card reaches a card below it on the same side, that card moves
  // down, and the one below it in turn — the growing card never moves. Sizes
  // come from the cards' boxes; targets from their inline top, so a card
  // mid-slide still counts where it will rest.
  const cardSizesRef = useRef<Record<string, string>>({});
  // A card that grows into the card under it keeps that card in its place
  // (SPEC.md §6): it stops at the room above it and scrolls inside, so a card
  // the reader is reading never jumps when another answer lands. cap = the
  // grown card's height limit, by kind; it lifts when a card opens or closes.
  const [cardCaps, setCardCaps] = useState<Record<string, number>>({});
  const CAP_MIN = 160;
  const settleSideCards = useCallback((grown: string | null, opened: string | null = null) => {
    const container = containerRef.current;
    if (!container) return;
    // The narrow reader places its cards under their paragraphs (layoutNarrowCards).
    if (narrowRef.current && !richTextRef.current) return;
    type Box = { kind: string; top: number; left: number; right: number; height: number };
    const boxes: Box[] = [];
    for (const el of container.querySelectorAll<HTMLElement>("[data-side-card]")) {
      if (el.closest(".presence-exit")) continue;
      const kind = el.dataset.sideCard ?? "";
      boxes.push({
        kind,
        top: parseFloat(el.style.top) || el.offsetTop,
        left: el.offsetLeft,
        right: el.offsetLeft + el.offsetWidth,
        height: el.offsetHeight,
      });
    }
    if (boxes.length < 2) return;
    // A grown card that reaches a card under it stops above that card, when
    // that leaves it room to read; else it pushes as before.
    const grownBox = boxes.find((b) => b.kind === grown);
    if (grownBox) {
      const below = boxes
        .filter((b) => b !== grownBox && b.left < grownBox.right && b.right > grownBox.left && b.top > grownBox.top)
        .sort((a, b) => a.top - b.top)[0];
      if (below && grownBox.top + grownBox.height + SETTLE_GAP > below.top) {
        const room = below.top - SETTLE_GAP - grownBox.top;
        if (room >= CAP_MIN) {
          grownBox.height = room;
          setCardCaps((caps) => (caps[grownBox.kind] === room ? caps : { ...caps, [grownBox.kind]: room }));
        }
      }
    }
    // A card that just opened lands at its words, in view: an older card above
    // it that reaches it gives up height (its body scrolls) instead of pushing
    // the new card under the window. An older card keeps CAP_MIN at least; the
    // new card then opens under that.
    const openedBox = grownBox ? undefined : boxes.find((b) => b.kind === opened);
    let openedTop: number | null = null;
    if (openedBox) {
      for (const above of boxes) {
        if (above === openedBox || above.top >= openedBox.top) continue;
        if (above.left >= openedBox.right || above.right <= openedBox.left) continue;
        if (above.top + above.height + SETTLE_GAP <= openedBox.top) continue;
        const room = Math.max(CAP_MIN, openedBox.top - SETTLE_GAP - above.top);
        if (room >= above.height) continue;
        above.height = room;
        setCardCaps((caps) => (caps[above.kind] === room ? caps : { ...caps, [above.kind]: room }));
        openedTop = Math.max(openedTop ?? openedBox.top, above.top + room + SETTLE_GAP);
      }
    }
    // The grown card, or the card that just opened, is placed first and
    // stays; the rest settle top to bottom.
    const pinned = grownBox ? grown : openedBox ? opened : null;
    const order = [
      ...boxes.filter((b) => b.kind === pinned),
      ...boxes.filter((b) => b.kind !== pinned).sort((a, b) => a.top - b.top),
    ];
    const moved: Record<string, number> = {};
    if (openedBox && openedTop !== null && openedTop !== openedBox.top) {
      openedBox.top = openedTop;
      moved[openedBox.kind] = openedTop;
    }
    const placed: Box[] = [];
    for (const box of order) {
      let top = box.top;
      let pushed = true;
      while (pushed) {
        pushed = false;
        for (const other of placed) {
          const sideBySide = box.left < other.right && box.right > other.left;
          const overlaps = top < other.top + other.height + SETTLE_GAP && top + box.height > other.top;
          if (sideBySide && overlaps) {
            top = other.top + other.height + SETTLE_GAP;
            pushed = true;
          }
        }
      }
      if (top !== box.top) moved[box.kind] = top;
      placed.push({ ...box, top });
    }
    const lift = <T extends { top: number }>(kind: string) => (c: T | null): T | null =>
      c && moved[kind] !== undefined && c.top !== moved[kind] ? { ...c, top: moved[kind] } : c;
    if (moved.explain !== undefined) setBubble(lift<ExplainBubble>("explain"));
    if (moved.simplify !== undefined) setSimplifyCard(lift<SimplifyCard>("simplify"));
    if (moved.assistant !== undefined) setAssistantChat(lift<AssistantChat>("assistant"));
    if (moved.comment !== undefined) setCommentCard(lift<NonNullable<typeof commentCard>>("comment"));
    if (moved.link !== undefined) setLinkCard(lift<LinkCard>("link"));
    if (moved.annotation !== undefined) setAnnotationCard(lift<AnnotationCard>("annotation"));
  }, []);
  // A card grows with its content up to the pane's height, then its body
  // scrolls (SPEC.md §6). A card anchored low in the pane still grows past the
  // pane's bottom edge, and the box at its foot goes out of reach — a long
  // conversation kept pushing it further down. So a card that grew is lifted
  // until its foot is back inside the pane; a card taller than the pane sits
  // at the pane's top and scrolls inside. Only a card the reader can see
  // moves: one scrolled away stays at its anchor.
  const PANE_EDGE_GAP = 8;
  const keepCardInPane = useCallback((grown: string | null) => {
    const container = containerRef.current;
    if (!container || !grown) return;
    // The narrow reader's cards sit in the text, under their paragraphs.
    if (narrowRef.current && !richTextRef.current) return;
    // A page over the pane scrolls it to the top while it is open; that is not
    // where the cards under it sit, so nothing moves until it closes.
    if (distillOpenRef.current || conversationViewRef.current) return;
    const el = container.querySelector<HTMLElement>(`[data-side-card="${grown}"]`);
    if (!el || el.closest(".presence-exit")) return;
    const top = parseFloat(el.style.top) || el.offsetTop;
    // The article's band holds Contents, Collapse and Extract: a lifted card
    // stops under it, so it never covers them.
    const band = container.querySelector<HTMLElement>("[data-article-band]")?.offsetHeight ?? 0;
    const viewTop = container.scrollTop + band + PANE_EDGE_GAP;
    const viewBottom = container.scrollTop + container.clientHeight - PANE_EDGE_GAP;
    if (top >= viewBottom || top + el.offsetHeight <= viewTop) return;
    const want = Math.max(viewTop, Math.min(top, viewBottom - el.offsetHeight));
    // A card above it in the same column stays uncovered: the lift stops
    // under that card's foot, and the card runs on below the pane instead.
    let floor = -Infinity;
    for (const other of container.querySelectorAll<HTMLElement>("[data-side-card]")) {
      if (other === el || other.closest(".presence-exit")) continue;
      const otherTop = parseFloat(other.style.top) || other.offsetTop;
      const sideBySide =
        other.offsetLeft < el.offsetLeft + el.offsetWidth && other.offsetLeft + other.offsetWidth > el.offsetLeft;
      if (sideBySide && otherTop < top) floor = Math.max(floor, otherTop + other.offsetHeight + SETTLE_GAP);
    }
    const lifted = want < top ? Math.max(want, Math.min(floor, top)) : want;
    if (Math.abs(lifted - top) < 1) return;
    const move = <T extends { top: number }>(c: T | null): T | null =>
      c ? { ...c, top: lifted } : c;
    if (grown === "explain") setBubble(move<ExplainBubble>);
    else if (grown === "simplify") setSimplifyCard(move<SimplifyCard>);
    else if (grown === "assistant") setAssistantChat(move<AssistantChat>);
    else if (grown === "comment") setCommentCard(move<NonNullable<typeof commentCard>>);
    else if (grown === "link") setLinkCard(move<LinkCard>);
    else if (grown === "annotation") setAnnotationCard(move<AnnotationCard>);
  }, []);
  // The narrow reader (SPEC.md §6): no room beside the words, so each card
  // opens under the paragraph that ends its passage, and that paragraph's
  // bottom margin grows by the cards' height, so the text after it moves down
  // and no card covers a word. Two cards under one paragraph stack, the
  // older first. A card the reader dragged elsewhere keeps its place and
  // takes no room. A new card below the window brings itself into view,
  // keeping the passage's first line on screen.
  const movedCardsRef = useRef(new Set<string>());
  const narrowShownRef = useRef(new Set<string>());
  const layoutNarrowCards = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const narrow = narrowRef.current && !richTextRef.current && !distillOpenRef.current && !conversationViewRef.current;
    const hosts = new Map<HTMLElement, { kind: string; el: HTMLElement; anchorTop: number }[]>();
    if (narrow) {
      for (const el of container.querySelectorAll<HTMLElement>("[data-side-card]")) {
        if (el.closest(".presence-exit")) continue;
        const kind = el.dataset.sideCard ?? "";
        if (movedCardsRef.current.has(`${kind}:${layerSeenRef.current[kind] ?? ""}`)) continue;
        const anchor = cardAnchorsRef.current[kind];
        const box = anchor ? passageBox(container, anchor) : null;
        if (!box) continue;
        const host = drawnBlock(container, box.blockId);
        if (!host) continue;
        const list = hosts.get(host) ?? [];
        list.push({ kind, el, anchorTop: box.top });
        hosts.set(host, list);
      }
    }
    // Paragraphs that no longer hold a card give their room back.
    for (const el of container.querySelectorAll<HTMLElement>("[data-card-room]")) {
      if (hosts.has(el)) continue;
      el.style.marginBottom = el.dataset.cardRoom ?? "";
      delete el.dataset.cardRoom;
      delete el.dataset.cardRoomBase;
    }
    const crect = container.getBoundingClientRect();
    // On a phone the bottom bar lies over the pane's foot: the view ends at
    // its top edge.
    const rail = narrow ? document.querySelector<HTMLElement>('nav[data-nudge="rail"]') : null;
    const railTop = rail && getComputedStyle(rail).position === "fixed" ? rail.getBoundingClientRect().top : Infinity;
    const shownHeight = Math.min(crect.bottom, railTop) - crect.top;
    const tops: Record<string, number> = {};
    const phoneCaps: Record<string, number> = {};
    const ordered = [...hosts.keys()].sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
    for (const host of ordered) {
      const cards = hosts
        .get(host)!
        .sort((a, b) => (layerOpenedRef.current[a.kind] ?? 0) - (layerOpenedRef.current[b.kind] ?? 0));
      // The paragraph's own margin, kept to give back when its cards close.
      if (host.dataset.cardRoom === undefined) {
        host.dataset.cardRoom = host.style.marginBottom;
        host.dataset.cardRoomBase = String(parseFloat(getComputedStyle(host).marginBottom) || 0);
      }
      const base = parseFloat(host.dataset.cardRoomBase ?? "0") || 0;
      const room = 8 + cards.reduce((sum, c) => sum + c.el.offsetHeight + CARD_GAP, 0);
      host.style.marginBottom = `${base + room}px`;
      let y = host.getBoundingClientRect().bottom - crect.top + container.scrollTop + 8;
      for (const card of cards) {
        tops[card.kind] = y;
        y += card.el.offsetHeight + CARD_GAP;
        // A card that just opened under the window comes into view, its foot
        // too (its buttons), as far as its words stay in view. A run that
        // lands is a new layer key: the card, grown, is checked again.
        const key = `${card.kind}:${layerSeenRef.current[card.kind] ?? ""}`;
        if (!narrowShownRef.current.has(key)) {
          narrowShownRef.current.add(key);
          const viewBottom = container.scrollTop + shownHeight;
          const want =
            tops[card.kind] + Math.min(card.el.offsetHeight, Math.max(220, shownHeight - 32)) - (viewBottom - 16);
          // The words stay in view below the article's band (its chips).
          const band = container.querySelector<HTMLElement>("[data-article-band]")?.offsetHeight ?? 0;
          const keep = card.anchorTop - container.scrollTop - 16 - band;
          const by = Math.min(want, keep);
          if (by > 0) container.scrollBy({ top: by, behavior: "smooth" });
          // On a phone a card taller than the room left above the bottom bar
          // gives up height (its body scrolls), so its foot — the box, the
          // buttons — stays in reach above the bar.
          if (railTop !== Infinity) {
            const room = Math.floor(shownHeight - (tops[card.kind] - container.scrollTop - Math.max(0, by)) - 16);
            if (card.el.offsetHeight > room && room >= CAP_MIN) phoneCaps[card.kind] = room;
          }
        }
      }
    }
    if (Object.keys(phoneCaps).length > 0) setCardCaps((caps) => ({ ...caps, ...phoneCaps }));
    const place = <T extends { top: number }>(kind: string) => (c: T | null): T | null =>
      c && tops[kind] !== undefined && Math.abs(c.top - tops[kind]) > 1 ? { ...c, top: tops[kind] } : c;
    if (tops.explain !== undefined) setBubble(place<ExplainBubble>("explain"));
    if (tops.simplify !== undefined) setSimplifyCard(place<SimplifyCard>("simplify"));
    if (tops.assistant !== undefined) setAssistantChat(place<AssistantChat>("assistant"));
    if (tops.comment !== undefined) setCommentCard(place<NonNullable<typeof commentCard>>("comment"));
    if (tops.link !== undefined) setLinkCard(place<LinkCard>("link"));
    if (tops.annotation !== undefined) setAnnotationCard(place<AnnotationCard>("annotation"));
  }, []);
  const layoutNarrowCardsRef = useRef(layoutNarrowCards);
  layoutNarrowCardsRef.current = layoutNarrowCards;
  useLayoutEffect(() => {
    layoutNarrowCardsRef.current();
  });
  const openCards = `${bubble !== null}${simplifyCard !== null}${assistantChat !== null}${commentCard !== null}${linkCard !== null}${annotationCard !== null}`;
  // The room the column made for the cards goes back when the last one closes.
  const anyCardOpen = openCards.includes("true");
  const anyCardOpenRef = useRef(anyCardOpen);
  anyCardOpenRef.current = anyCardOpen;
  // A card opening or closing lifts the caps: the cards settle again.
  const [capsOpenCards, setCapsOpenCards] = useState(openCards);
  if (capsOpenCards !== openCards) {
    setCapsOpenCards(openCards);
    if (Object.keys(cardCaps).length > 0) setCardCaps({});
  }
  useEffect(() => {
    if (anyCardOpen || cardsRoomRef.current === 0) return;
    cardsRoomRef.current = 0;
    setCardsRoom(0);
  }, [anyCardOpen]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      // The card whose size changed is the one that stays put. An observer's
      // first report of a card carries no change: the cards settle top to
      // bottom then, none pinned.
      let grown: string | null = null;
      let opened: string | null = null;
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const kind = el.dataset.sideCard ?? "";
        const size = `${el.offsetWidth}x${el.offsetHeight}`;
        const before = cardSizesRef.current[kind];
        cardSizesRef.current[kind] = size;
        if (before !== undefined && before !== size) grown = kind;
        if (before === undefined) opened = kind;
        // A card that opens tall (reopened from its mark with its turns)
        // keeps its foot inside the pane too, not only one that grew.
        if (before !== size) keepCardInPane(kind);
      }
      settleSideCards(grown, opened);
      layoutNarrowCardsRef.current();
    });
    // A closed card's size goes with it: the next card of its kind opens
    // fresh, and is kept in the pane like any card that opens.
    const open = new Set<string>();
    for (const el of container.querySelectorAll<HTMLElement>("[data-side-card]")) {
      if (el.closest(".presence-exit")) continue;
      open.add(el.dataset.sideCard ?? "");
      observer.observe(el);
    }
    for (const kind of Object.keys(cardSizesRef.current)) if (!open.has(kind)) delete cardSizesRef.current[kind];
    return () => observer.disconnect();
  }, [openCards, keepCardInPane, settleSideCards]);

  const chatMessageCount = assistantChat?.messages.length ?? 0;
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessageCount]);
  // A tool card's body scrolls to a new turn of its conversation (SPEC.md §21).
  const explainBodyRef = useRef<HTMLDivElement>(null);
  const simplifyBodyRef = useRef<HTMLDivElement>(null);
  const explainTurnCount = bubble?.conversation.length ?? 0;
  const simplifyTurnCount = simplifyCard?.conversation.length ?? 0;
  useEffect(() => {
    const el = explainBodyRef.current;
    if (el && explainTurnCount > 0) el.scrollTop = el.scrollHeight;
  }, [explainTurnCount]);
  useEffect(() => {
    const el = simplifyBodyRef.current;
    if (el && simplifyTurnCount > 0) el.scrollTop = el.scrollHeight;
  }, [simplifyTurnCount]);

  // The hint plays to its end once, then never again on any document.
  const hintPlayed = () => {
    setEditHint(false);
    try {
      localStorage.setItem("unitos-edit-hint", "done");
    } catch {
      // Storage blocked: the hint shows again on the next open.
    }
  };
  useEffect(() => {
    if (localStorage.getItem("unitos-edit-hint") === "done") return;
    // Beside the article when its right margin holds the card (with its
    // 20px from the pane's edge); else a row under the pane.
    const container = containerRef.current;
    const article = container?.querySelector("article");
    if (container && article) {
      const width = window.matchMedia("(pointer: coarse)").matches ? 320 : 256;
      const room = container.getBoundingClientRect().right - article.getBoundingClientRect().right;
      setHintBeside(room >= width + 32);
    }
    // Post-hydration reveal on purpose: localStorage is client-only, so the
    // SSR pass must render without the hint.
    setEditHint(true);
  }, [documentId]);

  // Hold-and-circle gesture on figures and equations opens their tools.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let tracking: {
      pointerId: number;
      blockId: string;
      points: { x: number; y: number }[];
      minX: number;
      maxX: number;
      minY: number;
      maxY: number;
    } | null = null;
    const figureAt = (target: Element | null): string | null => {
      const el = target?.closest?.<HTMLElement>("[data-block-id]");
      const blockId = el?.dataset.blockId;
      if (!blockId) return null;
      const block = blocksRef.current.find((b) => b.id === blockId);
      return block && CIRCLED_TYPES.has(block.type) ? blockId : null;
    };
    // Glow seam: a sibling layer renders the visual effect from these events.
    // Emitted only while a figure/equation block is tracked, in viewport coords.
    const emitGlow = (phase: "start" | "move" | "end", x: number, y: number, blockId: string) => {
      window.dispatchEvent(new CustomEvent("dissect:circle-glow", { detail: { phase, x, y, blockId } }));
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const blockId = figureAt(e.target as Element);
      if (!blockId) return;
      tracking = {
        pointerId: e.pointerId,
        blockId,
        points: [{ x: e.clientX, y: e.clientY }],
        minX: e.clientX,
        maxX: e.clientX,
        minY: e.clientY,
        maxY: e.clientY,
      };
      emitGlow("start", e.clientX, e.clientY, blockId);
    };
    const onMove = (e: PointerEvent) => {
      if (!tracking || e.pointerId !== tracking.pointerId) return;
      tracking.points.push({ x: e.clientX, y: e.clientY });
      tracking.minX = Math.min(tracking.minX, e.clientX);
      tracking.maxX = Math.max(tracking.maxX, e.clientX);
      tracking.minY = Math.min(tracking.minY, e.clientY);
      tracking.maxY = Math.max(tracking.maxY, e.clientY);
      emitGlow("move", e.clientX, e.clientY, tracking.blockId);
      // Spread out past a hand-sized area = a drag or a scroll, not a circle.
      if (tracking.maxX - tracking.minX > 320 || tracking.maxY - tracking.minY > 320) {
        emitGlow("end", e.clientX, e.clientY, tracking.blockId);
        tracking = null;
        return;
      }
      if (tracking.points.length >= 12 && circleSweepDegrees(tracking.points) >= 300) {
        const { blockId } = tracking;
        tracking = null;
        emitGlow("end", e.clientX, e.clientY, blockId);
        openFigureTools(blockId, e.clientX, e.clientY);
      }
    };
    const onUp = (e: PointerEvent) => {
      if (tracking) emitGlow("end", e.clientX, e.clientY, tracking.blockId);
      tracking = null;
    };
    const onDragStart = (e: DragEvent) => {
      if (figureAt(e.target as Element)) {
        e.preventDefault();
        return;
      }
      // A drag that starts on the selection carries the passage as a quote
      // (lib/quote-drag.ts): let go in a note, it lands there as a quote
      // with the same source Add to notes gives it, pointing back here. The
      // toolbar's anchor when it is open, else the selection read now: the
      // drag never waits on the toolbar.
      const sel = window.getSelection();
      if (!e.dataTransfer || !sel || sel.isCollapsed) return;
      const anchor = popoverRef.current?.anchor ?? captureSelectionRef.current()?.anchor;
      if (!anchor) return;
      const docId = documentIdRef.current;
      const segments = segmentsOf(anchor).map((segment) => ({ documentId: docId, ...anchorBody(segment) }));
      const text = passageText(anchor);
      writeQuoteDrag(e.dataTransfer, {
        source: segments[0],
        ...(segments.length > 1 ? { segments } : {}),
        text,
      });
      setQuoteDragImage(e.dataTransfer, text);
      // In the page editor the drag also moves words within the page, and
      // the typing saves on the way, so the note anchors on saved words.
      if (richTextRef.current) {
        e.dataTransfer.effectAllowed = "copyMove";
        void flushEditRef.current?.();
      }
    };
    // In Editing and Suggesting, a press outside the page (the notes tray,
    // a button) takes the browser's selection out of the page, while the
    // page still draws its selection and the toolbox stays open on it. A
    // press on those words then started a new selection, and the quote drag
    // never began. The page's selection goes back into the browser before
    // the press is handled, so a press on it and a move drag the quote, as
    // in Viewing; a click without a move still puts the caret there.
    const onPressSelection = (e: MouseEvent) => {
      if (e.button !== 0 || e.detail > 1 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const editor = pageEditorIn(container);
      if (!editor?.isEditable || !(e.target instanceof Node) || !editor.view.dom.contains(e.target)) return;
      const { from, to, empty } = editor.state.selection;
      if (empty) return;
      const live = window.getSelection();
      if (live && !live.isCollapsed && live.anchorNode && editor.view.dom.contains(live.anchorNode)) return;
      const at = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos;
      if (at === undefined || at <= from || at >= to) return;
      editor.view.focus();
    };
    container.addEventListener("pointerdown", onDown);
    container.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    container.addEventListener("mousedown", onPressSelection, true);
    container.addEventListener("dragstart", onDragStart);
    return () => {
      container.removeEventListener("mousedown", onPressSelection, true);
      container.removeEventListener("pointerdown", onDown);
      container.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      container.removeEventListener("dragstart", onDragStart);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll to an anchor and flash it. Retries while the refreshed tree paints.
  // The mark may not be painted yet — the document is still rendering, the
  // page editor's code is still loading, or the reader arrived here from a
  // note in another document — so the look-up retries for PAGE_WAIT_MS at
  // most, reading the container fresh each time. A core anchor paints only
  // while its unit shows its core (SPEC.md §28): the jump shows the core,
  // or, where no core can be drawn (Editing, edit mode, or no cores in
  // hand), lands on the unit's words and flashes the unit. A mark in the
  // words of a collapsed unit reads the unit whole first. While the cores
  // the article opens with are on their way, the jump waits for them.
  const flashSource = useCallback((sourceId: string) => {
    let attempts = 0;
    let rows: string[] | null = null;
    const tryScroll = () => {
      const pane = containerRef.current;
      let found: HTMLElement[] = [];
      if (pane && !coresComingRef.current()) {
        const keys = Object.entries(anchorHighlightsRef.current).flatMap(([key, list]) =>
          list.some((h) => h.sourceId === sourceId) ? [key] : [],
        );
        let unit: string | null = null;
        for (const key of keys) if (isCoreKey(key) && !showCoreRef.current(blockIdOfKey(key))) unit = blockIdOfKey(key);
        if (unit) {
          rows ??= unitRows(pane, unit, richTextRef.current !== null);
          found = (rows ?? []).flatMap((row) => wordsOf(pane, row) ?? []);
        } else if (!wordsHidden(pane, keys.filter((key) => !isCoreKey(key)), readWholeRef.current)) {
          const el = markOfSource(pane, sourceId);
          if (el) found = [el];
        }
      }
      if (found.length > 0) {
        found[0].scrollIntoView({ behavior: "smooth", block: "center" });
        for (const el of found) flashElement(el);
      } else if (attempts++ < PAGE_WAIT_MS / 200) {
        setTimeout(tryScroll, 200);
      }
    };
    tryScroll();
  }, []);

  // Scroll to a block's words and flash them: a search result, a ¶ chip, an
  // extraction's quote, a match. Words in a collapsed unit are read whole
  // first; the look retries every 200 ms, `tries` times, until they are
  // drawn, and waits for the cores the article opens with.
  const jumpToWords = useCallback((blockId: string, tries: number) => {
    const look = (left: number) => {
      const pane = containerRef.current;
      const ready = pane && !coresComingRef.current() && !wordsHidden(pane, [blockId], readWholeRef.current);
      const el = ready ? wordsOf(pane, blockId) : null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        flashElement(el);
      } else if (left > 0) {
        setTimeout(() => look(left - 1), 200);
      }
    };
    look(tries);
  }, []);

  // Source chip navigation: ?src=<sourceId> scrolls to the anchor and flashes it.
  // With ?annotation= too (an annotation reference in a note,
  // lib/annotation-reference.ts), the annotation opens once its mark is
  // painted: the bubble, the on-mark card, or the card in the Annotations tab.
  const src = searchParams.get("src");
  const annotationParam = searchParams.get(ANNOTATION_PARAM);
  // A jump in this pane flashes its mark at once (dissect:flash-source) and
  // puts ?src= in the address too: when the address lands, the pane moves
  // no more (a press made meanwhile would scroll away). A page opened with
  // ?src= flashes it.
  const jumpedRef = useRef(new Set<string>());
  const srcRef = useRef(src);
  srcRef.current = src;
  useEffect(() => {
    if (!src || jumpedRef.current.delete(src)) return;
    flashSource(src);
    if (!annotationParam) return;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tryOpen = () => {
      const el = containerRef.current ? markOfSource(containerRef.current, src) : null;
      // Drawn: a mark in a collapsed unit waits for the unit read whole.
      if (el && el.getClientRects().length > 0) {
        window.dispatchEvent(new CustomEvent("dissect:open-annotation", { detail: { sourceId: src } }));
      } else if (attempts++ < PAGE_WAIT_MS / 200) {
        timer = setTimeout(tryOpen, 200);
      }
    };
    tryOpen();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [src, annotationParam, flashSource]);

  // Arriving through a link's other end: ?link=<id> flashes the mark here;
  // a mark in a collapsed unit reads the unit whole first.
  const linkParam = searchParams.get("link");
  const linksRef = useRef(linksByBlock);
  linksRef.current = linksByBlock;
  useEffect(() => {
    if (!linkParam) return;
    const container = containerRef.current;
    if (!container) return;
    let attempts = 0;
    const tryScroll = () => {
      const blocks = Object.entries(linksRef.current).flatMap(([blockId, list]) =>
        list.some((l) => l.linkId === linkParam) ? [blockId] : [],
      );
      const hidden = coresComingRef.current() || wordsHidden(container, blocks, readWholeRef.current);
      const el = hidden ? null : container.querySelector<HTMLElement>(`[data-link-id="${linkParam}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        flashElement(el);
      } else if (attempts++ < PAGE_WAIT_MS / 200) {
        setTimeout(tryScroll, 200);
      }
    };
    tryScroll();
  }, [linkParam]);

  // Search result navigation: ?block=<blockId> scrolls to the block and flashes it.
  const blockParam = searchParams.get("block");
  useEffect(() => {
    if (blockParam) jumpToWords(blockParam, PAGE_WAIT_MS / 200);
  }, [blockParam, jumpToWords]);

  // Jump from the Annotations panel: works even when ?src is already this anchor.
  useEffect(() => {
    const onFlash = (e: Event) => {
      const { sourceId } = (e as CustomEvent<{ sourceId: string | null }>).detail;
      if (!sourceId) return;
      if (sourceId !== srcRef.current) jumpedRef.current.add(sourceId);
      flashSource(sourceId);
    };
    window.addEventListener("dissect:flash-source", onFlash);
    return () => window.removeEventListener("dissect:flash-source", onFlash);
  }, [flashSource]);

  // Where a stored mark sits in the pane, for a card that opens beside it.
  const markTop = useCallback((sourceId: string) => {
    const container = containerRef.current;
    if (!container) return 80;
    const markEl = markOfSource(container, sourceId);
    return markEl
      ? markEl.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
      : 80;
  }, []);
  // The plain note a source quotes for, when it is no annotation's: the
  // chooser's Note row (SPEC.md §6).
  const noteOfSource = (sourceId: string): string | null => {
    for (const list of Object.values(anchorHighlights)) {
      const hit = list.find((h) => h.sourceId === sourceId);
      if (hit) return hit.annotation ? null : (hit.noteId ?? null);
    }
    return null;
  };
  const notesById = useMemo(() => {
    const byId = new Map<string, NoteView>();
    const walk = (list: SectionView[]) => {
      for (const section of list) {
        for (const note of section.notes) byId.set(note.id, note);
        walk(section.children);
      }
    };
    walk(sections);
    return byId;
  }, [sections]);
  // The anchor a stored mark paints, rebuilt from its highlight entry.
  const anchorOfSource = useCallback((sourceId: string): Anchor | null => {
    for (const [blockId, list] of Object.entries(anchorHighlightsRef.current)) {
      const hit = list.find((h) => h.sourceId === sourceId);
      if (!hit) continue;
      // A core anchor's words are the core's (SPEC.md §28).
      const text = isCoreKey(blockId)
        ? coresRef.current?.[blockIdOfKey(blockId)]
        : blocksRef.current.find((b) => b.id === blockId)?.text;
      if (text === undefined) return null;
      return {
        blockId,
        startOffset: hit.start,
        endOffset: hit.end,
        quotedText: text.slice(hit.start, hit.end),
        prefix: "",
        suffix: "",
      };
    }
    return null;
  }, []);

  // A hold on a highlight in the text lifts its passage (SPEC.md §6,
  // lib/card-drag.ts): the mouse stays on the mark for WORDS_HOLD_MS, the
  // mark lifts (data-held), and the move that follows carries the quote as
  // a ghost; let go on a note — a note card of the tray, or the floating
  // card — it lands there as a quote, the mark's anchor its source. A press
  // that moves first is a selection, as ever, and a press that ends where
  // it began is the click that opens the annotation, however long. A touch
  // never lifts from the words: its long press selects them. The article
  // stops selecting while the ghost is out: the press already started a
  // selection, and it would otherwise grow under the pointer.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !canEditRef.current || editModeRef.current || richTextRef.current) return;
      const mark = (e.target as Element | null)?.closest<HTMLElement>("mark[data-source-id]");
      if (!mark || !container.contains(mark)) return;
      const sourceId = mark.dataset.sourceId;
      if (!sourceId) return;
      watchHold(
        e,
        (at) => {
          const anchor = anchorOfSource(sourceId);
          if (!anchor) return;
          const docId = documentIdRef.current;
          const segments = segmentsOf(anchor).map((segment) => ({ documentId: docId, ...anchorBody(segment) }));
          const text = passageText(anchor);
          if (!text.trim()) return;
          const quote: QuoteDrag = {
            source: segments[0],
            ...(segments.length > 1 ? { segments } : {}),
            text,
          };
          document.body.style.userSelect = "none";
          startCardDrag(
            { clientX: at.x, clientY: at.y },
            { kind: "quote", ids: [], label: `❝ ${clipWords(text, 60)}`, quote },
            () => {
              document.body.style.userSelect = "";
            },
          );
        },
        { pull: false, words: true, armed: (on) => mark.toggleAttribute("data-held", on) },
      );
    };
    container.addEventListener("pointerdown", onDown);
    return () => container.removeEventListener("pointerdown", onDown);
  }, [anchorOfSource]);

  // The log card (SPEC.md §21): hovering a mark whose annotation holds a
  // conversation — an assistant conversation, or a tool's output continued
  // into one — shows the conversation's log where its card would open, one
  // line per message. It waits out a passing pointer, leaves when the pointer
  // leaves the mark and the card, and gives way to the card on a click.
  const openNoteIdsRef = useRef(new Set<string>());
  openNoteIdsRef.current = new Set(
    [bubble?.noteId, simplifyCard?.noteId, assistantChat?.noteId].filter((id): id is string => Boolean(id)),
  );
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let showTimer: number | null = null;
    let pendingSourceId: string | null = null; // the mark the show timer waits on
    let hideTimer: number | null = null;
    const clearTimers = () => {
      if (showTimer !== null) clearTimeout(showTimer);
      if (hideTimer !== null) clearTimeout(hideTimer);
      showTimer = null;
      pendingSourceId = null;
      hideTimer = null;
    };
    const hide = () => {
      clearTimers();
      if (logCardRef.current) setLogCard(null);
    };
    const show = (sourceId: string) => {
      const stored = annotationBubblesRef.current[sourceId];
      if (!stored || stored.kind === "comment" || stored.conversation.length === 0) return;
      if (openNoteIdsRef.current.has(stored.noteId)) return; // the card itself is open
      const slot = claimSideSlot("log", markTop(sourceId), anchorOfSource(sourceId));
      const key = `${stored.noteId}:${stored.conversation.length}`;
      const cached = logCache.get(key)?.log ?? null;
      setLogCard({
        sourceId,
        noteId: stored.noteId,
        tool: stored.kind,
        anchor: anchorOfSource(sourceId),
        ...slot,
        log: cached,
        failed: false,
      });
      if (cached) return;
      void fetch(`/api/notes/${stored.noteId}/log`, { method: "POST" })
        .then((res) => (res.ok ? (res.json() as Promise<{ log?: ConversationLog | null }>) : null))
        .then((data) => {
          const log = data?.log ?? null;
          if (log) logCache.set(key, { turns: log.turns, log });
          setLogCard((c) => (c && c.noteId === stored.noteId ? { ...c, log, failed: log === null } : c));
        })
        .catch(() => {
          setLogCard((c) => (c && c.noteId === stored.noteId ? { ...c, failed: true } : c));
        });
    };
    const onOver = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest("[data-log-card]")) {
        // Over the card: it stays.
        if (hideTimer !== null) clearTimeout(hideTimer);
        hideTimer = null;
        return;
      }
      const markEl = target?.closest<HTMLElement>("[data-source-id], [data-hover-source]");
      const sourceId = markEl?.dataset.sourceId ?? markEl?.dataset.hoverSource ?? null;
      const current = logCardRef.current;
      if (sourceId && current?.sourceId === sourceId) {
        if (hideTimer !== null) clearTimeout(hideTimer);
        hideTimer = null;
        return;
      }
      // Still on the mark the timer waits on (its text, then its chip): wait on.
      if (sourceId && showTimer !== null && pendingSourceId === sourceId) return;
      clearTimers();
      if (sourceId) {
        pendingSourceId = sourceId;
        showTimer = window.setTimeout(() => {
          showTimer = null;
          pendingSourceId = null;
          show(sourceId);
        }, HOVER_LOG_DELAY);
      }
      if (current) hideTimer = window.setTimeout(hide, HOVER_LOG_LINGER);
    };
    const onLeave = () => {
      clearTimers();
      if (logCardRef.current) hideTimer = window.setTimeout(hide, HOVER_LOG_LINGER);
    };
    container.addEventListener("mouseover", onOver);
    container.addEventListener("mouseleave", onLeave);
    container.addEventListener("scroll", hide, true);
    window.addEventListener("mousedown", hide);
    return () => {
      clearTimers();
      container.removeEventListener("mouseover", onOver);
      container.removeEventListener("mouseleave", onLeave);
      container.removeEventListener("scroll", hide, true);
      window.removeEventListener("mousedown", hide);
    };
  }, [anchorOfSource, markTop]);

  // Clicking an annotation mark: EXPLAIN and SIMPLIFY reopen their bubble with
  // the stored content, beside the mark; everything else focuses its card in
  // the Annotations tab.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const { sourceId, sources, x, y } = (
        e as CustomEvent<{ sourceId: string; sources?: string[]; x?: number; y?: number }>
      ).detail;
      const container = containerRef.current;
      // Another pane owns marks this pane does not paint.
      if (!container || !markOfSource(container, sourceId)) return;
      // Words under more than one note or annotation: a small chooser at the
      // click lists every one, and the one picked opens (SPEC.md §6).
      if (sources && sources.length > 1 && x !== undefined && y !== undefined) {
        const crect = container.getBoundingClientRect();
        setStackChooser({
          sources,
          left: Math.max(8, Math.min(x - crect.left, container.clientWidth - 248)),
          top: y - crect.top + container.scrollTop + 12,
        });
        return;
      }
      setStackChooser(null);
      const stored = annotationBubblesRef.current[sourceId];
      if (!stored) {
        // Highlight or comment: the on-mark card, right below the mark.
        const summary = annotationsBySourceRef.current[sourceId];
        const markEl = markOfSource(container, sourceId);
        if (!summary || !markEl) {
          window.dispatchEvent(
            new CustomEvent("dissect:focus-annotation", { detail: { sourceId } }),
          );
          return;
        }
        const containerRect = container.getBoundingClientRect();
        const markRect = markEl.getBoundingClientRect();
        const width = 300;
        // A pure highlight stores its quote as content; its comment starts empty.
        const comment = summary.content === (summary.quotedText ?? "") ? "" : summary.content;
        // Words typed in the card before it closed come back (SPEC.md §6).
        const draft = reopenedDraftRef.current(summary.noteId, comment);
        // The block reader: the card docks beside the words like a tool card,
        // or under the paragraph in a narrow reader — never on the words
        // (SPEC.md §6).
        if (!richTextRef.current) {
          const anchor = anchorOfSource(sourceId);
          const slot = claimSideSlot("annotation", markTop(sourceId), anchor);
          setAnnotationCard({
            sourceId,
            noteId: summary.noteId,
            kind: summary.kind,
            color: summary.color,
            quotedText: summary.quotedText,
            draft,
            saved: comment,
            ...slot,
            anchor,
            busy: false,
          });
          return;
        }
        // The page editor: the card docks in the margin, level with its words.
        const page =
          richTextRef.current && !splitRef.current ? pageGeometry(container, docsShiftRef.current) : null;
        const place = page ? marginPlace(page) : null;
        if (place && place.shift !== docsShiftRef.current) setDocsShift(place.shift);
        setAnnotationCard({
          sourceId,
          noteId: summary.noteId,
          kind: summary.kind,
          color: summary.color,
          quotedText: summary.quotedText,
          draft,
          saved: comment,
          // Clamped so the action row never lands under the mobile bottom bar.
          top: Math.min(
            place
              ? markRect.top - containerRect.top + container.scrollTop
              : markRect.bottom - containerRect.top + container.scrollTop + 8,
            container.scrollTop + container.clientHeight - 240,
          ),
          left: place
            ? place.left
            : Math.max(
                12,
                Math.min(
                  markRect.left - containerRect.left + container.scrollLeft,
                  container.clientWidth - width - 12,
                ),
              ),
          ...(place ? { width: place.width } : {}),
          busy: false,
        });
        return;
      }
      // The card takes the log card's place (SPEC.md §21).
      setLogCard(null);
      const top = markTop(sourceId);
      // Rebuild the anchor from the mark's highlight entry: the connector line
      // needs it, and SIMPLIFY's sentence mirroring maps against it.
      const anchor = anchorOfSource(sourceId);
      if (stored.kind === "assistant") {
        const slot = claimSideSlot("assistant", top, anchor);
        setAssistantChat({
          anchor,
          noteId: stored.noteId,
          ...slot,
          messages: parseTranscript(stored.content),
          input: cardDraftsRef.current?.[stored.noteId] ?? "",
          busy: false,
        });
        return;
      }
      if (stored.kind === "comment") {
        const slot = claimSideSlot("comment", top, anchor);
        const summary = annotationsBySourceRef.current[sourceId];
        setCommentCard({
          ...slot,
          noteId: summary?.noteId ?? null,
          draft: summary?.noteId ? reopenedDraftRef.current(summary.noteId, stored.content) : stored.content,
          saved: stored.content,
          busy: false,
          anchor,
        });
        return;
      }
      // A conversation continued from the output reopens with it, its box
      // open (SPEC.md §21). The turns this session sent are kept by note id:
      // the page's copy arrives with the refresh, which can take seconds on a
      // large document, and a card closed and reopened before then must not
      // lose them. Whichever copy is longer is the newer one.
      const local = toolConversationsRef.current[stored.noteId] ?? [];
      const conversation = local.length > stored.conversation.length ? local : stored.conversation;
      const typed = cardDraftsRef.current?.[stored.noteId] ?? "";
      const chat: ToolChat = {
        ...NO_CHAT,
        conversation,
        input: typed,
        chatOpen: conversation.length > 0 || typed !== "",
      };
      if (stored.kind === "explain" || stored.kind === "analyze" || stored.kind === "visualize") {
        const slot = claimSideSlot("explain", top, anchor);
        setBubble({
          ...slot,
          ...chat,
          kind: stored.kind,
          text: stored.content,
          streaming: false,
          error: null,
          declined: null,
          anchor,
          noteId: stored.noteId,
        });
        return;
      }
      if (!anchor) {
        window.dispatchEvent(
          new CustomEvent("dissect:focus-annotation", { detail: { sourceId } }),
        );
        return;
      }
      const slot = claimSideSlot("simplify", top, anchor);
      setSimplifyCard({
        anchor,
        ...slot,
        ...chat,
        text: stored.content,
        streaming: false,
        error: null,
        noteId: stored.noteId,
        sentences: parseSimplified(stored.content),
        active: null,
      });
    };
    window.addEventListener("dissect:open-annotation", onOpen);
    return () => window.removeEventListener("dissect:open-annotation", onOpen);
  }, [anchorOfSource, markTop]);

  // Side cards dock to the article's edge; the notes tray resizing or
  // collapsing, or the window resizing, moves that edge. Re-dock every open
  // card so they stay right next to the content body, and track whether the
  // reader is now too narrow for side cards at all. On turning narrow, cards
  // with a stored annotation collapse to their tool symbols at the end of the
  // text; a streaming or unsaved card stays open, re-docked below the
  // highlight. Position popovers close instead — their coordinates are stale
  // the moment the layout shifts. A split pane counts as narrow whatever its
  // width: in a split view a tool card opens only when the reader clicks its
  // highlight or symbol (SPEC.md §6).
  // The toolbar follows its words to their new place (SPEC.md §6): they are
  // measured again, from the browser's selection, or from the tint when the
  // focus is in a toolbar field (Comment, Add to notes, the assistant's box)
  // and the selection lives there. False when the words are not found: a
  // toolbar with no words under it (a figure, a key term) cannot follow.
  const placeToolboxAgain = (): boolean => {
    const open = popoverRef.current;
    const container = containerRef.current;
    if (!open || open.figure || open.term || !container) return false;
    const same = (p: Popover | null): p is Popover =>
      p !== null &&
      p.anchor.blockId === open.anchor.blockId &&
      p.anchor.startOffset === open.anchor.startOffset &&
      p.anchor.endOffset === open.anchor.endOffset;
    let again = captureSelectionRef.current();
    if (!same(again)) again = captureSelectionRef.current(tintRange(container));
    if (!same(again)) return false;
    // The same words: the anchor object stays, so a run sent from this
    // toolbar still knows it.
    setPopover({ ...again, anchor: open.anchor });
    // Placed again, it is fitted into the pane again.
    requestAnimationFrame(() => requestAnimationFrame(() => fitToolboxRef.current()));
    return true;
  };
  const placeToolboxAgainRef = useRef(placeToolboxAgain);
  placeToolboxAgainRef.current = placeToolboxAgain;
  // The column slides when a card opens or closes beside it (--cards-room,
  // 0.35 s): once it is still, an open toolbar stands beside its words again.
  useEffect(() => {
    if (!popoverRef.current) return;
    const timer = window.setTimeout(() => placeToolboxAgainRef.current(), 400);
    return () => window.clearTimeout(timer);
  }, [cardsRoom]);
  const applyNarrow = useCallback(() => {
    const container = containerRef.current;
    if (!container) return null;
    const measured = measureSideCards(container);
    // The page editor is narrow when its margin has no room for a card.
    const page = richTextRef.current ? pageGeometry(container, docsShiftRef.current) : null;
    const isNarrow =
      splitRef.current ||
      (page ? marginPlace(page) === null : cardRoom(columnAtRest(measured, cardsRoomRef.current)) === null);
    if (isNarrow !== narrowRef.current) {
      narrowRef.current = isNarrow;
      if (isNarrow) {
        // A card with words typed in its box, or messages waiting, stays: the
        // reader is writing in it.
        const typed = (c: { input: string; queue?: readonly unknown[] }) =>
          c.input.trim() !== "" || (c.queue ?? []).length > 0;
        setBubble((b) => (b && !b.streaming && !b.busy && b.noteId && !typed(b) ? null : b));
        setSimplifyCard((c) => (c && !c.streaming && !c.busy && c.noteId && !typed(c) ? null : c));
        setAssistantChat((c) =>
          c && !c.busy && c.noteId && !typed(c) && !Object.values(c.inputs ?? {}).some((v) => v.trim()) ? null : c,
        );
        setCommentCard((c) => (c && !c.busy && c.noteId && c.draft === c.saved ? null : c));
        setAnnotationCard((c) => (c && !c.busy && c.draft === c.saved ? null : c));
        // No room to make beside the words: the column goes back.
        cardsRoomRef.current = 0;
        setCardsRoom(0);
      }
    }
    return measured;
  }, []);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    applyNarrow();
    let lastWidth = container.clientWidth;
    let lastHeight = 0;
    const observer = new ResizeObserver(() => {
      // The pane's height caps every tool card (SPEC.md §6).
      const height = container.clientHeight;
      if (height !== lastHeight) {
        lastHeight = height;
        setPaneHeight(height);
      }
      const width = container.clientWidth;
      setPaneWidth(width);
      if (width === lastWidth) return;
      lastWidth = width;
      const measured = applyNarrow();
      if (!measured) return;
      // The column at rest at the new width, and the room it makes now.
      const col = columnAtRest(measured, cardsRoomRef.current);
      const room = richTextRef.current || narrowRef.current ? null : cardRoom(col);
      const shift = room && anyCardOpenRef.current ? room.shift : 0;
      if (!richTextRef.current && shift !== cardsRoomRef.current) {
        cardsRoomRef.current = shift;
        setCardsRoom(shift);
      }
      // The page editor: the margin at the new width, else under the words.
      const page = richTextRef.current ? pageGeometry(container, docsShiftRef.current) : null;
      const place = page && !narrowRef.current ? marginPlace(page) : null;
      if (page) setDocsShift(place && marginCardOpenRef.current ? place.shift : 0);
      const redock = (side: "right" | "left") =>
        page
          ? place
            ? { left: place.left, width: place.width }
            : belowSlot(page, 0)
          : !room
            ? dockBelowCard(col.articleLeft, col.articleRight, col.cw)
            : dockSideCard(room[side] ? side : "right", col, shift);
      const sideOf = (side: "right" | "left") => (room && !room[side] ? "right" : side);
      setBubble((b) => (b ? { ...b, ...redock(b.side), side: sideOf(b.side) } : b));
      setSimplifyCard((c) => (c ? { ...c, ...redock(c.side), side: sideOf(c.side) } : c));
      setAssistantChat((c) => (c ? { ...c, ...redock(c.side), side: sideOf(c.side) } : c));
      setCommentCard((c) => (c ? { ...c, ...redock(c.side), side: sideOf(c.side) } : c));
      setLinkCard((c) => (c ? { ...c, ...redock(c.side), side: sideOf(c.side) } : c));
      // The on-mark card docks like a side card in the block reader; the
      // page editor's margin moves it on its own (below).
      if (page) setAnnotationCard(null);
      else setAnnotationCard((c) => (c ? { ...c, ...redock(c.side ?? "right"), side: sideOf(c.side ?? "right") } : c));
      // The toolbar follows its words to their new place (SPEC.md §6): the
      // selection is still there, so it is measured again. A toolbar with no
      // live selection under it (a figure, a key term) closes.
      if (!placeToolboxAgainRef.current()) {
        setPopover(null);
        setSubmenu(null);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [applyNarrow]);
  // The view switches without remounting the pane: a pane that becomes a
  // split pane collapses its stored cards at once, and one that leaves a
  // split view measures its width again.
  useEffect(() => {
    applyNarrow();
  }, [split, applyNarrow]);
  // Once the page editor's page has moved (0.2 s), the margin's cards dock
  // against where it is.
  const blankDocument = Boolean(richText);
  useEffect(() => {
    const container = containerRef.current;
    if (!blankDocument || !container) return;
    const redock = () => {
      if (narrowRef.current || splitRef.current) return;
      // A resize measures the page mid-move: at rest, the margin the cards
      // hold is measured again.
      const rest = marginCardOpenRef.current ? pageGeometry(container, docsShiftRef.current) : null;
      const held = rest && marginPlace(rest);
      if (held && held.shift !== docsShiftRef.current) setDocsShift(held.shift);
      const page = pageGeometry(container, 0);
      const slot = page ? slotAt(page, 0) : null;
      if (!slot) return;
      // An on-mark card without a width sits under its words and stays.
      const move = <T extends { left: number; width?: number }>(c: T | null): T | null =>
        c && c.width !== undefined && (c.left !== slot.left || c.width !== slot.width) ? { ...c, ...slot } : c;
      setBubble(move);
      setSimplifyCard(move);
      setAssistantChat(move);
      setCommentCard(move);
      setLinkCard(move);
      setAnnotationCard(move);
    };
    const onMoved = (e: TransitionEvent) => {
      if (e.target instanceof Element && e.target.matches("[data-docs-page], .docs-canvas")) redock();
    };
    const settled = window.setTimeout(redock, 260);
    container.addEventListener("transitionend", onMoved);
    return () => {
      window.clearTimeout(settled);
      container.removeEventListener("transitionend", onMoved);
    };
  }, [docsShift, blankDocument]);
  // The card column's comment and suggestion cards keep the margin too: the
  // layer that places them (docs/suggest) says on the pane when it wants it.
  const [pageMargin, setPageMargin] = useState(false);
  useEffect(() => {
    const container = containerRef.current;
    if (!blankDocument || !container) return;
    const onMargin = (e: Event) => setPageMargin((e as CustomEvent<boolean>).detail);
    container.addEventListener("docs:margin", onMargin);
    return () => container.removeEventListener("docs:margin", onMargin);
  }, [blankDocument]);
  // A comment the reader just made, where the margin has no room for the
  // cards at rest (a split pane, or no room beside the page even with the
  // page at the canvas's left edge): only the open card shows there, so the
  // new comment's card opens, under its words, once the stored comment is
  // in. Not when the reader has moved on to a toolbar or another card.
  const madeCommentRef = useRef<string[]>([]);
  useEffect(() => {
    const sourceId = madeCommentRef.current.find((id) => annotationBubbles[id]);
    if (!sourceId) return;
    madeCommentRef.current = [];
    const container = containerRef.current;
    if (!richTextRef.current || !container || popoverRef.current || marginCardOpenRef.current) return;
    const page = splitRef.current ? null : pageGeometry(container, docsShiftRef.current);
    if (page && marginPlace(page)) return;
    window.dispatchEvent(new CustomEvent("dissect:open-annotation", { detail: { sourceId } }));
  }, [annotationBubbles]);
  // Every painted comment has its card in the column, one line each; the
  // open one is its CommentCard. None minimized, hidden, or in a split pane.
  const columnComments =
    blankDocument && !split && commentsView === "all"
      ? [
          ...new Set(
            Object.values(anchorHighlights)
              .flat()
              .filter((h) => h.comment && h.noteId !== commentCard?.noteId && !removedNotes[h.noteId])
              .map((h) => h.sourceId),
          ),
        ].flatMap((sourceId) => {
          const a = annotationsBySource[sourceId];
          return a ? [{ sourceId, content: a.content, authorId: a.createdById ?? null }] : [];
        })
      : [];
  useEffect(() => {
    const container = containerRef.current;
    const page = pageMargin && container && !splitRef.current ? pageGeometry(container, docsShiftRef.current) : null;
    const place = page && marginPlace(page);
    if (place && place.shift > docsShiftRef.current) setDocsShift(place.shift);
  }, [pageMargin]);
  // The toolbox's width: a submenu with a field (the comment, the assistant)
  // or the definition under the Define row widens it, as far as the room
  // beside the words goes (popoverBox); coarse pointers get wider boxes to
  // fit the tap-sized rows.
  const restWidth = coarse ? 220 : 176;
  const toolboxWidth =
    submenu === "ai" || submenu === "comment" || submenu === "define" ? (coarse ? 300 : 248) : restWidth;
  // A toolbar beside the page that has grown past its room moves the page
  // left, as a card does.
  const toolbarPage = popover?.side === "right" ? popover.page : undefined;
  useEffect(() => {
    const need = toolbarPage ? toolbarShift(toolbarPage.geo, docsShiftRef.current, toolboxWidth) : null;
    if (need !== null && need > docsShiftRef.current) setDocsShift(need);
  }, [toolbarPage, toolboxWidth]);
  // The page moves back once no card and no toolbar is open, and not under a
  // held press: the words would slide under the drag it starts.
  const marginCardOpen =
    pageMargin ||
    bubble !== null ||
    simplifyCard !== null ||
    assistantChat !== null ||
    commentCard !== null ||
    linkCard !== null ||
    annotationCard !== null;
  marginCardOpenRef.current = marginCardOpen;
  const pageHeld = marginCardOpen || popover !== null;
  const pressedRef = useRef(false);
  useEffect(() => {
    if (!blankDocument) return;
    const down = (e: PointerEvent) => {
      if (e.button === 0) pressedRef.current = true;
    };
    const up = () => {
      pressedRef.current = false;
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
  }, [blankDocument]);
  useEffect(() => {
    if (pageHeld || docsShift === 0) return;
    let timer = 0;
    const back = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setDocsShift(0), 120);
    };
    if (!pressedRef.current) back();
    else {
      window.addEventListener("pointerup", back, { once: true });
      window.addEventListener("pointercancel", back, { once: true });
    }
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerup", back);
      window.removeEventListener("pointercancel", back);
    };
  }, [pageHeld, docsShift]);
  // The page editor's words changed: the toolbar closes.
  useEffect(() => {
    if (!blankDocument) return;
    const onEdited = (e: Event) => {
      if ((e as CustomEvent<{ documentId: string }>).detail?.documentId !== documentId) return;
      if (!popoverRef.current) return;
      setPopover(null);
      setSubmenu(null);
    };
    window.addEventListener(PAGE_EDITED_EVENT, onEdited);
    return () => window.removeEventListener(PAGE_EDITED_EVENT, onEdited);
  }, [blankDocument, documentId]);
  // View > Comments (SPEC.md §29): Hide comments unpaints the comments and
  // closes their card; Minimize comments shows them as their icons and closes
  // the card; Show all comments shows them.
  useEffect(() => {
    const container = containerRef.current;
    if (!blankDocument || !container) return;
    const onView = (e: Event) => {
      const view = (e as CustomEvent<CommentsView>).detail;
      setCommentsView(view);
      if (view !== "all") setCommentCard(null);
    };
    container.addEventListener(COMMENTS_EVENT, onView);
    return () => container.removeEventListener(COMMENTS_EVENT, onView);
  }, [blankDocument]);

  // The on-mark card closes on a click anywhere else. A click on another mark
  // stays: the open handler replaces the card. A press that drags is a
  // selection, not a click: closing the card inside it would re-render the
  // column and drop the new selection, so the card waits, and the selection
  // toolbar closes it when it opens (yieldToSelection).
  const annotationCardOpen = annotationCard !== null;
  useEffect(() => {
    if (!annotationCardOpen) return;
    let press: { x: number; y: number; target: Element | null } | null = null;
    const onMouseDown = (e: MouseEvent) => {
      press = { x: e.clientX, y: e.clientY, target: e.target as Element | null };
    };
    const onMouseUp = (e: MouseEvent) => {
      const down = press;
      press = null;
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      if (down.target?.closest?.("[data-selection-popover], [data-source-id]")) return;
      setAnnotationCard(null);
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [annotationCardOpen]);

  // The contents list (SPEC.md §26), opened from the Contents button at the
  // top left of the article.
  const [contentsOpen, setContentsOpen] = useState(false);
  // Collapse (SPEC.md §28): the article's blocks shown as their cores. The
  // choice is remembered per document in this browser; the cores come from
  // the document on open (GET), or are written on the press (POST). Each
  // block also has its own button beside it: `flippedBlocks` holds the blocks
  // shown the other way from the article (whole in a collapsed article, as
  // their core in a whole one); it is cleared when Collapse is pressed.
  // A remembered Collapse comes with the page (collapsedCores): the first
  // render is already collapsed.
  const sentCores = collapsedCores && Object.keys(collapsedCores).length > 0 ? collapsedCores : null;
  const [collapseOn, setCollapseOn] = useState(sentCores !== null);
  const [cores, setCores] = useState<Record<string, string> | null>(sentCores);
  // Another document opened in this pane, sent with its cores: it opens
  // collapsed too (adjust-during-render).
  const [coresSentFor, setCoresSentFor] = useState(documentId);
  if (coresSentFor !== documentId) {
    setCoresSentFor(documentId);
    if (sentCores) {
      setCores(sentCores);
      setCollapseOn(true);
    }
  }
  coresRef.current = cores;
  const [collapseBusy, setCollapseBusy] = useState(false);
  // The Collapse run on its way: the button's Stop ends it, and so does
  // leaving the document. The route passes the abort to the model calls.
  const collapseAbortRef = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      collapseAbortRef.current?.abort();
      collapseAbortRef.current = null;
    },
    [documentId],
  );
  // The New glow (SPEC.md §18) on the Collapse button until it is pressed.
  const collapseNew = useNewFeature("collapse");
  const [flippedBlocks, setFlippedBlocks] = useState<ReadonlySet<string>>(() => new Set());
  // Collapse on or off, or one block read whole or folded, draws other
  // words: a card about words no longer drawn closes, and its mark reopens
  // it on the layer it was made on (SPEC.md §28). A card with a run in
  // flight or typed words stays.
  const collapseView = `${collapseOn}:${[...flippedBlocks].join(",")}:${cores !== null}`;
  const collapseViewRef = useRef(collapseView);
  useEffect(() => {
    if (collapseViewRef.current === collapseView) return;
    collapseViewRef.current = collapseView;
    const container = containerRef.current;
    if (!container) return;
    const drawn = (anchor: Anchor | null | undefined) =>
      !anchor || segmentsOf(anchor).some((segment) => drawnBlock(container, segment.blockId) !== null);
    const idle = (c: { streaming?: boolean; busy: boolean; input?: string }) =>
      !c.streaming && !c.busy && !(c.input ?? "").trim();
    setBubble((b) => (b && !drawn(b.anchor) && idle(b) ? null : b));
    setSimplifyCard((c) => (c && !drawn(c.anchor) && idle(c) ? null : c));
    setAssistantChat((c) => (c && !drawn(c.anchor) && idle(c) ? null : c));
    setCommentCard((c) => (c && !drawn(c.anchor) && !c.busy && c.draft === c.saved ? null : c));
    setLinkCard((c) => (c && !drawn(c.anchor) && !c.busy && !c.draft.trim() ? null : c));
    setAnnotationCard((c) => (c && !drawn(c.anchor) && !c.busy && c.draft === c.saved ? null : c));
    setLogCard(null);
  }, [collapseView]);
  const collapseStoreKey = `unitos-collapse-${documentId}`;
  // Whether the cores the article opens with have been read (a jump waits
  // for them: coresComingRef).
  const coresReadRef = useRef(false);
  useEffect(() => {
    coresReadRef.current = false;
    if (embedded || transcript) return;
    if (sentCores) {
      coresReadRef.current = true;
      return;
    }
    if (!collapseRemembered(collapseStoreKey)) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/documents/${documentId}/collapse`);
        const body = (await res.json().catch(() => null)) as { cores?: Record<string, string> } | null;
        if (cancelled || !res.ok || !body?.cores || Object.keys(body.cores).length === 0) return;
        setCores(body.cores);
        setCollapseOn(true);
        // Remembered before the page could send the cores: from the next
        // open on, it does.
        rememberCollapsedDocument(documentId, true);
      } catch {
        // The article shows whole; the button collapses it again.
      } finally {
        if (!cancelled) coresReadRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
    // Once per document: the memory is read on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);
  function rememberCollapse(on: boolean) {
    rememberCollapsedDocument(documentId, on);
    try {
      if (on) localStorage.setItem(collapseStoreKey, "on");
      else localStorage.removeItem(collapseStoreKey);
    } catch {
      // A blocked store only loses the memory of the choice.
    }
  }
  async function toggleCollapse() {
    // While the cores are being written, the press is Stop: the run ends,
    // nothing is saved, and the article stays as it was (SPEC.md §28).
    if (collapseBusy) {
      collapseAbortRef.current?.abort();
      return;
    }
    setFlippedBlocks(new Set());
    // The toolbar's words go as the article changes view: the toolbar
    // closes with them, and so does the browser's selection under the tint.
    setPopover(null);
    setSubmenu(null);
    if (!richTextRef.current) window.getSelection()?.removeAllRanges();
    if (collapseOn) {
      setCollapseOn(false);
      rememberCollapse(false);
      return;
    }
    if (cores) {
      setCollapseOn(true);
      rememberCollapse(true);
      return;
    }
    setCollapseBusy(true);
    const controller = new AbortController();
    collapseAbortRef.current = controller;
    try {
      // An editor writes the cores the document lacks; a viewer reads what is stored.
      const res = await fetch(`/api/documents/${documentId}/collapse`, {
        method: canEdit ? "POST" : "GET",
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => null)) as
        | { cores?: Record<string, string>; complete?: boolean; error?: string }
        | null;
      if (!res.ok || !body?.cores) {
        throw new Error(body?.error ?? t("common.requestFailedStatus", { status: res.status }));
      }
      if (Object.keys(body.cores).length === 0) {
        showToast(t("reader.collapseViewer"));
        return;
      }
      setCores(body.cores);
      setCollapseOn(true);
      rememberCollapse(true);
      // Some blocks got no core — no model, or a failed call: they read
      // whole, and the toast says why.
      if (body.error) showToast(t("reader.collapseFailed", { reason: body.error }));
    } catch (err) {
      // Stopped, not failed: no toast.
      if (controller.signal.aborted) return;
      showToast(t("reader.collapseFailed", { reason: err instanceof Error ? err.message : t("common.requestFailed") }));
    } finally {
      if (collapseAbortRef.current === controller) collapseAbortRef.current = null;
      setCollapseBusy(false);
    }
  }
  // The Annotations tab lists the view the article shows (SPEC.md §28).
  useEffect(() => {
    if (embedded || transcript) return;
    announceCollapseView(documentId, collapseOn);
  }, [documentId, collapseOn, embedded, transcript]);
  // A jump shows the unit it lands in the way it needs, and no other unit
  // changes: a jump to a core annotation shows the unit's core — false when
  // no core can be drawn, in Editing, in edit mode, or with no cores in
  // hand — and a jump to words reads the unit whole (wordsHidden). A jump
  // waits while the cores the article opens with are on their way, and
  // until the first render's effects have set these.
  const coresComingRef = useRef<() => boolean>(() => true);
  const showCoreRef = useRef<(unitId: string) => boolean>(() => false);
  const readWholeRef = useRef<(unitId: string) => void>(() => {});
  useEffect(() => {
    coresComingRef.current = () =>
      !cores && !embedded && !transcript && !coresReadRef.current && collapseRemembered(collapseStoreKey);
    showCoreRef.current = (unitId: string) => {
      if (editMode || pageEditorIn(containerRef.current)?.isEditable || !cores?.[unitId]) return false;
      showUnit(unitId, true);
      return true;
    };
    readWholeRef.current = (unitId: string) => showUnit(unitId, false);
  });
  // Flipped: shown the other way from the article.
  function showUnit(unitId: string, core: boolean) {
    setFlippedBlocks((prev) => {
      const flipped = core !== collapseOn;
      if (prev.has(unitId) === flipped) return prev;
      const next = new Set(prev);
      if (flipped) next.add(unitId);
      else next.delete(unitId);
      return next;
    });
  }
  function flipBlock(blockId: string) {
    setFlippedBlocks((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  }
  // The page editor's Editing and Suggesting need the words: they turn
  // Collapse off (components/docs/layer/collapse.tsx).
  function collapseOff() {
    if (collapseOn) void toggleCollapse();
  }

  // The lead tool (SPEC.md §6): when the popover opens on a selection, Jev
  // predicts which tool the reader reaches for, from the selection and the
  // reader's own toolbar history (/api/jev/lead-tool), and that tool reads
  // as recommended. The rows never move: an answer that lands late would
  // move a button under the pointer. A key term's toolbar and a figure's
  // keep their fixed lead. A plain fetch, not `api`: a prediction is not a
  // save, so the save indicator stays quiet.
  const popoverAnchorKey = popover
    ? `${popover.anchor.blockId}:${popover.anchor.startOffset}:${popover.anchor.endOffset}:${popover.term ? "t" : ""}${popover.figure ? "f" : ""}`
    : null;
  // With no prediction, the kind's first tool after the assistant leads
  // (SPEC.md §6): Explain on text and equations, Analyze on a figure.
  const kindLead = (): Tool | null => {
    if (!popover || popover.term) return null;
    const tools = TOOLBARS[contentKindOf(blocks.find((b) => b.id === popover.anchor.blockId)?.type)];
    return tools[tools.indexOf("assistant") + 1] ?? null;
  };
  const leadTool: Tool | null =
    leadAnswer && leadAnswer.key === popoverAnchorKey ? leadAnswer.tool : kindLead();
  // The comment is kept per selection as a toolbar draft (lib/toolbar-drafts.ts) until the save lands.
  const [addComment, keepAddComment] = useToolbarDraft("add", documentId, popover?.anchor ?? null);
  const addMode = addDraft.key === popoverAnchorKey ? addDraft.mode : "sections";
  const setAddComment = (comment: string) => {
    keepAddComment(comment);
    setAddDraft((d) => ({ key: popoverAnchorKey, comment, mode: d.key === popoverAnchorKey ? d.mode : "sections" }));
  };
  const setAddMode = (mode: "sections" | "notes") =>
    setAddDraft((d) => ({ key: popoverAnchorKey, mode, comment: d.key === popoverAnchorKey ? d.comment : "" }));
  useEffect(() => {
    if (!popover || !popoverAnchorKey || popover.term || popover.figure) return;
    const text = popover.anchor.quotedText.trim();
    if (!text) return;
    const blockType = blocksRef.current.find((b) => b.id === popover.anchor.blockId)?.type;
    const kind = contentKindOf(blockType);
    if (kind === "figure") return;
    const key = popoverAnchorKey;
    // Only the tools the popover shows: a core selection has no Link (SPEC.md
    // §28), and Define shows on one word alone.
    const core = isCoreKey(popover.anchor.blockId);
    const define = offersDefine(popover);
    const tools = TOOLBARS[kind].filter(
      (tool) => !(core && tool === "link") && (tool !== "define" || define),
    );
    const controller = new AbortController();
    fetch("/api/jev/lead-tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notebookId, kind, blockType, text: text.slice(0, 600), tools }),
      signal: controller.signal,
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ tool: Tool | null }>) : null))
      .then((data) => {
        if (controller.signal.aborted || !data?.tool) return;
        if (tools.includes(data.tool)) setLeadAnswer({ key, tool: data.tool });
      })
      .catch(() => {});
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popoverAnchorKey, notebookId]);

  // The tint repaints the paragraph's words as marks, and the browser's
  // selection, which lived in the text nodes the repaint replaced, collapses
  // with them. A press on the tinted words then starts a new selection in
  // place of the quote drag (dragstart reads the selection), so the drag
  // worked only in a paragraph that already had marks. Once the tint has
  // painted, the selection goes back over the marks: the same words, with
  // the same transparent color. Not in the page editor, which keeps its own
  // selection and takes no tint.
  useLayoutEffect(() => {
    if (!popover || popover.term || popover.figure || richTextRef.current) return;
    const container = containerRef.current;
    const sel = window.getSelection();
    if (!container || !sel) return;
    const marks = container.querySelectorAll(".selection-mark");
    if (marks.length === 0) return;
    const first = marks[0];
    const last = marks[marks.length - 1];
    if (sel.rangeCount > 0 && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      if (first.contains(range.startContainer) && last.contains(range.endContainer)) return;
    }
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(last, last.childNodes.length);
    sel.removeAllRanges();
    sel.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popoverAnchorKey]);

  // A selection low in the pane opens the toolbox past the pane's bottom
  // edge: its last rows and the bubbles under it out of view, so the reader
  // scrolls to reach a tool they just asked for. Once the toolbox is on
  // screen, its stack (the toolbox and the bubbles anchored to it) is
  // measured against the pane's bottom edge. Beside the words the toolbox
  // moves up by the overflow: it stays beside its paragraph and covers no
  // words. Under the words, where moving up would cover the selection, the
  // toolbox goes above the words when the room above holds it, so the words
  // stay where the reader is looking; only with room on neither side does
  // the pane scroll by the overflow, and the selection ride up with it.
  const fitToolbox = () => {
    if (!popover) return;
    const container = containerRef.current;
    const el = container?.querySelector<HTMLElement>("[data-layer-toolbar]");
    if (!container || !el) return;
    let bottom = el.getBoundingClientRect().bottom;
    for (const child of el.children) bottom = Math.max(bottom, child.getBoundingClientRect().bottom);
    // On a phone the bottom bar lies over the pane's foot: the view ends at
    // its top edge.
    const rail = document.querySelector<HTMLElement>('nav[data-nudge="rail"]');
    const railTop = rail && getComputedStyle(rail).position === "fixed" ? rail.getBoundingClientRect().top : Infinity;
    const overflow = Math.ceil(bottom - Math.min(container.getBoundingClientRect().bottom, railTop) + 20);
    // The page editor under the words (SPEC.md §29): the toolbox stands
    // above the words whenever the room above holds it, so it covers lines
    // already read. With room on neither side the pane scrolls by the
    // overflow, as the block reader's does, so every row is in reach.
    if (popover.side === "below" && popover.page) {
      const containerTop = container.getBoundingClientRect().top;
      const ceiling = container.querySelector(".docs-header")?.getBoundingClientRect().bottom ?? containerTop + 48;
      const height = bottom - el.getBoundingClientRect().top;
      const fitsAbove =
        popover.wordsTop !== undefined && popover.wordsTop - container.scrollTop + containerTop - ceiling >= height + 8;
      if (popover.above) {
        // A field opened above the words grows the toolbox past the header:
        // it goes back under the words, and the pane scrolls it into view.
        if (fitsAbove) return;
        setPopover((p) => (p === popover ? { ...p, above: false } : p));
        const floor = Math.min(container.getBoundingClientRect().bottom, railTop);
        const under = popover.y - container.scrollTop + containerTop + height - floor + 20;
        if (under > 0) container.scrollBy({ top: under, behavior: "smooth" });
        return;
      }
      if (fitsAbove) {
        setPopover((p) => (p === popover ? { ...p, above: true } : p));
      } else if (overflow > 0) {
        container.scrollBy({ top: overflow, behavior: "smooth" });
      }
      return;
    }
    if (overflow <= 0) return;
    if (popover.side === "below") {
      // The room above runs from the words' first line up to the page
      // editor's header, or to the chips at the pane's top.
      const containerTop = container.getBoundingClientRect().top;
      const ceiling = container.querySelector(".docs-header")?.getBoundingClientRect().bottom ?? containerTop + 48;
      const height = bottom - el.getBoundingClientRect().top;
      if (
        popover.wordsTop !== undefined &&
        popover.wordsTop - container.scrollTop + containerTop - ceiling >= height + 8
      ) {
        setPopover((p) => (p === popover ? { ...p, above: true } : p));
        return;
      }
      container.scrollBy({ top: overflow, behavior: "smooth" });
      return;
    }
    const floor = container.scrollTop + 8;
    setPopover((p) => (p === popover ? { ...p, yTop: Math.max(floor, p.yTop - overflow) } : p));
  };
  const fitToolboxRef = useRef(fitToolbox);
  fitToolboxRef.current = fitToolbox;
  useLayoutEffect(() => {
    fitToolboxRef.current();
  }, [popoverAnchorKey, submenu, definition?.text]);
  // A field that opens (the assistant's box, Comment, Define) grows the
  // stack as it unfolds, and a line in it (a sent question, an error) grows
  // it again: each growth is measured, so the box stays inside the pane.
  useEffect(() => {
    if (!popoverAnchorKey) return;
    const el = containerRef.current?.querySelector<HTMLElement>("[data-layer-toolbar]");
    if (!el) return;
    const observer = new ResizeObserver(() => fitToolboxRef.current());
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => observer.disconnect();
  }, [popoverAnchorKey]);

  // A definition on its way stops when its popover closes or moves to
  // another selection: nobody is left to read it.
  useEffect(
    () => () => {
      defineAbortRef.current?.abort();
      defineAbortRef.current = null;
    },
    [popoverAnchorKey],
  );

  // Pressing a dotted key term opens the selection toolbar on it, with Extract
  // recommended on top. Fires on mousedown, so the toolbar survives the
  // selection capture on mouseup. Only the pane that owns the term handles it.
  useEffect(() => {
    const onTermTools = (e: Event) => {
      if (!canEditRef.current) return;
      const { start, end, origin } = (
        e as CustomEvent<{ start: number; end: number; origin: Element }>
      ).detail;
      const container = containerRef.current;
      if (!container || !origin || !container.contains(origin)) return;
      // The page editor selected the term's words (layer/reading.ts): the
      // toolbar opens on them as on any selection in the page (SPEC.md §29).
      if (richTextRef.current) {
        const captured = captureSelectionRef.current();
        if (!captured) return;
        suppressNextMouseUp.current = true;
        setSubmenu(null);
        setPopover({ ...captured, term: true });
        return;
      }
      const blockId = origin.closest<HTMLElement>("[data-block-id]")?.dataset.blockId;
      if (!blockId) return;
      const block = blocksRef.current.find((b) => b.id === blockId);
      if (!block) return;
      const quotedText = block.text.slice(start, end);
      if (!quotedText.trim()) return;
      suppressNextMouseUp.current = true;
      window.getSelection()?.removeAllRanges();
      const rect = origin.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const margin = Math.min(240, containerRect.width / 2);
      const articleRect = container.querySelector("article")?.getBoundingClientRect();
      const yTop = Math.max(8, rect.top - containerRect.top + container.scrollTop);
      const { articleRight, cw } = measureSideCards(container);
      const side = window.matchMedia("(pointer: coarse)").matches ? ("below" as const) : toolboxSide(container, yTop);
      const rawX = rect.left + rect.width / 2 - containerRect.left;
      setSubmenu(null);
      setPopover({
        anchor: {
          blockId,
          startOffset: start,
          endOffset: end,
          quotedText,
          prefix: block.text.slice(Math.max(0, start - 32), start),
          suffix: block.text.slice(end, end + 32),
        },
        x: Math.max(margin, Math.min(rawX, containerRect.width - margin)),
        y: rect.bottom - containerRect.top + container.scrollTop + (side === "below" ? 14 : 6),
        yTop,
        wordsTop: yTop,
        textLeft: articleRect ? articleRect.left - containerRect.left + 24 : 24,
        truncated: false,
        term: true,
        side,
        rightBase: articleRight + 10,
        cw,
      });
    };
    window.addEventListener("dissect:term-tools", onTermTools);
    return () => window.removeEventListener("dissect:term-tools", onTermTools);

  }, []);

  // Extract spans and label chips: either one opens the match card, which
  // lists the origin phrase and every passage. Only the owning pane handles it.
  useEffect(() => {
    const onChip = (e: Event) => {
      const { extractId, element } = (
        e as CustomEvent<{ extractId: string; element: Element }>
      ).detail;
      const container = containerRef.current;
      if (!container || !element || !container.contains(element)) return;
      const extraction = allExtractionsRef.current.find((x) => x.id === extractId);
      if (!extraction) return;
      const containerRect = container.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      const width = 300;
      setExtractCard({
        id: extractId,
        top: Math.max(
          container.scrollTop + 12,
          Math.min(
            rect.bottom - containerRect.top + container.scrollTop + 8,
            container.scrollTop + container.clientHeight - 300,
          ),
        ),
        left: Math.max(
          12,
          Math.min(
            rect.left - containerRect.left + container.scrollLeft,
            container.clientWidth - width - 12,
          ),
        ),
      });
    };
    window.addEventListener("dissect:extract-chip", onChip);
    return () => window.removeEventListener("dissect:extract-chip", onChip);
  }, []);

  // The Extract panel in the side tray opens the extract page (a stored
  // distillation by id, or the ask view, id null). Only
  // the pane showing the panel's document handles it.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const { documentId: forDocument, distillationId } = (
        e as CustomEvent<{ documentId: string; distillationId: string | null }>
      ).detail;
      if (forDocument !== documentIdRef.current) return;
      openDistillPage(distillationId);
    };
    window.addEventListener("dissect:open-distillation", onOpen);
    return () => {
      window.removeEventListener("dissect:open-distillation", onOpen);
    };
     
  }, []);

  // The extract card closes on a click anywhere else.
  useEffect(() => {
    if (!extractCard) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest("[data-selection-popover]")) return;
      setExtractCard(null);
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [extractCard]);

  // ¶ chips in AI text (Markdown) jump to the block they cite. A part of the
  // contents lands on the core of a collapsed block (SPEC.md §28); every
  // other jump lands on the block's words.
  useEffect(() => {
    const onFlashBlock = (e: Event) => {
      const { blockId, part } = (e as CustomEvent<{ blockId: string; part?: boolean }>).detail;
      const container = containerRef.current;
      const el = container?.querySelector<HTMLElement>(
        `[data-block-id="${blockId}"], [data-edit-block="${blockId}"]`,
      );
      if (!el) {
        // Another pane may own the block; only toast when no pane does.
        if (
          document.querySelector(`[data-block-id="${blockId}"], [data-edit-block="${blockId}"]`)
        ) {
          return;
        }
        showToast(t("reader.blockNotOpen"));
        return;
      }
      if (!part) {
        jumpToWords(blockId, 10);
        return;
      }
      // A part lands with its heading at the reading line, where a reader
      // starts reading (SPEC.md §6), not mid-pane.
      if (container) {
        const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
        container.scrollTo({ top: Math.max(0, top - READING_LINE_PX), behavior: "smooth" });
      } else el.scrollIntoView({ behavior: "smooth", block: "start" });
      flashElement(el);
    };
    window.addEventListener("dissect:flash-block", onFlashBlock);
    return () => window.removeEventListener("dissect:flash-block", onFlashBlock);
  }, [t, jumpToWords]);

  // Every toast fades after 5 seconds, action or not; the Undo toast after
  // the plan's actions stays UNDO_MS.
  function showToast(
    message: string,
    action: { label: string; run: () => void } | null = null,
    ms = 5000,
  ) {
    setToast(message);
    setToastAction(action);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      setToast(null);
      setToastAction(null);
    }, ms);
  }

  function hideToast() {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
    setToastAction(null);
  }

  // A failure shows as a toast and lands in the error log on this document,
  // so it stays readable under Extract after the toast fades
  // (article-errors.tsx).
  function showError(message: string) {
    showToast(message);
    reportError(message, documentId);
  }

  // A media figure (video/audio/embedded player inside an article) refuses
  // tools; the toast offers to open it as a video document, where the video
  // tools apply. The link goes to the document bar's ingest path — progress
  // card, then the new document opens. YouTube embeds ingest by URL; direct
  // file sources likewise.
  function refuseMediaFigure(block: { html: string | null }) {
    const html = block.html ?? "";
    const src =
      html.match(/<iframe[^>]*\ssrc="([^"]+)"/i)?.[1]?.replace(/&amp;/g, "&") ??
      html.match(/<(?:video|audio)[^>]*\ssrc="([^"]+)"/i)?.[1]?.replace(/&amp;/g, "&") ??
      html.match(/<source[^>]*\ssrc="([^"]+)"/i)?.[1]?.replace(/&amp;/g, "&");
    const youtubeId = src ? parseYouTubeId(src) : null;
    const url = youtubeId ? youtubeWatchUrl(youtubeId) : src && /^https?:\/\//.test(src) ? src : null;
    if (!url || !canEditRef.current) {
      showToast(t("reader.videoNoEditAnnotate"));
      return;
    }
    showToast(t("reader.videoNoEditAnnotate"), {
      label: t("reader.openAsVideoDoc"),
      run: () => {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast(null);
        setToastAction(null);
        window.dispatchEvent(new CustomEvent("dissect:add-document-url", { detail: { url } }));
      },
    });
  }

  // The block popover of a figure, equation, or table: anchored to the whole
  // block's text (offsets 0..length), so provenance validation holds and the
  // annotation lists like any other. The kind's toolbar renders (TOOLBARS).
  function openFigureTools(blockId: string, clientX: number, clientY: number) {
    const container = containerRef.current;
    const block = blocksRef.current.find((b) => b.id === blockId);
    if (!container || !block) return;
    // A figure whose content is a player is video or audio content: refused,
    // with the way out — open it as a video document.
    if (block.type === "FIGURE" && /<(?:video|audio|iframe)[\s>]/i.test(block.html ?? "")) {
      refuseMediaFigure(block);
      return;
    }
    const text = block.text;
    if (!text.trim()) {
      showToast(t("reader.figureNoCaption"));
      return;
    }
    if (!canEditRef.current) return;
    const containerRect = container.getBoundingClientRect();
    const y = clientY - containerRect.top + container.scrollTop;
    // The page editor (SPEC.md §29): beside the page's right edge, level
    // with the press and under the header, as a selection's toolbar stands;
    // with no room there (a split pane), under the press.
    const shift = docsShiftRef.current;
    const page = richTextRef.current ? pageGeometry(container, shift) : null;
    const beside =
      page !== null && !window.matchMedia("(pointer: coarse)").matches && toolbarLeft(page, shift, 176) !== null;
    const headerBottom = page ? container.querySelector(".docs-header")?.getBoundingClientRect().bottom : undefined;
    const lineTop = clientY - 20;
    const pageTop = headerBottom !== undefined ? Math.max(lineTop, headerBottom + 56) : lineTop;
    // The block reader: beside the block, as a selection's toolbox stands
    // beside its words (toolboxSide) — never over the figure, the table
    // around it, or the caption it was opened on. Near the pane's top edge
    // (a tall figure whose top is out of view) it stands clear of the
    // chips, as for words.
    const blockRect = page
      ? undefined
      : container.querySelector(`[data-block-id="${blockId}"]`)?.getBoundingClientRect();
    const blockTop = blockRect ? blockRect.top - containerRect.top + container.scrollTop : y;
    const readerSide = blockRect
      ? window.matchMedia("(pointer: coarse)").matches
        ? ("below" as const)
        : toolboxSide(container, blockTop)
      : null;
    const nearTop = blockRect !== undefined && (readerSide === "below" || blockRect.top - containerRect.top < 100);
    const readerTop = nearTop
      ? Math.max(blockTop, container.scrollTop + (readerSide === "right" ? 56 : 48))
      : Math.max(8, blockTop);
    suppressNextMouseUp.current = true;
    // The page editor keeps its own selection, the figure it selected: an
    // emptied one would put the caret at the text's start on the next key.
    if (!richTextRef.current) window.getSelection()?.removeAllRanges();
    setSubmenu(null);
    const anchor = { blockId, startOffset: 0, endOffset: text.length, quotedText: text, prefix: "", suffix: "" };
    if (blockRect && readerSide) {
      const { articleRight, cw } = measureSideCards(container);
      const articleRect = container.querySelector("article")?.getBoundingClientRect();
      const margin = Math.min(240, containerRect.width / 2);
      setPopover({
        anchor,
        figure: true,
        x: Math.max(margin, Math.min(blockRect.left + blockRect.width / 2 - containerRect.left, containerRect.width - margin)),
        y: blockRect.bottom - containerRect.top + container.scrollTop + 14,
        yTop: readerTop,
        wordsTop: blockTop,
        textLeft: articleRect ? articleRect.left - containerRect.left + 24 : 24,
        truncated: false,
        side: readerSide,
        rightBase: articleRight + 10,
        cw,
      });
      return;
    }
    setPopover({
      anchor,
      figure: true,
      x: Math.max(120, clientX - containerRect.left),
      y: y + 8,
      wordsTop: y - 8,
      yTop: beside ? Math.max(8, pageTop - containerRect.top + container.scrollTop) : Math.max(8, y - 8),
      textLeft: Math.min(clientX - containerRect.left + 130, containerRect.width - 20),
      truncated: false,
      side: beside ? "right" : page ? "below" : "left",
      rightBase: containerRect.width - 130,
      cw: containerRect.width,
      ...(page ? { page: { geo: page } } : {}),
    });
  }
  const openFigureToolsRef = useRef(openFigureTools);
  openFigureToolsRef.current = openFigureTools;

  // Edit mode: unsaved typing must reach the server before an anchor referencing
  // the live text is stored — the anchor's offsets describe what is on screen.
  // A blank document saves all of its typing first (SPEC.md §29).
  async function flushLiveBlock(blockId: string) {
    if (richTextRef.current) {
      await flushEditRef.current?.();
      return;
    }
    if (!editModeRef.current) return;
    const el = document.querySelector<HTMLElement>(`[data-edit-block="${blockId}"]`);
    const stored = blocksRef.current.find((b) => b.id === blockId);
    const live = el?.textContent;
    if (el && stored && live !== undefined && live !== stored.text) {
      try {
        await api(`/api/blocks/${blockId}`, "PATCH", { text: live });
      } catch {
        // The action still runs; the anchor may orphan and heal by quote.
      }
    }
  }

  // What Add to notes writes (SPEC.md §6): the highlighted text as a quote —
  // blockquote lines render as the boxed quotation on the note card; a
  // passage over several blocks quotes every block, a blank line between —
  // then, after a blank line, the comment the reader typed in the bubble.
  function addToNotesText(anchor: Anchor): string {
    const quote = passageText(anchor)
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n");
    const comment = addComment.trim();
    return comment ? `${quote}\n\n${comment}` : quote;
  }

  // After the quote landed: the toolbar closes and the page refreshes, so
  // the note shows where it went.
  function addedToNotes(anchor: Anchor) {
    markFreshAnchor(anchor);
    setPopover(null);
    setAddDraft({ key: null, comment: "", mode: "sections" });
    clearToolbarDraft("add", documentId, anchor);
    window.getSelection()?.removeAllRanges();
    refreshWhenOnline(router);
  }

  async function addToSection(sectionId: string) {
    if (!popover || busy) return;
    setBusy(true);
    try {
      await flushLiveBlock(popover.anchor.blockId);
      // A quote whose place is gone by the time the write lands (an edit
      // elsewhere, a queued write replayed later) still lands its words,
      // without the source, and the reader is told.
      const note = await api<{ id: string; sourceDropped?: boolean }>("/api/notes", "POST", {
        sectionId,
        content: addToNotesText(popover.anchor),
        source: { documentId, ...anchorBody(popover.anchor) },
        ...segmentsBody(popover.anchor),
        onSourceLost: "keep",
      });
      if (note.sourceDropped === true) showToast(t("outline.quoteSourceLost"));
      addedToNotes(popover.anchor);
      // The tray opens on the new note, so the reader sees where it went
      // (SPEC.md §6): every document, and a blank one whose tray starts
      // folded (SPEC.md §29). On a phone the sheet stays closed and the
      // bar's Notes button blooms (quiet), so the reader keeps reading.
      window.dispatchEvent(new CustomEvent("dissect:show-note", { detail: { noteId: note.id, quiet: true } }));
    } catch (err) {
      addFailed(err);
    } finally {
      setBusy(false);
    }
  }
  // The box stays open on the words, the reason under Add to notes.
  function addFailed(err: unknown) {
    const text = err instanceof Error ? err.message : t("reader.addFailed");
    reportError(text, documentId);
    if (popoverRef.current) setToolError({ text, from: popoverRef.current.anchor, at: "add" });
    else showToast(text);
  }

  // Add to a note… (SPEC.md §6): the quote and the comment go onto the end of
  // a note the reader picked, and the passage's anchor becomes a source of
  // that note. The tray then opens on the note, so the reader sees it land.
  async function addToNote(note: NoteView) {
    if (!popover || busy) return;
    setBusy(true);
    try {
      await flushLiveBlock(popover.anchor.blockId);
      const answer = await api<{ sourceDropped?: boolean } | null>(`/api/notes/${note.id}`, "PATCH", {
        append: addToNotesText(popover.anchor),
        addSource: {
          source: { documentId, ...anchorBody(popover.anchor) },
          ...segmentsBody(popover.anchor),
        },
        onSourceLost: "keep",
      });
      if (answer?.sourceDropped === true) showToast(t("outline.quoteSourceLost"));
      addedToNotes(popover.anchor);
      window.dispatchEvent(new CustomEvent("dissect:show-note", { detail: { noteId: note.id, quiet: true } }));
    } catch (err) {
      addFailed(err);
    } finally {
      setBusy(false);
    }
  }

  // The anchor travels whole (SPEC.md §5): the block id and offsets, plus the
  // quote selectors, so the server re-finds the selection when the blocks
  // changed under the reader (a re-parse, an edit).
  // A core's anchor (its core key, lib/anchors/core-key.ts) travels as the
  // block id and layer "core" (SPEC.md §28).
  function anchorBody(anchor: Segment) {
    const core = isCoreKey(anchor.blockId);
    return {
      blockId: blockIdOfKey(anchor.blockId),
      startOffset: anchor.startOffset,
      endOffset: anchor.endOffset,
      quotedText: anchor.quotedText,
      prefix: anchor.prefix,
      suffix: anchor.suffix,
      ...(core ? { layer: "core" as const } : {}),
    };
  }

  // A passage over several blocks travels as `segments` beside the anchor
  // (lib/anchors/passage.ts); one block sends nothing more.
  function segmentsBody(anchor: Anchor): { segments?: ReturnType<typeof anchorBody>[] } {
    const segments = segmentsOf(anchor);
    return segments.length > 1 ? { segments: segments.map(anchorBody) } : {};
  }

  // conversationOf: Regenerate on an annotation with a conversation (SPEC.md
  // §4, §21): the new annotation takes its turns.
  function deriveBody(type: string, anchor: Anchor, conversationOf?: string | null) {
    // The Web toggle (SPEC.md §7): the route searches for EXPLAIN and ANALYZE.
    return JSON.stringify({
      type,
      documentId,
      notebookId,
      web,
      anchor: anchorBody(anchor),
      ...segmentsBody(anchor),
      ...(conversationOf ? { conversationOf } : {}),
    });
  }

  // DEFINE (SPEC.md §4, §6): the meaning of the selected word in its
  // sentence, streamed into the toolbar under the Define row. Nothing
  // persists. A key term's definition is the glossary's, shown at once with
  // no call; a definition read once stays for the session. Pressing Define
  // again folds the definition away.
  async function define() {
    if (!popover || !popoverAnchorKey) return;
    if (submenu === "define") {
      setSubmenu(null);
      return;
    }
    setSubmenu("define");
    const key = popoverAnchorKey;
    const anchor = popover.anchor;
    // Shown already, or on its way.
    if (definition?.key === key && !definition.error) return;
    const word = defineKey(anchor.quotedText);
    const fromGlossary = glossaryDefinitions.get(word);
    if (fromGlossary) {
      setDefinition({ key, text: fromGlossary, streaming: false, error: null, glossary: true });
      return;
    }
    const cacheKey = `${anchor.blockId}:${word}`;
    const known = definitionCacheRef.current.get(cacheKey);
    if (known) {
      setDefinition({ key, text: known, streaming: false, error: null, glossary: false });
      return;
    }
    defineAbortRef.current?.abort();
    const controller = new AbortController();
    defineAbortRef.current = controller;
    const settle = (patch: Partial<Definition>) =>
      setDefinition((d) => (d && d.key === key ? { ...d, ...patch } : d));
    setDefinition({ key, text: "", streaming: true, error: null, glossary: false });
    try {
      await flushLiveBlock(anchor.blockId);
      const res = await aiFetch("/api/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: deriveBody("DEFINE", anchor),
      });
      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? t("reader.deriveFailedStatus", { status: res.status }));
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let raw = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        settle({ text: splitStreamError(raw).text });
      }
      // A failure mid-stream arrives in-band; an empty stream is a failure too.
      const { text, error } = splitStreamError(raw);
      const meaning = text.trim();
      if (meaning && !error) definitionCacheRef.current.set(cacheKey, meaning);
      settle({ text: meaning, streaming: false, error: error ?? (meaning ? null : t("reader.emptyResponse")) });
    } catch (err) {
      // Stopped, not failed: what arrived stays; nothing at all clears it.
      if (controller.signal.aborted) {
        setDefinition((d) => (d && d.key === key ? (d.text.trim() ? { ...d, streaming: false } : null) : d));
        return;
      }
      settle({ streaming: false, error: err instanceof Error ? err.message : t("reader.deriveFailed") });
    } finally {
      if (defineAbortRef.current === controller) defineAbortRef.current = null;
    }
  }
  // Stop under the Define row: the call ends, and a panel with nothing in
  // it folds away.
  function stopDefine() {
    defineAbortRef.current?.abort();
    defineAbortRef.current = null;
    if (!definition?.text.trim()) setSubmenu((m) => (m === "define" ? null : m));
  }

  // EXPLAIN and ANALYZE stream into the same card beside the article (SPEC.md
  // §4, §6): an explanation of the selection, or the three-section analysis
  // of a figure or table. Both persist in the hidden Annotations section.
  async function explain() {
    await streamBubble("explain");
  }
  // Explain asked for from outside the toolbar (the page editor's right-click
  // menu) runs once the popover it needs has rendered.
  useEffect(() => {
    if (!pendingExplain || !popover) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPendingExplain(false);
    void explain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingExplain, popover]);
  async function analyze() {
    await streamBubble("analyze");
  }
  async function streamBubble(kind: ExplainBubble["kind"]) {
    if (!popover || busy) return;
    const { anchor, yTop } = popover;
    await flushLiveBlock(anchor.blockId);
    setPopover(null);
    window.getSelection()?.removeAllRanges();
    markFreshAnchor(anchor);
    await runBubble(kind, anchor, claimSideSlot("explain", yTop, anchor));
  }
  // A new run of a card. Runs are never stopped by another run (SPEC.md §6):
  // only Stop or ✕ on their own card stops them.
  function startToolRun(): { run: number; controller: AbortController } {
    const run = ++toolRunSeqRef.current;
    const controller = new AbortController();
    toolRunsRef.current.set(run, controller);
    return { run, controller };
  }
  // A run whose card a later run took over lands its annotation all the
  // same: the mark paints, and a toast offers the card where its words are.
  function landedAway(
    kind: ExplainBubble["kind"] | "simplify",
    anchor: Anchor,
    text: string,
    noteId: string,
  ) {
    const ready =
      kind === "simplify"
        ? "reader.simplifiedReady"
        : kind === "analyze"
          ? "reader.analysisReady"
          : kind === "visualize"
            ? "reader.visualizationReady"
            : "reader.explanationReady";
    showToast(t(ready), {
      label: t("reader.showCard"),
      run: () => {
        hideToast();
        const box = containerRef.current ? passageBox(containerRef.current, anchor) : null;
        const top = box?.top ?? containerRef.current?.scrollTop ?? 80;
        // The words come into view first, at once, so the card opens beside
        // them and nothing lifts it into a pane still scrolling.
        if (box && containerRef.current) {
          const pane = containerRef.current;
          if (box.top < pane.scrollTop || box.top > pane.scrollTop + pane.clientHeight - 120) {
            pane.scrollTo({ top: Math.max(0, box.top - 120) });
          }
        }
        if (kind === "simplify") {
          setSimplifyCard({
            anchor,
            ...claimSideSlot("simplify", top, anchor),
            ...NO_CHAT,
            text,
            streaming: false,
            error: null,
            noteId,
            sentences: parseSimplified(text),
            active: null,
          });
        } else {
          setBubble({
            ...claimSideSlot("explain", top, anchor),
            ...NO_CHAT,
            kind,
            text,
            streaming: false,
            error: null,
            declined: null,
            anchor,
            noteId,
          });
        }
      },
    }, 12000);
  }
  // A Regenerate keeps the card's conversation: its turns, whether its box
  // is open, the box's words and the messages queued under it.
  const chatCarried = (replacing: ToolChat | null | undefined): ToolChat =>
    replacing
      ? {
          ...NO_CHAT,
          conversation: replacing.conversation,
          chatOpen: replacing.chatOpen,
          input: replacing.input,
          queue: replacing.queue,
        }
      : NO_CHAT;
  // The annotation whose turns the new one takes: only one with turns.
  const turnsOf = (replacing: (ToolChat & { noteId: string | null }) | null | undefined) =>
    replacing?.noteId && replacing.conversation.length > 0 ? replacing.noteId : null;
  // The new annotation holds the turns now; the old one's draft moves to it.
  function carryTurns(replacing: (ToolChat & { noteId: string | null }) | null | undefined, noteId: string) {
    if (!replacing?.noteId) return;
    if (replacing.conversation.length > 0) toolConversationsRef.current[noteId] = replacing.conversation;
    draftShownRef.current.delete(replacing.noteId);
    setCardDraft(replacing.noteId, null);
  }
  // Where a card stands now: a card moved while its run ran stays there.
  const slotOf = (c: SideSlot): SideSlot => ({ left: c.left, top: c.top, width: c.width, side: c.side });
  // replacing: the card this run regenerates (SPEC.md §4). Its annotation
  // goes only once the new one is stored, so a failed or stopped run never
  // loses what stands: the card shows the old output again, with why under
  // it. Its conversation goes on under the new output (§21): the new
  // annotation takes its turns, and the box keeps its words.
  async function runBubble(
    kind: ExplainBubble["kind"],
    anchor: Anchor,
    slot: SideSlot,
    replacing?: ExplainBubble | null,
  ) {
    if (kind === "visualize") {
      await runVisualize(anchor, slot, replacing);
      return;
    }
    const { run, controller } = startToolRun();
    const mine = (b: ExplainBubble | null): b is ExplainBubble => b !== null && b.run === run;
    const replaceNoteId = replacing?.noteId ?? null;
    setBubble({ ...slot, ...chatCarried(replacing), kind, text: "", streaming: true, error: null, declined: null, anchor, noteId: null, run });
    try {
      const res = await aiFetch("/api/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: deriveBody(kind === "analyze" ? "ANALYZE" : "EXPLAIN", anchor, turnsOf(replacing)),
      });
      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? t("reader.deriveFailedStatus", { status: res.status }));
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let raw = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        const live = splitStreamNote(splitStreamError(raw).text).text;
        setBubble((b) => (mine(b) ? { ...b, text: live } : b));
      }
      // A failure mid-stream arrives in-band; an empty stream is a failure too.
      // The note id trailer means the annotation persisted before the stream
      // closed, so the refresh below always finds the stored mark; the mark
      // paints from here until then, card open or closed, as the tool's mark.
      const { text: withoutError, error } = splitStreamError(raw);
      const { text, noteId } = splitStreamNote(withoutError);
      if (noteId) addLocalAnchor(anchor, kind);
      if (noteId && !error && text.trim() && bubbleRef.current?.run !== run) landedAway(kind, anchor, text, noteId);
      const failed = error ?? (text.trim() ? null : t("reader.emptyResponse"));
      if (replacing && (!noteId || failed)) {
        setBubble((b) => (mine(b) ? { ...replacing, ...slotOf(b), run, runError: failed ?? t("reader.deriveFailed") } : b));
        return;
      }
      if (noteId) carryTurns(replacing, noteId);
      setBubble((b) =>
        mine(b)
          ? {
              ...b,
              text,
              noteId: noteId ?? b.noteId,
              streaming: false,
              error: failed,
            }
          : b,
      );
      if (replaceNoteId && noteId) await discardNote(replaceNoteId);
      router.refresh();
    } catch (err) {
      const message = controller.signal.aborted ? null : err instanceof Error ? err.message : t("reader.deriveFailed");
      // Regenerate stopped or failed: the output that stands comes back.
      if (replacing) {
        setBubble((b) => (mine(b) ? { ...replacing, ...slotOf(b), run, runError: message } : b));
        return;
      }
      // Stopped, not failed: what streamed in stays; an empty card closes.
      if (message === null) {
        setBubble((b) => (mine(b) ? (b.text.trim() ? { ...b, streaming: false } : null) : b));
        return;
      }
      setBubble((b) => (mine(b) ? { ...b, streaming: false, error: message } : b));
    } finally {
      toolRunsRef.current.delete(run);
    }
  }

  // SIMPLIFY: stream the layman rewrite into a bubble beside the article,
  // level with the selection. Persists in the hidden Annotations section (SPEC.md §6).
  async function simplify() {
    if (!popover || busy) return;
    const { anchor, yTop } = popover;
    await flushLiveBlock(anchor.blockId);
    setPopover(null);
    window.getSelection()?.removeAllRanges();
    markFreshAnchor(anchor);
    await runSimplify(anchor, claimSideSlot("simplify", yTop, anchor));
  }
  async function runSimplify(anchor: Anchor, slot: SideSlot, replacing?: SimplifyCard | null) {
    const { run, controller } = startToolRun();
    const mine = (c: SimplifyCard | null): c is SimplifyCard => c !== null && c.run === run;
    const replaceNoteId = replacing?.noteId ?? null;
    setSimplifyCard({
      anchor,
      ...slot,
      ...chatCarried(replacing),
      text: "",
      streaming: true,
      error: null,
      noteId: null,
      sentences: null,
      active: null,
      run,
    });
    try {
      const res = await aiFetch("/api/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: deriveBody("SIMPLIFY", anchor, turnsOf(replacing)),
      });
      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? t("reader.deriveFailedStatus", { status: res.status }));
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let raw = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        const live = splitStreamNote(splitStreamError(raw).text).text;
        setSimplifyCard((c) => (mine(c) ? { ...c, text: live } : c));
      }
      // A failure mid-stream arrives in-band; an empty stream is a failure too.
      // The note id trailer means the annotation persisted before the stream
      // closed, so the refresh below always finds the stored mark.
      const { text: withoutError, error } = splitStreamError(raw);
      const { text, noteId } = splitStreamNote(withoutError);
      if (noteId) addLocalAnchor(anchor, "simplify");
      if (noteId && !error && text.trim() && simplifyCardRef.current?.run !== run) landedAway("simplify", anchor, text, noteId);
      const failed = error ?? (text.trim() ? null : t("reader.emptyResponse"));
      if (replacing && (!noteId || failed)) {
        setSimplifyCard((c) => (mine(c) ? { ...replacing, ...slotOf(c), run, runError: failed ?? t("reader.simplifyFailed") } : c));
        return;
      }
      if (noteId) carryTurns(replacing, noteId);
      setSimplifyCard((c) =>
        mine(c)
          ? {
              ...c,
              text,
              noteId: noteId ?? c.noteId,
              streaming: false,
              error: failed,
              sentences: failed ? null : parseSimplified(text),
              active: null,
            }
          : c,
      );
      if (replaceNoteId && noteId) await discardNote(replaceNoteId);
      router.refresh();
    } catch (err) {
      const message = controller.signal.aborted ? null : err instanceof Error ? err.message : t("reader.simplifyFailed");
      // Regenerate stopped or failed: the output that stands comes back.
      if (replacing) {
        setSimplifyCard((c) => (mine(c) ? { ...replacing, ...slotOf(c), run, runError: message } : c));
        return;
      }
      // Stopped, not failed: what streamed in stays; an empty card closes.
      if (message === null) {
        setSimplifyCard((c) => (mine(c) ? (c.text.trim() ? { ...c, streaming: false } : null) : c));
        return;
      }
      setSimplifyCard((c) => (mine(c) ? { ...c, streaming: false, error: message } : c));
    } finally {
      toolRunsRef.current.delete(run);
    }
  }

  // VISUALIZE (SPEC.md §20, Unitos Ultra): the selection as a picture, into
  // the same card as EXPLAIN. The server answers behind a heartbeat stream
  // with the annotation's markdown (the picture and its caption), or with the
  // reason the model declined to draw; a decline persists nothing.
  async function visualize() {
    if (!popover || busy) return;
    if (!ultra) {
      showToast(t("reader.visualizeNeedsUltra"), plansAction);
      return;
    }
    const { anchor, yTop } = popover;
    await flushLiveBlock(anchor.blockId);
    setPopover(null);
    window.getSelection()?.removeAllRanges();
    markFreshAnchor(anchor);
    await runVisualize(anchor, claimSideSlot("explain", yTop, anchor));
  }
  async function runVisualize(anchor: Anchor, slot: SideSlot, replacing?: ExplainBubble | null) {
    const { run, controller } = startToolRun();
    const mine = (b: ExplainBubble | null): b is ExplainBubble => b !== null && b.run === run;
    const replaceNoteId = replacing?.noteId ?? null;
    setBubble({
      ...slot,
      ...chatCarried(replacing),
      kind: "visualize",
      text: "",
      streaming: true,
      error: null,
      declined: null,
      anchor,
      noteId: null,
      run,
    });
    try {
      const res = await aiFetch("/api/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: deriveBody("VISUALIZE", anchor, turnsOf(replacing)),
      });
      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? t("reader.deriveFailedStatus", { status: res.status }));
      }
      // Heartbeat spaces while the model works, then the payload JSON or the
      // error token with the reason.
      const { text, error } = splitStreamError(await res.text());
      if (error) throw new Error(error);
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text.trim());
      } catch {
        parsed = null;
      }
      const payload = parsed as {
        declined?: boolean;
        reason?: string;
        noteId?: string;
        content?: string;
      } | null;
      if (!payload) throw new Error(t("reader.emptyResponse"));
      if (payload.declined) {
        const reason = payload.reason ?? "";
        // A Regenerate that declines keeps the picture that stands (SPEC.md §20).
        if (replacing) {
          const why = [t("reader.visualizeDeclined"), reason].filter(Boolean).join(" ");
          setBubble((b) => (mine(b) ? { ...replacing, ...slotOf(b), run, runError: why } : b));
          return;
        }
        setBubble((b) => (mine(b) ? { ...b, streaming: false, declined: reason } : b));
        return;
      }
      const content = payload.content ?? "";
      const noteId = payload.noteId ?? null;
      if (!content.trim()) throw new Error(t("reader.emptyResponse"));
      if (noteId) addLocalAnchor(anchor, "visualize");
      if (noteId && bubbleRef.current?.run !== run) landedAway("visualize", anchor, content, noteId);
      if (noteId) carryTurns(replacing, noteId);
      setBubble((b) => (mine(b) ? { ...b, text: content, noteId, streaming: false } : b));
      if (replaceNoteId && noteId) await discardNote(replaceNoteId);
      router.refresh();
    } catch (err) {
      const stopped = controller.signal.aborted;
      // Regenerate stopped or failed: the picture that stands comes back.
      if (replacing) {
        const why = stopped ? null : err instanceof Error ? err.message : t("reader.visualizeFailed");
        setBubble((b) => (mine(b) ? { ...replacing, ...slotOf(b), run, runError: why } : b));
        return;
      }
      // Stopped, not failed: nothing to keep, the card closes.
      if (stopped) {
        setBubble((b) => (mine(b) ? null : b));
        return;
      }
      const message = err instanceof Error ? err.message : t("reader.visualizeFailed");
      setBubble((b) => (mine(b) ? { ...b, streaming: false, error: message } : b));
    } finally {
      toolRunsRef.current.delete(run);
    }
  }

  // On-mark card actions: recolor, save the comment, delete. Every action
  // syncs through the normal notes API and refreshes the painted marks.
  async function recolorAnnotation(color: (typeof HIGHLIGHT_HUES)[number]) {
    const card = annotationCard;
    if (!card || card.busy || card.color === color) return;
    setAnnotationCard({ ...card, color, busy: true });
    try {
      await api(`/api/notes/${card.noteId}`, "PATCH", { color });
      router.refresh();
      setAnnotationCard((c) => (c && c.sourceId === card.sourceId ? { ...c, busy: false } : c));
    } catch (err) {
      showError(err instanceof Error ? err.message : t("reader.recolorFailed"));
      setAnnotationCard((c) =>
        c && c.sourceId === card.sourceId ? { ...c, color: card.color, busy: false } : c,
      );
    }
  }

  async function saveAnnotation() {
    const card = annotationCard;
    if (!card || card.busy) return;
    const draft = card.draft.trim();
    // A comment needs text; a highlight with its comment cleared keeps the
    // quote as content — the same convention the create route uses.
    const content = draft || (card.kind === "highlight" ? (card.quotedText ?? "").slice(0, 5000) : "");
    if (!content) {
      showToast(t("reader.commentEmpty"));
      return;
    }
    setAnnotationCard({ ...card, busy: true });
    try {
      // Made from the text the card opened on (a pure highlight stores its
      // quote): a note changed elsewhere meanwhile keeps both sides' words
      // (lib/notes/save-text.ts, SPEC.md §6).
      const base = card.saved === "" ? (card.quotedText ?? "") : card.saved;
      const saved = await saveNoteText(card.noteId, content, base);
      router.refresh();
      // Saved: the draft is done (a later reopen shows the stored comment).
      draftShownRef.current.delete(card.noteId);
      setCardDraft(card.noteId, null);
      setAnnotationCard(null);
      // The header says Saved; a toast says only that both sides were kept.
      if (saved.conflict) showToast(t("outline.savedBoth"));
    } catch (err) {
      showError(err instanceof Error ? err.message : t("reader.saveFailed"));
      setAnnotationCard((c) => (c ? { ...c, busy: false } : c));
    }
  }

  async function deleteAnnotation() {
    const card = annotationCard;
    if (!card || card.busy) return;
    setAnnotationCard(null);
    await deleteNote(
      card.noteId,
      card.kind === "highlight" ? t("reader.highlightRemoved") : t("reader.commentRemoved"),
    );
  }

  // The comment card edits in place too: same notes API, same refresh.
  async function saveCommentCard() {
    const card = commentCard;
    if (!card || card.busy || !card.noteId) return;
    const content = card.draft.trim();
    if (!content) {
      showToast(t("reader.commentEmpty"));
      return;
    }
    setCommentCard({ ...card, busy: true });
    try {
      // Made from the comment the card opened on: a comment changed elsewhere
      // meanwhile keeps both sides' words (lib/notes/save-text.ts, SPEC.md §6).
      const saved = await saveNoteText(card.noteId, content, card.saved);
      router.refresh();
      // Words typed while the save ran stay in the box.
      setCommentCard((c) =>
        c ? { ...c, draft: c.draft.trim() === content ? saved.content : c.draft, saved: saved.content, busy: false } : c,
      );
      // The header says Saved; a toast says only that both sides were kept.
      if (saved.conflict) showToast(t("outline.savedBoth"));
    } catch (err) {
      showError(err instanceof Error ? err.message : t("reader.saveFailed"));
      setCommentCard((c) => (c ? { ...c, busy: false } : c));
    }
  }

  async function deleteCommentCard() {
    const card = commentCard;
    if (!card || card.busy || !card.noteId) return;
    setCommentCard(null);
    await deleteNote(card.noteId, t("reader.commentRemoved"));
  }

  // Resolve (SPEC.md §29): the card and the mark go; Reopen is in the Annotations tab.
  async function resolveCommentCard() {
    const card = commentCard;
    if (!card || card.busy || !card.noteId) return;
    setCommentCard(null);
    try {
      await setCommentResolved(card.noteId, true);
      router.refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : t("common.requestFailed"));
    }
  }

  // What the link is about: saved as the link's reason. Skip closes the card
  // and leaves the link as it is.
  async function saveLinkCard() {
    const card = linkCard;
    if (!card || card.busy) return;
    const reason = card.draft.trim();
    if (!reason) {
      setLinkCard(null);
      return;
    }
    setLinkCard({ ...card, busy: true });
    try {
      await api(`/api/links/${card.linkId}`, "PATCH", { reason });
      setLinkReasons((prev) => ({ ...prev, [card.linkId]: reason }));
      setLinkCard(null);
      router.refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : t("reader.saveFailed"));
      setLinkCard((c) => (c ? { ...c, busy: false } : c));
    }
  }

  // DISTILL: one question, the whole article, the quotes that answer it
  // (SPEC.md §4). The page opens on the ask view; Run scans the article.
  // A deleted or replaced extraction leaves the list at once; the page's
  // next load carries the same.
  const allDistillations = [
    ...localDistillations.filter((d) => !distillations.some((p) => p.id === d.id)),
    ...distillations,
  ].filter((d) => !goneDistillations.has(d.id));

  // Text highlighted on the extract page (SPEC.md §6): it lands as a pending
  // note, anchored to the quote it was highlighted inside. Highlighted
  // anywhere else on the page it lands without an anchor — the words are the
  // note.
  async function addSelectionNote(
    text: string,
    anchor: {
      blockId: string;
      start: number;
      end: number;
      quotedText: string;
      prefix: string;
      suffix: string;
      orphaned: boolean;
    } | null,
  ): Promise<boolean> {
    const section = sectionChoices[0];
    if (!section) {
      showToast(t("reader.addSectionFirstDot"));
      return false;
    }
    const source = anchor && !anchor.orphaned ? anchor : null;
    try {
      await api("/api/notes", "POST", {
        sectionId: section.id,
        content: text,
        origin: "distill",
        ...(source
          ? {
              source: {
                documentId,
                blockId: source.blockId,
                startOffset: source.start,
                endOffset: source.end,
                quotedText: source.quotedText,
                prefix: source.prefix,
                suffix: source.suffix,
              },
            }
          : {}),
      });
      if (source) markFreshSpan(source.blockId, source.start, source.end);
      router.refresh();
      return true;
    } catch (err) {
      showError(err instanceof Error ? err.message : t("reader.addFailed"));
      return false;
    }
  }

  // Oldest first, matching the stored order — the index gives the label.
  const allExtractions = [
    ...extractions,
    ...localExtractions.filter((x) => !extractions.some((p) => p.id === x.id)),
  ];
  const allExtractionsRef = useRef(allExtractions);
  allExtractionsRef.current = allExtractions;

  function openDistillPage(shownId: string | null) {
    const container = containerRef.current;
    if (container && !distillOpenRef.current) {
      distillReturnScroll.current = container.scrollTop;
      container.scrollTo({ top: 0 });
    }
    setDistillShownId(shownId);
    setDistillError(null);
    setDistillOpen(true);
  }

  // Closing the page never cancels: a running distillation keeps going, with
  // the progress bar under the Extract button showing it.
  function closeDistillPage() {
    setDistillOpen(false);
    const container = containerRef.current;
    if (container && distillReturnScroll.current !== null) {
      container.scrollTo({ top: distillReturnScroll.current });
    }
    distillReturnScroll.current = null;
  }

  // Cancel a running distillation: the request aborts, the server persists
  // nothing, and the ask view keeps the question for editing.
  function cancelDistill() {
    distillAbortRef.current?.abort();
    distillAbortRef.current = null;
    setDistillRun(null);
  }

  // replaceId: the extraction this run regenerates — it goes once the new one
  // is stored (SPEC.md §4).
  async function runDistill(question: string, replaceId?: string) {
    const q = question.trim();
    if (!q || distillRun) return;
    const runDocumentId = documentId;
    const controller = new AbortController();
    distillAbortRef.current = controller;
    setDistillRun({ question: q });
    setDistillError(null);
    setDistillShownId(null);
    try {
      const res = await aiFetch("/api/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ type: "DISTILL", documentId, notebookId, question: q, replaceId }),
      });
      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? t("reader.distillFailedStatus", { status: res.status }));
      }
      // The response streams heartbeat spaces while the model works; the
      // payload is the trailer — the distillation JSON, or the in-band error.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let raw = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
      }
      const { text, error } = splitStreamError(raw);
      if (error) throw new Error(error);
      let payload: { distillation?: Distillation } | null = null;
      try {
        payload = JSON.parse(text.trim()) as { distillation?: Distillation };
      } catch {
        payload = null;
      }
      if (!payload?.distillation) throw new Error(t("reader.distillUnfinished"));
      if (controller.signal.aborted || documentIdRef.current !== runDocumentId) return;
      const fresh: DistillationView = {
        ...payload.distillation,
        quotes: payload.distillation.quotes.map((quote) => ({ ...quote, orphaned: false })),
      };
      setLocalDistillations((prev) => [fresh, ...prev]);
      setDistillShownId(fresh.id);
      // The route dropped the replaced extraction with the new one's arrival.
      if (replaceId) setGoneDistillations((prev) => new Set(prev).add(replaceId));
      // The page may be closed: the pill's progress bar stops, and the toast
      // says where the result is.
      if (!distillOpenRef.current) showToast(t("reader.distilledToast"));
      router.refresh();
    } catch (err) {
      // A cancelled run is not a failure: the ask view keeps the question.
      if (controller.signal.aborted) return;
      if (documentIdRef.current !== runDocumentId) return;
      const message = err instanceof Error ? err.message : t("reader.distillFailed");
      setDistillError(message);
      reportError(message, runDocumentId);
      if (!distillOpenRef.current) showToast(message);
    } finally {
      if (distillAbortRef.current === controller) distillAbortRef.current = null;
      if (documentIdRef.current === runDocumentId) setDistillRun(null);
    }
  }

  async function deleteDistillation(id: string) {
    await deleteDistillations([id]);
  }

  // The selected extractions go in one call (SPEC.md §4).
  async function deleteDistillations(ids: string[]) {
    if (ids.length === 0) return;
    try {
      await api(`/api/notebooks/${notebookId}/documents/${documentId}`, "PATCH", {
        removeDistillationIds: ids,
      });
      setLocalDistillations((prev) => prev.filter((d) => !ids.includes(d.id)));
      setGoneDistillations((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.add(id);
        return next;
      });
      if (distillShownId && ids.includes(distillShownId)) setDistillShownId(null);
      router.refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : t("reader.deleteFailed"));
    }
  }

  // A distilled quote lands as a note: caption as content, quote as source,
  // PENDING like every AI note (SPEC.md §1).
  async function addQuoteNote(
    _distillation: DistillationView,
    quote: DistillationView["quotes"][number],
  ): Promise<boolean> {
    const section = sectionChoices[0];
    if (!section) {
      showToast(t("reader.addSectionFirstDot"));
      return false;
    }
    try {
      await api("/api/notes", "POST", {
        sectionId: section.id,
        content: quote.caption,
        source: {
          documentId,
          blockId: quote.blockId,
          startOffset: quote.start,
          endOffset: quote.end,
          quotedText: quote.quotedText,
          prefix: quote.prefix,
          suffix: quote.suffix,
        },
        origin: "distill",
      });
      markFreshSpan(quote.blockId, quote.start, quote.end);
      router.refresh();
      return true;
    } catch (err) {
      showError(err instanceof Error ? err.message : t("reader.addFailed"));
      return false;
    }
  }

  // Jump to a span: scroll to its block, flash it, and tint the exact span
  // while the reader lands on it. Distilled quotes and extract chips share it.
  function flashSpan(blockId: string, start: number, end: number) {
    setSpanFlash({ blockId, start, end });
    if (spanFlashTimer.current) clearTimeout(spanFlashTimer.current);
    spanFlashTimer.current = setTimeout(() => setSpanFlash(null), 2600);
    requestAnimationFrame(() => jumpToWords(blockId, 10));
  }

  // Jump from the match card: close the card, then land on the span.
  function jumpToExtractSpan(span: { blockId: string; start: number; end: number }) {
    setExtractCard(null);
    flashSpan(span.blockId, span.start, span.end);
  }

  // Jump from the distilled page: close it, then land on the quote.
  function jumpToQuote(quote: { blockId: string; start: number; end: number; orphaned: boolean }) {
    if (quote.orphaned) return;
    setDistillOpen(false);
    distillReturnScroll.current = null;
    flashSpan(quote.blockId, quote.start, quote.end);
  }

  // The stored match goes; the caller says whether the reader hears about it.
  async function removeExtraction(id: string) {
    try {
      await api(`/api/notebooks/${notebookId}/documents/${documentId}`, "PATCH", {
        removeExtractionId: id,
      });
      setLocalExtractions((prev) => prev.filter((x) => x.id !== id));
      return true;
    } catch (err) {
      showError(err instanceof Error ? err.message : t("reader.deleteFailed"));
      return false;
    }
  }

  async function deleteExtraction(id: string) {
    if (!(await removeExtraction(id))) return;
    setExtractCard(null);
    router.refresh();
    showToast(t("reader.extractionRemoved"));
  }

  // Voice: stop whatever is reading — the audio element or the browser voice.
  function stopVoice() {
    voiceRunRef.current += 1;
    const audio = voiceAudioRef.current;
    if (audio) {
      audio.pause();
      URL.revokeObjectURL(audio.src);
      voiceAudioRef.current = null;
    }
    window.speechSynthesis?.cancel();
    setVoice("idle");
  }

  // The most natural voice the browser has for the language. The default is
  // often robotic; neural voices ("Natural", Edge) rank first, then Google's,
  // then premium local ones, then any voice matching the language.
  function pickBrowserVoice(lang: string): SpeechSynthesisVoice | null {
    const prefix = lang.split("-")[0];
    const candidates = (window.speechSynthesis?.getVoices() ?? []).filter((v) =>
      v.lang.replace("_", "-").toLowerCase().startsWith(prefix),
    );
    const score = (v: SpeechSynthesisVoice) => {
      const name = v.name.toLowerCase();
      if (name.includes("natural") || name.includes("online")) return 4;
      if (name.includes("google")) return 3;
      if (name.includes("premium") || name.includes("enhanced") || name.includes("siri")) return 2;
      if (v.lang.replace("_", "-").toLowerCase() === lang.toLowerCase()) return 1;
      return 0;
    };
    return candidates.sort((a, b) => score(b) - score(a))[0] ?? null;
  }

  // The browser voice reads when /api/speech fails. The utterance language
  // follows the text: Chinese characters → zh-CN, else en-US.
  function browserSpeak(text: string, run: number) {
    const synth = window.speechSynthesis;
    if (!synth) {
      setVoice("idle");
      showToast(t("reader.voiceUnavailable"));
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    const lang = /[一-鿿]/.test(text) ? "zh-CN" : "en-US";
    utterance.lang = lang;
    const voice = pickBrowserVoice(lang);
    if (voice) utterance.voice = voice;
    utterance.onend = () => {
      if (voiceRunRef.current === run) setVoice("idle");
    };
    utterance.onerror = () => {
      if (voiceRunRef.current === run) setVoice("idle");
    };
    synth.cancel();
    synth.speak(utterance);
    setVoice("playing");
  }

  async function speakSelection() {
    if (voice !== "idle") {
      stopVoice();
      return;
    }
    if (!popover) return;
    const text = passageText(popover.anchor).slice(0, 4000);
    if (!text.trim()) return;
    const run = ++voiceRunRef.current;
    setVoice("loading");
    // Warm the voice list: if the route fails, browserSpeak needs it loaded.
    window.speechSynthesis?.getVoices();
    try {
      const res = await fetch("/api/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (voiceRunRef.current !== run) return;
      if (res.status === 503) {
        browserSpeak(text, run);
        return;
      }
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? t("reader.voiceFailedStatus", { status: res.status }));
      }
      const blob = await res.blob();
      if (voiceRunRef.current !== run) return;
      const audio = new Audio(URL.createObjectURL(blob));
      voiceAudioRef.current = audio;
      const done = () => {
        if (voiceRunRef.current !== run) return;
        URL.revokeObjectURL(audio.src);
        voiceAudioRef.current = null;
        setVoice("idle");
      };
      audio.onended = done;
      audio.onerror = done;
      await audio.play();
      if (voiceRunRef.current === run) setVoice("playing");
    } catch (err) {
      if (voiceRunRef.current !== run) return;
      setVoice("idle");
      showError(err instanceof Error ? err.message : t("reader.voiceFailed"));
    }
  }


  // Stop the assistant chat's running turn — the popover's Run button before
  // the chat card exists, or the chat card's Send button once it does. The
  // request aborts and nothing it would have produced lands; the pending
  // user message (already shown) simply gets no reply.
  function stopAssistantChat() {
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    setAiBusy(false);
    setAssistantChat((c) => (c ? { ...c, busy: false } : c));
  }

  // When the comment field closes, the page editor takes the focus back with
  // the caret after the commented words, as its link box does (SPEC.md §29).
  function focusPageAfterComment() {
    const editor = pageEditorIn(containerRef.current);
    editor?.commands.focus(editor.state.selection.to);
  }

  // Manual annotation: highlight (color, content = quote) or comment (user text).
  // Lands ACCEPTED in the hidden Annotations section. The mark paints instantly
  // from the captured anchor; the server's copy replaces it on refresh.
  async function annotate(input: { color?: string; comment?: string }) {
    if (!popover || busy) return;
    if (input.comment !== undefined && !input.comment.trim()) return;
    const shown = popover;
    const { anchor } = popover;
    setCommentError(null);
    setToolError(null);
    await flushLiveBlock(anchor.blockId);
    markFreshAnchor(anchor);
    // Every segment of the passage paints at once, a comment as a comment.
    const optimistic = segmentsOf(anchor).map((s) => ({
      blockId: s.blockId,
      mark: { start: s.startOffset, end: s.endOffset, color: input.color ?? null, comment: !input.color },
    }));
    setLocalAnchors((prev) => {
      let next = prev;
      for (const { blockId, mark } of optimistic) next = { ...next, [blockId]: [...(next[blockId] ?? []), mark] };
      return next;
    });
    setPopover(null);
    setSubmenu(null);
    window.getSelection()?.removeAllRanges();
    // A new comment shows, and every hidden comment with it.
    if (input.comment) {
      setCommentsView("all");
      focusPageAfterComment();
    }
    setBusy(true);
    const body = {
      notebookId,
      documentId,
      anchor: anchorBody(anchor),
      ...segmentsBody(anchor),
      color: input.color,
      comment: input.comment,
    };
    // False until the server answered: a fetch that throws before then is a
    // dropped connection, which queues as offline does.
    let answered = false;
    try {
      const res = await fetch("/api/annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      answered = true;
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? t("reader.annotationFailedStatus", { status: res.status }));
      }
      // Each mark learns its stored source (one per segment, in the passage's
      // order), and one whose stored copy is already in goes.
      const note = (await res.json().catch(() => null)) as { sources?: { id: string; blockId: string }[] } | null;
      if (input.comment) madeCommentRef.current = (note?.sources ?? []).map((s) => s.id);
      if (input.comment) clearToolbarDraft("comment", documentId, anchor);
      const sources = [...(note?.sources ?? [])];
      const ids = new Map<object, string | undefined>(
        optimistic.map(({ blockId, mark }) => {
          const i = sources.findIndex((src) => src.blockId === blockIdOfKey(blockId));
          return [mark, i >= 0 ? sources.splice(i, 1)[0].id : undefined] as const;
        }),
      );
      setLocalAnchors((prev) => {
        const next: typeof prev = {};
        for (const [blockId, list] of Object.entries(prev)) {
          const stored = anchorHighlightsRef.current[blockId] ?? [];
          const kept = list
            .map((h) => (ids.get(h) ? { ...h, sourceId: ids.get(h) } : h))
            .filter((h) => !h.sourceId || !stored.some((c) => c.sourceId === h.sourceId));
          if (kept.length > 0) next[blockId] = kept;
        }
        return next;
      });
      router.refresh();
    } catch (err) {
      // Offline or a dropped connection (SPEC.md §17, Unitos Premium): a
      // highlight or comment is a non-AI annotation — queue it, keep the
      // optimistic paint, sync later, as a note's write does (lib/api.ts).
      if (offlinePremium() && (isOffline() || (!answered && err instanceof TypeError))) {
        await queueWrite("/api/annotations", "POST", body);
        if (input.comment) clearToolbarDraft("comment", documentId, anchor);
        showToast(t("reader.annotationQueuedOffline"));
        setBusy(false);
        return;
      }
      setLocalAnchors((prev) => {
        let next = prev;
        for (const { blockId, mark } of optimistic) {
          next = { ...next, [blockId]: (next[blockId] ?? []).filter((h) => h !== mark) };
        }
        return next;
      });
      const reason = err instanceof Error ? err.message : t("reader.annotationFailed");
      if (input.comment) {
        // The words are still in the draft: the box opens again with them.
        setPopover(shown);
        setSubmenu("comment");
        setCommentError({ text: reason, from: anchor });
      } else {
        // The toolbar opens again on the words, the reason under the colors.
        reportError(reason, documentId);
        setPopover(shown);
        setSubmenu(null);
        setToolError({ text: reason, from: anchor, at: "highlight" });
      }
    } finally {
      setBusy(false);
    }
  }

  // Two-ended link, phase 1: hold this selection as the first end.
  function beginLink() {
    if (!popover) return;
    void flushLiveBlock(popover.anchor.blockId);
    broadcastPendingLink({ fromDocumentId: documentId, anchor: popover.anchor });
    setPopover(null);
    setSubmenu(null);
    window.getSelection()?.removeAllRanges();
  }

  // Phase 2: an anchor is the other end — from a selection directly, or from
  // the popover's option. Both ends paint and navigate to each other; the
  // pair lists in the Annotations tab. Same-article ends are allowed.
  // top: where this end sits in the pane; the link card docks beside it.
  async function completeLinkTo(to: Anchor, top: number): Promise<boolean> {
    const pending = pendingLinkRef.current;
    if (!pending || busy) return false;
    const from = pending.anchor;
    if (
      pending.fromDocumentId === documentId &&
      from.blockId === to.blockId &&
      from.startOffset === to.startOffset
    ) {
      showToast(t("reader.samePassage"));
      return false;
    }
    setBusy(true);
    try {
      await flushLiveBlock(to.blockId);
      const created = await api<{ id: string }>("/api/links", "POST", {
        fromDocumentId: pending.fromDocumentId,
        toDocumentId: documentId,
        anchor: from,
        toAnchor: to,
      });
      broadcastPendingLink(null);
      window.getSelection()?.removeAllRanges();
      // Both ends paint at once, sweeping in, in every pane that shows one —
      // the event reaches the other pane of a split view. The server's copy
      // replaces them on refresh.
      markFreshSpan(to.blockId, to.startOffset, to.endOffset);
      if (pending.fromDocumentId === documentId) {
        markFreshSpan(from.blockId, from.startOffset, from.endOffset);
      }
      const fromTitle =
        pending.fromDocumentId === documentId
          ? title
          : (attachedDocuments.find((d) => d.id === pending.fromDocumentId)?.title ??
            t("reader.anotherDocument"));
      window.dispatchEvent(
        new CustomEvent("dissect:link-created", {
          detail: {
            linkId: created.id,
            fromDocumentId: pending.fromDocumentId,
            fromTitle,
            from,
            toDocumentId: documentId,
            toTitle: title,
            to,
          },
        }),
      );
      // The link card: what is this link about?
      const slot = claimSideSlot("link", top, to);
      setLinkCard({
        linkId: created.id,
        anchor: to,
        fromQuote: from.quotedText,
        toQuote: to.quotedText,
        ...slot,
        draft: "",
        busy: false,
      });
      router.refresh();
      showToast(t("reader.linkCreated"));
      return true;
    } catch (err) {
      showError(err instanceof Error ? err.message : t("reader.linkFailed"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function completeLink() {
    if (!popover) return;
    const done = await completeLinkTo(popover.anchor, popover.yTop);
    if (done) {
      setPopover(null);
      setSubmenu(null);
    }
  }


  // A link closed in this pane or the other one: the ends in this document
  // paint now, before the refresh delivers the server's copy.
  useEffect(() => {
    const onCreated = (e: Event) => {
      const d = (
        e as CustomEvent<{
          linkId: string;
          fromDocumentId: string;
          fromTitle: string;
          from: Anchor;
          toDocumentId: string;
          toTitle: string;
          to: Anchor;
        }>
      ).detail;
      const mine: LocalLink[] = [];
      if (d.fromDocumentId === documentIdRef.current) {
        mine.push({
          linkId: d.linkId,
          blockId: d.from.blockId,
          start: d.from.startOffset,
          end: d.from.endOffset,
          href: `/n/${notebookId}?doc=${d.toDocumentId}&link=${d.linkId}`,
          title: d.toTitle,
          reason: null,
        });
      }
      if (d.toDocumentId === documentIdRef.current) {
        mine.push({
          linkId: d.linkId,
          blockId: d.to.blockId,
          start: d.to.startOffset,
          end: d.to.endOffset,
          href: `/n/${notebookId}?doc=${d.fromDocumentId}&link=${d.linkId}`,
          title: d.fromTitle,
          reason: null,
        });
      }
      if (mine.length > 0) setLocalLinks((prev) => [...prev, ...mine]);
    };
    window.addEventListener("dissect:link-created", onCreated);
    return () => window.removeEventListener("dissect:link-created", onCreated);
  }, [notebookId]);

  // The assistant engine: command → server-validated plan → approval → the
  // normal API routes.
  async function runAssistant(commandText?: string) {
    const command = (commandText ?? aiCommandRef.current).trim();
    if (!command || aiBusy || !popover) return;
    const sent = popover;
    const { anchor } = sent;
    setAiBusy(true);
    // The question leaves the field for the line above it: the next one can
    // be typed while this one runs (SPEC.md §6).
    setAiSent({ text: command, from: anchor });
    setAiError(null);
    if (!commandText) setAiCommand("");
    const controller = new AbortController();
    chatAbortRef.current = controller;
    try {
      await flushLiveBlock(anchor.blockId);
      const turn = await assistantTurn(command, anchor, [], null, controller.signal);
      // The reader may have moved on to other words while the answer ran:
      // their toolbar and selection stay. Only the toolbar that sent the
      // question closes.
      // The reader still in its box goes on typing in the card's box.
      const inBox =
        popoverRef.current?.anchor === sent.anchor &&
        !!document.activeElement?.closest("[data-selection-popover]");
      if (popoverRef.current?.anchor === sent.anchor) {
        setPopover(null);
        setSubmenu(null);
        window.getSelection()?.removeAllRanges();
      }
      // The card opens beside the words where they are now; words the reader
      // scrolled away from get a toast that brings the card and the words back.
      const pane = containerRef.current;
      const box = pane ? passageBox(pane, anchor) : null;
      const inView =
        !pane || !box || (box.bottom > pane.scrollTop + 24 && box.top < pane.scrollTop + pane.clientHeight - 24);
      // The answer landed, so the question's draft goes (SPEC.md §6, toolbar
      // drafts) — unless the box already holds a next question typed while
      // this one ran: that one stays, or, with the reader in the box and the
      // card opening, moves into the card's box, which keeps it as its draft.
      const typed = aiCommandRef.current.trim();
      const carried = inBox && inView && turn.noteId && typed && typed !== command ? aiCommandRef.current : "";
      if (typed === "" || typed === command || carried) {
        clearToolbarDraft("assistant", documentId, anchor, command);
        if (typed === command || carried) setAiCommand("");
      }
      // The conversation continues in a chat card docked beside the article.
      markFreshAnchor(anchor);
      if (turn.noteId) addLocalAnchor(anchor, "assistant");
      const chat = (top: number): AssistantChat => ({
        anchor,
        noteId: turn.noteId,
        ...claimSideSlot("assistant", top, anchor),
        messages: [
          { role: "user", content: command },
          { role: "assistant", content: turn.reply, suggestKey: turn.suggestKey },
        ],
        input: carried,
        busy: false,
      });
      if (inView) {
        setAssistantChat(chat(box?.top ?? sent.yTop));
        if (inBox) setChatFocusTick((n) => n + 1);
      } else {
        showToast(
          t("reader.answerReady"),
          {
            label: t("reader.showCard"),
            run: () => {
              hideToast();
              const now = containerRef.current ? passageBox(containerRef.current, anchor) : null;
              // The words come into view first, at once, so the card opens
              // beside them and nothing lifts it into a pane still scrolling.
              if (now && containerRef.current) {
                containerRef.current.scrollTo({ top: Math.max(0, now.top - 120) });
              }
              setAssistantChat(chat(now?.top ?? sent.yTop));
            },
          },
          12000,
        );
      }
    } catch (err) {
      // Stopped, not failed: the question comes back to the box to edit or
      // resend, unless the reader typed a new one meanwhile.
      if (!commandText) setAiCommand((c) => (c.trim() ? c : command));
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : t("reader.assistantFailed");
      // The error shows in the box that asked; with that box gone, as a toast.
      if (popoverRef.current?.anchor === sent.anchor) {
        setAiError({ text: message, from: anchor });
        reportError(message, documentId);
      } else showError(message);
    } finally {
      if (chatAbortRef.current === controller) chatAbortRef.current = null;
      setAiBusy(false);
      setAiSent(null);
    }
  }

  // The assistant's bar (SPEC.md §29): a chip or the typed instruction runs
  // through the selection chat's request, and the answer's suggestions land
  // in the text. A follow-up takes the place of the edit still pending; a
  // turn with no suggestions (an answer, a plan) goes on in the chat card.
  // Closing the bar stops nothing: what lands stays pending, with its cards.
  const barRef = useRef(bar);
  barRef.current = bar;
  const barAbortRef = useRef<AbortController | null>(null);

  // The bar's field is a toolbar draft (SPEC.md §6, §29): each keystroke is
  // kept by the words it is on, so Escape, a press elsewhere, or a reload
  // never throws the instruction away, and the bar opens on the same words
  // with it. It goes once the command's answer lands.
  function setBarInput(input: string) {
    const open = barRef.current;
    if (open) writeToolbarDraft("assistant", documentId, open.anchor, input);
    setBar((b) => (b ? { ...b, input } : b));
  }
  // A figure's bar opens from its block, with no selection under it: its
  // words' bottom is its top.
  function openBar(
    target: Pick<Popover, "anchor" | "yTop"> & Partial<Pick<Popover, "y" | "side">>,
    figure = false,
  ): AssistantBar {
    // In the page editor the toolbox stands in the card column, pulled up to
    // fit the pane, so its place says nothing of the words': the words'
    // bottom is the selection's last line (PAGE13-03).
    const container = containerRef.current;
    const editor = figure ? null : pageEditorIn(container);
    let selectionBottom: number | null = null;
    if (container && editor && !editor.isDestroyed && !editor.state.selection.empty) {
      const bottom = editor.view.coordsAtPos(editor.state.selection.to, -1).bottom;
      selectionBottom = bottom - container.getBoundingClientRect().top + container.scrollTop;
    }
    const opened: AssistantBar = {
      key: queuedKey(),
      anchor: target.anchor,
      figure,
      yTop: target.yTop,
      wordsBottom:
        selectionBottom ?? (target.y === undefined ? target.yTop : target.y - (target.side === "below" ? 14 : 6)),
      noteId: null,
      messages: [],
      input: readToolbarDraft("assistant", documentId, target.anchor) ?? "",
      busy: false,
      error: null,
    };
    setPopover(null);
    setSubmenu(null);
    setBar(opened);
    return opened;
  }
  const openBarRef = useRef(openBar);
  openBarRef.current = openBar;

  // The image toolbar's Assistant (SPEC.md §7, words from a figure): the bar
  // opens on the image. An image has no words, so its anchor quotes none and
  // the request names the figure by its block id (assistantTurn). The page
  // editor that sent it picks this reader in a split pane.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ blockId: string; top: number; from: Element }>).detail;
      const container = containerRef.current;
      if (!detail || !container || !container.contains(detail.from)) return;
      if (!canEditRef.current) return;
      const text = blocksRef.current.find((b) => b.id === detail.blockId)?.text ?? "";
      const rect = container.getBoundingClientRect();
      openBarRef.current({
        anchor: { blockId: detail.blockId, startOffset: 0, endOffset: text.length, quotedText: text, prefix: "", suffix: "" },
        yTop: Math.max(8, detail.top - rect.top + container.scrollTop),
      }, true);
    };
    window.addEventListener(FIGURE_ASSISTANT_EVENT, onOpen);
    return () => window.removeEventListener(FIGURE_ASSISTANT_EVENT, onOpen);
  }, []);

  // The bar's edit: its last command's suggestions.
  const barRunKey = (b: AssistantBar) => b.messages.findLast((m) => m.suggestKey)?.suggestKey ?? null;

  async function runBar(current: AssistantBar, chip?: Chip) {
    const text = chip ? t(chip.key) : current.input.trim();
    if (current.busy || !text) return;
    const { key, anchor, messages, noteId } = current;
    const pending = barRunKey(current);
    const replacing = pending ? suggestRunsRef.current.get(pending)?.ids : undefined;
    const same = (b: AssistantBar | null): b is AssistantBar => b?.key === key;
    setBar({ ...current, busy: true, error: null, input: chip ? current.input : "" });
    // The passage keeps the thin mark alone while the command runs (SPEC.md
    // §6): the selection's gray fill goes as the command is sent.
    const editor = pageEditorIn(containerRef.current);
    if (editor && !editor.isDestroyed && !editor.state.selection.empty) {
      editor.commands.setTextSelection(editor.state.selection.to);
    }
    const controller = new AbortController();
    barAbortRef.current = controller;
    try {
      await flushLiveBlock(anchor.blockId);
      const turn = await assistantTurn(text, anchor, messages, noteId, controller.signal, undefined, undefined, chip?.name, replacing);
      // The instruction has its answer: its draft is done.
      if (!chip) clearToolbarDraft("assistant", documentId, anchor, text);
      if (turn.noteId) addLocalAnchor(anchor, "assistant");
      const done: AssistantBar = {
        ...current,
        noteId: turn.noteId ?? noteId,
        busy: false,
        messages: [...messages, { role: "user", content: text }, { role: "assistant", content: turn.reply, suggestKey: turn.suggestKey }],
      };
      if (turn.suggestKey) setBar((b) => (same(b) ? { ...done, input: b.input } : b));
      else if (same(barRef.current)) barToCard(done);
    } catch (err) {
      // Stopped: a typed instruction comes back to the field.
      const error = controller.signal.aborted ? null : err instanceof Error ? err.message : t("reader.assistantFailed");
      setBar((b) => (same(b) ? { ...b, busy: false, error, input: b.input || (chip ? "" : text) } : b));
    } finally {
      if (barAbortRef.current === controller) barAbortRef.current = null;
    }
  }
  const runBarRef = useRef(runBar);
  runBarRef.current = runBar;

  // The bar's conversation goes on in the chat card beside the words.
  // Words typed in the bar while the command ran go into the card's box, and
  // the reader in the bar goes on typing there.
  function barToCard(b: AssistantBar) {
    const typed = barRef.current?.key === b.key ? barRef.current.input : "";
    const inBar = !!document.activeElement?.closest("[data-assistant-bar]");
    setBar(null);
    const slot = claimSideSlot("assistant", b.yTop, b.anchor);
    setAssistantChat({ anchor: b.anchor, noteId: b.noteId, ...slot, messages: b.messages, input: typed, busy: false });
    if (inBar) setChatFocusTick((n) => n + 1);
  }

  // The bar never covers the words it acts on (SPEC.md §29): when it opens
  // over them, the pane scrolls until their last line stands 16px above the
  // bar, and the suggestions land in view.
  const barOpenKey = bar?.key ?? null;
  useEffect(() => {
    if (!barOpenKey) return;
    const raf = requestAnimationFrame(() => {
      const container = containerRef.current;
      // The bar stands at the pane's foot, beside the scroller, not in it.
      const el = container?.parentElement?.querySelector<HTMLElement>("[data-assistant-bar]");
      const current = barRef.current;
      if (!container || !el || !current) return;
      const crect = container.getBoundingClientRect();
      const wordsBottom = current.wordsBottom - container.scrollTop + crect.top;
      const over = wordsBottom - (el.getBoundingClientRect().top - 16);
      if (over > 0) container.scrollBy({ top: over, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(raf);
  }, [barOpenKey]);

  // A press anywhere but the bar closes it.
  const barOpen = bar !== null;
  useEffect(() => {
    if (!barOpen) return;
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest("[data-assistant-bar]")) return;
      setBar(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [barOpen]);

  // One assistant turn: command + history → reply text. Plans route through the
  // plan card, and the chat narrates it.
  async function assistantTurn(
    command: string,
    anchor: Anchor | null,
    history: ChatMessage[],
    conversationNoteId: string | null,
    signal?: AbortSignal,
    // A tool conversation (SPEC.md §21): the turn continues from the tool's
    // annotation; the server takes the selection and the turns from it.
    toolNoteId?: string,
    // A side chat (SPEC.md §7): the conversation it branched from and the
    // quote it started on. Its turns persist on a note of its own.
    sideChat?: { of: string; quote: string },
    // A command chip (SPEC.md §29): the act route runs it with no chat model.
    suggestCommand?: SuggestCommand,
    // A follow-up's suggestions take the place of these, still pending.
    replacing?: readonly string[],
  ): Promise<{ reply: string; noteId: string | null; suggestKey?: string }> {
    // A figure with no words (an image) has no quote to anchor to: the
    // request names it by its block id (SPEC.md §7, words from a figure).
    const figureOnly = anchor && !toolNoteId && !anchor.quotedText ? anchor.blockId : undefined;
    const res = await aiFetch("/api/assistant/act", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        notebookId,
        documentId,
        command,
        anchor: anchor && !toolNoteId && !figureOnly ? anchorBody(anchor) : undefined,
        ...(anchor && !toolNoteId && !figureOnly ? segmentsBody(anchor) : {}),
        figureBlockId: figureOnly,
        history: history.slice(-12).map(({ role, content }) => ({ role, content })),
        conversationNoteId: conversationNoteId ?? undefined,
        toolNoteId,
        sideChatOf: sideChat?.of,
        sideChatQuote: sideChat?.quote,
        suggestCommand,
        thinking,
        web,
      }),
    });
    const plan = (await res.json().catch(() => null)) as
      | (AssistantPlan & { suggestions?: SuggestResult; error?: string })
      | null;
    if (!res.ok || !plan)
      throw new Error(plan?.error ?? t("reader.assistantFailedStatus", { status: res.status }));
    const parts: string[] = [];
    if (plan.reply) parts.push(plan.reply);
    // Words for under a figure wait there as the assistant's suggestion.
    const actions = offerFigureSuggestions(plan.actions);
    if (actions.length < plan.actions.length) parts.push(t("reader.figureSuggestionOffered"));
    if (actions.length > 0) {
      const n = actions.length;
      // Every plan waits for approval (SPEC.md §1: nothing applies unaccepted).
      const planThread = toolNoteId ?? plan.conversationNoteId ?? conversationNoteId;
      parkPlan(planThread);
      parkedPlansRef.current.delete(planThread ?? "");
      setAiPlan({ ...plan, actions });
      setPlanChecked(new Set(actions.map((_, i) => i)));
      setPlanFrom(toolNoteId ? "tool" : "chat");
      setPlanNoteId(planThread);
      // The plan under the answer and its Apply say the count; a plan with
      // no reply says it in the turn.
      if (!plan.reply) parts.push(t("assistant.proposedActions", { n, s: plural(n) }));
    }
    // The assistant's suggestions land in the text: pending by construction
    // until an editor accepts them.
    const suggestKey = plan.suggestions
      ? await landSuggestions(plan.suggestions, anchor ? `${command}\n\n${passageText(anchor)}` : command, replacing)
      : undefined;
    if (suggestKey && anchor) collapseSelectionAfterLanding(suggestKey);
    if (parts.length === 0) parts.push(plan.suggestions?.summary || (plan.warnings[0] ?? t("reader.noActions")));
    // The anchored conversation persisted server-side; refresh paints its mark.
    if (plan.conversationNoteId) router.refresh();
    return { reply: parts.join("\n\n"), noteId: plan.conversationNoteId ?? null, suggestKey };
  }

  // The assistant's suggestions (SPEC.md §29): every command's run, by key.
  // The rows under its turn (suggestion-row.tsx) read what publishRun gives
  // them; the count follows the text as anyone accepts or rejects one.
  const suggestRunsRef = useRef(new Map<string, SuggestionRun>());
  const suggestWatchRef = useRef<{ editor: Editor; off: () => void } | null>(null);
  // Once this reader closes, its runs keep their count and lose their buttons.
  const readerClosedRef = useRef(false);

  function publishRun(key: string) {
    const run = suggestRunsRef.current.get(key);
    if (!run) return;
    publishSuggestRun(key, {
      running: run.running,
      count: run.count,
      skipped: [...run.skipped],
      notes: [...run.notes],
      summary: run.summary,
      rating: {
        input: run.input,
        output: `${run.summary}\n\n${JSON.stringify(run.ops)}`.slice(0, 12_000),
        notebookId,
        documentId,
      },
      act: readerClosedRef.current
        ? undefined
        : { stop: () => run.controller?.abort(), review: () => reviewRun(run), settle: (accept) => void settleRun(run, accept) },
    });
  }

  function startRun(key: string, input: string, controller: AbortController | null): SuggestionRun {
    const run: SuggestionRun = { input, ops: [], ids: [], count: 0, skipped: [], notes: [], summary: "", running: true, controller };
    suggestRunsRef.current.set(key, run);
    publishRun(key);
    return run;
  }

  // Ops land as the assistant's suggestions, authored for this reader (the
  // page switches Viewing mode to Editing to show them).
  async function landOps(key: string, ops: ResolvedOp[], warnings: string[], replacing: readonly string[] = []) {
    const run = suggestRunsRef.current.get(key);
    const editor = pageEditorIn(containerRef.current);
    if (!run || !editor) return;
    run.skipped.push(...warnings);
    // An import another account's project holds too takes no edits: nothing
    // lands, and the row says why.
    const shared = t("api.importShared");
    if (richTextRef.current?.imported?.shared) {
      if (ops.length > 0 && !run.notes.includes(shared)) run.notes.push(shared);
    } else if (ops.length > 0) {
      const code = await suggestCode();
      if (editor.isDestroyed) return;
      const landed = code.applyAssistantOps(editor, ops, assistantAuthor(myId), replacing);
      run.ops.push(...ops);
      run.ids.push(...landed.ids);
      // The page's own skips read as the server's: the words changed, or hold an object.
      for (const { i, reason } of landed.skipped) {
        const why = ops.find((op) => op.i === i)?.why ?? "";
        run.skipped.push(
          t(reason === "object" ? "docsSuggest.skipObject" : reason === "overlap" ? "api.suggestSkipOverlap" : "docsSuggest.skipChanged", { why }),
        );
      }
      watchRuns(editor, code.readSuggestions);
      run.count = countRun(run, code.readSuggestions(editor.state.doc));
    }
    publishRun(key);
  }

  // One answer's suggestions from the act route: a chip, or a typed command
  // the assistant turned into suggestions.
  async function landSuggestions(result: SuggestResult, input: string, replacing?: readonly string[]): Promise<string> {
    const key = queuedKey();
    const run = startRun(key, input, null);
    run.summary = result.summary;
    await landOps(key, result.ops, result.warnings, replacing);
    run.running = false;
    publishRun(key);
    return key;
  }

  // A command on selected words landed suggestions in the page editor: the
  // selection collapses to its end. The reader picked the passage to have it
  // changed, not to keep it selected, and the moment the page takes the focus
  // back a long passage drawn blue over the suggestions in the assistant's
  // color is a block of color over the very words to review. The caret lands
  // after the passage, where the page's own commands leave it; the page is
  // not focused, so nothing scrolls. A plain answer lands no suggestion and
  // moves nothing; the panel's command over the document (suggestDocument)
  // runs on no selection and never comes here.
  function collapseSelectionAfterLanding(key: string) {
    const run = suggestRunsRef.current.get(key);
    const editor = pageEditorIn(containerRef.current);
    if (!run || run.ids.length === 0 || !editor || editor.isDestroyed) return;
    const { selection } = editor.state;
    if (selection.empty) return;
    editor.commands.setTextSelection(selection.to);
  }

  function countRun(run: SuggestionRun, present: readonly { id: string }[]): number {
    const ids = new Set(present.map((s) => s.id));
    return run.ids.filter((id) => ids.has(id)).length;
  }

  // While runs are held, every change of the text recounts them.
  function watchRuns(editor: Editor, read: (doc: Editor["state"]["doc"]) => readonly { id: string }[]) {
    if (suggestWatchRef.current?.editor === editor) return;
    suggestWatchRef.current?.off();
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return;
      const present = read(editor.state.doc);
      for (const [key, run] of suggestRunsRef.current) {
        const count = countRun(run, present);
        if (count === run.count) continue;
        run.count = count;
        publishRun(key);
      }
    };
    editor.on("transaction", onTransaction);
    suggestWatchRef.current = { editor, off: () => editor.off("transaction", onTransaction) };
  }

  // Review suggested edits over this command's suggestions, the first one selected.
  function reviewRun(run: SuggestionRun) {
    pageEditorIn(containerRef.current)?.view.dom.dispatchEvent(
      new CustomEvent("docs:review-suggestions", { detail: { ids: run.ids } }),
    );
  }

  // Accept all or Reject all of this command: one undo step.
  async function settleRun(run: SuggestionRun, accept: boolean) {
    const editor = pageEditorIn(containerRef.current);
    if (!editor) return;
    const { settleSuggestions } = await suggestCode();
    settleSuggestions(editor, accept, run.ids);
  }

  // The panel's command over this document (SPEC.md §29): the suggest route
  // answers one window at a time, and each window's ops land as it arrives.
  // Stop keeps what landed; another document opening stops the run.
  async function suggestDocument(request: SuggestRequest) {
    const controller = new AbortController();
    const run = startRun(request.key, `${request.command}\n\n${request.instruction}`, controller);
    // An import another account's project holds too takes no edits.
    if (richTextRef.current?.imported?.shared) {
      run.notes.push(t("api.importShared"));
      run.running = false;
      run.controller = null;
      publishRun(request.key);
      return;
    }
    try {
      await flushEditRef.current?.();
      const caret = pageEditorIn(containerRef.current)?.state.selection.$from.parent.attrs.blockId;
      const res = await aiFetch(`/api/documents/${documentId}/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          notebookId,
          command: request.command,
          instruction: request.instruction,
          blockIds: request.blockIds,
          reorder: request.reorder,
          caretBlockId: typeof caret === "string" && caret ? caret : undefined,
          material: request.material,
          history: request.history,
          thinking,
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error ?? t("assistant.suggestFailedStatus", { status: res.status }));
      }
      for await (const event of readNdjson<SuggestEvent>(res)) {
        if ("ops" in event) {
          // The windows' summaries until the run's own: a stopped run keeps them.
          if (event.ops.length > 0) run.summary = [run.summary, event.summary].filter(Boolean).join(" ");
          await landOps(request.key, event.ops, event.warnings);
        } else if ("done" in event) {
          run.summary = event.summary;
          run.notes.push(...event.warnings);
        } else if ("error" in event) run.notes.push(event.error);
      }
    } catch (err) {
      if (!controller.signal.aborted) run.notes.push(err instanceof Error ? err.message : t("reader.assistantFailed"));
    } finally {
      run.running = false;
      run.controller = null;
      publishRun(request.key);
    }
  }
  const suggestDocumentRef = useRef(suggestDocument);
  suggestDocumentRef.current = suggestDocument;
  useEffect(() => {
    const onSuggest = (e: Event) => {
      const request = (e as CustomEvent<SuggestRequest>).detail;
      if (request.documentId !== documentId || !richTextRef.current) return;
      // One pane takes the command: a split view may show this document twice.
      e.stopImmediatePropagation();
      void suggestDocumentRef.current(request);
    };
    window.addEventListener(SUGGEST_EVENT, onSuggest);
    return () => window.removeEventListener(SUGGEST_EVENT, onSuggest);
  }, [documentId]);
  // The reader closes: every run stops, and keeps what landed.
  useEffect(() => {
    readerClosedRef.current = false;
    const runs = suggestRunsRef.current;
    return () => {
      readerClosedRef.current = true;
      suggestWatchRef.current?.off();
      suggestWatchRef.current = null;
      for (const [key, run] of runs) {
        run.controller?.abort();
        run.running = false;
        publishRun(key);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The side chat on screen in the card, and the note the open thread saves
  // on: what a comment is written under.
  // The queues drain one message per finished answer, in order — after a
  // Stop too: a queued message was sent to go out next (SPEC.md §7).
  const chatQueueHead = assistantChat && !assistantChat.busy ? (assistantChat.queue?.[0] ?? null) : null;
  useEffect(() => {
    if (chatQueueHead) void sendChatMessage(chatQueueHead);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatQueueHead]);
  const explainQueueHead = bubble && !bubble.busy && !bubble.streaming ? (bubble.queue[0] ?? null) : null;
  useEffect(() => {
    if (explainQueueHead) void sendToolMessage("explain", explainQueueHead);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explainQueueHead]);
  const simplifyQueueHead = simplifyCard && !simplifyCard.busy && !simplifyCard.streaming ? (simplifyCard.queue[0] ?? null) : null;
  useEffect(() => {
    if (simplifyQueueHead) void sendToolMessage("simplify", simplifyQueueHead);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simplifyQueueHead]);
  const removeQueuedChat = (key: string) =>
    setAssistantChat((c) => (c ? { ...c, queue: (c.queue ?? []).filter((q) => q.key !== key) } : c));
  const removeQueuedTool = (kind: "explain" | "simplify", key: string) =>
    setToolChat(kind, (c) => ({ queue: c.queue.filter((q) => q.key !== key) }));

  const chatOpenSide = assistantChat?.openKey
    ? ((assistantChat.sideChats ?? []).find((s) => s.key === assistantChat.openKey) ?? null)
    : null;
  const chatNoteId = chatOpenSide ? chatOpenSide.noteId : (assistantChat?.noteId ?? null);
  // The thread on screen has a plan waiting: it comes back, and the plan it
  // replaces waits under its own thread (TOOL13-03).
  useEffect(() => {
    if (!chatNoteId || (aiPlan && planNoteId === chatNoteId)) return;
    const parked = parkedPlansRef.current.get(chatNoteId);
    if (!parked) return;
    parkedPlansRef.current.delete(chatNoteId);
    parkPlan(chatNoteId);
    setAiPlan(parked.plan);
    setPlanChecked(parked.checked);
    setPlanFrom(parked.from);
    setPlanNoteId(chatNoteId);
  }, [chatNoteId, aiPlan, planNoteId]);
  // A comment on an answer keeps its draft by the thread's note and the quote.
  const chatCommentKey = chatNoteId && chatCommentQuote ? cardCommentKey(chatNoteId, chatCommentQuote) : null;
  // The comment box closes with its card; its words wait in the draft for
  // the same words of the answer.
  if (assistantChat === null && chatCommentQuote !== null) setChatCommentQuote(null);

  // A conversation reopened from its mark brings its side chats with it.
  useEffect(() => {
    const noteId = assistantChat?.noteId ?? null;
    if (!noteId || sideChatsLoadedFor.current === noteId) return;
    sideChatsLoadedFor.current = noteId;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/assistant/conversation?noteId=${encodeURIComponent(noteId)}`);
        const json = (await res.json().catch(() => null)) as {
          sideChats?: { id: string; quote: string; turns: ChatMessage[] }[];
        } | null;
        if (cancelled || !res.ok || !json?.sideChats) return;
        const loaded: ReaderSideChat[] = json.sideChats.map((s) => ({
          key: s.id,
          noteId: s.id,
          quote: s.quote,
          messages: s.turns,
        }));
        setAssistantChat((c) => {
          if (!c || c.noteId !== noteId) return c;
          // A side chat started in this card and not yet saved keeps its place.
          const unsaved = (c.sideChats ?? []).filter((s) => !s.noteId);
          return { ...c, sideChats: [...loaded, ...unsaved] };
        });
      } catch {
        // Offline: the conversation reads the same, with no side chats listed.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assistantChat?.noteId]);

  // The comments under the open thread.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!chatNoteId) {
        setChatComments([]);
        return;
      }
      try {
        const res = await fetch(`/api/replies?noteId=${encodeURIComponent(chatNoteId)}`);
        const json = (await res.json().catch(() => null)) as {
          replies?: AnswerComment[];
          people?: Record<string, Person>;
        } | null;
        if (cancelled || !res.ok || !json) return;
        setChatComments(json.replies ?? []);
        setChatCommentPeople(json.people ?? {});
      } catch {
        // Offline: the thread reads the same, with no comments under it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chatNoteId]);

  // The selection's three actions in the card, the panel's three.
  // The browser's own selection goes — the box that opens takes focus — and
  // the words stay marked by the tint until the reader is done with them.
  function takeAnswerSelection(): string {
    return holdAnswerSelection();
  }
  // The quote goes, and the words it marked stop being marked.
  function dropChatQuote() {
    setAssistantChat((c) => (c ? { ...c, quote: null } : c));
    clearAnswerSelection();
  }
  function startChatSideChat() {
    const text = takeAnswerSelection();
    if (!text || !assistantChat?.noteId) return;
    const key = `side-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setAssistantChat((c) =>
      c
        ? {
            ...switchThread(
              { ...c, sideChats: [...(c.sideChats ?? []), { key, noteId: null, quote: text, messages: [] }] },
              key,
            ),
            quote: text,
          }
        : c,
    );
    setChatCommentQuote(null);
    setChatFocusTick((n) => n + 1);
  }
  function askAboutThisInChat() {
    const text = takeAnswerSelection();
    if (!text) return;
    setAssistantChat((c) => (c ? { ...c, quote: text } : c));
    setChatCommentQuote(null);
    setChatFocusTick((n) => n + 1);
  }
  function openChatComment() {
    const text = takeAnswerSelection();
    if (!text || !chatNoteId) return;
    setChatCommentQuote(text);
  }
  async function postChatComment(text: string) {
    if (!chatNoteId || chatCommentBusy) return;
    setChatCommentBusy(true);
    try {
      const res = await fetch("/api/replies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteId: chatNoteId, content: quoteMessage(chatCommentQuote ?? "", text) }),
      });
      const json = (await res.json().catch(() => null)) as (AnswerComment & { error?: string }) | null;
      if (!res.ok || !json?.id) throw new Error(json?.error ?? t("assistant.commentFailed"));
      // Posted: the comment's draft is done.
      setCardDraft(cardCommentKey(chatNoteId, chatCommentQuote ?? ""), null);
      setChatComments((list) => [...list, json]);
      setChatCommentQuote(null);
      clearAnswerSelection();
      // The Annotations tab lists the comment under the conversation.
      router.refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : t("assistant.commentFailed"));
    } finally {
      setChatCommentBusy(false);
    }
  }
  async function deleteChatComment(id: string) {
    setChatComments((list) => list.filter((c) => c.id !== id));
    try {
      await fetch(`/api/replies/${id}`, { method: "DELETE" });
    } catch {
      // Offline: the row is gone on screen and stays on the server; the next
      // load of the thread shows it again.
    }
  }

  // A message of the assistant card that did not go (a failed request, Stop,
  // offline): its words go back to the box of the thread it was sent in, with
  // the reason under the box; with the card closed, to the thread's draft
  // (rule zero: typed words are kept until the server has them).
  function returnChatWords(
    sentFrom: { noteId: string | null; openKey: string | null; sideNoteId: string | null },
    text: string,
    typed: string,
    quote: string | null,
    error: string | null,
  ) {
    const open = assistantChatRef.current;
    const sameCard =
      open !== null &&
      (open.noteId === sentFrom.noteId || (sentFrom.noteId === null && open.anchor !== null)) &&
      (sentFrom.openKey === null || (open.sideChats ?? []).some((s) => s.key === sentFrom.openKey));
    if (!sameCard) {
      const key = sentFrom.openKey ? sentFrom.sideNoteId : sentFrom.noteId;
      if (key) returnToCardDraft(key, text);
      return;
    }
    setAssistantChat((c) => {
      if (!c) return c;
      const key = sentFrom.openKey;
      const unsent: AssistantChat = key
        ? {
            ...c,
            sideChats: (c.sideChats ?? []).map((s) => (s.key === key ? { ...s, messages: withoutSent(s.messages, text) } : s)),
          }
        : { ...c, messages: withoutSent(c.messages, text) };
      const back = { ...unsent, busy: false };
      // The thread on screen takes the words (and the quote they were on);
      // another thread keeps them for when it opens.
      if ((c.openKey ?? null) === key) {
        return { ...back, input: joinWords(typed, c.input), quote: quote ?? c.quote ?? null, sendError: error };
      }
      return { ...back, inputs: { ...c.inputs, [key ?? ""]: joinWords(text, c.inputs?.[key ?? ""] ?? "") } };
    });
  }

  async function sendChatMessage(queued?: QueuedText & { openKey: string | null }) {
    const chat = assistantChat;
    const typed = queued ? queued.content : chat?.input.trim();
    if (!chat || !typed) return;
    // While an answer runs the message queues (SPEC.md §7); a queued message
    // sends once the answer lands, into the thread it was queued for.
    if (chat.busy && !queued) {
      const content = chat.quote ? quoteMessage(chat.quote, typed) : typed;
      if (chat.quote) clearAnswerSelection();
      setAssistantChat((c) =>
        c
          ? {
              ...c,
              input: "",
              quote: null,
              sendError: null,
              queue: [...(c.queue ?? []), { key: queuedKey(), content, openKey: c.openKey ?? null }],
            }
          : c,
      );
      return;
    }
    if (chat.busy) return;
    // Offline nothing goes: the words stay in the box, and the box says why
    // (SPEC.md §17). A queued message comes back to its thread's box.
    if (isOffline()) {
      const offline = t("common.offlineAi");
      if (queued) {
        setAssistantChat((c) => (c ? { ...c, queue: (c.queue ?? []).filter((q) => q.key !== queued.key) } : c));
        returnChatWords(
          { noteId: chat.noteId, openKey: queued.openKey, sideNoteId: (chat.sideChats ?? []).find((s) => s.key === queued.openKey)?.noteId ?? null },
          queued.content,
          queued.content,
          null,
          offline,
        );
      } else setAssistantChat((c) => (c ? { ...c, sendError: offline } : c));
      return;
    }
    // The quote the reader took from an answer rides in the message.
    const text = queued ? queued.content : chat.quote ? quoteMessage(chat.quote, typed) : typed;
    const openKey = queued ? queued.openKey : (chat.openKey ?? null);
    const open = openKey ? (chat.sideChats ?? []).find((s) => s.key === openKey) ?? null : null;
    if (openKey && !open) return;
    const history = open ? open.messages : chat.messages;
    // A side chat needs the conversation it branched from; without a saved
    // note there is nothing to branch from.
    if (open && !chat.noteId) return;
    if (chat.quote && !queued) clearAnswerSelection();
    const queue = queued ? (chat.queue ?? []).filter((q) => q.key !== queued.key) : chat.queue;
    const pushUser = (c: AssistantChat): AssistantChat =>
      open
        ? {
            ...c,
            ...(queued ? { queue } : { input: "", quote: null }),
            busy: true,
            sendError: null,
            sideChats: (c.sideChats ?? []).map((s) =>
              s.key === open.key ? { ...s, messages: [...s.messages, { role: "user", content: text }] } : s,
            ),
          }
        : {
            ...c,
            ...(queued ? { queue } : { input: "", quote: null }),
            busy: true,
            sendError: null,
            messages: [...c.messages, { role: "user", content: text }],
          };
    setAssistantChat((c) => (c ? pushUser(c) : c));
    const controller = new AbortController();
    chatAbortRef.current = controller;
    // A follow-up's suggestions take the place of the thread's pending ones.
    const pending = history.findLast((m) => m.suggestKey)?.suggestKey;
    try {
      const turn = await assistantTurn(
        text,
        chat.anchor,
        history,
        open ? open.noteId : chat.noteId,
        controller.signal,
        undefined,
        open && chat.noteId ? { of: chat.noteId, quote: open.quote } : undefined,
        undefined,
        pending ? suggestRunsRef.current.get(pending)?.ids : undefined,
      );
      if (turn.noteId && chat.anchor && !open) addLocalAnchor(chat.anchor, "assistant");
      setAssistantChat((c) => {
        if (!c) return c;
        if (open) {
          return {
            ...c,
            busy: false,
            sideChats: (c.sideChats ?? []).map((s) =>
              s.key === open.key
                ? {
                    ...s,
                    noteId: turn.noteId ?? s.noteId,
                    messages: [...s.messages, { role: "assistant", content: turn.reply, suggestKey: turn.suggestKey }],
                  }
                : s,
            ),
          };
        }
        return {
          ...c,
          busy: false,
          noteId: turn.noteId ?? c.noteId,
          messages: [...c.messages, { role: "assistant", content: turn.reply, suggestKey: turn.suggestKey }],
        };
      });
    } catch (err) {
      // Stopped or failed: nothing was stored, so the words go back to the
      // box (Stop says nothing more; a failure says why).
      const message = controller.signal.aborted
        ? null
        : err instanceof Error
          ? err.message
          : t("reader.assistantFailed");
      returnChatWords(
        { noteId: chat.noteId, openKey, sideNoteId: open?.noteId ?? null },
        text,
        queued ? text : typed,
        queued ? null : (chat.quote ?? null),
        message,
      );
    } finally {
      if (chatAbortRef.current === controller) chatAbortRef.current = null;
    }
  }

  // A tool conversation (SPEC.md §21): Continue opens the box at the bottom
  // of the Explain, Analyze, Visualize, or Simplify card; the card becomes
  // Explain+ (Simplify+, …) and every turn goes deeper on the output. The
  // turns persist on the tool's annotation, so the card reopens with them
  // and the mark's symbol gains its plus.
  // The turns sent this session, by the tool annotation's note id: what a
  // reopened card shows until the refresh delivers the server's copy.
  const toolConversationsRef = useRef<Record<string, ChatTurn[]>>({});
  // noteId: change the card only while it shows that annotation; a card
  // reopened on other words since is another conversation.
  function setToolChat(
    kind: "explain" | "simplify",
    update: (c: ToolChat) => Partial<ToolChat>,
    noteId?: string,
  ) {
    const mine = (c: { noteId: string | null }) => noteId === undefined || c.noteId === noteId;
    if (kind === "explain") setBubble((b) => (b && mine(b) ? { ...b, ...update(b) } : b));
    else setSimplifyCard((c) => (c && mine(c) ? { ...c, ...update(c) } : c));
  }
  // A message that did not go (a failed request, Stop, offline): its words
  // go back to the box of the card it was sent from, with the reason under
  // the box; with that card closed, to the card's draft, which its mark
  // opens with (rule zero: typed words are kept until the server has them).
  function returnToolWords(kind: "explain" | "simplify", noteId: string, text: string, error: string | null) {
    const open = kind === "explain" ? bubbleRef.current : simplifyCardRef.current;
    if (open?.noteId !== noteId) {
      returnToCardDraft(noteId, text);
      return;
    }
    setToolChat(
      kind,
      (c) => ({
        busy: false,
        sendError: error,
        conversation: withoutSent(c.conversation, text),
        input: joinWords(text, c.input),
      }),
      noteId,
    );
  }
  // Continuing a tool's output into a conversation is Unitos Ultra (TIERS.md):
  // the button and the box are offered to every account, and a non-Ultra
  // press answers with the plain Ultra message, like Visualize.
  function openToolChat(kind: "explain" | "simplify") {
    if (!ultra) {
      showToast(t("reader.continueNeedsUltra"), plansAction);
      return;
    }
    setToolChat(kind, () => ({ chatOpen: true }));
  }
  function stopToolChat(kind: "explain" | "simplify") {
    toolChatAbortRef.current[kind]?.abort();
    toolChatAbortRef.current[kind] = null;
    setToolChat(kind, () => ({ busy: false }));
  }
  async function sendToolMessage(kind: "explain" | "simplify", queued?: QueuedText) {
    if (!ultra) {
      showToast(t("reader.continueNeedsUltra"), plansAction);
      return;
    }
    const card = kind === "explain" ? bubble : simplifyCard;
    const text = queued ? queued.content : card?.input.trim();
    if (!card || !text || !card.noteId) return;
    const noteId = card.noteId;
    // While a turn runs the message queues (SPEC.md §7).
    if ((card.busy || card.streaming) && !queued) {
      setToolChat(kind, (c) => ({ input: "", sendError: null, queue: [...c.queue, { key: queuedKey(), content: text }] }), noteId);
      return;
    }
    if (card.busy || card.streaming) return;
    // Offline nothing goes: the words stay in the box, and the box says why
    // (SPEC.md §17). A queued message waits in the queue.
    if (isOffline()) {
      if (queued) {
        setToolChat(kind, (c) => ({ queue: c.queue.filter((q) => q.key !== queued.key), input: joinWords(text, c.input), sendError: t("common.offlineAi") }), noteId);
      } else setToolChat(kind, () => ({ sendError: t("common.offlineAi") }), noteId);
      return;
    }
    const history = card.conversation;
    setToolChat(
      kind,
      (c) => ({
        ...(queued ? { queue: c.queue.filter((q) => q.key !== queued.key) } : { input: "" }),
        busy: true,
        chatOpen: true,
        sendError: null,
        conversation: [...c.conversation, { role: "user", content: text }],
      }),
      noteId,
    );
    const controller = new AbortController();
    toolChatAbortRef.current[kind] = controller;
    try {
      const turn = await assistantTurn(text, card.anchor, history, null, controller.signal, noteId);
      // The turn is stored on the annotation; the card shows it if open.
      toolConversationsRef.current[noteId] = [
        ...history,
        { role: "user", content: text },
        { role: "assistant", content: turn.reply },
      ];
      setToolChat(
        kind,
        (c) => {
          const conversation: ChatTurn[] = [...c.conversation, { role: "assistant", content: turn.reply }];
          toolConversationsRef.current[noteId] = conversation;
          return { busy: false, conversation };
        },
        noteId,
      );
    } catch (err) {
      // Stopped or failed: nothing was stored, so the words go back to the
      // box (Stop says nothing more; a failure says why).
      const message = controller.signal.aborted
        ? null
        : err instanceof Error
          ? err.message
          : t("reader.assistantFailed");
      returnToolWords(kind, noteId, text, message);
    } finally {
      if (toolChatAbortRef.current[kind] === controller) toolChatAbortRef.current[kind] = null;
    }
  }

  // How long the Undo toast stays after the plan's actions run.
  const UNDO_MS = 8000;

  // Every applied action records the request that takes it back; Undo runs
  // them newest first. A block's text and kind come from the article as it
  // is now; the rest from the ids the write routes return.
  async function executePlan(actions: AssistantAction[], warnings: string[] = []): Promise<boolean> {
    // The routes edit what is stored: typing on screen is saved first.
    await flushEditRef.current?.();
    const sectionIdByTitle = new Map(
      sectionChoices.map((c) => [c.label.toLowerCase(), c.id] as const),
    );
    const undo: { description: string; run: () => Promise<unknown> }[] = [];
    let applied = 0;
    const failed: string[] = [];
    // A block as the plan's earlier actions left it: the routes answer with it.
    const changed = new Map<string, BlockData>();
    const current = (id: string) => changed.get(id) ?? blocks.find((b) => b.id === id);
    // New blocks after one block land in the plan's order: each after the one before.
    const lastInserted = new Map<string, string>();
    for (const action of actions) {
      try {
        switch (action.type) {
          case "add_section": {
            const created = await api<{ id: string }>("/api/sections", "POST", {
              notebookId,
              title: action.title,
              parentId: null,
            });
            sectionIdByTitle.set(action.title.toLowerCase(), created.id);
            undo.push({ description: action.description, run: () => api(`/api/sections/${created.id}`, "DELETE") });
            break;
          }
          case "edit_block": {
            const before = current(action.blockId)?.text ?? null;
            const saved = await api<BlockData>(`/api/blocks/${action.blockId}`, "PATCH", { text: action.newText });
            changed.set(action.blockId, saved);
            if (before !== null) {
              undo.push({
                description: action.description,
                run: () => api(`/api/blocks/${action.blockId}`, "PATCH", { text: before }),
              });
            }
            break;
          }
          case "insert_paragraph": {
            const place = action.afterBlockId ?? "";
            const created = await api<{ id: string }>("/api/blocks", "POST", {
              documentId,
              afterBlockId: lastInserted.get(place) ?? action.afterBlockId,
              text: action.text,
              ...(action.kind ? { kind: action.kind } : {}),
            });
            lastInserted.set(place, created.id);
            undo.push({ description: action.description, run: () => api(`/api/blocks/${created.id}`, "DELETE") });
            break;
          }
          case "move_block": {
            // The answer names the block it stood after: Undo moves it back.
            const moved = await api<{ previousAfterBlockId: string | null }>(`/api/blocks/${action.blockId}/move`, "POST", {
              afterBlockId: action.afterBlockId,
            });
            undo.push({
              description: action.description,
              run: () => api(`/api/blocks/${action.blockId}/move`, "POST", { afterBlockId: moved.previousAfterBlockId }),
            });
            break;
          }
          case "remove_block": {
            const removed = await api<{ editId: string }>(`/api/blocks/${action.blockId}`, "DELETE");
            undo.push({
              description: action.description,
              run: () => api("/api/blocks/restore", "POST", { editId: removed.editId }),
            });
            break;
          }
          case "highlight": {
            const note = await api<{ id: string }>("/api/annotations", "POST", {
              notebookId,
              documentId,
              anchor: action.anchor,
              color: action.color,
              comment: action.comment,
            });
            undo.push({ description: action.description, run: () => api(`/api/notes/${note.id}`, "DELETE") });
            break;
          }
          case "comment": {
            const note = await api<{ id: string }>("/api/annotations", "POST", {
              notebookId,
              documentId,
              anchor: action.anchor,
              comment: action.comment,
            });
            undo.push({ description: action.description, run: () => api(`/api/notes/${note.id}`, "DELETE") });
            break;
          }
          case "add_note": {
            let sectionId =
              action.sectionId ??
              (action.sectionTitle
                ? sectionIdByTitle.get(action.sectionTitle.toLowerCase())
                : undefined);
            if (!sectionId) {
              const title = action.sectionTitle ?? t("reader.defaultSectionTitle");
              const created = await api<{ id: string }>("/api/sections", "POST", {
                notebookId,
                title,
                parentId: null,
              });
              sectionId = created.id;
              sectionIdByTitle.set(title.toLowerCase(), created.id);
              undo.push({ description: action.description, run: () => api(`/api/sections/${created.id}`, "DELETE") });
            }
            // Assistant notes carry their authorship. The plan was approved,
            // so the note lands accepted (SPEC.md §1).
            const note = await api<{ id: string }>("/api/notes", "POST", {
              sectionId,
              content: action.content,
              source: action.source,
              origin: "assistant",
              pending: false,
            });
            undo.push({ description: action.description, run: () => api(`/api/notes/${note.id}`, "DELETE") });
            break;
          }
          case "link": {
            if (action.href !== undefined) {
              // A web address on the words: the answer names the address
              // they had before, and Undo puts it back ("" takes it off).
              const range = { startOffset: action.anchor.startOffset, endOffset: action.anchor.endOffset };
              const linked = await api<{ previous: string | null }>(`/api/blocks/${action.anchor.blockId}/link`, "POST", {
                ...range,
                href: action.href,
              });
              undo.push({
                description: action.description,
                run: () => api(`/api/blocks/${action.anchor.blockId}/link`, "POST", { ...range, href: linked.previous ?? "" }),
              });
              break;
            }
            const link = await api<{ id: string }>("/api/links", "POST", {
              fromDocumentId: documentId,
              toDocumentId: action.toDocumentId,
              anchor: action.anchor,
            });
            undo.push({ description: action.description, run: () => api(`/api/links/${link.id}`, "DELETE") });
            break;
          }
          case "format_block": {
            // A list's markers change with its kind (the route writes them),
            // so Undo sends the text back with the kind.
            const block = current(action.blockId);
            const before = block ? formatKind(block.type, block.html, block.text) : null;
            const saved = await api<BlockData>(`/api/blocks/${action.blockId}`, "PATCH", { kind: action.kind });
            changed.set(action.blockId, saved);
            if (block && before !== null && before !== action.kind) {
              undo.push({
                description: action.description,
                run: () => api(`/api/blocks/${action.blockId}`, "PATCH", { kind: before, text: block.text }),
              });
            }
            break;
          }
          case "join_lines": {
            // A transcript's lines (SPEC.md §11): the answer names the edit,
            // and Undo gives both lines back as they were.
            const joined = await api<{ editId: string }>("/api/blocks/lines", "POST", {
              op: "join",
              blockId: action.blockId,
              nextBlockId: action.nextBlockId,
            });
            undo.push({ description: action.description, run: () => api("/api/blocks/lines", "POST", { op: "undo", editId: joined.editId }) });
            break;
          }
          case "split_line": {
            // The place as the line reads now: the plan's earlier actions may
            // have changed its words.
            const text = current(action.blockId)?.text;
            const at = text?.indexOf(action.quote) ?? -1;
            const cut = await api<{ editId: string }>("/api/blocks/lines", "POST", {
              op: "split",
              blockId: action.blockId,
              offset: at > 0 ? at : action.offset,
            });
            undo.push({ description: action.description, run: () => api("/api/blocks/lines", "POST", { op: "undo", editId: cut.editId }) });
            break;
          }
          case "set_speaker": {
            const set = await api<{ previous: string | null }>("/api/blocks/lines", "POST", {
              op: "speaker",
              blockId: action.blockId,
              speakerId: action.speakerId,
            });
            undo.push({
              description: action.description,
              run: () => api("/api/blocks/lines", "POST", { op: "speaker", blockId: action.blockId, speakerId: set.previous }),
            });
            break;
          }
          case "rename_speaker": {
            await api(`/api/documents/${documentId}/speakers`, "PATCH", { speakerId: action.speakerId, name: action.name });
            undo.push({
              description: action.description,
              run: () => api(`/api/documents/${documentId}/speakers`, "PATCH", { speakerId: action.speakerId, name: action.previousName }),
            });
            break;
          }
          case "style": {
            // The style route toggles the span: the same request takes it back.
            const body = {
              startOffset: action.anchor.startOffset,
              endOffset: action.anchor.endOffset,
              style: action.style,
            };
            await api(`/api/blocks/${action.anchor.blockId}/style`, "POST", body);
            undo.push({
              description: action.description,
              run: () => api(`/api/blocks/${action.anchor.blockId}/style`, "POST", body),
            });
            break;
          }
        }
        applied += 1;
      } catch {
        failed.push(action.description);
      }
    }
    router.refresh();
    const summary = [
      t("reader.actionsApplied", { n: applied, s: plural(applied) }),
      ...(failed.length > 0 ? [t("reader.failedPrefix", { what: failed[0] })] : []),
      ...(warnings.length > 0 ? [warnings[0]] : []),
    ].join(" · ");
    if (undo.length === 0) showToast(summary);
    else showToast(summary, { label: t("reader.undo"), run: () => void undoPlan(undo) }, UNDO_MS);
    return failed.length === 0;
  }
  const executePlanRef = useRef(executePlan);
  executePlanRef.current = executePlan;

  // Words from a figure (SPEC.md §7): a plan's new blocks right after a
  // figure are the assistant's suggestion under it (figure-suggestion.tsx);
  // Accept runs them as the plan card's Apply does, Reject drops them. The
  // other actions go on to the plan card.
  function offerFigureSuggestions(actions: AssistantAction[]): AssistantAction[] {
    const { byFigure, rest } = splitFigureSuggestions(
      actions,
      (id) => blocksRef.current.find((b) => b.id === id)?.type === "FIGURE",
    );
    for (const [blockId, list] of byFigure) {
      publishFigureSuggestion(documentId, blockId, {
        actions: list,
        settle: async (accept) => (accept ? executePlanRef.current(list) : true),
      });
    }
    return rest;
  }
  const offerFigureSuggestionsRef = useRef(offerFigureSuggestions);
  offerFigureSuggestionsRef.current = offerFigureSuggestions;

  // Undo, pressed in time: every applied action taken back, newest first.
  async function undoPlan(undo: { description: string; run: () => Promise<unknown> }[]) {
    hideToast();
    let undone = 0;
    const failed: string[] = [];
    for (const step of [...undo].reverse()) {
      try {
        await step.run();
        undone += 1;
      } catch {
        failed.push(step.description);
      }
    }
    router.refresh();
    showToast(
      [
        t("reader.actionsUndone", { n: undone, s: plural(undone) }),
        ...(failed.length > 0 ? [t("reader.failedPrefix", { what: failed[0] })] : []),
      ].join(" · "),
    );
  }

  async function approvePlan() {
    if (!aiPlan) return;
    const actions = aiPlan.actions.filter((_, i) => planChecked.has(i));
    setAiPlan(null);
    await executePlan(actions, aiPlan.warnings);
  }

  // Leaving edit mode: whatever is being typed saves first, then the mode and
  // its toolbar go. Escape, Done, and a press outside the article all come
  // here, so the bar never outlives the mode.
  function leaveEditMode() {
    const active = document.activeElement as HTMLElement | null;
    const editingId = active?.dataset.editBlock;
    if (editingId) {
      const live = active?.textContent ?? "";
      const stored = blocksRef.current.find((b) => b.id === editingId);
      if (stored && live !== stored.text) void saveBlockEdit(editingId, live);
    }
    editModeRef.current = false;
    setEditMode(false);
  }
  const leaveEditModeRef = useRef(leaveEditMode);
  leaveEditModeRef.current = leaveEditMode;

  // A press anywhere outside the article, its format bar, the edit-mode
  // controls, and the selection tools leaves edit mode: the reader clicked
  // away, so the bar goes with the mode.
  useEffect(() => {
    if (!editMode) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (
        target?.closest(
          "article.reader-prose, [data-edit-toolbar], [data-edit-control], [data-selection-popover]",
        )
      ) {
        return;
      }
      leaveEditModeRef.current();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [editMode]);

  // Undo and redo for the article (SPEC.md §6). The note editor keeps its own
  // history inside the editable; the article's edits are server calls, so the
  // history here is a stack of steps, each knowing how to take itself back and
  // how to do itself again. Typing is one step per block: the text the block
  // held before this run of typing, against the text it holds now.
  const undoStack = useRef<{ undo: () => Promise<void>; redo: () => Promise<void> }[]>([]);
  const redoStack = useRef<typeof undoStack.current>([]);
  const [historyDepth, setHistoryDepth] = useState({ undo: 0, redo: 0 });
  const syncHistory = () =>
    setHistoryDepth({ undo: undoStack.current.length, redo: redoStack.current.length });
  // True while a step is being undone or redone: the calls it makes must not
  // record steps of their own.
  const stepping = useRef(false);

  function record(step: { undo: () => Promise<void>; redo: () => Promise<void> }) {
    if (stepping.current) return;
    undoStack.current = [...undoStack.current.slice(-99), step];
    redoStack.current = [];
    syncHistory();
  }

  async function runStep(back: boolean) {
    // Typing that has not been saved yet is a step of its own, so Cmd+Z after
    // typing takes the typing back rather than the change before it.
    await flushEditRef.current?.();
    const from = back ? undoStack.current : redoStack.current;
    const step = from[from.length - 1];
    if (!step) return;
    stepping.current = true;
    try {
      await (back ? step.undo() : step.redo());
      if (back) {
        undoStack.current = undoStack.current.slice(0, -1);
        redoStack.current = [...redoStack.current, step];
      } else {
        redoStack.current = redoStack.current.slice(0, -1);
        undoStack.current = [...undoStack.current, step];
      }
      syncHistory();
    } catch (err) {
      showError(err instanceof Error ? err.message : t("reader.editFailed"));
    } finally {
      stepping.current = false;
    }
  }
  // The article's editor hands back a way to save what is being typed, so undo
  // can settle it first.
  const flushEditRef = useRef<(() => Promise<void>) | null>(null);
  // The voice command saves a blank document's typing first (layer/flush.ts).
  useEffect(() => {
    if (!blankDocument) return;
    return registerDocumentFlush(documentId, () => flushEditRef.current?.() ?? Promise.resolve());
  }, [blankDocument, documentId]);

  // Cmd+Z and Shift+Cmd+Z, Ctrl elsewhere (Ctrl+Y too). The article's history
  // answers in edit mode and after it: leaving the mode is not a reason for
  // the last change to stop being undoable. Two things keep their own undo and
  // are left to the browser: a text box or an editable the reader is typing in
  // — a note, the assistant's box, any input — and every key with nothing in
  // the stack to take back, which the browser then handles as it always would.
  // The article's own editable is the exception: its typing is recorded here,
  // so the browser's undo of the same typing would fight this one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const redo = key === "y" || (key === "z" && e.shiftKey);
      if (key !== "z" && !redo) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && !active.closest("[data-edit-block]") && isTextEntry(active)) return;
      if ((redo ? redoStack.current : undoStack.current).length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      void runStep(!redo);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The history belongs to the open document: its steps name that document's
  // blocks. Opening another document starts an empty one; entering and leaving
  // edit mode does not, so Cmd+Z still takes back what the last session typed.
  useEffect(() => {
    undoStack.current = [];
    redoStack.current = [];
    syncHistory();
  }, [documentId]);

  // Edit mode: the whole body is editable in place. Every change goes through
  // the same routes as the assistant's, so history and healing stay uniform.
  function toggleEditMode() {
    setPopover(null);
    setSubmenu(null);
    setBubble(null);
    setSimplifyCard(null);
    editModeRef.current = !editMode;
    setEditMode(!editMode);
  }

  async function formatBlock(blockId: string, kind: FormatKind, text?: string) {
    const was = blocksRef.current.find((b) => b.id === blockId);
    const wasKind = blockFormatKind(was);
    const wasText = was?.text;
    try {
      await api(`/api/blocks/${blockId}`, "PATCH", {
        kind,
        ...(text !== undefined ? { text } : {}),
      });
      if (wasKind) {
        record({
          undo: () => formatBlock(blockId, wasKind, text !== undefined ? wasText : undefined),
          redo: () => formatBlock(blockId, kind, text),
        });
      }
      refreshWhenOnline(router);
    } catch (err) {
      showError(err instanceof Error ? err.message : t("reader.formatFailed"));
    }
  }

  async function toggleStyleSpan(
    blockId: string,
    start: number,
    end: number,
    style: ToggleStyle,
  ) {
    try {
      await api(`/api/blocks/${blockId}/style`, "POST", {
        startOffset: start,
        endOffset: end,
        style,
      });
      // A style is its own opposite: the same span, the same style, off again.
      const again = () => toggleStyleSpan(blockId, start, end, style);
      record({ undo: again, redo: again });
      router.refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : t("reader.styleFailed"));
    }
  }

  async function setFont(next: string) {
    try {
      await api(`/api/documents/${documentId}`, "PATCH", { font: next });
      router.refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : t("reader.fontFailed"));
    }
  }

  async function insertBlock(afterBlockId: string): Promise<string | null> {
    try {
      const res = await fetch("/api/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId, afterBlockId }),
      });
      const json = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!res.ok || !json?.id)
        throw new Error(json?.error ?? t("reader.insertFailedStatus", { status: res.status }));
      // Redoing an insert makes a new block; the step follows it, so a second
      // undo removes the one that is actually there.
      let id = json.id;
      record({
        undo: () => deleteBlock(id),
        redo: () => insertBlock(afterBlockId).then((next) => {
          if (next) id = next;
        }),
      });
      router.refresh();
      return json.id;
    } catch (err) {
      showError(err instanceof Error ? err.message : t("reader.insertFailed"));
      return null;
    }
  }

  // A dropped or pasted image lands as a figure right after the block it was
  // dropped on (SPEC.md §16), the same insert path a new paragraph takes, and
  // Undo takes it out again.
  async function insertImageBlock(afterBlockId: string, image: DroppedImage): Promise<string> {
    const res = await fetch("/api/blocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId,
        afterBlockId,
        type: "FIGURE",
        text: image.name,
        html: imageFigureHtml(image.url, image.name),
      }),
    });
    const json = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
    if (!res.ok || !json?.id) {
      throw new Error(json?.error ?? t("reader.insertFailedStatus", { status: res.status }));
    }
    let id = json.id;
    record({
      undo: () => deleteBlock(id),
      redo: () =>
        insertImageBlock(afterBlockId, image).then((next) => {
          id = next;
          router.refresh();
        }),
    });
    return json.id;
  }

  // Images drop into the article, in reading and in edit mode alike: a file,
  // or an image dragged from another page, dropped on a block of the text
  // lands right after that block, and the drop line under the block says so
  // while the drag is over it. A drop anywhere else, and a file that is not
  // an image, keeps travelling to the window, which adds dropped files as
  // documents (document-bar.tsx). A transcript, slides, sheets, and a
  // handwritten document's pages take no figure.
  const figureDrop = canEdit && !richText && !transcript;
  const dropAfterRef = useRef<string | null>(null);
  const [dropLine, setDropLine] = useState<{ top: number; left: number; width: number } | null>(null);
  const dropLineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideDropLine = () => {
    if (dropLineTimer.current) clearTimeout(dropLineTimer.current);
    dropLineTimer.current = null;
    setDropLine(null);
  };
  /** The block of the text that a figure dropped at `target` follows. */
  const figureTarget = (target: EventTarget | null): HTMLElement | null => {
    if (!figureDrop || !(target instanceof Element) || !target.closest("article.reader-prose")) return null;
    const el = target.closest<HTMLElement>("[data-edit-block], [data-block-id]");
    const id = el?.dataset.editBlock ?? el?.dataset.blockId;
    const blocks = blocksRef.current;
    if (!el || !id || blocks.some((b) => NO_NEW_BLOCKS.has(b.type))) return null;
    const block = blocks.find((b) => b.id === id);
    return block && block.type !== "PAGE" ? el : null;
  };
  const imageDrop = useNoteDrop({
    premium,
    enabled: figureDrop,
    pageImages: true,
    t,
    onError: showToast,
    onImages: async (images) => {
      const afterId = dropAfterRef.current;
      if (!afterId) return;
      // Each figure lands after the one before it, so several images keep the
      // order they were dropped in.
      let after = afterId;
      for (const image of images) after = await insertImageBlock(after, image);
      router.refresh();
    },
  });
  const onArticleDragOver = (e: React.DragEvent) => {
    const el = figureTarget(e.target);
    if (!el) {
      hideDropLine();
      return;
    }
    imageDrop.handlers.onDragOver(e);
    const container = containerRef.current;
    if (!e.defaultPrevented || !container) return;
    const box = container.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setDropLine({ top: r.bottom - box.top + container.scrollTop + 2, left: r.left - box.left, width: r.width });
    // dragover comes every 350 ms or so while the pointer holds still.
    if (dropLineTimer.current) clearTimeout(dropLineTimer.current);
    dropLineTimer.current = setTimeout(() => setDropLine(null), 600);
  };
  const onArticleDrop = (e: React.DragEvent) => {
    hideDropLine();
    const el = figureTarget(e.target);
    if (!el) return;
    dropAfterRef.current = el.dataset.editBlock ?? el.dataset.blockId ?? null;
    void imageDrop.handlers.onDrop(e);
  };
  // An image pasted while a block is being edited lands after that block.
  const onArticlePaste = (e: React.ClipboardEvent) => {
    const el = editMode ? figureTarget(e.target) : null;
    const files = Array.from(e.clipboardData?.files ?? []).filter(isImageFile);
    const html = e.clipboardData?.getData("text/html") ?? "";
    if (!el || files.length === 0 || html.replace(/<[^>]*>|&nbsp;/g, "").trim()) return;
    e.preventDefault();
    dropAfterRef.current = el.dataset.editBlock ?? el.dataset.blockId ?? null;
    void imageDrop.takeFiles(files);
  };

  async function deleteBlock(blockId: string) {
    try {
      // Through api(), so offline the removal queues (SPEC.md §17); a queued
      // removal has no edit yet, so it leaves no undo step.
      const json = await api<{ editId?: string }>(`/api/blocks/${blockId}`, "DELETE");
      // The removal's own edit puts the block back with its id, so anchors on
      // it heal rather than orphan.
      const editId = json?.editId;
      if (editId) {
        record({
          undo: async () => {
            await api("/api/blocks/restore", "POST", { editId });
            router.refresh();
          },
          redo: () => deleteBlock(blockId),
        });
      }
      refreshWhenOnline(router);
    } catch (err) {
      showError(err instanceof Error ? err.message : t("reader.removeFailed"));
    }
  }

  async function saveBlockEdit(blockId: string, text: string) {
    const before = blocksRef.current.find((b) => b.id === blockId)?.text;
    try {
      await api(`/api/blocks/${blockId}`, "PATCH", { text });
      if (before !== undefined && before !== text) {
        record({
          undo: () => saveBlockEdit(blockId, before),
          redo: () => saveBlockEdit(blockId, text),
        });
      }
      refreshWhenOnline(router);
    } catch (err) {
      showError(err instanceof Error ? err.message : t("reader.editFailed"));
    }
  }

/** The format a stored block is in, for a step that puts it back. */
/** A block's format as Undo restores it: a code block is code again. */
function blockFormatKind(block: { type: string; html: string | null; text: string } | undefined): FormatKind | null {
  return block ? formatKind(block.type, block.html, block.text) : null;
}

  // The assistant is changing the passage the chat is on: a message is in
  // flight, or the last answer landed suggestions (SPEC.md §29). A reader
  // who selects a long passage for a command does not want it kept as a
  // block of color while the suggestions, in the assistant's color, land in
  // it and are reviewed — unlike a passage selected to annotate. So while
  // this holds the passage keeps the thin mark a closed conversation has
  // (block-view.tsx tool-mark: the underline and no fill), and the card
  // keeps its connector line; a plain answer brings the fill back.
  const assistantEditing =
    assistantChat !== null && (assistantChat.busy || assistantChat.messages.at(-1)?.suggestKey !== undefined);
  // The spans of the chat's passage, as the local marks key them.
  const chatSpans = new Set(
    assistantChat?.anchor ? segmentsOf(assistantChat.anchor).map((s) => `${s.blockId}:${s.startOffset}:${s.endOffset}`) : [],
  );
  // The assistant's thin mark on a span: the mark a stored conversation
  // paints with its card closed.
  const thinAssistantMark = (start: number, end: number): Highlight => ({
    sourceId: null,
    start,
    end,
    kind: "anchor",
    annotation: true,
    tool: "assistant",
    open: false,
  });

  // Merge anchor, extraction, term, and link layers per block.
  const highlightsByBlock: Record<string, Highlight[]> = {};
  for (const [blockId, list] of Object.entries(anchorHighlights)) {
    // A deleted note's marks fade first, then unpaint (removedNotes).
    highlightsByBlock[blockId] = list
      .filter((h) => removedNotes[h.noteId] !== "gone" && !(commentsHidden && h.comment))
      .map((h) => {
        // A stored AI annotation carries the symbol of the tool that made it —
        // Explain's question mark, Simplify's lines, the assistant's sparkle —
        // at the end of the highlighted text, in every view; the symbol opens
        // the card (SPEC.md §6). Comments keep their own icon.
        const stored = annotationBubbles[h.sourceId];
        const tool = stored && stored.kind !== "comment" ? stored.kind : undefined;
        // A tool's output continued into a conversation: the symbol gains its
        // plus (SPEC.md §21). An open card's turns count before the refresh.
        const openTurns =
          bubble?.noteId === h.noteId
            ? bubble.conversation.length
            : simplifyCard?.noteId === h.noteId
              ? simplifyCard.conversation.length
              : 0;
        const plus =
          tool !== undefined &&
          tool !== "assistant" &&
          ((stored?.conversation.length ?? 0) > 0 ||
            openTurns > 0 ||
            (toolConversationsRef.current[h.noteId]?.length ?? 0) > 0);
        // Its card open: the mark keeps the fill (block-view.tsx open). The
        // assistant's loses it while the assistant is changing the passage.
        const open =
          bubble?.noteId === h.noteId ||
          simplifyCard?.noteId === h.noteId ||
          (assistantChat?.noteId === h.noteId && !assistantEditing) ||
          commentCard?.noteId === h.noteId;
        // A highlight that holds a comment (typed in its card) carries the
        // comment's chip, so the reader sees which highlights hold one. A pure
        // highlight stores its quote as its content.
        const summary = h.color ? annotationsBySource[h.sourceId] : undefined;
        const holdsComment = summary !== undefined && summary.content !== (summary.quotedText ?? "");
        return {
          ...h,
          comment: h.comment || holdsComment,
          kind: "anchor" as const,
          tool,
          chipless: stored?.chipless ?? false,
          plus,
          open,
          leaving: removedNotes[h.noteId] === "leaving",
        };
      });
  }
  for (const [blockId, list] of Object.entries(localAnchors)) {
    const existing = highlightsByBlock[blockId] ?? [];
    highlightsByBlock[blockId] = [
      ...existing,
      ...list.map((h) => ({
        sourceId: null,
        start: h.start,
        end: h.end,
        color: h.color,
        annotation: Boolean(h.comment) || h.tool !== undefined,
        comment: h.comment,
        kind: "anchor" as const,
        // The assistant's local mark fills only as the stored one would: its
        // chat open on this passage, and the assistant not changing it.
        tool: h.tool,
        open: h.tool !== undefined && chatSpans.has(`${blockId}:${h.start}:${h.end}`) && !assistantEditing,
      })),
    ];
  }
  for (const [blockId, list] of Object.entries(stylesByBlock)) {
    const existing = highlightsByBlock[blockId] ?? [];
    highlightsByBlock[blockId] = [
      ...existing,
      ...list.map((r) => ({
        sourceId: null,
        start: r.start,
        end: r.end,
        kind: "style" as const,
        styleKind: r.style,
      })),
    ];
  }
  for (const [blockId, list] of Object.entries(editedByBlock)) {
    const existing = highlightsByBlock[blockId] ?? [];
    highlightsByBlock[blockId] = [
      ...existing,
      ...list.map((r) => ({ sourceId: null, start: r.start, end: r.end, kind: "edited" as const })),
    ];
  }
  for (const [blockId, list] of Object.entries(linksByBlock)) {
    const existing = highlightsByBlock[blockId] ?? [];
    highlightsByBlock[blockId] = [
      ...existing,
      ...list.map((l) => ({
        sourceId: null,
        start: l.start,
        end: l.end,
        kind: "link" as const,
        href: l.href,
        linkTitle: l.title,
        linkId: l.linkId,
        linkReason: linkReasons[l.linkId] ?? l.reason,
      })),
    ];
  }
  // Links closed in this session, until the server's copy lands.
  for (const l of localLinks) {
    const existing = highlightsByBlock[l.blockId] ?? [];
    if (existing.some((h) => h.kind === "link" && h.linkId === l.linkId)) continue;
    highlightsByBlock[l.blockId] = [
      ...existing,
      {
        sourceId: null,
        start: l.start,
        end: l.end,
        kind: "link" as const,
        href: l.href,
        linkTitle: l.title,
        linkId: l.linkId,
        linkReason: linkReasons[l.linkId] ?? l.reason,
      },
    ];
  }
  // A citation's card on hover (bibliography.tsx referenceCard): the block
  // reader's citation carries it in its highlight; the page editor's reads
  // it from the cards set here.
  const referenceById = new Map(references.map((r) => [r.id, r]));
  for (const [blockId, list] of Object.entries(citationsByBlock)) {
    const existing = highlightsByBlock[blockId] ?? [];
    highlightsByBlock[blockId] = [
      ...existing,
      ...list.map((c) => {
        const reference = referenceById.get(c.referenceId);
        return {
          sourceId: null,
          start: c.start,
          end: c.end,
          kind: "citation" as const,
          referenceId: c.referenceId,
          referenceText: reference ? referenceCard(reference) : undefined,
        };
      }),
    ];
  }
  const citationsInPage = richText !== null;
  useEffect(() => {
    if (citationsInPage) setReferenceCards(documentId, references);
  }, [citationsInPage, documentId, references]);
  for (const [blockId, list] of Object.entries(contentsLinksByBlock)) {
    const existing = highlightsByBlock[blockId] ?? [];
    highlightsByBlock[blockId] = [
      ...existing,
      ...list.map((l) =>
        l.targetBlockId
          ? {
              sourceId: null,
              start: l.start,
              end: l.end,
              kind: "toc" as const,
              targetBlockId: l.targetBlockId,
            }
          : {
              sourceId: null,
              start: l.start,
              end: l.end,
              kind: "weblink" as const,
              href: l.href,
            },
      ),
    ];
  }
  for (const [blockId, list] of Object.entries(weblinksByBlock)) {
    // A span already marked as a citation or a link stays what it is.
    const taken = [
      ...(citationsByBlock[blockId] ?? []),
      ...(linksByBlock[blockId] ?? []),
      ...(contentsLinksByBlock[blockId] ?? []),
    ];
    const existing = highlightsByBlock[blockId] ?? [];
    highlightsByBlock[blockId] = [
      ...existing,
      ...list
        .filter((w) => !taken.some((t) => t.start < w.end && t.end > w.start))
        .map((w) => ({
          sourceId: null,
          start: w.start,
          end: w.end,
          kind: "weblink" as const,
          href: w.href,
        })),
    ];
  }
  if (simplifyCard) {
    // With a pressed sentence, only its source sentences tint — the mirroring.
    // Otherwise the whole selection keeps the light tint. The sentences
    // number on through the passage, block after block, as the prompt
    // numbers them (lib/sentences.ts: a block boundary is a sentence
    // boundary), so a pressed sentence finds its sources in whichever block
    // holds them.
    const pressed =
      simplifyCard.active !== null && simplifyCard.sentences
        ? simplifyCard.sentences[simplifyCard.active]
        : null;
    let number = 0;
    for (const s of segmentsOf(simplifyCard.anchor)) {
      const existing = highlightsByBlock[s.blockId] ?? [];
      const sourceSpans: (SentenceSpan & { n: number })[] = splitSentences(s.quotedText).map((span) => ({
        ...span,
        n: ++number,
      }));
      const ranges = pressed
        ? sourceSpans
            .filter((span) => pressed.refs.includes(span.n))
            .map((span) => ({
              sourceId: null,
              start: s.startOffset + span.start,
              end: s.startOffset + span.end,
              kind: "simplify" as const,
            }))
        : [];
      highlightsByBlock[s.blockId] = [
        ...existing,
        ...(pressed
          ? ranges
          : [{ sourceId: null, start: s.startOffset, end: s.endOffset, kind: "simplify" as const }]),
      ];
    }
  }
  // Extraction layers: the origin phrase and its revealing passages, each
  // carrying the extraction's label chip. Unresolvable spans stay unpainted.
  for (const extraction of allExtractions) {
    const entries = [
      ...(!extraction.origin.orphaned ? [{ span: extraction.origin, isOrigin: true }] : []),
      ...extraction.spans.filter((s) => !s.orphaned).map((span) => ({ span, isOrigin: false })),
    ];
    entries.forEach(({ span, isOrigin }) => {
      const existing = highlightsByBlock[span.blockId] ?? [];
      highlightsByBlock[span.blockId] = [
        ...existing,
        {
          sourceId: null,
          start: span.start,
          end: span.end,
          kind: "extract" as const,
          extractId: extraction.id,
          extractLabel: extraction.label,
          extractOrigin: isOrigin,
        },
      ];
    });
  }
  // A span jumped to (a distilled quote, an extract origin) keeps its exact
  // range tinted while the reader lands on it.
  if (spanFlash) {
    const existing = highlightsByBlock[spanFlash.blockId] ?? [];
    highlightsByBlock[spanFlash.blockId] = [
      ...existing,
      {
        sourceId: null,
        start: spanFlash.start,
        end: spanFlash.end,
        kind: "anchor" as const,
      },
    ];
  }
  // While an Explanation, Assistant, or Comment card is open, its anchor keeps
  // the anchor tint — the same mark its stored annotation paints after refresh.
  // Spans the server already marks are skipped, so the text never double-marks.
  // The assistant's passage keeps the thin mark instead while the assistant
  // is changing it (assistantEditing above).
  for (const anchor of [bubble?.anchor, assistantChat?.anchor, commentCard?.anchor]) {
    if (!anchor) continue;
    const thin = anchor === assistantChat?.anchor && assistantEditing;
    for (const s of segmentsOf(anchor)) {
      const existing = highlightsByBlock[s.blockId] ?? [];
      const marked = existing.some(
        (h) => h.kind === "anchor" && h.start === s.startOffset && h.end === s.endOffset,
      );
      if (marked) continue;
      highlightsByBlock[s.blockId] = [
        ...existing,
        thin
          ? thinAssistantMark(s.startOffset, s.endOffset)
          : { sourceId: null, start: s.startOffset, end: s.endOffset, kind: "anchor" as const },
      ];
    }
  }
  // The text under the open toolbar keeps the selection tint (block-view.tsx
  // kind "selection"): the browser's own selection goes the moment the
  // assistant's command box or the comment box takes focus; the mark stays
  // until the toolbar closes. Every block of the passage keeps it, so the
  // tint is the selection, whole, from the moment the pointer lifts. The
  // Close link chip's highlight keeps it the same way. The page editor keeps
  // its own selection drawn, blue or gray (SPEC.md §29): no tint, so opening
  // the toolbar never repaints the page, and a repaint cannot put back a
  // selection the keys have just moved. A core's words (SPEC.md §28) are
  // drawn over the page, not its text: they keep the tint. From the moment
  // the toolbar's command box sends to the assistant (aiBusy), the passage
  // keeps the assistant's thin mark in place of the tint: the toolbar stays
  // open with its thinking indicator until the answer lands, and the reader
  // asked for the passage to be worked on, not to look at it tinted. A
  // figure keeps the tint: its tint is the ring around it, not a fill.
  const toolbarAnchor = popover?.anchor ?? null;
  const underToolbar = richText && !(toolbarAnchor && isCoreKey(toolbarAnchor.blockId)) ? null : toolbarAnchor;
  if (underToolbar) {
    const running = aiBusy && popover !== null && underToolbar === popover.anchor && !popover.figure;
    for (const s of segmentsOf(underToolbar)) {
      const existing = highlightsByBlock[s.blockId] ?? [];
      highlightsByBlock[s.blockId] = [
        ...existing,
        running
          ? thinAssistantMark(s.startOffset, s.endOffset)
          : { sourceId: null, start: s.startOffset, end: s.endOffset, kind: "selection" as const },
      ];
    }
  }
  // The first end of a pending link stays tinted, in the pane that owns it,
  // until the link closes or the banner cancels it.
  if (pendingLink && pendingLink.fromDocumentId === documentId) {
    const { blockId, startOffset, endOffset } = pendingLink.anchor;
    const existing = highlightsByBlock[blockId] ?? [];
    highlightsByBlock[blockId] = [
      ...existing,
      { sourceId: null, start: startOffset, end: endOffset, kind: "pending-link" as const },
    ];
  }
  for (const [blockId, list] of Object.entries(termsByBlock)) {
    const existing = highlightsByBlock[blockId] ?? [];
    highlightsByBlock[blockId] = [
      ...existing,
      ...list.map((h) => ({
        sourceId: null,
        start: h.start,
        end: h.end,
        kind: "term" as const,
        definition: h.definition,
      })),
    ];
  }
  // Marks made in this session sweep in left to right the first time they
  // paint (block-view.tsx mark-sweep); everything painted on load rests still.
  for (const [blockId, list] of Object.entries(highlightsByBlock)) {
    for (const h of list) {
      if (
        (h.kind === "anchor" || h.kind === "simplify" || h.kind === "link") &&
        freshSpansRef.current.has(`${blockId}:${h.start}:${h.end}`)
      ) {
        h.fresh = true;
      }
    }
  }

  // The toolbox's own box (top/left/width), in pane coordinates. The bubbles
  // anchored to it (highlight colors, Add to notes) are w-full, so the stack
  // shares one left edge and one width.
  const popoverBox = popover
    ? (() => {
        const w = toolboxWidth;
        // The page editor: a box widened by a submenu takes the room the page
        // moves left to give; with none, it keeps the toolbar's width.
        if (popover.side === "right" && popover.page) {
          const shift = toolbarShift(popover.page.geo, docsShift, w);
          const width = shift === null ? 176 : w;
          const left = toolbarLeft(popover.page.geo, shift ?? docsShift, width) ?? Math.max(6, popover.cw - width - 6);
          return { top: popover.yTop, left, width };
        }
        // Beside the words, the box stands where it stands at rest, and a
        // box widened by a field grows away from the words, into the margin,
        // as far as the margin goes: past that it keeps its width and the
        // field wraps. It never grows back over the words it was opened for.
        if (popover.side === "right") {
          const left = Math.min(popover.rightBase, popover.cw - restWidth - 6);
          return { top: popover.yTop, left, width: Math.max(restWidth, Math.min(w, popover.cw - 6 - left)) };
        }
        if (popover.side === "below") {
          const left = Math.max(6, Math.min(popover.x - w / 2, popover.cw - w - 6));
          // Above the words, the box's bottom sits over their first line, and
          // a field it opens grows it upward, off the words.
          if (popover.above && popover.wordsTop !== undefined) {
            return { top: popover.wordsTop - 8, left, width: w, translate: "0 -100%" };
          }
          return { top: popover.y, left, width: w };
        }
        const width = Math.max(restWidth, Math.min(w, popover.textLeft - 10 - 6));
        return { top: popover.yTop, left: Math.max(6, popover.textLeft - width - 10), width };
      })()
    : { top: 0, left: 0, width: 0 };
  // The toolbox is one card at every width: the colors and the voice are
  // its first row, Add to notes its second, then the tools, so it covers as
  // few lines as it can.
  // One row of the toolbox. Coarse pointers get 44px-tall rows.
  const toolRow = coarse ? "px-3.5 py-2.5 text-[14px]" : "px-2.5 py-[5px] text-[12px]";
  // On a coarse pointer two short tools share a row, each one tap: Explain
  // and Simplify, Visualize and Comment. Elsewhere the rows stand one under
  // the other (the pair's box is display: contents).
  const pairRow = (both: boolean) => (coarse && both ? "grid grid-cols-2 gap-0.5" : "contents");
  const halfRow = "px-2.5 py-2.5 text-[14px]";
  // The assistant's bar (SPEC.md §29) takes the selection box's Assistant on
  // a blank document or an import, for a reader who can edit it, out of
  // Viewing mode. A figure has no words to change: its Assistant keeps the
  // selection chat.
  const barOffered =
    popover !== null && !popover.figure && blankDocument && pageEditorIn(containerRef.current)?.isEditable === true;
  // The open popover's content kind and its toolbar (SPEC.md §6).
  const popoverKind: ContentKind = contentKindOf(
    popover ? blocks.find((b) => b.id === popover.anchor.blockId)?.type : undefined,
  );
  // A selection in a core (SPEC.md §28) takes every tool but Link: a link
  // joins the texts themselves. With a link pending, Close link takes Link's
  // place.
  const inCore = popover ? isCoreKey(popover.anchor.blockId) : false;
  // The passage spans more blocks than a save takes (lib/anchors/passage.ts).
  const passageTooLong = popover !== null && (popover.anchor.segments?.length ?? 1) > MAX_SEGMENTS;
  // Define shows on one word alone (offersDefine).
  const has = (tool: Tool) =>
    TOOLBARS[popoverKind].includes(tool) &&
    !((inCore || pendingLink) && tool === "link") &&
    (tool !== "define" || (popover !== null && offersDefine(popover)));
  // The definition under the Define row: the open popover's own.
  const shownDefinition = definition && definition.key === popoverAnchorKey ? definition : null;
  // A row's look: the predicted lead tool reads as recommended, like the
  // figure toolbar's Analyze; every other row is plain.
  const leads = (tool: Tool) => leadTool === tool;
  // Offline, a row whose tool needs a model reads as off (SPEC.md §17).
  const aiOff = !online;
  const aiTip = (tip: string) => (aiOff ? t("common.offlineAi") : tip);
  const aiDim = aiOff ? " opacity-50" : "";
  const rowLook = (tool: Tool) =>
    leads(tool)
      ? "bg-clay-100 font-semibold text-clay-800 hover:bg-clay-200"
      : "text-sand-800 hover:bg-clay-100 hover:text-clay-800";
  // The lead row's tint says it leads; its tooltip says so in words.
  const leadTip = (tool: Tool, tip: string) => (leads(tool) ? `${tip}\n${t("reader.recommended")}` : tip);
  // The highlight colors, Add to notes, and Read aloud draw a clay ring
  // when their tool leads.
  const leadRing = (tool: Tool) => (leads(tool) ? " ring-2 ring-clay/60" : "");
  // Read aloud: the last button of the colors row.
  const voiceButton = (
    <button
      onClick={() => void speakSelection()}
      data-track="read-aloud"
      aria-label={voice === "idle" ? t("reader.readAloud") : t("reader.stopReading")}
      data-tip={voice === "idle" ? t("reader.readAloud") : t("reader.stopReading")}
      className={`flex ${coarse ? "size-7" : "size-6"} items-center justify-center rounded-full ${
        voice !== "idle" ? "bg-clay text-clay-fg hover:bg-clay-600" : "text-sand-700 hover:bg-clay-100 hover:text-clay-800"
      }${leadRing("readAloud")}`}
    >
      {voice === "loading" ? (
        <SpinnerIcon size={12} className="motion-safe:animate-spin" />
      ) : voice === "playing" ? (
        <StopIcon size={11} />
      ) : (
        <VolumeIcon size={13} />
      )}
    </button>
  );
  // Every tool card grows with its content up to the pane's height, then its
  // body scrolls (SPEC.md §6). Unmeasured (the SSR pass): no cap.
  // A pane with the article's band (h-12) gives the band's 48px too, so a
  // card the pane's height sits under it.
  const bandRoom = !split && !transcript && !embedded && !richText ? 48 : 0;
  const cardMaxHeight = paneHeight > 0 ? Math.max(200, paneHeight - 24 - bandRoom) : undefined;
  // The full conversation view lies over the pane (SPEC.md §21): the cards
  // stay open under it, out of sight, so none covers the view.
  const underView = conversationView !== null ? " invisible" : "";
  // A card capped above the card under it (settleSideCards) scrolls inside.
  const cardHeight = (kind: string) =>
    cardCaps[kind] !== undefined ? Math.min(cardMaxHeight ?? Infinity, cardCaps[kind]) : cardMaxHeight;

  // A tool conversation's turns, under the output inside the card's scroll
  // body (SPEC.md §21): the reader's messages as chat bubbles, the assistant's
  // as markdown, the same shapes as the assistant card.
  // The kind of a tool card, for its queue: the explain bubble, else Simplify.
  const kindOfCard = (card: ToolChat): "explain" | "simplify" => (card === bubble ? "explain" : "simplify");
  // The queued messages of the thread on screen: the side chat's, or the
  // conversation's own.
  const chatQueueShown = (chat: AssistantChat) => (chat.queue ?? []).filter((q) => q.openKey === (chat.openKey ?? null));
  // The plan a tool conversation proposed, under its turns in its own card.
  const toolPlan = (card: ToolChat & { noteId: string | null }) =>
    aiPlan !== null && planFrom === "tool" && card.noteId !== null && card.noteId === planNoteId ? (
      <div data-plan-in-card className="flex flex-col rounded-2xl border border-line bg-sand-50 p-3">
        {planBody}
      </div>
    ) : null;
  const toolChatTurns = (card: ToolChat & { noteId: string | null }) =>
    card.conversation.length > 0 || card.busy ? (
      <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
        {card.conversation.map((message, i) =>
          message.role === "user" ? (
            <p
              key={i}
              className="ml-6 self-end rounded-2xl bg-clay-100 px-3 py-1.5 text-[12.5px] text-clay-800"
            >
              {message.content}
            </p>
          ) : (
            <div key={i} className="text-[13px]">
              <Markdown>{message.content}</Markdown>
            </div>
          ),
        )}
        {card.busy && <ThinkingIndicator className="py-0.5 text-[12px]" />}
        <QueuedList items={card.queue} onRemove={(key) => removeQueuedTool(kindOfCard(card), key)} />
        {toolPlan(card)}
      </div>
    ) : null;
  // The card's foot: Continue, which opens the box, or the box itself once
  // it is open. A card still streaming, failed, or unsaved has no foot.
  const toolChatFoot = (
    kind: "explain" | "simplify",
    card: ToolChat & { noteId: string | null; streaming: boolean; error: string | null },
    tool: ToolKind,
    // In the full conversation view the foot is a row of its own, so it takes
    // none of the space the card's foot leaves under the output.
    inView = false,
  ) => {
    if (!card.noteId || card.streaming || card.error) return null;
    if (!card.chatOpen) {
      // On the card Continue is a pill in the foot row (continuePill).
      if (!inView) return null;
      // Continuing into a conversation is Unitos Ultra (TIERS.md): every
      // account sees the mention at the end of the tool's output; a
      // non-Ultra press answers with the plain Ultra message, never the box.
      return (
        <button
          onClick={() => openToolChat(kind)}
          data-track={`${tool}-continue`}
          data-tip={ultra ? t("reader.continueConversationTitle") : t("reader.continueNeedsUltra")}
          className={`${inView ? "" : "mt-2.5"} flex w-full items-center justify-between gap-2 self-start rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800`}
        >
          <span className="flex items-center gap-1.5">
            <ToolSymbol tool={tool} plus size={11} />
            {t("reader.continueConversation")}
          </span>
          {!ultra && (
            <span className="flex items-center gap-1 text-[9px] font-bold tracking-[0.06em] text-sand-500 uppercase">
              <TierMark state="ultra" size={10} />
              {t("reader.ultra")}
            </span>
          )}
        </button>
      );
    }
    if (!ultra) {
      // A conversation started while the account was Ultra, since downgraded:
      // the turns above stay readable; no more can be sent.
      return (
        <p className={`${inView ? "" : "mt-2"} flex items-center gap-1.5 text-[11px] text-sand-500`}>
          <ToolSymbol tool={tool} plus size={11} />
          {t("reader.continueNeedsUltra")}
        </p>
      );
    }
    return (
      <>
      <form
        className={`${inView ? "" : "mt-2"} flex items-end gap-1.5`}
        onSubmit={(e) => {
          e.preventDefault();
          void sendToolMessage(kind);
        }}
      >
        <textarea
          autoFocus
          value={card.input}
          rows={1}
          onFocus={caretToEnd}
          onChange={(e) => {
            const value = e.target.value;
            setToolChat(kind, () => ({ input: value, sendError: null }));
          }}
          {...ime.props}
          onKeyDown={(e) => {
            if (ime.isImeEnter(e)) return;
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void sendToolMessage(kind);
            }
          }}
          placeholder={t(card.busy ? "assistant.queuePlaceholder" : "reader.continuePlaceholder")}
          aria-label={t("reader.messageAssistant")}
          className="field-sizing-content max-h-40 min-h-8 flex-1 resize-none rounded-xl bg-sand-100 px-3 py-1.5 text-[12.5px] outline-none placeholder:text-sand-500"
        />
        <VoiceTypingButton track={`${tool}-continue-voice-typing`} className="size-8" size={14} />
        {/* While a turn runs the button is Stop, or Queue once a message is
            composed (SPEC.md §7). */}
        <button
          type="submit"
          data-track={card.busy && card.input.trim() ? "assistant-queue" : `${tool}-continue-send`}
          onClick={(e) => {
            if (!card.busy || card.input.trim()) return;
            e.preventDefault();
            stopToolChat(kind);
          }}
          disabled={!card.busy && !card.input.trim()}
          data-tip={card.busy ? t(card.input.trim() ? "assistant.queueTitle" : "reader.stopAssistant") : t("reader.sendTitle")}
          aria-label={card.busy && !card.input.trim() ? t("reader.stopAssistant") : undefined}
          className="rounded-full bg-clay px-3 py-1.5 text-[11px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
        >
          {card.busy ? (card.input.trim() ? t("assistant.queue") : <StopIcon size={11} />) : t("reader.send")}
        </button>
      </form>
      {/* Why the last message did not go; its words are back in the box. */}
      {card.sendError && (
        <p data-send-error role="alert" className="mt-1 shrink-0 text-[12px] font-medium text-red-600">
          {card.sendError}
        </p>
      )}
      </>
    );
  };
  // Continue on a tool card: a short pill in the foot row beside the rating
  // and Save as note; a press opens the box in its place (toolChatFoot). Its
  // tooltip names it whole and says when it needs Unitos Ultra.
  const continuePill = (
    kind: "explain" | "simplify",
    card: ToolChat & { noteId: string | null; streaming: boolean; error: string | null },
    tool: ToolKind,
    className = "",
  ) =>
    !card.noteId || card.streaming || card.error || card.chatOpen ? null : (
      <button
        onClick={() => openToolChat(kind)}
        data-track={`${tool}-continue`}
        aria-label={t("reader.continueConversation")}
        data-tip={ultra ? t("reader.continueConversationTitle") : t("reader.continueNeedsUltra")}
        className={`flex items-center gap-1 rounded-full border border-line px-1.5 py-0.5 pointer-coarse:py-1.5 text-[11px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800 ${className}`}
      >
        {t("assistant.continue")}
        {!ultra && <TierMark state="ultra" size={10} />}
      </button>
    );
  // The assistant card's foot: the box that sends the next turn. The card
  // beside the article and the full conversation view render the same one.
  const assistantChatFoot = (chat: AssistantChat, className: string, chipsClassName: string) => (
    <>
    {chat.openKey ? (
      <SideChatHeader
        quote={chatOpenSide?.quote ?? ""}
        onBack={() => setAssistantChat((c) => (c ? switchThread(c, null) : c))}
        className={chipsClassName}
      />
    ) : (
      <SideChatChips
        // A side chat with turns, or with words typed in its box and not sent.
        sideChats={(chat.sideChats ?? []).filter((s) => s.messages.length > 0 || (chat.inputs?.[s.key] ?? "").trim())}
        onOpen={(key) =>
          setAssistantChat((c) => {
            if (!c) return c;
            const side = (c.sideChats ?? []).find((s) => s.key === key);
            return switchThread(c, key, side?.noteId ? (cardDraftsRef.current?.[side.noteId] ?? "") : "");
          })
        }
        className={chipsClassName}
      />
    )}
    <CommentList
      comments={chatComments}
      people={{ ...people, ...chatCommentPeople }}
      myId={myId}
      onDelete={(id) => void deleteChatComment(id)}
      className={chipsClassName}
    />
    {/* A side chat's header already shows the quote it started on. */}
    {chat.quote && !(chat.openKey && chat.quote === chatOpenSide?.quote) && (
      <QuoteChip quote={chat.quote} onClear={dropChatQuote} className={chipsClassName} />
    )}
    {chatCommentQuote ? (
      // The comment's words are a card draft under the conversation and the
      // quote: Escape, Cancel, a closed card, or a reload keeps them.
      <CommentBox
        key={chatCommentKey ?? ""}
        quote={chatCommentQuote}
        busy={chatCommentBusy}
        draft={(chatCommentKey && cardDraftsRef.current?.[chatCommentKey]) || ""}
        onDraft={(text) => {
          if (chatCommentKey) setCardDraft(chatCommentKey, text.trim() ? text : null);
        }}
        onCancel={() => {
          setChatCommentQuote(null);
          clearAnswerSelection();
        }}
        onSubmit={(text) => void postChatComment(text)}
        className={chipsClassName}
      />
    ) : (
    <>
    {/* One composer foot (TOOL13-10): the field, then how the assistant
        answers on the left and the mic and Send on the right, as in the
        toolbar's box. */}
    <form
      className={`${className} flex-wrap`}
      onSubmit={(e) => {
        e.preventDefault();
        void sendChatMessage();
      }}
    >
      <textarea
        value={chat.input}
        rows={1}
        onChange={(e) => setAssistantChat((c) => (c ? { ...c, input: e.target.value, sendError: null } : c))}
        {...ime.props}
        onKeyDown={(e) => {
          if (ime.isImeEnter(e)) return;
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void sendChatMessage();
          }
        }}
        placeholder={t(chat.busy ? "assistant.queuePlaceholder" : "reader.replyPlaceholder")}
        aria-label={t("reader.messageAssistant")}
        data-chat-box=""
        className="field-sizing-content max-h-40 min-h-8 basis-full resize-none rounded-xl bg-sand-100 px-3 py-1.5 text-[12.5px] outline-none placeholder:text-sand-500"
      />
      <span className="flex items-center gap-1.5 self-center">
        <ThinkingChips small />
        <WebChip small />
      </span>
      <VoiceTypingButton track="assistant-card-voice-typing" className="ml-auto size-8" size={14} />
      {/* While an answer runs the button is Stop, or Queue once a message is
          composed (SPEC.md §7). */}
      <button
        type="submit"
        data-track={chat.busy && chat.input.trim() ? "assistant-queue" : "assistant-card-send"}
        onClick={(e) => {
          if (!chat.busy || chat.input.trim()) return;
          e.preventDefault();
          stopAssistantChat();
        }}
        disabled={!chat.busy && !chat.input.trim()}
        data-tip={chat.busy ? t(chat.input.trim() ? "assistant.queueTitle" : "reader.stopAssistant") : t("reader.sendTitle")}
        aria-label={chat.busy && !chat.input.trim() ? t("reader.stopAssistant") : undefined}
        className="rounded-full bg-clay px-3 py-1.5 text-[11px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
      >
        {chat.busy ? (chat.input.trim() ? t("assistant.queue") : <StopIcon size={11} />) : t("reader.send")}
      </button>
    </form>
    {chat.sendError && (
      <p data-send-error role="alert" className={`${chipsClassName} text-[12px] font-medium text-red-600`}>
        {chat.sendError}
      </p>
    )}
    </>
    )}
    <AnswerTint rects={answerTintRects} />
    {answerSelection && (
      <AnswerToolbar
        selection={answerSelection}
        canSideChat={assistantChat?.noteId != null}
        onSideChat={startChatSideChat}
        onAsk={askAboutThisInChat}
        onComment={openChatComment}
      />
    )}
    </>
  );
  // The card's title once its output continued into a conversation.
  const toolPlus = (card: ToolChat) => card.chatOpen || card.conversation.length > 0;

  // Expand: the conversation read whole over the pane (SPEC.md §21). The card
  // stays open under the view, so closing it puts the reader back where the
  // card was, at the scroll position the pane left.
  function openConversationView(kind: "assistant" | "explain" | "simplify") {
    const container = containerRef.current;
    if (container && !conversationViewRef.current) {
      conversationReturnScroll.current = container.scrollTop;
      container.scrollTo({ top: 0 });
    }
    setConversationView(kind);
  }
  function closeConversationView() {
    setConversationView(null);
    const container = containerRef.current;
    if (container && conversationReturnScroll.current !== null) {
      container.scrollTo({ top: conversationReturnScroll.current });
      conversationReturnScroll.current = null;
    }
  }
  // Expand, on the header of every card that holds a conversation.
  // Every action in a card's header is one button: a 24px circle around a
  // 13px glyph, the same on the explanation, the simplification, the
  // analysis, the visualization, and the assistant's card. The rating sits
  // at the card's foot, not in the header (SPEC.md §25). On a touch screen
  // the circle takes the toolbar's finger size.
  const CARD_ACTION =
    "flex size-6 shrink-0 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-800 pointer-coarse:size-9";
  const expandButton = (kind: "assistant" | "explain" | "simplify") => (
    <button
      onClick={() => openConversationView(kind)}
      data-track={`${kind}-expand`}
      className={CARD_ACTION}
      aria-label={t("reader.expandConversation")}
      data-tip={t("reader.expandConversationTitle")}
    >
      <ExpandIcon size={13} />
    </button>
  );

  // The article menu: the Contents button (SPEC.md §26) and the list it
  // opens — the article's parts, each a jump to its block. In Normal view it
  // floats at the top left of the pane and stays there as the article
  // scrolls: a sticky block with no height, like the controls at the top
  // right, so the text runs under it, and only the controls take pointer
  // events. In a split view it sits in the pane header, always in reach,
  // and its list drops below the header (SPEC.md §6). A transcript has the
  // video pane's own tools instead (SPEC.md §11).
  const articleMenu = (
      <div
        data-track-surface="article-menu"
        className={
          split ? "relative flex shrink-0 items-center" : "pointer-events-none sticky top-4 z-30 h-0 print:hidden"
        }
      >
        <div
          className={
            split
              ? "flex w-max items-start gap-1.5 [&>nav]:absolute [&>nav]:top-full [&>nav]:left-0 [&>nav]:mt-2 [&>nav]:w-[min(400px,70vw)]"
              : "absolute top-0 left-4 flex w-[min(400px,calc(100%-32px))] flex-col items-start gap-1.5"
          }
        >
          <ContentsMenu documentId={documentId} open={contentsOpen} onOpenChange={setContentsOpen} />
        </div>
      </div>
  );
  // Extract: a link into the extract page. While a run is going, a progress
  // bar shows under its button. Top right of
  // the page in Normal view; the end of the pane header in a split view. A
  // transcript has none: the video pane has its own tools (SPEC.md §11).
  const distillButton = (
        <>
        <div className="relative">
          <button
            onClick={() => openDistillPage(distillShownId)}
            data-track="distill-page"
            className="flex items-center gap-1.5 rounded-full bg-sand-100 px-3.5 py-1.5 text-xs font-semibold text-sand-600 shadow-soft hover:text-clay-800"
            data-tip={t("reader.distillButtonTitle")}
          >
            <QuoteIcon size={13} />
            {t("reader.distill")}
            {allDistillations.length > 0 ? ` (${allDistillations.length})` : ""}
          </button>
          {distillRun && (
            <span aria-hidden className="progress-track absolute right-1.5 -bottom-[7px] left-1.5">
              <span className="progress-fill" />
            </span>
          )}
        </div>
        </>
  );

  // Collapse (SPEC.md §28): the button at the top right, beside Extract.
  // Pressed, every block shows its core and the button reads Collapsed;
  // pressed again, the article shows whole.
  const collapseButton = (
    <button
      onClick={() => {
        collapseNew.seen();
        // A page editor collapses in Viewing: Editing needs the words.
        const page = richText && !collapseOn ? pageEditorIn(containerRef.current) : null;
        // Collapse off goes back to the mode it left.
        if (page?.isEditable) fireDocs(page, DOCS_EVENT.mode, { mode: "viewing", collapse: true } satisfies ModeRequest);
        void toggleCollapse();
      }}
      data-track={collapseBusy ? "collapse-stop" : collapseOn ? "collapse-off" : "collapse"}
      aria-pressed={collapseOn}
      data-tip={t(
        collapseBusy ? "reader.collapseStopTitle" : collapseOn ? "reader.collapseOffTitle" : "reader.collapseTitle",
      )}
      className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold shadow-soft disabled:opacity-60 ${
        collapseOn ? "bg-ink text-paper" : "bg-sand-100 text-sand-600 hover:text-clay-800"
      }${collapseNew.isNew ? ` ${NEW_GLOW_CLASS}` : ""}`}
    >
      {collapseBusy ? <SpinnerIcon size={13} className="motion-safe:animate-spin" /> : <CollapseIcon size={13} />}
      {t(collapseBusy ? "reader.collapsing" : collapseOn ? "reader.collapsed" : "reader.collapse")}
      {collapseBusy && <StopPill />}
      {collapseNew.isNew && <NewPill />}
    </button>
  );
  // The annotation each card over the article holds, as a reference
  // (lib/annotation-reference.ts): what its grip and a hold on it drag.
  const annotationCardReference = annotationCard
    ? annotationReference({
        noteId: annotationCard.noteId,
        sourceId: annotationCard.sourceId,
        kind: annotationCard.kind,
        quote: annotationCard.quotedText,
        content: annotationCard.saved,
      })
    : null;
  const bubbleReference =
    bubble && !bubble.streaming
      ? annotationReference({
          noteId: bubble.noteId,
          sourceId: bubble.noteId ? sourceIdOfNote(bubble.noteId) : null,
          kind: bubble.kind,
          quote: bubble.anchor ? passageText(bubble.anchor) : null,
          content: bubble.text,
          turns: bubble.conversation.length,
        })
      : null;
  const simplifyReference =
    simplifyCard && !simplifyCard.streaming
      ? annotationReference({
          noteId: simplifyCard.noteId,
          sourceId: simplifyCard.noteId ? sourceIdOfNote(simplifyCard.noteId) : null,
          kind: "simplify",
          quote: passageText(simplifyCard.anchor),
          content: simplifyCard.text,
          turns: simplifyCard.conversation.length,
        })
      : null;
  const assistantReference = assistantChat
    ? annotationReference({
        noteId: assistantChat.noteId,
        sourceId: assistantChat.noteId ? sourceIdOfNote(assistantChat.noteId) : null,
        kind: "assistant",
        quote: assistantChat.anchor ? passageText(assistantChat.anchor) : null,
        content: assistantChat.messages.map((m) => m.content).join(" "),
        turns: assistantChat.messages.length,
      })
    : null;
  // The stored comment's own card, opened from its mark: its grip and a hold
  // drag the comment like the tool cards' drag theirs.
  const commentSourceId = commentCard?.noteId ? sourceIdOfNote(commentCard.noteId) : null;
  const commentReference =
    commentCard && !commentCard.busy
      ? annotationReference({
          noteId: commentCard.noteId,
          sourceId: commentSourceId,
          kind: "comment",
          quote: commentCard.anchor ? passageText(commentCard.anchor) : null,
          content: commentCard.saved,
        })
      : null;
  // The plan's checklist and its buttons: under the answer in the chat card
  // that proposed it, or in the card at the window's foot for the panel's.
  // In a card the answer above says what the plan is, so the plan is its
  // action rows and Apply alone; the panel's card, far from its answer,
  // keeps its title and the reply.
  const planAlone = planFrom === "panel";
  const planBody = aiPlan ? (
    <>
      {planAlone && (
        <div className="mb-2 flex items-center gap-2">
          <SparkleIcon size={15} className="text-clay" />
          <span className="font-display text-[15px]">{t("reader.assistantPlan")}</span>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {planAlone && aiPlan.reply && (
        <div className="mb-2 text-[13px]">
          <Markdown>{aiPlan.reply}</Markdown>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        {aiPlan.actions.map((action, i) => (
          <label
            key={i}
            className="flex cursor-pointer items-start gap-2 rounded-xl bg-sand-100 px-3 py-2 text-[12.5px]"
          >
            <input
              type="checkbox"
              className="mt-0.5 accent-clay"
              checked={planChecked.has(i)}
              onChange={() =>
                setPlanChecked((prev) => {
                  const next = new Set(prev);
                  if (next.has(i)) next.delete(i);
                  else next.add(i);
                  return next;
                })
              }
            />
            <span className="min-w-0">
              <span className="mr-1.5 rounded-full bg-sand-200 px-2 py-0.5 text-[10px] font-semibold text-sand-700">
                {t(ACTION_LABEL_KEY[action.type])}
              </span>
              {action.description}
              {actionDetail(action, blocks, attachedDocuments, t) && (
                <span className="mt-0.5 block text-[11px] text-sand-500">
                  {actionDetail(action, blocks, attachedDocuments, t)}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
      </div>
      {aiPlan.warnings.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          {aiPlan.warnings.map((w, i) => (
            <li key={i} className="text-[11.5px] font-medium text-amber-700 dark:text-amber-400">
              ⚠ {w}
            </li>
          ))}
        </ul>
      )}
      <div className={`${planAlone ? "mt-3" : "mt-2"} flex items-center gap-2`}>
        <button
          disabled={planChecked.size === 0}
          onClick={() => void approvePlan()}
          data-track="plan-apply"
          data-tip={t("reader.applyActionsTitle")}
          className="rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
        >
          {t("reader.applyActions", { n: planChecked.size, s: plural(planChecked.size) })}
        </button>
        <button
          onClick={() => setAiPlan(null)}
          data-track="plan-cancel"
          data-tip={t("reader.discardPlanTitle")}
          className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
        >
          {t("common.reject")}
        </button>
      </div>
    </>
  ) : null;
  // The card that shows the plan; a plan whose card is closed waits for it.
  // A side chat shows its own plan; the main thread's waits in the main
  // thread, and a side chat with no answer yet shows none (TOOL13-03).
  const shownThreadNoteId = assistantChat?.openKey ? (chatOpenSide?.noteId ?? null) : (assistantChat?.noteId ?? null);
  const planInCard =
    aiPlan !== null &&
    planFrom === "chat" &&
    assistantChat !== null &&
    (assistantChat.openKey
      ? planNoteId !== null && shownThreadNoteId === planNoteId
      : planNoteId === null || shownThreadNoteId === null || shownThreadNoteId === planNoteId);
  // A plan lands under its answer: the turns show the answer from its start,
  // the plan under it (TOOL13-02).
  useEffect(() => {
    if (!planInCard) return;
    const raf = requestAnimationFrame(() => {
      const el = chatScrollRef.current;
      const answer = el ? [...el.querySelectorAll<HTMLElement>("[data-chat-answer]")].pop() : undefined;
      if (!el || !answer) return;
      el.scrollTop += answer.getBoundingClientRect().top - el.getBoundingClientRect().top - 8;
    });
    return () => cancelAnimationFrame(raf);
  }, [planInCard, chatMessageCount]);
  const planFloats = aiPlan !== null && planFrom === "panel";
  const barKey = bar ? barRunKey(bar) : null;
  // The bar on an image (SPEC.md §7): its chips read the image.
  const barFigure = bar?.figure === true;
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {/* A split view: the pane header — the pane's document, the article
          menu, Extract — one row above the scroller, never over the text
          (SPEC.md §6). On a transcript the header carries the document only. */}
      {split && (
        <div className={PANE_HEADER}>
          {paneHeader}
          {/* A blank document has no Contents. */}
          {!transcript && !richText && articleMenu}
          {!transcript && (
            <div className="relative ml-auto flex shrink-0 items-center gap-2">
              {collapseButton}
              {distillButton}
              {/* The article's errors: under the buttons, over the text. */}
              <div className="absolute top-full right-0 mt-2">
                <ArticleErrors documentId={documentId} />
              </div>
            </div>
          )}
        </div>
      )}
    <div
      ref={containerRef}
      data-reader-root
      onDragOver={onArticleDragOver}
      onDragLeave={(e) => {
        if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) hideDropLine();
        imageDrop.handlers.onDragLeave(e);
      }}
      onDrop={onArticleDrop}
      onPaste={onArticlePaste}
      // The inline restore script finds this pane's stored reading position by
      // its document (lib/reading-position.ts), and the account's copy here.
      // An embedded layer has none.
      data-document-id={embedded ? undefined : documentId}
      data-account-position={
        keepsAccountCopy && accountPosition ? JSON.stringify(accountPosition) : undefined
      }
      // A blank document or an import: the cards take the page editor's look,
      // and the page moves left by --docs-shift (SPEC.md §29). An import
      // keeps the notes tray open (lib/reading-position.ts).
      data-page-editor={richText ? "" : undefined}
      data-import={richText?.imported ? "" : undefined}
      data-docs-shift={richText && docsShift > 0 ? "" : undefined}
      // The column moves left to make room for a side card (SPEC.md §6, globals.css).
      data-cards-room={!richText && cardsRoom > 0 ? "" : undefined}
      style={
        richText
          ? ({ "--docs-shift": `${docsShift}px` } as React.CSSProperties)
          : cardsRoom > 0
            ? ({ "--cards-room": `${cardsRoom}px` } as React.CSSProperties)
            : undefined
      }
      // While the extract page is open it scrolls itself; the article
      // underneath must not scroll away, so the pane clips instead. An
      // embedded layer scrolls with the pane around it.
      className={
        embedded
          ? "relative min-w-0"
          : `relative min-h-0 min-w-0 flex-1 print:overflow-visible ${
              distillOpen || conversationView
                ? "overflow-hidden"
                : "overflow-y-auto"
            }`
      }
    >
      {!split && !transcript && !embedded && !richText && articleMenu}

      {/* The drop line: where an image dropped on the text lands. */}
      {dropLine && (
        <div
          aria-hidden
          data-drop-line
          className="pointer-events-none absolute z-20 h-0.5 rounded-full bg-clay"
          style={{ top: dropLine.top, left: dropLine.left, width: dropLine.width }}
        />
      )}

      {/* The controls float over the article at the top right of the pane
          and stay there as it scrolls: a sticky block with no height, so the
          text runs under them and never wraps around them. The toast sits
          under the controls, on the right, and wraps before it reaches the
          pane's left side, so the Contents button at the top left never
          covers its words; the article's errors sit under the toast. */}
      <div
        className={`pointer-events-none sticky z-10 h-0 print:hidden ${
          // A blank document's toolbar holds the top; the toasts sit under it.
          richText ? "top-[112px]" : "top-4"
        }`}
      >
      <div className="absolute top-0 right-4 left-4 flex flex-col items-end gap-2">
      <div
        className="pointer-events-auto flex items-center gap-2 rounded-full"
        data-nudge={!split && !transcript ? "tools" : undefined}
      >
        {editMode && (
          <select
            data-edit-control
            value={font ?? "default"}
            onChange={(e) => void setFont(e.target.value)}
            aria-label={t("reader.readerFont")}
            className="rounded-full bg-sand-100 px-3 py-1.5 text-xs font-semibold text-sand-700 shadow-soft outline-none"
          >
            <option value="default">Figtree</option>
            <option value="serif">{t("reader.fontSerif")}</option>
            <option value="mono">{t("reader.fontMono")}</option>
            <option value="sans">{t("reader.fontSans")}</option>
          </select>
        )}
        {editMode && (
          <button
            data-edit-control
            onClick={toggleEditMode}
            data-track="done"
            className="rounded-full bg-clay px-3.5 py-1.5 text-xs font-semibold text-clay-fg shadow-soft hover:bg-clay-600"
            data-tip={t("reader.backToReading")}
          >
            {t("common.done")}
          </button>
        )}
        {!split && !transcript && !embedded && !richText && collapseButton}
        {!split && !transcript && !embedded && !richText && distillButton}
      </div>
      {/* A pending link's banner: under the controls, beside the toast, so
          it covers no control. Escape or its ✕ cancels the link. */}
      <Presence show={pendingLink !== null && !embedded} exit="fade">
        {pendingLink && !embedded && (
          <div
            data-link-banner
            className="pointer-events-auto flex max-w-full items-center gap-1 rounded-full bg-card py-1 pr-1 pl-4 shadow-float"
          >
            <span className="truncate text-[12.5px] text-sand-700">
              {t("reader.linkingBanner", {
                quote:
                  pendingLink.anchor.quotedText.slice(0, 48) +
                  (pendingLink.anchor.quotedText.length > 48 ? "…" : ""),
                source:
                  pendingLink.fromDocumentId === documentId
                    ? t("reader.thisDocument")
                    : (attachedDocuments.find((d) => d.id === pendingLink.fromDocumentId)?.title ??
                      t("reader.anotherDocument")),
              })}
            </span>
            <button
              onClick={() => broadcastPendingLink(null)}
              data-track="cancel-link"
              aria-label={t("reader.cancelLink")}
              data-tip={t("reader.cancelLink")}
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs text-sand-500 hover:bg-sand-100 hover:text-clay-700"
            >
              ✕
            </button>
          </div>
        )}
      </Presence>
      <Presence show={toast !== null} exit="fade">
        {toast && (
          <span
            data-reader-toast
            className="pointer-events-auto flex max-w-[min(34rem,100%)] items-center gap-2 rounded-[18px] bg-ink/90 px-3 py-1.5 text-xs leading-snug text-paper"
          >
            <span className="min-w-0">{toast}</span>
            {toastAction && (
              <button
                onClick={toastAction.run}
                data-track="toast-action"
                className="shrink-0 rounded-full bg-paper/20 px-2.5 py-0.5 font-semibold hover:bg-paper/30"
              >
                {toastAction.label}
              </button>
            )}
          </span>
        )}
      </Presence>
      {!split && !transcript && !embedded && <ArticleErrors documentId={documentId} />}
      </div>
      </div>

      {/* The article's band (SPEC.md §6): Contents at the left and Collapse
          and Extract at the right stand on it, and the text scrolls under
          it, so they never sit on a word. It takes no room: the article
          starts where it did, its first line just under the band. */}
      {!split && !transcript && !embedded && !richText && (
        <div aria-hidden data-article-band className="pointer-events-none sticky top-0 z-[9] -mb-12 h-12 bg-paper print:hidden" />
      )}

      {/* Not in a split pane: the card would sit over the title. Not on a
          transcript: it has no edit mode. Under the toast, which may reach
          down over it. It yields while a toolbar is open: the stack beside
          the first lines would cut its words. */}
      {editHint && hintBeside && !editMode && !split && !transcript && !embedded && !richText && (
        <div
          onAnimationEnd={hintPlayed}
          className={`hint-fade pointer-events-none absolute top-16 right-5 z-[9] rounded-2xl bg-card px-4 py-2.5 leading-relaxed text-sand-700 shadow-lift print:hidden ${
            coarse ? "max-w-80 text-[13px]" : "max-w-64 text-[12px]"
          }${popover ? " invisible" : ""}`}
        >
          {t(coarse ? "reader.touchHint" : "reader.editHint")}
        </div>
      )}

      <Reader
        title={title}
        blocks={blocks}
        documentId={documentId}
        highlightsByBlock={highlightsByBlock}
        mode={editMode ? "edit" : "read"}
        font={font}
        columnWidth={columnWidth}
        captionGaps={captionGaps}
        figureRender={figureRender}
        stylesByBlock={stylesByBlock}
        editedByBlock={editedByBlock}
        pages={
          conversion
            ? { notebookId, canEdit, marksByBlock: pageMarksByBlock, sizeByBlock: pageSizeByBlock, conversion }
            : null
        }
        onSaveText={saveBlockEdit}
        onFormatBlock={formatBlock}
        onToggleStyle={toggleStyleSpan}
        onInsertBlock={insertBlock}
        onDeleteBlock={deleteBlock}
        history={{ canUndo: historyDepth.undo > 0, canRedo: historyDepth.redo > 0 }}
        onUndo={() => void runStep(true)}
        onRedo={() => void runStep(false)}
        flushRef={flushEditRef}
        richText={
          richText
            ? {
                ...richText,
                canEdit,
                // Collapse alone: the rail's Extract tab has Extract from
                // the article (PAGE12-11).
                aiControls: !split && !embedded ? <div className="flex items-center gap-2">{collapseButton}</div> : null,
                notebookId,
                documents: attachedDocuments,
                // An import's References section stands under its pages,
                // under the page editor's header.
                footer: <Bibliography references={references} />,
              }
            : null
        }
        transcript={transcript}
        embedded={embedded}
        banner={
          <TranslationBar
            documentId={documentId}
            text={blocks.map((b) => b.text).join("\n").slice(0, 4000)}
            available={translationAvailable}
            onTranslations={setTranslations}
          />
        }
        translations={translations}
        collapse={cores ? { cores, on: collapseOn, flipped: flippedBlocks, flip: flipBlock, off: collapseOff } : null}
        leftOffBlockId={leftOffBlockId}
        accountPositionAtOpen={accountAtOpen !== null}
      />

      {!richText && <Bibliography references={references} />}

      {richText && <CardColumn ref={setColumnHost} split={split} comments={columnComments} />}
      {inColumn(<>
      {/* The chooser of stacked annotations stands on its own, not in the
          annotation card's Presence: it opens with no card open. */}
      {stackChooser && (
        <div
          data-selection-popover
          data-stack-chooser
          role="menu"
          className={`pop-in absolute ${TOOL_LAYER} flex w-60 flex-col gap-0.5 rounded-2xl border border-line bg-card p-1.5 shadow-float`}
          style={{ left: stackChooser.left, top: stackChooser.top }}
        >
          {stackChooser.sources.map((sid) => {
            const tool = annotationBubbles[sid];
            const summary = annotationsBySource[sid];
            // A plain note on the words: its row opens the note in the tray.
            const noteId = tool || summary ? null : noteOfSource(sid);
            if (noteId) {
              const note = notesById.get(noteId);
              const line = note
                ? noteTitle(note.content) || note.gist || markdownPreview(note.content)
                : (anchorOfSource(sid)?.quotedText ?? "");
              return (
                <button
                  key={sid}
                  role="menuitem"
                  data-track="stack-chooser-note"
                  onClick={() => {
                    setStackChooser(null);
                    window.dispatchEvent(new CustomEvent("dissect:show-note", { detail: { noteId } }));
                  }}
                  className="flex min-w-0 flex-col items-start rounded-xl px-2.5 py-1.5 text-left hover:bg-sand-100"
                >
                  <span className="text-[10.5px] font-bold tracking-[0.08em] text-clay-600 uppercase">
                    {t("reader.note")}
                  </span>
                  <span className="line-clamp-2 text-[12px] text-sand-700">{line}</span>
                </button>
              );
            }
            // A source with neither a tool nor a summary is a highlight.
            const kind = tool ? tool.kind : (summary?.kind ?? "highlight");
            // What the mark holds, not the words again: a comment's words, a
            // tool's answer, a highlight's comment (a pure highlight stores
            // its quote: its row is its hue alone).
            const held = tool
              ? markdownPreview(tool.content)
              : summary && summary.content !== (summary.quotedText ?? "")
                ? summary.content
                : "";
            return (
              <button
                key={sid}
                role="menuitem"
                data-track="stack-chooser-open"
                onClick={() => {
                  setStackChooser(null);
                  window.dispatchEvent(new CustomEvent("dissect:open-annotation", { detail: { sourceId: sid } }));
                }}
                className="flex min-w-0 flex-col items-start rounded-xl px-2.5 py-1.5 text-left hover:bg-sand-100"
              >
                <span
                  className="flex items-center gap-1.5 text-[10.5px] font-bold tracking-[0.08em] uppercase"
                  style={{ color: annotationKindColor(kind, summary?.color ?? null) }}
                >
                  {kind === "highlight" && (
                    <span
                      aria-hidden
                      className="size-2 rounded-full"
                      style={{ background: annotationKindColor(kind, summary?.color ?? null) }}
                    />
                  )}
                  {t(ANNOTATION_KIND_KEY[kind])}
                </span>
                {held && <span className="line-clamp-2 text-[12px] text-sand-700">{held}</span>}
              </button>
            );
          })}
        </div>
      )}
      <Presence show={annotationCard !== null} exit="pop">
      {annotationCard && (
        <div
          data-selection-popover
          data-annotation-card
          // The block reader docks it like a tool card (SPEC.md §6).
          data-side-card={richText ? undefined : "annotation"}
          onPointerDown={holdAnnotation(annotationCardReference)}
          className={`group/hlcard pop-in absolute ${TOOL_LAYER} w-[300px] rounded-2xl border bg-card p-3 shadow-float${underView}`}
          // The card's border and label carry the annotation's kind color (SPEC.md §6).
          style={{
            top: annotationCard.top,
            left: annotationCard.left,
            width: annotationCard.width,
            borderColor: annotationKindColor(annotationCard.kind, annotationCard.color),
          }}
        >
          <div className="mb-2 flex items-center justify-between">
            <span
              className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.08em] uppercase"
              style={{ color: annotationKindColor(annotationCard.kind, annotationCard.color) }}
            >
              {annotationGrip(annotationCardReference)}
              {annotationCard.kind === "highlight" ? t("reader.highlight") : t("reader.comment")}
            </span>
            <button
              onClick={() => setAnnotationCard(null)}
              data-track="annotation-close"
              aria-label={t("common.close")}
              data-tip={t("common.close")}
              className="rounded-full px-1.5 text-sand-500 hover:text-clay-800"
            >
              ✕
            </button>
          </div>
          {annotationCard.kind === "highlight" && (
            <div className="mb-2.5 flex items-center gap-2">
              {HIGHLIGHT_HUES.map((color) => (
                <button
                  key={color}
                  onClick={() => void recolorAnnotation(color)}
                  data-track={`annotation-recolor:${color}`}
                  disabled={annotationCard.busy}
                  aria-label={t("reader.recolor", { color: t(HUE_KEY[color]) })}
                  data-tip={t("reader.recolor", { color: t(HUE_KEY[color]) })}
                  className={`size-5 rounded-full disabled:opacity-40 ${
                    annotationCard.color === color ? "ring-2 ring-sand-600 ring-offset-2" : ""
                  }`}
                  style={{ background: HUE_DOT[color] }}
                />
              ))}
            </div>
          )}
          <textarea
            value={annotationCard.draft}
            onChange={(e) =>
              setAnnotationCard((c) => (c ? { ...c, draft: e.target.value } : c))
            }
            onKeyDown={(e) => {
              if (isImeKey(e)) return;
              const styled = markdownStyleKey(e);
              if (styled !== null) {
                setAnnotationCard((c) => (c ? { ...c, draft: styled } : c));
                return;
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (annotationCard.draft.trim() !== annotationCard.saved.trim()) void saveAnnotation();
                return;
              }
              if (e.key === "Escape") {
                // This card closes, and only this card (SPEC.md §6).
                e.stopPropagation();
                setAnnotationCard(null);
              }
            }}
            placeholder={t("reader.addCommentPlaceholder")}
            // One line at rest; the field grows while the reader writes, and
            // stays grown while the card holds focus or unsaved words: a
            // field that shrank on the press would move Save from under it.
            rows={1}
            className={`field-sizing-content max-h-48 min-h-9 w-full resize-none rounded-xl bg-sand-100 px-2.5 py-2 text-[13px] outline-none placeholder:text-sand-500 ${
              annotationCard.draft.trim() !== annotationCard.saved.trim()
                ? "min-h-[4.5rem]"
                : "group-focus-within/hlcard:min-h-[4.5rem]"
            }`}
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="flex items-center gap-3">
              <button
                onClick={() => void deleteAnnotation()}
                data-track="annotation-delete"
                data-tip={annotationCard.kind === "highlight" ? t("reader.deleteHighlightTitle") : t("reader.deleteCommentTitle")}
                disabled={annotationCard.busy}
                className="text-xs font-semibold text-red-500 hover:text-red-700 disabled:opacity-40"
              >
                {t("common.delete")}
              </button>
              {/* A link across texts starts from the highlight: the next
                  words the reader selects, here or in another text, close it. */}
              {annotationCard.kind === "highlight" && (
                <button
                  onClick={(e) => {
                    window.dispatchEvent(
                      new CustomEvent("dissect:start-link", {
                        detail: { sourceId: annotationCard.sourceId, origin: e.currentTarget },
                      }),
                    );
                    setAnnotationCard(null);
                  }}
                  data-track="link-chip"
                  aria-label={t("panes.linkToOtherTexts")}
                  data-tip={t("panes.linkToOtherTexts")}
                  className="flex size-6 items-center justify-center rounded-full text-sand-600 hover:bg-clay-100 hover:text-clay-800"
                >
                  <UnlinkIcon size={12} />
                </button>
              )}
            </span>
            {/* The mic and Save show once the reader writes: a card opened to
                recolor or delete holds no dead buttons. */}
            <span
              className={`items-center gap-1.5 ${
                annotationCard.draft.trim() !== annotationCard.saved.trim() ? "flex" : "hidden group-focus-within/hlcard:flex"
              }`}
            >
              <VoiceTypingButton track="annotation-voice-typing" />
              <button
                onClick={() => void saveAnnotation()}
                data-track="annotation-save"
                disabled={annotationCard.busy || annotationCard.draft.trim() === annotationCard.saved.trim()}
                className="rounded-full bg-clay px-3 py-1 text-[11px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
              >
                {t("common.save")}
              </button>
            </span>
          </div>
        </div>
      )}
      </Presence>

      <Presence show={extractCard !== null} exit="pop">
      {extractCard &&
        (() => {
          const extraction = allExtractions.find((x) => x.id === extractCard.id);
          if (!extraction) return null;
          return (
            <div
              data-selection-popover
              className={`pop-in absolute ${TOOL_LAYER} w-[300px] rounded-2xl bg-card p-3 shadow-float${underView}`}
              style={{ top: extractCard.top, left: extractCard.left }}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
                  <ExtractIcon size={12} />
                  {t("reader.extractLabel", { label: extraction.label })}
                </span>
                <button
                  onClick={() => setExtractCard(null)}
                  data-track="extract-card-close"
                  aria-label={t("common.close")}
                  data-tip={t("common.close")}
                  className="rounded-full px-1.5 text-sand-500 hover:text-clay-800"
                >
                  ✕
                </button>
              </div>
              <div className="-mr-1 max-h-[260px] overflow-y-auto pr-1">
                <p className="text-[10.5px] font-bold tracking-[0.08em] text-sand-500 uppercase">
                  {t("reader.extractCardOrigin")}
                </p>
                <div className="mt-1 flex flex-col gap-1">
                  <ExtractRow
                    span={extraction.origin}
                    origin
                    onJump={jumpToExtractSpan}
                    t={t}
                  />
                </div>
                <p className="mt-3 text-[10.5px] font-bold tracking-[0.08em] text-sand-500 uppercase">
                  {t("reader.extractCardPassages", {
                    n: extraction.spans.length,
                    s: plural(extraction.spans.length),
                  })}
                </p>
                <div className="mt-1 flex flex-col gap-1">
                  {extraction.spans.map((span, i) => (
                    <ExtractRow
                      key={`${span.blockId}:${span.start}:${i}`}
                      span={span}
                      onJump={jumpToExtractSpan}
                      t={t}
                    />
                  ))}
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <AuthorChip createdById={extraction.createdById} />
                {canEdit && (
                  <span className="flex items-center gap-3">
                    <button
                      onClick={() => void deleteExtraction(extraction.id)}
                      data-track="extract-card-delete"
                      className="text-xs font-semibold text-red-500 hover:text-red-700"
                      data-tip={t("reader.deleteExtractionTitle")}
                    >
                      {t("common.delete")}
                    </button>
                  </span>
                )}
              </div>
            </div>
          );
        })()}
      </Presence>

      {connectors.length > 0 && (
        <svg
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 z-10 w-full"
          style={{ height: connectorHeight }}
        >
          {connectors.map((line, i) => (
            <line key={i} className="connector-line" {...line} />
          ))}
        </svg>
      )}

      <Presence show={popover !== null} exit="pop">
      {popover && (
        <div
          data-selection-popover
          data-layer-toolbar
          data-track-surface="ai-toolbar"
          onMouseDown={(e) => {
            // Keep the text selection alive under the rail — but let fields
            // take focus, or the inputs could never place a caret.
            const target = e.target as HTMLElement;
            if (target.closest("textarea, input")) return;
            e.preventDefault();
          }}
          // Beside the page editor's page it fades in (docs/css/layer.css).
          className={`${popover.page && popover.side === "right" ? "docs-toolbar-in" : "pop-in"} absolute ${TOOLBOX_LAYER} flex flex-col gap-0.5 rounded-2xl bg-card p-1.5 shadow-float`}
          style={popoverBox}
        >
          {/* A passage over more blocks than an annotation or a note takes
              (MAX_SEGMENTS) says so in place of the tools, before a press
              that could only fail. */}
          {passageTooLong ? (
            <p data-passage-too-long className="max-w-56 px-2.5 py-1.5 text-[12px] leading-snug text-sand-700">
              {t("reader.passageTooLong", { n: MAX_SEGMENTS })}
            </p>
          ) : (<>
          {popover.truncated && (
            <p className="px-2.5 py-1 text-[10.5px] leading-snug text-sand-500">
              {t(popover.page ? "docsLayer.leftOut" : "reader.anchorsFirstParagraph")}
            </p>
          )}
          {popoverKind !== "text" && (
            <p className="px-2.5 py-1 text-[10.5px] leading-snug text-sand-500">
              {t(KIND_LABEL[popoverKind])}
            </p>
          )}
          {popover.term && (
            <p className="px-2.5 py-1 text-[10.5px] leading-snug text-sand-500">
              {t("reader.keyTerm")}
            </p>
          )}
          {/* With a link pending, Close link is the toolbox's first row: the
              selection is the link's other end once it is pressed. */}
          {pendingLink && !inCore && (
            <button
              disabled={busy}
              onClick={() => void completeLink()}
              data-track="close-link"
              data-tip={t("reader.closeLinkTitle")}
              className={`order-first flex w-full items-center gap-1.5 rounded-full bg-sage-600 ${toolRow} text-left font-semibold text-sage-fg hover:bg-sage-700 disabled:opacity-40`}
            >
              {busy ? <SpinnerIcon size={11} className="motion-safe:animate-spin" /> : <LinkIcon size={11} />}
              {t("reader.closeLink")}
            </button>
          )}

          {/* Define (SPEC.md §6): the first row when the selection is one
              word, right under the highlight colors — in the compact
              toolbox, where the colors are the toolbox's first row, the row
              after them. The definition opens under the row. */}
          {has("define") && (
            <div className="-order-2 flex flex-col gap-0.5">
              <button
                onClick={() => {
                  defineNew.seen();
                  void define();
                }}
                data-track="define"
                aria-disabled={aiOff || undefined}
                aria-expanded={submenu === "define"}
                data-tip={aiTip(leadTip("define", t("reader.defineTitle")))}
                className={`flex w-full items-center justify-between gap-2 rounded-full ${toolRow} text-left ${
                  submenu === "define" ? "bg-clay-100 text-clay-800" : rowLook("define")
                }${defineNew.isNew ? ` ${NEW_GLOW_CLASS}` : ""}${aiDim}`}
              >
                <span className="flex items-center gap-1.5">
                  <DefineIcon size={coarse ? 14 : 12} />
                  {t("reader.define")}
                  {defineNew.isNew && <NewPill />}
                </span>
              </button>
              <Collapse open={submenu === "define" && shownDefinition !== null}>
                {shownDefinition && (
                  <div data-definition className="flex flex-col gap-1 px-2.5 pt-0.5 pb-1.5">
                    <span className="text-[12px] font-semibold break-words text-sand-900">
                      {defineWord(popover.anchor.quotedText)}
                    </span>
                    {shownDefinition.text && (
                      <p className="text-[12.5px] leading-snug break-words whitespace-pre-line text-sand-800">
                        {shownDefinition.text}
                      </p>
                    )}
                    {shownDefinition.streaming && !shownDefinition.text && (
                      <ThinkingIndicator
                        label={t("reader.defining")}
                        className="py-0.5 text-[11.5px]"
                        onStop={stopDefine}
                      />
                    )}
                    {shownDefinition.error && (
                      <p className="text-[11.5px] leading-snug text-red-600">{shownDefinition.error}</p>
                    )}
                    {!shownDefinition.streaming &&
                      !shownDefinition.error &&
                      !shownDefinition.glossary &&
                      shownDefinition.text && (
                        <RatingButtons
                          tool="define"
                          input={popover.anchor.quotedText}
                          output={shownDefinition.text}
                          notebookId={notebookId}
                          documentId={documentId}
                          className="self-end"
                        />
                      )}
                  </div>
                )}
              </Collapse>
            </div>
          )}

          <button
            onClick={() => (barOffered ? openBar(popover) : setSubmenu(submenu === "ai" ? null : "ai"))}
            data-track="assistant"
            aria-disabled={aiOff || undefined}
            aria-expanded={submenu === "ai"}
            data-tip={aiTip(t("reader.assistantTitle"))}
            className={`flex w-full items-center gap-1.5 rounded-full ${toolRow} text-left font-semibold ${
              submenu === "ai"
                ? "bg-clay-100 text-clay-800"
                : "text-clay-700 hover:bg-clay-100 hover:text-clay-800"
            }${aiDim}`}
          >
            <SparkleIcon size={coarse ? 14 : 12} />
            {t(barOffered ? "reader.editWithAssistant" : "reader.assistant")}
          </button>
          <Collapse open={submenu === "ai"}>
          {submenu === "ai" && (
            <div className="flex flex-col gap-1.5 p-1">
              {/* The question that runs, out of the field (SPEC.md §6). */}
              {aiSent && aiSent.from === popover.anchor && (
                <p data-assistant-sent className="line-clamp-3 rounded-xl border-l-2 border-clay-300 bg-sand-50 px-2 py-1 text-[12px] text-sand-700">
                  {aiSent.text}
                </p>
              )}
              <textarea
                autoFocus
                value={aiCommand}
                onFocus={caretToEnd}
                onChange={(e) => {
                  setAiCommand(e.target.value);
                  if (popover) writeToolbarDraft("assistant", documentId, popover.anchor, e.target.value);
                }}
                {...ime.props}
                onKeyDown={(e) => {
                  if (ime.isImeEnter(e) || isImeKey(e)) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void runAssistant();
                  }
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setSubmenu(null);
                  }
                }}
                placeholder={t(popover.figure ? "reader.figureBarPlaceholder" : "reader.assistantPlaceholder")}
                rows={2}
                className="w-full resize-none rounded-xl bg-sand-100 p-2 text-[12px] outline-none placeholder:text-sand-500"
              />
              {popover.figure && !aiBusy && (
                <div className="flex flex-wrap items-center gap-1">
                  {FIGURE_CHIPS.map((chip) => (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={() => void runAssistant(t(chip.command))}
                      data-track={`assistant-figure:${chip.label.slice("reader.figure".length)}`}
                      data-tip={t("reader.figureChipTitle")}
                      className="rounded-full bg-sand-100 px-2.5 py-0.5 text-[11px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800 pointer-coarse:py-1.5"
                    >
                      {t(chip.label)}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                <ThinkingChips small />
                <WebChip small />
                <span className="ml-auto flex items-center gap-1.5">
                <VoiceTypingButton track="assistant-voice" className="size-8" size={14} />
                <button
                  disabled={!aiBusy && !aiCommand.trim()}
                  onClick={() => (aiBusy ? stopAssistantChat() : void runAssistant())}
                  data-track="assistant-run"
                  data-tip={aiBusy ? t("reader.stopAssistant") : t("reader.sendTitle")}
                  aria-label={aiBusy ? t("reader.stopAssistant") : undefined}
                  className="rounded-full bg-clay px-3 py-1.5 text-[11px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
                >
                  {aiBusy ? <StopIcon size={11} /> : t("reader.send")}
                </button>
                </span>
              </div>
              {aiBusy && <ThinkingIndicator className="px-1 pb-0.5 text-[11.5px]" />}
              {/* A failed run says so here, where the reader asked (SPEC.md §6). */}
              {!aiBusy && aiError && aiError.from === popover.anchor && (
                <p data-assistant-error role="alert" className="px-1 pb-0.5 text-[12px] font-medium text-red-600">
                  {aiError.text}
                </p>
              )}
            </div>
          )}
          </Collapse>

          {/* Analyze leads the figure toolbar (SPEC.md §4): the three-section
              analysis beside the article. Never on text. */}
          {has("analyze") && (
            <button
              onClick={() => void analyze()}
              data-track="analyze"
              aria-disabled={aiOff || undefined}
              data-tip={aiTip(`${t("reader.analyzeFigureTitle")}\n${t("reader.recommended")}`)}
              className={`flex w-full items-center gap-1.5 rounded-full bg-clay-100 ${toolRow} text-left font-semibold text-clay-800 hover:bg-clay-200 disabled:opacity-40${aiDim}`}
            >
              <ChartIcon size={coarse ? 14 : 12} />
              {t("reader.analyzeFigure")}
            </button>
          )}
          <div className={pairRow(has("explain") && has("simplify"))}>
          {has("explain") && (
            <button
              onClick={() => void explain()}
              data-track="explain"
              aria-disabled={aiOff || undefined}
              data-tip={aiTip(
                leadTip("explain", popoverKind === "figure" ? t("reader.explainFigureTitle") : t("reader.explainTitle")),
              )}
              className={`flex w-full min-w-0 items-center gap-1.5 rounded-full ${
                coarse && has("simplify") ? halfRow : toolRow
              } text-left ${rowLook("explain")}${aiDim}`}
            >
              <QuestionIcon size={coarse ? 14 : 12} />
              {t("reader.explain")}
            </button>
          )}
          {has("simplify") && (
            <button
              onClick={() => void simplify()}
              data-track="simplify"
              aria-disabled={aiOff || undefined}
              data-tip={aiTip(leadTip("simplify", t("reader.simplifyTitle")))}
              className={`flex w-full min-w-0 items-center gap-1.5 rounded-full ${
                coarse && has("explain") ? halfRow : toolRow
              } text-left ${rowLook("simplify")}${aiDim}`}
            >
              <SummaryIcon size={coarse ? 14 : 12} />
              {t("reader.simplify")}
            </button>
          )}
          </div>
          <div className={pairRow(has("visualize") && has("comment"))}>
          {has("visualize") && (
            <button
              onClick={() => void visualize()}
              data-track="visualize"
              aria-disabled={aiOff || undefined}
              data-tip={aiTip(leadTip("visualize", t("reader.visualizeTitle")))}
              className={`flex w-full min-w-0 items-center justify-between gap-1.5 rounded-full ${
                coarse && has("comment") ? halfRow : toolRow
              } text-left ${rowLook("visualize")}${aiDim}`}
            >
              <span className="flex items-center gap-1.5">
                <VisualizeIcon size={coarse ? 14 : 12} />
                {t("reader.visualize")}
              </span>
              {/* Visualize is Unitos Ultra: an account without it sees the
                  tier mark (its word too, where the row has the room). */}
              {!ultra && (
                <span
                  data-tip={t("reader.ultra")}
                  className="flex items-center gap-1 text-[9px] font-bold tracking-[0.06em] text-sand-500 uppercase"
                >
                  <TierMark state="ultra" size={10} />
                  {!(coarse && has("comment")) && t("reader.ultra")}
                </span>
              )}
            </button>
          )}
          {has("comment") && (
          <button
            onClick={() => {
              if (submenu === "comment") focusPageAfterComment();
              setSubmenu(submenu === "comment" ? null : "comment");
            }}
            data-track="comment"
            aria-expanded={submenu === "comment"}
            data-tip={leadTip("comment", t("reader.commentTitle"))}
            className={`flex w-full min-w-0 items-center gap-1.5 rounded-full ${
              coarse && has("visualize") ? halfRow : toolRow
            } text-left ${submenu === "comment" ? "bg-clay-100 text-clay-800" : rowLook("comment")}`}
          >
            <CommentIcon size={coarse ? 14 : 12} />
            {t("reader.comment")}
          </button>
          )}
          </div>

          {has("comment") && (
          <Collapse open={submenu === "comment"}>
          {submenu === "comment" && (
            <form
              className="flex flex-col gap-1.5 p-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (commentDraft.trim()) void annotate({ comment: commentDraft });
              }}
            >
              <textarea
                autoFocus
                value={commentDraft}
                onFocus={caretToEnd}
                onChange={(e) => {
                  setCommentDraft(e.target.value);
                  setCommentError(null);
                }}
                {...ime.props}
                onKeyDown={(e) => {
                  if (ime.isImeEnter(e) || isImeKey(e)) return;
                  const styled = markdownStyleKey(e);
                  if (styled !== null) {
                    setCommentDraft(styled);
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey && commentDraft.trim()) {
                    e.preventDefault();
                    void annotate({ comment: commentDraft });
                  }
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setSubmenu(null);
                    focusPageAfterComment();
                  }
                }}
                placeholder={t("reader.commentPlaceholder")}
                rows={2}
                className="w-full resize-none rounded-xl bg-sand-100 p-2 text-[12px] outline-none placeholder:text-sand-500"
              />
              {commentError && commentError.from === popover.anchor && (
                <p data-comment-error role="alert" className="px-1 text-[12px] font-medium text-red-600">
                  {commentError.text}
                </p>
              )}
              <span className="flex items-center justify-end gap-1.5">
                <VoiceTypingButton track="comment-voice-typing" />
                <button
                  type="submit"
                  data-track="comment-save"
                  disabled={busy || !commentDraft.trim()}
                  className="rounded-full bg-clay px-3 py-1 text-[11px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
                >
                  {t("common.save")}
                </button>
              </span>
            </form>
          )}
          </Collapse>
          )}

          {has("link") && (
          <button
            onClick={beginLink}
            data-track="link"
            data-tip={leadTip("link", t("reader.linkTitle"))}
            className={`flex w-full items-center gap-1.5 rounded-full ${toolRow} text-left ${rowLook("link")}`}
          >
            <UnlinkIcon size={coarse ? 14 : 12} />
            {t("reader.linkAcrossTexts")}
          </button>
          )}

          {/* Highlight: the color dots are the toolbox's first row, and the
              voice ends it. */}
          {has("highlight") && (
          <div
            className={`order-first flex items-center justify-around rounded-full ${coarse ? "px-2 py-2" : "px-1.5 py-1"}${leadRing("highlight")}`}
          >
            {HIGHLIGHT_HUES.map((color) => (
              <button
                key={color}
                disabled={busy}
                // A comment kept from before rides along only while its box is open.
                onClick={() => void annotate({ color, comment: (submenu === "comment" && commentDraft.trim()) || undefined })}
                data-track={`highlight:${color}`}
                aria-label={t("reader.highlightIn", { color: t(HUE_KEY[color]) })}
                data-tip={t(
                  submenu === "comment" && commentDraft.trim() ? "reader.highlightInWithNote" : "reader.highlightIn",
                  { color: t(HUE_KEY[color]) },
                )}
                className={`${coarse ? "size-7" : "size-5"} rounded-full transition-transform hover:scale-110 disabled:opacity-40`}
                style={{ background: HUE_DOT[color] }}
              />
            ))}
            {has("readAloud") && voiceButton}
          </div>
          )}
          {toolError?.at === "highlight" && toolError.from === popover.anchor && (
            <p data-tool-error role="alert" className="order-first px-2 py-1 text-[12px] font-medium text-red-600">
              {toolError.text}
            </p>
          )}

          {/* Add to notes: the toolbox's second row. One press makes a new
              note in the first section with the words as its quote, as Enter
              in its field does; the ▾ half opens the panel: the field for the
              note's words, the sections, and Add to a note…. */}
          {has("addToNotes") && sectionChoices.length > 0 && (
            <div className={`-order-1 flex flex-col gap-0.5 rounded-2xl${leadRing("addToNotes")}`}>
              <div className="flex w-full items-stretch gap-px">
                <button
                  disabled={busy}
                  onClick={() => void addToSection(sectionChoices[0].id)}
                  data-track="add-to-notes"
                  data-tip={t("reader.addToNotesTitle", { section: sectionChoices[0].label })}
                  className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-l-full bg-clay ${toolRow} text-left font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-60`}
                >
                  <NotesIcon size={coarse ? 14 : 12} />
                  {t("reader.addToNotes")}
                </button>
                <button
                  onClick={() => setSubmenu(submenu === "add" ? null : "add")}
                  data-track="add-to-notes-more"
                  aria-expanded={submenu === "add"}
                  aria-label={t("reader.addToNotesMoreTitle")}
                  data-tip={t("reader.addToNotesMoreTitle")}
                  className={`flex items-center justify-center rounded-r-full bg-clay ${coarse ? "w-11" : "w-7"} text-clay-fg hover:bg-clay-600`}
                >
                  <ChevronDownIcon size={coarse ? 14 : 12} className={submenu === "add" ? "rotate-180" : undefined} />
                </button>
              </div>
              {toolError?.at === "add" && toolError.from === popover.anchor && (
                <p data-tool-error role="alert" className="px-2 py-0.5 text-[12px] font-medium text-red-600">
                  {toolError.text}
                </p>
              )}
          {(() => {
            // The panel: the field for the note's words on top, then the
            // sections for a new note under "New note in", then Add to a
            // note…, which swaps the sections for the note picker.
            const first = sectionChoices[0];
            const hasNotes = sections.some((s) =>
              [s, ...s.children].some((x) => x.notes.some((n) => n.status === "ACCEPTED")),
            );
            const smallLabel = `${coarse ? "text-[11px]" : "text-[10px]"} font-bold tracking-[0.08em] text-sand-500 uppercase`;
            const panel = submenu === "add" && (
              <div className="flex flex-col gap-0.5">
                <input
                  autoFocus={!coarse}
                  value={addComment}
                  onFocus={caretToEnd}
                  onChange={(e) => setAddComment(e.target.value)}
                  {...ime.props}
                  onKeyDown={(e) => {
                    if (ime.isImeEnter(e) || isImeKey(e)) return;
                    // Enter: the fastest path, a new note in the first section.
                    if (e.key === "Enter" && !busy) {
                      e.preventDefault();
                      void addToSection(first.id);
                    }
                    // Escape folds the box and leaves the toolbar, as Comment's does.
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setSubmenu(null);
                      focusPageAfterComment();
                    }
                  }}
                  placeholder={t("reader.addNotePlaceholder")}
                  aria-label={t("reader.addNotePlaceholder")}
                  data-tip={t("reader.addCommentTitle", { section: first.label })}
                  data-track="add-to-notes-comment"
                  className={`w-full rounded-full bg-sand-100 ${
                    coarse ? "px-3.5 py-2.5 text-[14px]" : "px-2.5 py-1.5 text-[12px]"
                  } outline-none placeholder:text-sand-500`}
                />
                {addMode === "sections" ? (
                  <>
                    <span className={`px-2.5 pt-1.5 pb-0.5 ${smallLabel}`}>{t("reader.addNewNoteIn")}</span>
                    <div className="flex max-h-44 flex-col overflow-y-auto">
                      {sectionChoices.map((choice) => (
                        <button
                          key={choice.id}
                          disabled={busy}
                          onClick={() => void addToSection(choice.id)}
                          data-track="add-to-notes-section"
                          data-tip={t("reader.addPendingNote", { section: choice.label })}
                          className={`truncate rounded-full ${toolRow} text-left text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40`}
                        >
                          {choice.label}
                        </button>
                      ))}
                    </div>
                    {hasNotes && (
                      <>
                        <div className="mx-2.5 my-0.5 border-t border-line" />
                        <button
                          disabled={busy}
                          onClick={() => setAddMode("notes")}
                          data-track="add-to-notes-existing"
                          data-tip={t("reader.addToExistingNoteTitle")}
                          className={`flex w-full items-center justify-between gap-2 rounded-full ${toolRow} text-left text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40`}
                        >
                          <span className="truncate">{t("reader.addToExistingNote")}</span>
                          <ChevronRightIcon size={coarse ? 14 : 12} />
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setAddMode("sections")}
                      data-track="add-to-notes-back"
                      className={`flex w-full items-center gap-1.5 rounded-full ${toolRow} text-left ${smallLabel} hover:bg-clay-100 hover:text-clay-800`}
                    >
                      <ChevronLeftIcon size={coarse ? 14 : 12} />
                      {t("reader.addPickNote")}
                    </button>
                    <NotePicker
                      sections={sections}
                      onPick={(note) => void addToNote(note)}
                      disabled={busy}
                      // Escape in the search goes back to the sections, not out of the bubble.
                      onEscape={() => setAddMode("sections")}
                    />
                  </>
                )}
              </div>
            );
            return <Collapse open={submenu === "add"}>{panel}</Collapse>;
          })()}
            </div>
          )}

          </>)}
        </div>
      )}
      </Presence>


      <Presence show={bubble !== null} exit="bubble">
      {bubble && (
        <div
          data-selection-popover
          data-side-card="explain"
          onPointerDown={holdAnnotation(bubbleReference)}
          className={`bubble-in absolute ${TOOL_LAYER} flex flex-col rounded-[20px] border bg-card p-4 shadow-float${underView}`}
          style={{
            left: bubble.left,
            top: bubble.top,
            width: bubble.width,
            maxHeight: cardHeight("explain"),
            borderColor: annotationKindColor(bubble.kind, null),
          }}
        >
          <div
            onPointerDown={dragCard(
              () => (bubble ? { left: bubble.left, top: bubble.top } : null),
              (left, top) => setBubble((b) => (b ? { ...b, left, top } : b)),
            )}
            style={{ touchAction: "none" }}
            data-no-drag
            data-tip={t("reader.dragToMove")}
            className="mb-2 flex cursor-move items-center justify-between gap-2"
          >
            <span
              className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold tracking-[0.08em] uppercase"
              style={{ color: annotationKindColor(bubble.kind, null) }}
            >
              {annotationGrip(bubbleReference)}
              <ToolSymbol tool={bubble.kind} plus={toolPlus(bubble)} size={12} />
              {toolPlus(bubble)
                ? t(TOOL_PLUS_KEY[bubble.kind])
                : bubble.kind === "analyze"
                  ? bubble.streaming
                    ? t("reader.analyzing")
                    : t("reader.analysis")
                  : bubble.kind === "visualize"
                    ? bubble.streaming
                      ? t("reader.visualizing")
                      : t("reader.visualization")
                    : bubble.streaming
                      ? t("reader.explaining")
                      : t("reader.explanation")}
            </span>
            <span className="flex shrink-0 items-center gap-0.5">
              {bubble.streaming && (
                <button
                  onClick={stopExplain}
                  data-tip={t("reader.stopRunTitle")}
                  className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                >
                  <StopIcon size={9} />
                  {t("common.stop")}
                </button>
              )}
              {/* A press on the picture opens it large, so a visualization
                  shows Expand once it holds a conversation. */}
              {(bubble.kind === "visualize" ? bubble.conversation.length > 0 : bubble.text || bubble.conversation.length > 0) &&
                expandButton("explain")}
              {!bubble.streaming && !bubble.busy && bubble.anchor && (
                <button
                  onClick={() => void regenerateBubble()}
                  data-track={`${bubble.kind}-regenerate`}
                  className={CARD_ACTION}
                  aria-label={t("common.regenerate")}
                  data-tip={t(
                    bubble.kind === "analyze"
                      ? "reader.regenerateAnalysisTitle"
                      : bubble.kind === "visualize"
                        ? "reader.regenerateVisualizationTitle"
                        : "reader.regenerateExplanationTitle",
                  )}
                >
                  <RegenerateIcon size={13} />
                </button>
              )}
              {bubble.noteId && !bubble.streaming && (
                <button
                  onClick={() => void deleteExplain()}
                  data-track={`${bubble.kind}-delete`}
                  className={CARD_ACTION}
                  aria-label={t("common.delete")}
                  data-tip={t(
                    bubble.kind === "analyze"
                      ? "reader.deleteAnalysisTitle"
                      : bubble.kind === "visualize"
                        ? "reader.deleteVisualizeTitle"
                        : "reader.deleteExplainTitle",
                  )}
                >
                  <TrashIcon size={13} />
                </button>
              )}
              <button
                onClick={closeExplain}
                data-track={`${bubble.kind}-close`}
                className={`${CARD_ACTION} text-xs`}
                aria-label={t("common.close")}
                data-tip={t("common.close")}
              >
                ✕
              </button>
            </span>
          </div>
          {bubble.error ? (
            <p className="text-sm text-red-600">{bubble.error}</p>
          ) : bubble.declined !== null ? (
            <div className="min-h-0 flex-1 overflow-y-auto text-sm text-sand-700">
              <p className="font-semibold">{t("reader.visualizeDeclined")}</p>
              {bubble.declined && <p className="mt-1">{bubble.declined}</p>}
              <p className="mt-1 text-sand-600">{t("reader.visualizeDeclinedHint")}</p>
            </div>
          ) : bubble.text ? (
            <div ref={explainBodyRef} className="min-h-0 flex-1 overflow-y-auto text-sm">
              <Markdown>{bubble.text}</Markdown>
              {bubble.runError && (
                <p data-run-error role="alert" className="mt-2 text-[12px] font-medium text-red-600">
                  {bubble.runError}
                </p>
              )}
              {toolChatTurns(bubble)}
            </div>
          ) : (
            <ThinkingIndicator className="py-1 text-[12.5px]" />
          )}
          {bubble.noteId && !bubble.streaming && !bubble.error && bubble.declined === null && (
            <div className="mt-2 flex shrink-0 flex-wrap items-center gap-2">
              <RatingButtons
                tool={bubble.kind}
                input={bubble.anchor?.quotedText ?? ""}
                output={bubble.text}
                notebookId={notebookId}
                documentId={documentId}
                noteId={bubble.noteId}
                inRow
              />
              {/* Save as note (SPEC.md §7): the output organized into a note. */}
              {bubble.kind !== "visualize" && (
                <SaveAsNote
                  notebookId={notebookId}
                  documentId={documentId}
                  origin={bubble.kind}
                  selection={bubble.anchor?.quotedText ?? ""}
                  // A new turn is more to save: the button comes back.
                  key={bubble.conversation.length}
                  question={savedQuestion(bubble)}
                  answer={savedAnswer(bubble.text, bubble)}
                  className="ml-auto"
                />
              )}
              {continuePill("explain", bubble, bubble.kind, bubble.kind === "visualize" ? "ml-auto" : "")}
            </div>
          )}
          {bubble.declined === null && toolChatFoot("explain", bubble, bubble.kind)}
        </div>
      )}
      </Presence>

      <Presence show={simplifyCard !== null} exit="bubble">
      {simplifyCard && (
        <div
          key={`${simplifyCard.anchor.blockId}:${simplifyCard.anchor.startOffset}`}
          data-selection-popover
          data-side-card="simplify"
          onPointerDown={holdAnnotation(simplifyReference)}
          className={`bubble-in absolute ${TOOL_LAYER} flex flex-col rounded-[20px] border bg-card p-4 shadow-float${underView}`}
          style={{
            top: simplifyCard.top,
            left: simplifyCard.left,
            width: simplifyCard.width,
            maxHeight: cardHeight("simplify"),
            borderColor: annotationKindColor("simplify", null),
          }}
        >
          <div
            onPointerDown={dragCard(
              () => (simplifyCard ? { left: simplifyCard.left, top: simplifyCard.top } : null),
              (left, top) => setSimplifyCard((c) => (c ? { ...c, left, top } : c)),
            )}
            style={{ touchAction: "none" }}
            data-no-drag
            data-tip={t("reader.dragToMove")}
            className="mb-2 flex cursor-move items-center justify-between gap-2"
          >
            <span
              className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold tracking-[0.08em] uppercase"
              style={{ color: annotationKindColor("simplify", null) }}
            >
              {annotationGrip(simplifyReference)}
              <ToolSymbol tool="simplify" plus={toolPlus(simplifyCard)} size={12} />
              {toolPlus(simplifyCard)
                ? t(TOOL_PLUS_KEY.simplify)
                : simplifyCard.streaming
                  ? t("reader.simplifying")
                  : t("reader.simplified")}
            </span>
            <span className="flex shrink-0 items-center gap-0.5">
              {simplifyCard.streaming && (
                <button
                  onClick={stopSimplify}
                  data-tip={t("reader.stopRunTitle")}
                  className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                >
                  <StopIcon size={9} />
                  {t("common.stop")}
                </button>
              )}
              {simplifyCard.conversation.length > 0 && expandButton("simplify")}
              {!simplifyCard.streaming && !simplifyCard.busy && (
                <button
                  onClick={() => void regenerateSimplify()}
                  data-track="simplify-regenerate"
                  className={CARD_ACTION}
                  aria-label={t("common.regenerate")}
                  data-tip={t("reader.regenerateSimplifyTitle")}
                >
                  <RegenerateIcon size={13} />
                </button>
              )}
              {simplifyCard.noteId && !simplifyCard.streaming && (
                <button
                  onClick={() => void deleteSimplify()}
                  data-track="simplify-delete"
                  className={CARD_ACTION}
                  aria-label={t("common.delete")}
                  data-tip={t("reader.deleteSimplifyTitle")}
                >
                  <TrashIcon size={13} />
                </button>
              )}
              <button
                onClick={closeSimplify}
                data-track="simplify-close"
                className={`${CARD_ACTION} text-xs`}
                aria-label={t("common.close")}
                data-tip={t("common.close")}
              >
                ✕
              </button>
            </span>
          </div>
          {simplifyCard.error ? (
            <p className="text-sm text-red-600">{simplifyCard.error}</p>
          ) : (
          <div ref={simplifyBodyRef} className="min-h-0 flex-1 overflow-y-auto">
          {simplifyCard.sentences ? (
            <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap">
              {simplifyCard.sentences.map((sentence, i) => {
                const lead = /^\s*/.exec(sentence.text)![0];
                return (
                  <Fragment key={i}>
                    {lead}
                    <span
                      onClick={() =>
                        setSimplifyCard((c) =>
                          c ? { ...c, active: c.active === i ? null : i } : c,
                        )
                      }
                      data-tip={t("reader.sentenceTitle")}
                      className={
                        simplifyCard.active === i
                          ? "simplify-sentence simplify-sentence-active"
                          : "simplify-sentence"
                      }
                    >
                      {sentence.text.slice(lead.length)}
                    </span>
                  </Fragment>
                );
              })}
            </p>
          ) : (
            <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap">
              {stripSimplifyMarkers(simplifyCard.text) || (
                <ThinkingIndicator className="py-1 text-[12.5px]" />
              )}
            </p>
          )}
          {simplifyCard.runError && (
            <p data-run-error role="alert" className="mt-2 text-[12px] font-medium text-red-600">
              {simplifyCard.runError}
            </p>
          )}
          {toolChatTurns(simplifyCard)}
          </div>
          )}
          {simplifyCard.noteId && !simplifyCard.streaming && !simplifyCard.error && (
            <div className="mt-2 flex shrink-0 flex-wrap items-center gap-2">
              <RatingButtons
                tool="simplify"
                input={simplifyCard.anchor.quotedText}
                output={simplifyCard.text}
                notebookId={notebookId}
                documentId={documentId}
                noteId={simplifyCard.noteId}
                inRow
              />
              <SaveAsNote
                notebookId={notebookId}
                documentId={documentId}
                origin="simplify"
                selection={simplifyCard.anchor.quotedText}
                key={simplifyCard.conversation.length}
                question={savedQuestion(simplifyCard)}
                answer={savedAnswer(stripSimplifyMarkers(simplifyCard.text), simplifyCard)}
                className="ml-auto"
              />
              {continuePill("simplify", simplifyCard, "simplify")}
            </div>
          )}
          {toolChatFoot("simplify", simplifyCard, "simplify")}
        </div>
      )}
      </Presence>

      {/* The log card (SPEC.md §21): the conversation's condensed log, where
          its card would open, while the pointer rests on the mark. */}
      <Presence show={logCard !== null} exit="fade">
      {logCard && (
        <div
          data-log-card="log"
          data-selection-popover
          className={`bubble-in absolute ${TOOL_LAYER} flex flex-col rounded-[20px] border bg-card p-4 shadow-float${underView}`}
          style={{
            left: logCard.left,
            top: logCard.top,
            width: logCard.width,
            maxHeight: cardMaxHeight,
            borderColor: annotationKindColor(logCard.tool, null),
          }}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.08em] text-clay-800 uppercase">
              <ToolSymbol tool={logCard.tool} plus={logCard.tool !== "assistant"} size={12} />
              {logCard.tool === "assistant" ? t("reader.assistant") : t(TOOL_PLUS_KEY[logCard.tool])}
            </span>
            <span className="text-[10px] font-semibold tracking-[0.08em] text-sand-500 uppercase">
              {t("reader.log")}
            </span>
          </div>
          {logCard.log ? (
            <ol className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
              {logCard.log.lines.map((line, i) =>
                line.role === "user" ? (
                  <li
                    key={i}
                    className="ml-6 self-end rounded-2xl bg-clay-100 px-2.5 py-1 text-[12px] text-clay-800"
                  >
                    {line.text}
                  </li>
                ) : (
                  <li key={i} className="text-[12.5px] leading-snug text-sand-800">
                    {line.text}
                  </li>
                ),
              )}
            </ol>
          ) : logCard.failed ? (
            <p className="text-[12.5px] text-sand-600">{t("reader.logUnavailable")}</p>
          ) : (
            <ThinkingIndicator className="py-1 text-[12.5px]" />
          )}
          <p className="mt-2 text-[11px] text-sand-500">{t("reader.logOpenHint")}</p>
        </div>
      )}
      </Presence>

      <Presence show={commentCard !== null} exit="bubble">
      {commentCard && richText && commentCard.noteId ? (
        // The page editor's comment card is Google Docs' (SPEC.md §29).
        <CommentCard
          key={commentCard.noteId}
          noteId={commentCard.noteId}
          sourceId={commentSourceId}
          link={annotationReferenceHref(notebookId, {
            annotationId: commentCard.noteId,
            documentId,
            sourceId: commentSourceId,
            kind: "comment",
          })}
          draft={commentCard.draft}
          saved={commentCard.saved}
          busy={commentCard.busy}
          grip={annotationGrip(commentReference)}
          // Its place is the card column's (suggest/layer.tsx).
          className={`bubble-in absolute ${TOOL_LAYER}${underView}`}
          style={{ maxHeight: cardMaxHeight, borderColor: annotationKindColor("comment", null) }}
          onPointerDown={holdAnnotation(commentReference)}
          onDraft={(draft) => setCommentCard((c) => (c ? { ...c, draft } : c))}
          onSave={() => void saveCommentCard()}
          onDelete={() => void deleteCommentCard()}
          onClose={closeCommentCard}
        />
      ) : commentCard && (
        <div
          data-selection-popover
          data-side-card="comment"
          onPointerDown={holdAnnotation(commentReference)}
          className={`group/cmcard bubble-in absolute ${TOOL_LAYER} flex flex-col rounded-[20px] border bg-card p-4 shadow-float${underView}`}
          style={{
            left: commentCard.left,
            top: commentCard.top,
            width: commentCard.width,
            maxHeight: cardHeight("comment"),
            borderColor: annotationKindColor("comment", null),
          }}
        >
          <div
            onPointerDown={dragCard(
              () => (commentCard ? { left: commentCard.left, top: commentCard.top } : null),
              (left, top) => setCommentCard((c) => (c ? { ...c, left, top } : c)),
            )}
            style={{ touchAction: "none" }}
            data-no-drag
            data-tip={t("reader.dragToMove")}
            className="mb-2 flex cursor-move items-center justify-between"
          >
            <span
              className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.08em] uppercase"
              style={{ color: annotationKindColor("comment", null) }}
            >
              {annotationGrip(commentReference)}
              <CommentIcon size={12} />
              {t("reader.comment")}
            </span>
            {/* The page editor's comment card's shape: its icons at the
                head's right — Resolve, then Delete — and the field under it. */}
            <span className="ml-auto flex items-center gap-0.5">
              {commentCard.noteId && canEdit && (
                <button
                  onClick={() => void resolveCommentCard()}
                  data-track="comment-card-resolve"
                  aria-label={t("common.resolve")}
                  data-tip={t("docsLayer.resolveTitle")}
                  className="flex size-6 items-center justify-center rounded-full text-sand-600 hover:bg-sage-100 hover:text-sage-700"
                >
                  <CheckIcon size={14} />
                </button>
              )}
              {commentCard.noteId && (
                <button
                  onClick={() => void deleteCommentCard()}
                  data-track="comment-card-delete"
                  aria-label={t("common.delete")}
                  data-tip={t("reader.deleteCommentTitle")}
                  disabled={commentCard.busy}
                  className="flex size-6 items-center justify-center rounded-full text-sand-600 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                >
                  <TrashIcon size={13} />
                </button>
              )}
              <button
                onClick={closeCommentCard}
                data-track="comment-card-close"
                className="flex size-6 items-center justify-center rounded-full text-xs text-sand-500 hover:text-clay-700"
                aria-label={t("common.close")}
                data-tip={t("common.close")}
              >
                ✕
              </button>
            </span>
          </div>
          {commentCard.noteId ? (
            <>
              <textarea
                value={commentCard.draft}
                onChange={(e) =>
                  setCommentCard((c) => (c ? { ...c, draft: e.target.value } : c))
                }
                onKeyDown={(e) => {
                  if (isImeKey(e)) return;
                  const styled = markdownStyleKey(e);
                  if (styled !== null) {
                    setCommentCard((c) => (c ? { ...c, draft: styled } : c));
                    return;
                  }
                  if (e.key === "Escape") {
                    // This card closes, and only this card (SPEC.md §6).
                    e.stopPropagation();
                    setCommentCard(null);
                  }
                }}
                rows={1}
                className="field-sizing-content min-h-0 w-full flex-1 resize-none rounded-xl bg-sand-100 px-2.5 py-2 text-[13px] outline-none placeholder:text-sand-500"
              />
              {/* The mic and Save show once the reader writes. The quote is
                  the lit words beside the card. */}
              <div
                className={`mt-2 items-center justify-end ${
                  commentCard.draft.trim() !== commentCard.saved.trim() ? "flex" : "hidden group-focus-within/cmcard:flex"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <VoiceTypingButton track="comment-card-voice-typing" />
                  <button
                    onClick={() => void saveCommentCard()}
                    data-track="comment-card-save"
                    disabled={commentCard.busy || commentCard.draft.trim() === commentCard.saved.trim()}
                    className="rounded-full bg-clay px-3 py-1 text-[11px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
                  >
                    {t("common.save")}
                  </button>
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto text-[13px]">
                <Markdown>{commentCard.draft}</Markdown>
              </div>
            </>
          )}
        </div>
      )}
      </Presence>

      {/* The card a closed link opens: both ends, and a box for what the
          link is about. Save stores it as the link's reason; Skip leaves the
          link as it is. */}
      <Presence show={linkCard !== null} exit="bubble">
      {linkCard && (
        <div
          data-selection-popover
          data-side-card="link"
          className={`bubble-in absolute ${TOOL_LAYER} flex flex-col rounded-[20px] border border-line bg-card p-4 shadow-float${underView}`}
          style={{ left: linkCard.left, top: linkCard.top, width: linkCard.width, maxHeight: cardHeight("link") }}
        >
          <div
            onPointerDown={dragCard(
              () => (linkCard ? { left: linkCard.left, top: linkCard.top } : null),
              (left, top) => setLinkCard((c) => (c ? { ...c, left, top } : c)),
            )}
            style={{ touchAction: "none" }}
            data-no-drag
            data-tip={t("reader.dragToMove")}
            className="mb-2 flex cursor-move items-center justify-between"
          >
            <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.08em] text-sage-800 uppercase">
              <LinkIcon size={12} />
              {t("reader.linkCard")}
            </span>
            <button
              onClick={closeLinkCard}
              data-track="link-card-close"
              className="text-xs text-sand-500 hover:text-clay-700"
              aria-label={t("common.close")}
              data-tip={t("common.close")}
            >
              ✕
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <p className="line-clamp-2 border-l-2 border-sage-300 pl-2 text-xs text-sand-500">
              {linkCard.fromQuote}
            </p>
            <p className="mt-1.5 line-clamp-2 border-l-2 border-sage-300 pl-2 text-xs text-sand-500">
              {linkCard.toQuote}
            </p>
            <textarea
              autoFocus
              value={linkCard.draft}
              onChange={(e) => setLinkCard((c) => (c ? { ...c, draft: e.target.value } : c))}
              {...ime.props}
              onKeyDown={(e) => {
                if (ime.isImeEnter(e) || isImeKey(e)) return;
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void saveLinkCard();
                }
                if (e.key === "Escape") {
                  // This card closes, and only this card (SPEC.md §6).
                  e.stopPropagation();
                  closeLinkCard();
                }
              }}
              placeholder={t("reader.linkAboutPlaceholder")}
              rows={2}
              className="field-sizing-content mt-2.5 min-h-0 w-full resize-none rounded-xl bg-sand-100 px-2.5 py-2 text-[13px] outline-none placeholder:text-sand-500"
            />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <button
              onClick={closeLinkCard}
              data-track="link-card-skip"
              data-tip={t("reader.linkSkipTitle")}
              className="text-xs text-sand-500 hover:text-clay-700"
            >
              {t("reader.linkSkip")}
            </button>
            <span className="flex items-center gap-1.5">
              <VoiceTypingButton track="link-card-voice-typing" />
              <button
                onClick={() => void saveLinkCard()}
                data-track="link-card-save"
                disabled={linkCard.busy || !linkCard.draft.trim()}
                data-tip={t("reader.linkAboutSaveTitle")}
                className="rounded-full bg-clay px-3 py-1 text-[11px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
              >
                {t("common.save")}
              </button>
            </span>
          </div>
        </div>
      )}
      </Presence>

      <Presence show={assistantChat !== null} exit="bubble">
      {assistantChat && (
        <div
          data-selection-popover
          data-side-card="assistant"
          onPointerDown={holdAnnotation(assistantReference)}
          className={`bubble-in absolute ${TOOL_LAYER} flex resize flex-col overflow-hidden rounded-[20px] border bg-card shadow-float${underView}`}
          style={{
            left: assistantChat.left,
            top: assistantChat.top,
            width: assistantChat.width,
            minWidth: 260,
            maxWidth: paneWidth > 0 ? Math.max(260, Math.min(680, paneWidth - assistantChat.left - 8)) : 680,
            maxHeight: cardHeight("assistant"),
            borderColor: annotationKindColor("assistant", null),
          }}
        >
          <div
            onPointerDown={dragCard(
              () => (assistantChat ? { left: assistantChat.left, top: assistantChat.top } : null),
              (left, top) => setAssistantChat((c) => (c ? { ...c, left, top } : c)),
            )}
            style={{ touchAction: "none" }}
            data-no-drag
            data-tip={t("reader.dragToMove")}
            className="flex cursor-move items-center justify-between px-4 pt-3 pb-1"
          >
            <span
              className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.08em] uppercase"
              style={{ color: annotationKindColor("assistant", null) }}
            >
              {annotationGrip(assistantReference)}
              <SparkleIcon size={12} />
              {t("reader.assistant")}
            </span>
            <span className="flex shrink-0 items-center gap-0.5">
              {assistantChat.messages.length > 0 && expandButton("assistant")}
              {assistantChat.noteId && (
                <button
                  onClick={() => void deleteAssistantConversation()}
                  data-track="assistant-card-delete"
                  className={CARD_ACTION}
                  aria-label={t("common.delete")}
                  data-tip={t("reader.deleteConversationTitle")}
                >
                  <TrashIcon size={13} />
                </button>
              )}
              <button
                onClick={closeAssistantChat}
                data-track="assistant-card-close"
                className={`${CARD_ACTION} text-xs`}
                aria-label={t("common.close")}
                data-tip={t("common.close")}
              >
                ✕
              </button>
            </span>
          </div>
          <div ref={chatScrollRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-2">
            {(chatOpenSide ? chatOpenSide.messages : assistantChat.messages).map((message, i, list) =>
              message.role === "user" ? (
                <p
                  key={i}
                  className="ml-6 self-end rounded-2xl bg-clay-100 px-3 py-1.5 text-[12.5px] whitespace-pre-wrap text-clay-800"
                >
                  {message.content}
                </p>
              ) : (
                <div
                  key={i}
                  // An older answer shows its rating row on hover or focus; a
                  // tap focuses the answer on a touch screen (TOOL13-12).
                  tabIndex={-1}
                  data-chat-answer
                  className="group/answer text-[13px] outline-none"
                >
                  {/* Highlighting the answer offers the side chat, the quoted
                      question, and the comment (SPEC.md §7). */}
                  <div {...{ [ANSWER_MARK]: "" }}>
                    <Markdown>{message.content}</Markdown>
                  </div>
                  {/* The rating (SPEC.md §25): the question and the selection
                      it ran on, the answer it gave; the suggestions' row
                      rates the suggestions. */}
                  {message.suggestKey ? (
                    <SuggestionRow runKey={message.suggestKey} />
                  ) : !assistantChat.busy && (
                    <div
                      className={`mt-1 flex flex-wrap items-center gap-2${
                        i < list.findLastIndex((m) => m.role === "assistant")
                          ? " opacity-0 transition-opacity group-focus-within/answer:opacity-100 group-hover/answer:opacity-100"
                          : ""
                      }`}
                    >
                      <RatingButtons
                        tool="act"
                        input={[assistantChat.anchor?.quotedText ?? "", list[i - 1]?.content ?? ""]
                          .filter(Boolean)
                          .join("\n\n")}
                        output={message.content}
                        notebookId={notebookId}
                        documentId={documentId}
                        noteId={chatNoteId}
                        inRow
                      />
                      <SaveAsNote
                        notebookId={notebookId}
                        documentId={documentId}
                        origin="act"
                        question={list[i - 1]?.content ?? ""}
                        selection={assistantChat.anchor?.quotedText ?? ""}
                        answer={message.content}
                        className="ml-auto"
                      />
                    </div>
                  )}
                </div>
              ),
            )}
            {assistantChat.busy && <ThinkingIndicator className="py-0.5 text-[12px]" />}
            {/* The plan this conversation proposed, under its answer (SPEC.md
                §7): it scrolls with the turns, so a short card still shows
                the answer, and the box stays the card's last row. */}
            {planInCard && (
              <div data-plan-in-card className="flex shrink-0 flex-col rounded-2xl border border-line bg-sand-50 p-3">
                {planBody}
              </div>
            )}
            <QueuedList items={chatQueueShown(assistantChat)} onRemove={removeQueuedChat} />
          </div>
          {assistantChatFoot(assistantChat, "flex items-end gap-1.5 px-3 pb-3", "px-3 pb-1.5")}
        </div>
      )}
      </Presence>
      </>)}

      {/* The voice outlives the toolbar: with the selection dismissed while
          reading, this floating control stops it. */}
      <Presence show={voice !== "idle" && !popover} exit="fade">
      {voice !== "idle" && !popover && (
        <button
          onClick={stopVoice}
          data-track="stop-reading"
          className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full bg-card px-4 py-2 text-[12.5px] font-semibold text-sand-700 shadow-float hover:text-clay-800"
        >
          {voice === "loading" ? (
            <SpinnerIcon size={13} className="motion-safe:animate-spin" />
          ) : (
            <VolumeIcon size={14} className="text-clay" />
          )}
          {t("reader.stopReading")}
        </button>
      )}
      </Presence>

      <Presence show={planFloats} exit="pop">
      {/* The plan card grows with the reply and the actions up to the
          window's height, then scrolls inside. */}
      {planFloats && (
        <div className="fixed bottom-6 left-1/2 z-40 flex max-h-[calc(100vh-3rem)] w-[440px] max-w-[92vw] -translate-x-1/2 flex-col rounded-[24px] bg-card p-4 shadow-float">
          {planBody}
        </div>
      )}
      </Presence>

      {/* The conversation read whole, over the pane (SPEC.md §21). The card
          stays open under it and the same box sends from either place. */}
      <Presence show={conversationView !== null} exit="fade">
      {conversationView === "assistant" && assistantChat && (
        <ConversationView
          title={t("reader.assistant")}
          icon={<SparkleIcon size={12} />}
          messages={chatOpenSide ? chatOpenSide.messages : assistantChat.messages}
          busy={assistantChat.busy}
          after={<QueuedList items={chatQueueShown(assistantChat)} onRemove={removeQueuedChat} />}
          foot={assistantChatFoot(assistantChat, "flex items-end gap-1.5", "pb-1.5")}
          onClose={closeConversationView}
        />
      )}
      {conversationView === "explain" && bubble && (
        <ConversationView
          title={
            toolPlus(bubble)
              ? t(TOOL_PLUS_KEY[bubble.kind])
              : t(
                  bubble.kind === "analyze"
                    ? "reader.analysis"
                    : bubble.kind === "visualize"
                      ? "reader.visualization"
                      : "reader.explanation",
                )
          }
          icon={<ToolSymbol tool={bubble.kind} plus={toolPlus(bubble)} size={12} />}
          output={bubble.text}
          messages={bubble.conversation}
          busy={bubble.busy}
          after={
            <>
              <QueuedList items={bubble.queue} onRemove={(key) => removeQueuedTool("explain", key)} />
              {toolPlan(bubble)}
            </>
          }
          foot={
            bubble.declined === null ? toolChatFoot("explain", bubble, bubble.kind, true) : null
          }
          onClose={closeConversationView}
        />
      )}
      {conversationView === "simplify" && simplifyCard && (
        <ConversationView
          title={toolPlus(simplifyCard) ? t(TOOL_PLUS_KEY.simplify) : t("reader.simplified")}
          icon={<ToolSymbol tool="simplify" plus={toolPlus(simplifyCard)} size={12} />}
          output={stripSimplifyMarkers(simplifyCard.text)}
          messages={simplifyCard.conversation}
          busy={simplifyCard.busy}
          after={
            <>
              <QueuedList items={simplifyCard.queue} onRemove={(key) => removeQueuedTool("simplify", key)} />
              {toolPlan(simplifyCard)}
            </>
          }
          foot={toolChatFoot("simplify", simplifyCard, "simplify", true)}
          onClose={closeConversationView}
        />
      )}
      </Presence>

      <Presence show={distillOpen} exit="fade">
      {distillOpen && (
        <DistillPage
          distillations={allDistillations}
          shownId={distillShownId}
          running={distillRun}
          error={distillError}
          canAddNotes={sectionChoices.length > 0}
          addNoteHint={
            sectionChoices.length === 0
              ? t("reader.addSectionFirst")
              : t("reader.addPendingNote", { section: sectionChoices[0].label })
          }
          onRun={(question, replaceId) => void runDistill(question, replaceId)}
          onCancel={cancelDistill}
          onOpen={(id) => {
            setDistillShownId(id);
            setDistillError(null);
          }}
          onAsk={() => setDistillShownId(null)}
          onClose={closeDistillPage}
          onDelete={(id) => void deleteDistillation(id)}
          onDeleteMany={(ids) => void deleteDistillations(ids)}
          onJump={jumpToQuote}
          onAddNote={addQuoteNote}
          onAddSelection={(text, quote) => addSelectionNote(text, quote)}
        />
      )}
      </Presence>

    </div>
      {/* The hint where the article's margin cannot hold it (a tablet, a
          phone, a narrow window): a row under the pane, which takes its
          height from the pane's foot, so it covers no word and the lines
          the reader reads stay where they are. */}
      {editHint && !hintBeside && !editMode && !split && !transcript && !embedded && !richText && (
        <div
          data-edit-hint
          onAnimationEnd={hintPlayed}
          className={`hint-fade pointer-events-none shrink-0 border-t border-line bg-card px-4 py-2.5 leading-relaxed text-sand-700 print:hidden ${
            coarse ? "text-[13px]" : "text-[12px]"
          }`}
        >
          {t(coarse ? "reader.touchHint" : "reader.editHint")}
        </div>
      )}
      {/* The assistant's bar (SPEC.md §29), over the page at the bottom of
          the pane: the status of its edit, the field, and the commands. */}
      <Presence show={bar !== null} exit="fade">
      {bar && (
        <div
          data-assistant-bar
          // The page editor's own control: its header stays while the bar has the focus.
          data-edit-control
          data-track-surface="ai-toolbar"
          role="dialog"
          aria-label={t("docsInsert.askAssistant")}
          className={`pop-in absolute bottom-5 left-1/2 ${TOOL_LAYER} flex w-[min(640px,calc(100%-32px))] -translate-x-1/2 flex-col gap-2 rounded-[24px] border bg-card px-4 py-2.5 shadow-float`}
          style={{ borderColor: annotationKindColor("assistant", null) }}
        >
          {bar.busy ? (
            <ThinkingIndicator
              label={t("assistant.suggestWriting")}
              onStop={() => barAbortRef.current?.abort()}
              className="text-[12px]"
            />
          ) : bar.error ? (
            <p className="text-[12px] font-medium text-amber-700 dark:text-amber-400">⚠ {bar.error}</p>
          ) : (
            barKey && (
              <SuggestionRow runKey={barKey} bar={{ onChat: () => barToCard(bar), onSettled: () => setBar(null) }} />
            )
          )}
          <div className="flex items-center gap-2">
            <span style={{ color: annotationKindColor("assistant", null) }}>
              <SparkleIcon size={14} />
            </span>
            <input
              autoFocus
              value={bar.input}
              onFocus={caretToEnd}
              onChange={(e) => setBarInput(e.target.value)}
              {...ime.props}
              onKeyDown={(e) => {
                if (ime.isImeEnter(e) || isImeKey(e) || e.key !== "Enter") return;
                e.preventDefault();
                void runBar(bar);
              }}
              placeholder={t(barFigure ? "reader.figureBarPlaceholder" : "reader.barPlaceholder")}
              aria-label={t(barFigure ? "reader.figureBarPlaceholder" : "reader.barPlaceholder")}
              className="min-w-0 flex-1 rounded-xl bg-sand-100 px-3 py-1.5 text-[13px] outline-none placeholder:text-sand-500"
            />
            <VoiceTypingButton track="assistant-voice" className="size-8" size={14} />
            <button
              type="button"
              disabled={bar.busy || !bar.input.trim()}
              onClick={() => void runBar(bar)}
              data-track="assistant-run"
              data-tip={t("reader.sendTitle")}
              className="rounded-full bg-clay px-3 py-1.5 text-[11px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
            >
              {t("reader.send")}
            </button>
          </div>
          {!barKey && !bar.busy && barFigure && (
            <div className="flex flex-wrap items-center gap-1">
              {FIGURE_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => void runBar({ ...bar, input: t(chip.command) })}
                  data-track={`assistant-figure:${chip.label.slice("reader.figure".length)}`}
                  data-tip={t("reader.figureChipTitle")}
                  className="rounded-full bg-sand-100 px-2.5 py-0.5 text-[11px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                >
                  {t(chip.label)}
                </button>
              ))}
              <ThinkingChips small className="ml-auto" />
            </div>
          )}
          {!barKey && !bar.busy && !barFigure && (
            <div className="flex flex-wrap items-center gap-1">
              {SUGGEST_CHIPS.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => void runBar(bar, c)}
                  data-track={`assistant-command:${c.name}`}
                  data-tip={t("reader.commandTitle")}
                  className="rounded-full bg-sand-100 px-2.5 py-0.5 text-[11px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                >
                  {t(c.key)}
                </button>
              ))}
              <ThinkingChips small className="ml-auto" />
            </div>
          )}
        </div>
      )}
      </Presence>
    </div>
  );
}

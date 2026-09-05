"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  applyReadingPosition,
  atReadingPosition,
  parseReadingPosition,
  POSITION_HOLD_MS,
  readingPositionKey,
  readReadingPosition,
  type ReadingPosition,
} from "@/lib/reading-position";
import type { SourceInput } from "@/lib/anchors/input";
import { anchorableOffset, anchorableText } from "@/lib/anchors/dom";
import {
  parseSimplified,
  splitSentences,
  stripSimplifyMarkers,
  type SentenceSpan,
  type SimplifiedSentence,
} from "@/lib/sentences";
import type {
  AssistantAction,
  AssistantPlan,
  Distillation,
  DistillationView,
  Extraction,
  ExtractionView,
} from "@/lib/types";
import type { DocumentReference } from "@/lib/parse/types";
import { splitStreamError, splitStreamNote } from "@/lib/derive/config";
import { TranslationBar } from "@/components/reader/translation-bar";
import { findWeblinks } from "@/lib/weblinks";
import { isImeKey, useImeGuard } from "@/lib/ime";
import { imageFigureHtml } from "@/lib/images";
import { markdownStyleKey } from "@/lib/markdown-style";
import { isOffline, offlinePremium, queueWrite } from "@/lib/offline/queue";
import { parseYouTubeId, youtubeWatchUrl } from "@/lib/video/youtube";
import type { TFunc, TKey } from "@/lib/i18n/dictionaries";
import { useLang, useT } from "@/components/lang-provider";
import {
  CommentIcon,
  DistillIcon,
  ExtractIcon,
  LinkIcon,
  MicIcon,
  NotesIcon,
  QuestionIcon,
  ChartIcon,
  SearchIcon,
  SparkleIcon,
  SpinnerIcon,
  StopIcon,
  SummaryIcon,
  UnlinkIcon,
  VolumeIcon,
} from "@/components/icons";
import { Markdown } from "@/components/markdown";
import { Collapse, Presence } from "@/components/presence";
import { ThinkingIndicator } from "@/components/thinking";
import type { BlockData, Highlight } from "@/components/reader/block-view";
import { Bibliography } from "@/components/reader/bibliography";
import type { ConversionInfo } from "@/components/reader/conversion-strip";
import { HIGHLIGHT_HUES, HUE_DOT, HUE_KEY } from "@/components/reader/hues";
import type { PageMark } from "@/components/reader/page-block";
import { useCollab } from "@/components/collab/collab-context";
import { useImageDrop, type DroppedImage } from "@/components/use-image-drop";
import { AuthorChip } from "@/components/collab/person-badge";
import { DistillPage } from "@/components/reader/distill-page";
import { ProjectSearch } from "@/components/reader/project-search";
import { Reader } from "@/components/reader/reader";

type Anchor = Omit<SourceInput, "documentId">;
type Popover = {
  anchor: Anchor;
  x: number;
  y: number;
  yTop: number;
  textLeft: number;
  // Container coords of the end of the selection: the Close link chip sits there.
  endLeft: number;
  endTop: number;
  truncated: boolean; // selection crossed into another paragraph; anchor covers the first
  figure?: boolean; // opened by the hold-and-circle gesture on a figure, equation, or table: the anchor is the whole block
  term?: boolean; // opened by clicking a key term; Extract leads, recommended
  // Placement, by proximity to open tool blocks: right of the text first, then
  // left, then directly below the highlighted text. Bases are container coords.
  side: "right" | "left" | "below";
  rightBase: number;
  cw: number;
};

// One toolbar per content kind (SPEC.md §6). The popover shows the tools of
// the kind under the selection and nothing else: a tool missing from a
// kind's list is not offered there. The first tool of a kind after the
// assistant is its lead tool and reads as recommended.
type ContentKind = "text" | "table" | "figure" | "equation";
type Tool =
  | "assistant"
  | "analyze"
  | "explain"
  | "simplify"
  | "extract"
  | "comment"
  | "link"
  | "highlight"
  | "addToNotes"
  | "readAloud";

const TOOLBARS: Record<ContentKind, readonly Tool[]> = {
  text: ["assistant", "explain", "simplify", "extract", "comment", "link", "highlight", "addToNotes", "readAloud"],
  table: ["assistant", "analyze", "explain", "comment", "link", "highlight", "addToNotes"],
  figure: ["assistant", "analyze", "explain", "comment", "link", "highlight", "addToNotes"],
  equation: ["assistant", "explain", "comment", "link", "highlight", "addToNotes"],
};

// The blocks the hold-and-circle gesture opens a toolbar on, whole.
const CIRCLED_TYPES = new Set(["FIGURE", "EQUATION", "TABLE"]);

function contentKindOf(type: string | undefined): ContentKind {
  if (type === "TABLE") return "table";
  if (type === "FIGURE") return "figure";
  if (type === "EQUATION") return "equation";
  return "text";
}

const KIND_LABEL: Record<Exclude<ContentKind, "text">, TKey> = {
  table: "reader.tableTools",
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
    return { rects: [] as CardRect[], articleLeft: 0, articleRight: 0, cw: 1200 };
  }
  const crect = container.getBoundingClientRect();
  const arect = container.querySelector("article")?.getBoundingClientRect();
  const cw = container.clientWidth;
  const articleLeft = arect ? arect.left - crect.left : cw;
  const articleRight = arect ? arect.right - crect.left : 0;
  const rects = [...container.querySelectorAll<HTMLElement>("[data-side-card]")]
    .filter((el) => el.dataset.sideCard !== excludeKind)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left - crect.left,
        right: r.right - crect.left,
        top: r.top - crect.top + container.scrollTop,
        bottom: r.bottom - crect.top + container.scrollTop,
      };
    });
  return { rects, articleLeft, articleRight, cw };
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

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
};

const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n)}…` : s);

// Format targets of a format_block action, shown in the plan card.
const FORMAT_KIND_KEY: Record<"paragraph" | "h1" | "h2" | "h3", TKey> = {
  paragraph: "reader.kindParagraph",
  h1: "reader.kindH1",
  h2: "reader.kindH2",
  h3: "reader.kindH3",
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
      return `“${clip(action.text)}”`;
    case "remove_block":
      return `“${clip(blockText(action.blockId))}”`;
    case "link": {
      const target =
        documents.find((d) => d.id === action.toDocumentId)?.title ?? t("reader.aDocument");
      return `“${clip(action.anchor.quotedText, 60)}” → ${target}`;
    }
    case "format_block":
      return `“${clip(blockText(action.blockId), 60)}” → ${t(FORMAT_KIND_KEY[action.kind])}`;
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
};
// The card EXPLAIN and ANALYZE stream into (SPEC.md §4, §6): one card, the
// kind sets its title and glyph.
type ExplainBubble = {
  kind: "explain" | "analyze";
  left: number;
  top: number;
  width: number;
  side: "right" | "left"; // which article edge the card docks to
  text: string;
  streaming: boolean;
  error: string | null;
  anchor: Anchor | null; // the highlighted text this bubble explains
  noteId: string | null; // the persisted annotation; Delete removes it and its mark
};

type ChatMessage = { role: "user" | "assistant"; content: string };

// Transcript format written by /api/assistant/act: "**Reader:** …" and
// "**Assistant:** …" turns separated by blank lines.
function parseConversation(content: string): ChatMessage[] {
  const chunks = content.split(/\n\n(?=\*\*(?:Reader|Assistant):\*\* )/);
  const messages: ChatMessage[] = [];
  for (const chunk of chunks) {
    const m = /^\*\*(Reader|Assistant):\*\* ([\s\S]*)$/.exec(chunk.trim());
    if (m) messages.push({ role: m[1] === "Reader" ? "user" : "assistant", content: m[2] });
  }
  return messages.length > 0 ? messages : [{ role: "assistant", content }];
}
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
};

// SIMPLIFY output: a translucent bubble beside the article, level with the
// selection. The selection stays tinted while the bubble is open (SPEC.md §6).
type SimplifyCard = {
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
};

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
  busy: boolean;
};

// The article menu's frequent asks: one click sends the question to the
// assistant, which reads the whole document and answers in the chat card.
// Keys, not strings — the menu translates at render, and the question goes to
// the assistant in the reader's language.
// track names the ask in click telemetry (SPEC.md §7).
const FREQUENT_ASKS: { labelKey: TKey; questionKey: TKey; track: string }[] = [
  { labelKey: "reader.summarizeLabel", questionKey: "reader.summarizeQuestion", track: "summarize" },
  { labelKey: "reader.takeawaysLabel", questionKey: "reader.takeawaysQuestion", track: "key-takeaways" },
  { labelKey: "reader.explainSimplyLabel", questionKey: "reader.explainSimplyQuestion", track: "explain-simply" },
];


// English plural suffix for count phrases ({s} in reader.* keys); zh templates
// omit {s}.
const plural = (n: number) => (n === 1 ? "" : "s");

/** Horizontal dock for a side card: right next to the article on its side. */
function dockSideCard(
  side: "right" | "left",
  articleLeft: number,
  articleRight: number,
  cw: number,
) {
  const margin = side === "right" ? cw - articleRight - 24 : articleLeft - 24;
  const width = Math.max(260, Math.min(320, margin));
  const left =
    side === "right"
      ? Math.min(articleRight + 16, cw - width - 8)
      : Math.max(8, articleLeft - width - 16);
  return { left, width };
}

// Narrow reader: the gutter beside the article is under this, so a docked
// side card would cover the text (cards are 260-320 wide). Tool cards dock
// below the highlighted text instead, and stored AI annotations rest as tool
// icons next to their text (block-view.tsx) rather than open cards.
const NARROW_GUTTER = 140;

/** Horizontal dock for a narrow reader: over the article, at article width. */
function dockBelowCard(articleLeft: number, articleRight: number, cw: number) {
  const width = Math.min(Math.max(280, articleRight - articleLeft), cw - 16);
  const left = Math.max(8, Math.min(articleLeft, cw - width - 8));
  return { left, width };
}

// Client layer over the reader: selection capture, popover, EXPLAIN bubble,
// SIMPLIFY bubble, SALIENCE overlay toggle, DISTILL page, the article menu,
// jump-to-anchor.
export function ReaderInteractions({
  documentId,
  notebookId,
  sectionChoices,
  attachedDocuments,
  title,
  blocks,
  anchorHighlights,
  annotationsBySource,
  annotationBubbles,
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
  conversion,
  font,
  translationAvailable,
}: {
  documentId: string;
  notebookId: string;
  /** DEEPL_API_KEY is set: the Translate offer shows when the languages differ (SPEC.md §19). */
  translationAvailable: boolean;
  sectionChoices: { id: string; label: string }[];
  attachedDocuments: { id: string; title: string }[];
  title: string;
  blocks: BlockData[];
  anchorHighlights: Record<
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
    }
  >;
  // Stored EXPLAIN, SIMPLIFY, ANALYZE, comment, and assistant conversation
  // content by source id: clicking their mark (or icon) reopens the card with
  // this content.
  annotationBubbles: Record<
    string,
    {
      kind: "explain" | "simplify" | "analyze" | "comment" | "assistant";
      content: string;
      noteId: string;
    }
  >;
  // Stored distillations for this document, newest first, quotes healed
  // against the current blocks.
  distillations: DistillationView[];
  // Stored extractions for this document, oldest first (labels E1…), spans
  // healed against the current blocks.
  extractions: ExtractionView[];
  termsByBlock: Record<string, { start: number; end: number; definition: string }[]>;
  linksByBlock: Record<
    string,
    { linkId: string; start: number; end: number; href: string; title: string }[]
  >;
  editedByBlock: Record<string, { start: number; end: number }[]>;
  stylesByBlock: Record<
    string,
    {
      start: number;
      end: number;
      style:
        | "bold"
        | "italic"
        | "underline"
        | "code"
        | "color-clay"
        | "color-sage"
        | "color-gold"
        | "color-plum";
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
  conversion: ConversionInfo | null;
  font: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Stable translator: mount-time closures (effects, async handlers) keep this
  // identity but always read the current language through the ref.
  const tCtx = useT();
  // Viewers on a shared corpus read only: no selection tools, no edit mode,
  // no assistant. The server rejects their writes; this keeps the surface honest.
  const { canEdit, premium } = useCollab();
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
  // The popover's submenus (section list, link targets) are custom lists, not
  // native selects: the popover preventDefaults mousedown to keep the text
  // selection alive, which also keeps a native select from ever opening.
  const [submenu, setSubmenu] = useState<null | "add" | "ai" | "comment">(null);
  const [commentDraft, setCommentDraft] = useState("");
  // The page is only editable in edit mode; reading mode never opens editors.
  const [editMode, setEditMode] = useState(false);
  const [bubble, setBubble] = useState<ExplainBubble | null>(null);
  const [busy, setBusy] = useState(false);
  const [simplifyCard, setSimplifyCard] = useState<SimplifyCard | null>(null);
  // The distilled page: ask view (shownId null) or one distillation. A fresh
  // result shows from local state until the refresh delivers it as a prop.
  const [distillOpen, setDistillOpen] = useState(false);
  const distillOpenRef = useRef(false);
  distillOpenRef.current = distillOpen;
  // The reading position survives a full page load and a remount: a note, an
  // annotation, or an AI tool refreshes the page, and when the refresh turns
  // into a full load (a new deploy, a dropped response) the reader came back
  // at the top (reader report). Saved per tab and per document as the block
  // at the top of the pane and its offset (lib/reading-position.ts). The
  // workspace's inline script restores it before the first paint; this
  // re-applies it after hydration and holds it while the layout under it
  // settles — a figure above the position loading late moves everything
  // below it — until the reader scrolls. A ?src, ?block, or ?link jump wins:
  // with one in the URL nothing restores.
  const positionStoreKey = readingPositionKey(documentId);
  const jumpOnOpen = useRef(
    Boolean(searchParams.get("src") || searchParams.get("block") || searchParams.get("link")),
  );
  // While the hold keeps the stored position, saves pause: a clamped
  // intermediate position must not overwrite the stored one.
  const positionHeld = useRef(false);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || jumpOnOpen.current) return;
    let stored: ReadingPosition | null = null;
    try {
      stored = parseReadingPosition(sessionStorage.getItem(positionStoreKey));
    } catch {
      stored = null; // storage unavailable: the reader starts at the top
    }
    if (!stored) return;
    const position = stored;
    let expected = applyReadingPosition(container, position);
    if (expected === null) return; // the block is gone (a re-parse): nothing to hold
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
      expected = applyReadingPosition(container, position);
      if (expected === null) release();
    };
    const onScroll = () => {
      // The hold's own moves land on expected. Any other scroll is the
      // reader's, or a jump the reader asked for: the hold ends.
      if (container.scrollTop === expected || atReadingPosition(container, position)) return;
      release();
    };
    const observer = new ResizeObserver(hold);
    observer.observe(article);
    container.addEventListener("scroll", onScroll, { passive: true });
    container.addEventListener("wheel", release, { passive: true });
    container.addEventListener("touchmove", release, { passive: true });
    container.addEventListener("pointerdown", release);
    const timer = setTimeout(release, POSITION_HOLD_MS);
    return cleanup;
  }, [positionStoreKey]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let raf = 0;
    const save = () => {
      raf = 0;
      // The distilled page scrolls the pane to the top while it is open; that
      // is not a reading position. While the hold above keeps the stored
      // position, the stored one stands.
      if (distillOpenRef.current || positionHeld.current) return;
      try {
        sessionStorage.setItem(positionStoreKey, JSON.stringify(readReadingPosition(container)));
      } catch {
        // storage unavailable: nothing to remember
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(save);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", save);
    return () => {
      container.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", save);
      if (raf) cancelAnimationFrame(raf);
      save();
    };
  }, [positionStoreKey]);
  const [distillShownId, setDistillShownId] = useState<string | null>(null);
  const [distillRun, setDistillRun] = useState<{ question: string } | null>(null);
  const [distillError, setDistillError] = useState<string | null>(null);
  const [localDistillations, setLocalDistillations] = useState<DistillationView[]>([]);
  // The running request, so Cancel can abort it. Cancel keeps the question in
  // the ask view for editing; nothing persists from an aborted run.
  const distillAbortRef = useRef<AbortController | null>(null);
  const distillReturnScroll = useRef<number | null>(null);
  // The running Explain, Simplify, and Extract, so Stop can abort them. A
  // stopped stream keeps what arrived; nothing persists (SPEC.md §6).
  const explainAbortRef = useRef<AbortController | null>(null);
  const simplifyAbortRef = useRef<AbortController | null>(null);
  const extractAbortRef = useRef<AbortController | null>(null);
  // The span a jump landed on (a distilled quote, an extract origin): tinted
  // while the reader arrives.
  const [spanFlash, setSpanFlash] = useState<{
    blockId: string;
    start: number;
    end: number;
  } | null>(null);
  const spanFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // EXTRACT: the highlighted phrase's topic → labeled passages (SPEC.md §4).
  // A fresh extraction shows from local state until the refresh delivers it.
  const [localExtractions, setLocalExtractions] = useState<ExtractionView[]>([]);
  const [extractBusy, setExtractBusy] = useState(false);
  // The document's translation (SPEC.md §19), one text per block, shown
  // under each block while the reader has it on.
  const [translations, setTranslations] = useState<Record<string, string> | null>(null);
  // The card an origin chip opens: the origin quote, the count, Delete.
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
  // The article menu floats open at the top of the page; it hides once the
  // reader scrolls and returns when the reader is back at the top.
  const [atTop, setAtTop] = useState(true);
  // Optimistic highlight marks: painted the instant a color dot is clicked,
  // cleared when the server's anchors arrive with the refresh.
  const [localAnchors, setLocalAnchors] = useState<
    Record<string, { start: number; end: number; color: string | null }[]>
  >({});
  // Spans made in this session: their marks sweep in left to right the first
  // time they paint (block-view.tsx mark-sweep). Keyed `${blockId}:${start}:${end}`,
  // so the server's copy of a span matches the optimistic one and the class
  // survives the refresh swap without restarting. Extractions sweep whole,
  // their spans staggered, tracked by extraction id.
  const freshSpansRef = useRef(new Set<string>());
  const freshExtractIdsRef = useRef(new Set<string>());
  function markFreshSpan(blockId: string, start: number, end: number) {
    freshSpansRef.current.add(`${blockId}:${start}:${end}`);
  }
  const [prevAnchorsProp, setPrevAnchorsProp] = useState(anchorHighlights);
  if (prevAnchorsProp !== anchorHighlights) {
    setPrevAnchorsProp(anchorHighlights);
    // Clear an optimistic mark only once the server's copy of its span is in
    // the props: a refresh from an older action would otherwise blank the mark
    // until the next refresh lands.
    setLocalAnchors((prev) => {
      const next: typeof prev = {};
      for (const [blockId, list] of Object.entries(prev)) {
        const confirmed = anchorHighlights[blockId] ?? [];
        const keep = list.filter(
          (h) => !confirmed.some((c) => c.start === h.start && c.end === h.end),
        );
        if (keep.length > 0) next[blockId] = keep;
      }
      return next;
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
  // With a link pending, highlighting text shows this chip at the end of the
  // highlight; pressing it closes the link there.
  const [closeLink, setCloseLink] = useState<{
    anchor: Anchor;
    left: number;
    top: number;
  } | null>(null);

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
      if (!next) setCloseLink(null);
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
  // approval, or immediately when the reader toggled auto.
  const [aiCommand, setAiCommand] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiListening, setAiListening] = useState(false);
  const [aiPlan, setAiPlan] = useState<AssistantPlan | null>(null);
  const [planChecked, setPlanChecked] = useState<Set<number>>(new Set());
  const aiCommandRef = useRef("");
  aiCommandRef.current = aiCommand;
  // The running assistant turn, so Stop can abort it — the popover's Run
  // button before the chat card exists, or the chat card's Send button once
  // it does; only one is ever in flight at a time.
  const chatAbortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<SpeechRec | null>(null);
  const editModeRef = useRef(false);
  editModeRef.current = editMode;
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const annotationBubblesRef = useRef(annotationBubbles);
  annotationBubblesRef.current = annotationBubbles;
  const annotationsBySourceRef = useRef(annotationsBySource);
  annotationsBySourceRef.current = annotationsBySource;
  const [annotationCard, setAnnotationCard] = useState<AnnotationCard | null>(null);
  const anchorHighlightsRef = useRef(anchorHighlights);
  anchorHighlightsRef.current = anchorHighlights;
  // Narrow reader (see NARROW_GUTTER): stored AI annotations rest as tool
  // icons next to their text, and open cards dock below the highlight.
  const [narrow, setNarrow] = useState(false);
  const narrowRef = useRef(false);
  const [assistantChat, setAssistantChat] = useState<AssistantChat | null>(null);
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
  const overlayOpenRef = useRef(false);
  overlayOpenRef.current =
    popover !== null ||
    bubble !== null ||
    simplifyCard !== null ||
    assistantChat !== null ||
    annotationCard !== null ||
    commentCard !== null ||
    extractCard !== null ||
    closeLink !== null;
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
    kind: "explain" | "simplify" | "assistant" | "comment",
    preferredTop: number,
  ) {
    const { rects, articleLeft, articleRight, cw } = measureSideCards(containerRef.current, kind);
    // Narrow reader: no room beside the article — dock below the highlight.
    if (narrowRef.current) {
      return {
        ...dockBelowCard(articleLeft, articleRight, cw),
        top: Math.max(8, preferredTop) + 34,
        side: "right" as const,
      };
    }
    const articleMid = (articleLeft + articleRight) / 2;
    let top = Math.max(8, preferredTop);
    let side: "right" | "left" = "right";
    for (let step = 0; step < 12; step++) {
      if (blocksOnSide(rects, articleMid, "right", top, CARD_ESTIMATE).length === 0) {
        side = "right";
        break;
      }
      if (blocksOnSide(rects, articleMid, "left", top, CARD_ESTIMATE).length === 0) {
        side = "left";
        break;
      }
      // Both sides busy at this height: drop below whichever clears first.
      const clears = (["right", "left"] as const).map((s) =>
        Math.max(...blocksOnSide(rects, articleMid, s, top, CARD_ESTIMATE).map((r) => r.bottom)),
      );
      top = Math.min(...clears) + CARD_GAP;
      side = "right";
    }
    return { ...dockSideCard(side, articleLeft, articleRight, cw), top, side };
  }
  // Closing a card mid-stream stops its run: nobody will read the rest.
  function closeExplain() {
    explainAbortRef.current?.abort();
    explainAbortRef.current = null;
    setBubble(null);
  }
  function stopExplain() {
    explainAbortRef.current?.abort();
  }
  async function deleteExplain() {
    const card = bubble;
    if (!card?.noteId || card.streaming) return;
    try {
      await api(`/api/notes/${card.noteId}`, "DELETE");
      setBubble(null);
      router.refresh();
      showToast(t(card.kind === "analyze" ? "reader.analysisRemoved" : "reader.explanationRemoved"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("reader.deleteFailed"));
    }
  }
  function closeSimplify() {
    simplifyAbortRef.current?.abort();
    simplifyAbortRef.current = null;
    setSimplifyCard(null);
  }
  function stopSimplify() {
    simplifyAbortRef.current?.abort();
  }
  function stopExtract() {
    extractAbortRef.current?.abort();
  }
  async function deleteSimplify() {
    const card = simplifyCard;
    if (!card?.noteId || card.streaming) return;
    try {
      await api(`/api/notes/${card.noteId}`, "DELETE");
      setSimplifyCard(null);
      router.refresh();
      showToast(t("reader.simplifiedRemoved"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("reader.deleteFailed"));
    }
  }
  function closeAssistantChat() {
    // A turn still in flight aborts too — closing the card means nobody will
    // read the reply, so there is nothing left for it to finish for.
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    setAssistantChat(null);
  }
  async function deleteAssistantConversation() {
    const chat = assistantChat;
    if (!chat?.noteId || chat.busy) return;
    try {
      await api(`/api/notes/${chat.noteId}`, "DELETE");
      setAssistantChat(null);
      router.refresh();
      showToast(t("reader.conversationRemoved"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("reader.deleteFailed"));
    }
  }
  function closeCommentCard() {
    setCommentCard(null);
  }

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
      const onMove = (ev: PointerEvent) => {
        const maxLeft = (container?.clientWidth ?? 1200) - 80;
        apply(
          Math.max(4, Math.min(start.left + ev.clientX - fromX, maxLeft)),
          Math.max(4, start.top + ev.clientY - fromY),
        );
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };
  }
  // The fading hint that replaces the Edit button. Shows on document open until
  // the reader double-clicks into edit mode once.
  const [editHint, setEditHint] = useState(false);

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
    setCloseLink(null);
    setBubble(null);
    setSimplifyCard(null);
    setAssistantChat(null);
    setCommentCard(null);
    setAnnotationCard(null);
    setEditMode(false);
    setCommentDraft("");
    setLocalAnchors({});
    freshSpansRef.current = new Set();
    freshExtractIdsRef.current = new Set();
    setDistillOpen(false);
    setDistillShownId(null);
    setDistillRun(null);
    setDistillError(null);
    setLocalDistillations([]);
    setSpanFlash(null);
    setLocalExtractions([]);
    setExtractCard(null);
    distillAbortRef.current?.abort();
    explainAbortRef.current?.abort();
    simplifyAbortRef.current?.abort();
    extractAbortRef.current?.abort();
    setExtractBusy(false);
    distillReturnScroll.current = null;
    voiceRunRef.current += 1;
    voiceAudioRef.current?.pause();
    voiceAudioRef.current = null;
    window.speechSynthesis?.cancel();
    setVoice("idle");
  }

  // Selection → block-relative offsets via data-block-id (SPEC.md §5). DOM ranges are never persisted.
  // Edit mode marks blocks with data-edit-block instead; both carry the block id.
  const captureSelection = useCallback((): Popover | null => {
    const container = containerRef.current;
    const selection = window.getSelection();
    if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return null;

    const blockOf = (node: Node): HTMLElement | null => {
      const el = node instanceof HTMLElement ? node : node.parentElement;
      return el?.closest("[data-block-id], [data-edit-block]") ?? null;
    };
    const startBlock = blockOf(range.startContainer);
    if (!startBlock) return null;
    const blockId = startBlock.dataset.blockId ?? startBlock.dataset.editBlock;
    if (!blockId) return null;
    // A rendered equation's DOM text is not the stored TeX; offsets there would
    // anchor to the wrong characters. No selection tools on math blocks.
    if (startBlock.hasAttribute("data-math-block")) return null;
    // A page's DOM text is its label and the Circle & ask card, not stored
    // text. Page anchors are drawn regions (SPEC.md §16), never selections.
    if (blocksRef.current.find((b) => b.id === blockId)?.type === "PAGE") return null;

    // Offsets over the block's anchorable text, never Range.toString(): inline
    // controls ([data-anchor-skip], e.g. extract chips) render text the stored
    // block text does not have, and counting it would shift every offset after
    // it. The quote is sliced from the same walked text, so the anchor is
    // exactly the selected text.
    const blockText = anchorableText(startBlock);
    const startOffset = anchorableOffset(startBlock, range.startContainer, range.startOffset);
    const truncated = !startBlock.contains(range.endContainer);
    const endOffset = truncated
      ? blockText.length
      : anchorableOffset(startBlock, range.endContainer, range.endOffset);
    if (endOffset <= startOffset) return null;
    const quotedText = blockText.slice(startOffset, endOffset);
    if (!quotedText.trim()) return null;

    const prefix = blockText.slice(Math.max(0, startOffset - 32), startOffset);
    const suffix = blockText.slice(endOffset, endOffset + 32);

    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    // The end of the selection is the last drawn line's right edge — the
    // bounding rect's right is the widest line, not the end.
    const lineRects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    const endRect = lineRects[lineRects.length - 1] ?? rect;
    const endLeft = Math.max(
      8,
      Math.min(endRect.right - containerRect.left + 6, containerRect.width - 110),
    );
    const endTop = endRect.top + endRect.height / 2 - containerRect.top + container.scrollTop;
    const rawX = rect.left + rect.width / 2 - containerRect.left;
    const margin = Math.min(240, containerRect.width / 2);
    const articleRect = container.querySelector("article")?.getBoundingClientRect();
    const textLeft = articleRect ? articleRect.left - containerRect.left + 24 : 24;
    const yTop = Math.max(8, rect.top - containerRect.top + container.scrollTop);
    // The rail's side follows the tool blocks nearby: right of the text when
    // that side is clear, else left, else directly below the highlight.
    const { rects, articleLeft, articleRight, cw } = measureSideCards(container);
    const articleMid = (articleLeft + articleRight) / 2;
    const POPOVER_ESTIMATE = 280;
    const side = window.matchMedia("(pointer: coarse)").matches
      ? ("below" as const)
      : blocksOnSide(rects, articleMid, "right", yTop, POPOVER_ESTIMATE).length === 0
        ? ("right" as const)
        : blocksOnSide(rects, articleMid, "left", yTop, POPOVER_ESTIMATE).length === 0
          ? ("left" as const)
          : ("below" as const);
    return {
      anchor: { blockId, startOffset, endOffset, quotedText, prefix, suffix },
      x: Math.max(margin, Math.min(rawX, containerRect.width - margin)),
      y: rect.bottom - containerRect.top + container.scrollTop + (side === "below" ? 14 : 6),
      yTop,
      textLeft,
      endLeft,
      endTop,
      truncated,
      side,
      rightBase: articleRight + 10,
      cw,
    };
  }, []);

  // Escape closes the popover and bubbles first; with nothing open it leaves
  // edit mode, saving unsaved typing on the way out.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape that dismisses a pinyin candidate list stays the IME's.
      if (isImeKey(e)) return;
      if (overlayOpenRef.current) {
        setPopover(null);
        setSubmenu(null);
        setBubble(null);
        setSimplifyCard(null);
        chatAbortRef.current?.abort();
        chatAbortRef.current = null;
        setAssistantChat(null);
        setCommentCard(null);
        setAnnotationCard(null);
        setExtractCard(null);
        setCloseLink(null);
        window.getSelection()?.removeAllRanges();
        return;
      }
      if (editModeRef.current) leaveEditMode();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Selection → popover, in reading AND edit mode: highlighting text while
  // editing offers the same tools.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onMouseUp = (event: MouseEvent) => {
      if (!canEditRef.current) return;
      if (suppressNextMouseUp.current) {
        suppressNextMouseUp.current = false;
        return;
      }
      if (event.target instanceof Element && event.target.closest("[data-selection-popover]")) return;
      // A drag that started inside the comment box can end over the article —
      // that is text editing, not a new selection.
      if (document.activeElement?.closest("[data-selection-popover]")) return;
      requestAnimationFrame(() => {
        const captured = captureSelection();
        // Video documents' blocks refuse annotation outright: a selection over
        // one shows the refusal instead of tools.
        if (captured) {
          const block = blocksRef.current.find((b) => b.id === captured.anchor.blockId);
          if (block && (block.type === "VIDEO" || block.type === "TRANSCRIPT")) {
            window.getSelection()?.removeAllRanges();
            setPopover(null);
            setSubmenu(null);
            showToast(t("reader.videoNoEditAnnotate"));
            return;
          }
        }
        // A pending link waits on the next highlighted text: the Close link
        // chip shows at the end of the highlight, and pressing it closes the
        // link there. No auto-close — an accidental selection creates nothing.
        if (captured && pendingLinkRef.current) {
          setPopover(null);
          setSubmenu(null);
          setCloseLink({ anchor: captured.anchor, left: captured.endLeft, top: captured.endTop });
          return;
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
        }
        setPopover(captured);
        setSubmenu(null);
        setCloseLink(null);
        setCommentDraft("");
      });
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
        if (captured && pendingLinkRef.current) {
          setPopover(null);
          setSubmenu(null);
          setCloseLink({ anchor: captured.anchor, left: captured.endLeft, top: captured.endTop });
          return;
        }
        setPopover(captured);
        setSubmenu(null);
      }, 500);
    };
    container.addEventListener("mouseup", onMouseUp);
    container.addEventListener("pointerup", onPointerUp);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      container.removeEventListener("mouseup", onMouseUp);
      container.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("selectionchange", onSelectionChange);
      if (selectionTimer) clearTimeout(selectionTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureSelection, documentId]);

  // Double-click a text block to edit it in place. The hint card teaches this
  // once; after the first double-click it never shows again.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onDblClick = (e: MouseEvent) => {
      if (!canEditRef.current) return;
      if (editModeRef.current) return;
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
        block.type === "PAGE"
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
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) {
        setConnectors([]);
        return;
      }
      const crect = container.getBoundingClientRect();
      const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
      const anchors: Record<string, Anchor | null | undefined> = {
        explain: bubble?.anchor,
        simplify: simplifyCard?.anchor,
        assistant: assistantChat?.anchor,
        comment: commentCard?.anchor,
      };
      for (const el of container.querySelectorAll<HTMLElement>("[data-side-card]")) {
        const anchor = anchors[el.dataset.sideCard ?? ""];
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
      setConnectors(lines);
      setConnectorHeight(container.scrollHeight);
    });
    return () => cancelAnimationFrame(raf);
  }, [bubble, simplifyCard, assistantChat, commentCard]);

  const chatMessageCount = assistantChat?.messages.length ?? 0;
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessageCount]);

  useEffect(() => {
    if (localStorage.getItem("unitos-edit-hint") === "done") return;
    // Post-hydration reveal on purpose: localStorage is client-only, so the
    // SSR pass must render without the hint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      if (figureAt(e.target as Element)) e.preventDefault();
    };
    container.addEventListener("pointerdown", onDown);
    container.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    container.addEventListener("dragstart", onDragStart);
    return () => {
      container.removeEventListener("pointerdown", onDown);
      container.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      container.removeEventListener("dragstart", onDragStart);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll to an anchor and flash it. Retries while the refreshed tree paints.
  const flashSource = useCallback((sourceId: string) => {
    const container = containerRef.current;
    if (!container) return;
    let attempts = 0;
    const tryScroll = () => {
      const el = container.querySelector<HTMLElement>(`[data-source-id="${sourceId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("anchor-flash");
        setTimeout(() => el.classList.remove("anchor-flash"), 2000);
      } else if (attempts++ < 10) {
        setTimeout(tryScroll, 200);
      }
    };
    tryScroll();
  }, []);

  // Source chip navigation: ?src=<sourceId> scrolls to the anchor and flashes it.
  const src = searchParams.get("src");
  useEffect(() => {
    if (src) flashSource(src);
  }, [src, flashSource]);

  // Arriving through a link's other end: ?link=<id> flashes the mark here.
  const linkParam = searchParams.get("link");
  useEffect(() => {
    if (!linkParam) return;
    const container = containerRef.current;
    if (!container) return;
    let attempts = 0;
    const tryScroll = () => {
      const el = container.querySelector<HTMLElement>(`[data-link-id="${linkParam}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("anchor-flash");
        setTimeout(() => el.classList.remove("anchor-flash"), 2000);
      } else if (attempts++ < 10) {
        setTimeout(tryScroll, 200);
      }
    };
    tryScroll();
  }, [linkParam]);

  // Search result navigation: ?block=<blockId> scrolls to the block and flashes it.
  const blockParam = searchParams.get("block");
  useEffect(() => {
    if (!blockParam) return;
    const container = containerRef.current;
    if (!container) return;
    let attempts = 0;
    const tryScroll = () => {
      const el = container.querySelector<HTMLElement>(
        `[data-block-id="${blockParam}"], [data-edit-block="${blockParam}"]`,
      );
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("anchor-flash");
        setTimeout(() => el.classList.remove("anchor-flash"), 2000);
      } else if (attempts++ < 10) {
        setTimeout(tryScroll, 200);
      }
    };
    tryScroll();
  }, [blockParam]);

  // Jump from the Annotations panel: works even when ?src is already this anchor.
  useEffect(() => {
    const onFlash = (e: Event) => {
      const { sourceId } = (e as CustomEvent<{ sourceId: string | null }>).detail;
      if (sourceId) flashSource(sourceId);
    };
    window.addEventListener("dissect:flash-source", onFlash);
    return () => window.removeEventListener("dissect:flash-source", onFlash);
  }, [flashSource]);

  // Clicking an annotation mark: EXPLAIN and SIMPLIFY reopen their bubble with
  // the stored content, beside the mark; everything else focuses its card in
  // the Annotations tab.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const { sourceId } = (e as CustomEvent<{ sourceId: string }>).detail;
      const container = containerRef.current;
      // Another pane owns marks this pane does not paint.
      if (!container?.querySelector(`[data-source-id="${sourceId}"]`)) return;
      const stored = annotationBubblesRef.current[sourceId];
      if (!stored) {
        // Highlight or comment: the on-mark card, right below the mark.
        const summary = annotationsBySourceRef.current[sourceId];
        const markEl = container.querySelector<HTMLElement>(`[data-source-id="${sourceId}"]`);
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
        setAnnotationCard({
          sourceId,
          noteId: summary.noteId,
          kind: summary.kind,
          color: summary.color,
          quotedText: summary.quotedText,
          draft: comment,
          saved: comment,
          // Clamped so the action row never lands under the mobile bottom bar.
          top: Math.min(
            markRect.bottom - containerRect.top + container.scrollTop + 8,
            container.scrollTop + container.clientHeight - 240,
          ),
          left: Math.max(
            12,
            Math.min(
              markRect.left - containerRect.left + container.scrollLeft,
              container.clientWidth - width - 12,
            ),
          ),
          busy: false,
        });
        return;
      }
      const markEl = container.querySelector<HTMLElement>(`[data-source-id="${sourceId}"]`);
      const containerRect = container.getBoundingClientRect();
      const top = markEl
        ? markEl.getBoundingClientRect().top - containerRect.top + container.scrollTop
        : 80;
      // Rebuild the anchor from the mark's highlight entry: the connector line
      // needs it, and SIMPLIFY's sentence mirroring maps against it.
      let anchor: Anchor | null = null;
      for (const [blockId, list] of Object.entries(anchorHighlightsRef.current)) {
        const hit = list.find((h) => h.sourceId === sourceId);
        if (!hit) continue;
        const block = blocksRef.current.find((b) => b.id === blockId);
        if (!block) break;
        anchor = {
          blockId,
          startOffset: hit.start,
          endOffset: hit.end,
          quotedText: block.text.slice(hit.start, hit.end),
          prefix: "",
          suffix: "",
        };
        break;
      }
      if (stored.kind === "assistant") {
        const slot = claimSideSlot("assistant", top);
        setAssistantChat({
          anchor,
          noteId: stored.noteId,
          ...slot,
          messages: parseConversation(stored.content),
          input: "",
          busy: false,
        });
        return;
      }
      if (stored.kind === "comment") {
        const slot = claimSideSlot("comment", top);
        const summary = annotationsBySourceRef.current[sourceId];
        setCommentCard({
          ...slot,
          noteId: summary?.noteId ?? null,
          draft: stored.content,
          saved: stored.content,
          busy: false,
          anchor,
        });
        return;
      }
      if (stored.kind === "explain" || stored.kind === "analyze") {
        const slot = claimSideSlot("explain", top);
        setBubble({
          ...slot,
          kind: stored.kind,
          text: stored.content,
          streaming: false,
          error: null,
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
      const slot = claimSideSlot("simplify", top);
      setSimplifyCard({
        anchor,
        ...slot,
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
     
  }, []);

  // Side cards dock to the article's edge; the notes tray resizing or
  // collapsing, or the window resizing, moves that edge. Re-dock every open
  // card so they stay right next to the content body, and track whether the
  // reader is now too narrow for side cards at all. On turning narrow, cards
  // with a stored annotation collapse to their tool icons next to the text;
  // a streaming or unsaved card stays open, re-docked below the highlight.
  // Position popovers close instead — their coordinates are stale the moment
  // the layout shifts.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const applyNarrow = () => {
      const measured = measureSideCards(container);
      const isNarrow = measured.cw - measured.articleRight < NARROW_GUTTER;
      if (isNarrow !== narrowRef.current) {
        narrowRef.current = isNarrow;
        setNarrow(isNarrow);
        if (isNarrow) {
          setBubble((b) => (b && !b.streaming && b.noteId ? null : b));
          setSimplifyCard((c) => (c && !c.streaming && c.noteId ? null : c));
          setAssistantChat((c) => (c && !c.busy && c.noteId ? null : c));
          setCommentCard((c) => (c && !c.busy && c.noteId && c.draft === c.saved ? null : c));
        }
      }
      return measured;
    };
    applyNarrow();
    let lastWidth = container.clientWidth;
    const observer = new ResizeObserver(() => {
      const width = container.clientWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      const { articleLeft, articleRight, cw } = applyNarrow();
      const redock = (side: "right" | "left") =>
        narrowRef.current
          ? dockBelowCard(articleLeft, articleRight, cw)
          : dockSideCard(side, articleLeft, articleRight, cw);
      setBubble((b) => (b ? { ...b, ...redock(b.side) } : b));
      setSimplifyCard((c) => (c ? { ...c, ...redock(c.side) } : c));
      setAssistantChat((c) => (c ? { ...c, ...redock(c.side) } : c));
      setCommentCard((c) => (c ? { ...c, ...redock(c.side) } : c));
      setAnnotationCard(null);
      setPopover(null);
      setSubmenu(null);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // The on-mark card closes on a click anywhere else. A click on another mark
  // stays: the open handler replaces the card.
  useEffect(() => {
    if (!annotationCard) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest("[data-selection-popover], [data-source-id]")) return;
      setAnnotationCard(null);
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [annotationCard]);

  // Below xl the article menu collapses to a pill; the card would sit over
  // the article text there. The pill toggles it; an action closes it.
  const [menuExpanded, setMenuExpanded] = useState(false);
  // The project search bubble, opened from the search icon beside the
  // assistant button. Opening one closes the other.
  const [searchOpen, setSearchOpen] = useState(false);
  // The article menu tracks the scroll position: visible only at the top.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onScroll = () => setAtTop(container.scrollTop < 24);
    onScroll();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

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
      const { rects, articleLeft, articleRight, cw } = measureSideCards(container);
      const articleMid = (articleLeft + articleRight) / 2;
      const POPOVER_ESTIMATE = 280;
      const side = window.matchMedia("(pointer: coarse)").matches
        ? ("below" as const)
        : blocksOnSide(rects, articleMid, "right", yTop, POPOVER_ESTIMATE).length === 0
          ? ("right" as const)
          : blocksOnSide(rects, articleMid, "left", yTop, POPOVER_ESTIMATE).length === 0
            ? ("left" as const)
            : ("below" as const);
      const rawX = rect.left + rect.width / 2 - containerRect.left;
      setSubmenu(null);
      setCommentDraft("");
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
        textLeft: articleRect ? articleRect.left - containerRect.left + 24 : 24,
        endLeft: Math.max(8, Math.min(rect.right - containerRect.left + 6, containerRect.width - 110)),
        endTop: rect.top + rect.height / 2 - containerRect.top + container.scrollTop,
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

  // Extract label chips: a passage's chip jumps back to the origin phrase;
  // the origin's chip opens the extract card. Only the owning pane handles it.
  useEffect(() => {
    const onChip = (e: Event) => {
      const { extractId, origin, element } = (
        e as CustomEvent<{ extractId: string; origin: boolean; element: Element }>
      ).detail;
      const container = containerRef.current;
      if (!container || !element || !container.contains(element)) return;
      const extraction = allExtractionsRef.current.find((x) => x.id === extractId);
      if (!extraction) return;
      if (origin) {
        const containerRect = container.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        const width = 280;
        setExtractCard({
          id: extractId,
          top: Math.min(
            rect.bottom - containerRect.top + container.scrollTop + 8,
            container.scrollTop + container.clientHeight - 210,
          ),
          left: Math.max(
            12,
            Math.min(
              rect.left - containerRect.left + container.scrollLeft,
              container.clientWidth - width - 12,
            ),
          ),
        });
        return;
      }
      if (extraction.origin.orphaned) {
        showToast(t("reader.originChanged"));
        return;
      }
      flashSpan(extraction.origin.blockId, extraction.origin.start, extraction.origin.end);
    };
    window.addEventListener("dissect:extract-chip", onChip);
    return () => window.removeEventListener("dissect:extract-chip", onChip);
  }, [t]);

  // The Distill panel in the side tray opens the distilled page: a stored
  // distillation by id, or the ask view (id null). Only the pane showing the
  // panel's document handles it.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const { documentId: forDocument, distillationId } = (
        e as CustomEvent<{ documentId: string; distillationId: string | null }>
      ).detail;
      if (forDocument !== documentIdRef.current) return;
      openDistillPage(distillationId);
    };
    window.addEventListener("dissect:open-distillation", onOpen);
    return () => window.removeEventListener("dissect:open-distillation", onOpen);
     
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

  // ¶ chips in AI text (Markdown) jump to the block they cite.
  useEffect(() => {
    const onFlashBlock = (e: Event) => {
      const { blockId } = (e as CustomEvent<{ blockId: string }>).detail;
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
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("anchor-flash");
      setTimeout(() => el.classList.remove("anchor-flash"), 2000);
    };
    window.addEventListener("dissect:flash-block", onFlashBlock);
    return () => window.removeEventListener("dissect:flash-block", onFlashBlock);
  }, [t]);

  // Every toast fades after 5 seconds, action or not.
  function showToast(message: string, action: { label: string; run: () => void } | null = null) {
    setToast(message);
    setToastAction(action);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      setToast(null);
      setToastAction(null);
    }, 5000);
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
    suppressNextMouseUp.current = true;
    window.getSelection()?.removeAllRanges();
    setSubmenu(null);
    setCommentDraft("");
    setPopover({
      anchor: { blockId, startOffset: 0, endOffset: text.length, quotedText: text, prefix: "", suffix: "" },
      figure: true,
      x: Math.max(120, clientX - containerRect.left),
      y: y + 8,
      yTop: Math.max(8, y - 8),
      textLeft: Math.min(clientX - containerRect.left + 130, containerRect.width - 20),
      endLeft: Math.max(8, Math.min(clientX - containerRect.left + 6, containerRect.width - 110)),
      endTop: y,
      truncated: false,
      side: "left",
      rightBase: containerRect.width - 130,
      cw: containerRect.width,
    });
  }

  // Edit mode: unsaved typing must reach the server before an anchor referencing
  // the live text is stored — the anchor's offsets describe what is on screen.
  async function flushLiveBlock(blockId: string) {
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

  async function addToSection(sectionId: string) {
    if (!popover || busy) return;
    setBusy(true);
    try {
      await flushLiveBlock(popover.anchor.blockId);
      // The highlighted text lands as a quote: blockquote lines render as the
      // boxed quotation on the note card. Edits and replies go underneath.
      const quote = popover.anchor.quotedText
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      await api("/api/notes", "POST", {
        sectionId,
        content: quote,
        source: { documentId, ...popover.anchor },
      });
      markFreshSpan(popover.anchor.blockId, popover.anchor.startOffset, popover.anchor.endOffset);
      setPopover(null);
      window.getSelection()?.removeAllRanges();
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("reader.addFailed"));
    } finally {
      setBusy(false);
    }
  }

  // The anchor travels whole (SPEC.md §5): the block id and offsets, plus the
  // quote selectors, so the server re-finds the selection when the blocks
  // changed under the reader (a re-parse, an edit).
  function anchorBody(anchor: Anchor) {
    return {
      blockId: anchor.blockId,
      startOffset: anchor.startOffset,
      endOffset: anchor.endOffset,
      quotedText: anchor.quotedText,
      prefix: anchor.prefix,
      suffix: anchor.suffix,
    };
  }

  function deriveBody(type: string, anchor: Anchor) {
    return JSON.stringify({ type, documentId, notebookId, anchor: anchorBody(anchor) });
  }

  // EXPLAIN and ANALYZE stream into the same card beside the article (SPEC.md
  // §4, §6): an explanation of the selection, or the three-section analysis
  // of a figure or table. Both persist in the hidden Annotations section.
  async function explain() {
    await streamBubble("explain");
  }
  async function analyze() {
    await streamBubble("analyze");
  }
  async function streamBubble(kind: ExplainBubble["kind"]) {
    if (!popover || busy) return;
    const { anchor, yTop } = popover;
    await flushLiveBlock(anchor.blockId);
    setPopover(null);
    window.getSelection()?.removeAllRanges();
    markFreshSpan(anchor.blockId, anchor.startOffset, anchor.endOffset);
    const slot = claimSideSlot("explain", yTop);
    setBubble({ ...slot, kind, text: "", streaming: true, error: null, anchor, noteId: null });
    explainAbortRef.current?.abort();
    const controller = new AbortController();
    explainAbortRef.current = controller;
    try {
      const res = await fetch("/api/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: deriveBody(kind === "analyze" ? "ANALYZE" : "EXPLAIN", anchor),
      });
      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? t("reader.deriveFailedStatus", { status: res.status }));
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setBubble((b) => (b ? { ...b, text: b.text + chunk } : b));
      }
      // A failure mid-stream arrives in-band; an empty stream is a failure too.
      // The note id trailer means the annotation persisted before the stream
      // closed, so the refresh below always finds the stored mark.
      setBubble((b) => {
        if (!b) return b;
        const note = splitStreamNote(b.text);
        const { text, error } = splitStreamError(note.text);
        return {
          ...b,
          text,
          noteId: note.noteId ?? b.noteId,
          streaming: false,
          error: error ?? (text.trim() ? null : t("reader.emptyResponse")),
        };
      });
      router.refresh();
    } catch (err) {
      // Stopped, not failed: what streamed in stays; an empty card closes.
      if (controller.signal.aborted) {
        setBubble((b) => (b && b.text.trim() ? { ...b, streaming: false } : null));
        return;
      }
      const message = err instanceof Error ? err.message : t("reader.deriveFailed");
      setBubble((b) => (b ? { ...b, streaming: false, error: message } : b));
    } finally {
      if (explainAbortRef.current === controller) explainAbortRef.current = null;
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
    markFreshSpan(anchor.blockId, anchor.startOffset, anchor.endOffset);
    const slot = claimSideSlot("simplify", yTop);
    setSimplifyCard({
      anchor,
      ...slot,
      text: "",
      streaming: true,
      error: null,
      noteId: null,
      sentences: null,
      active: null,
    });
    simplifyAbortRef.current?.abort();
    const controller = new AbortController();
    simplifyAbortRef.current = controller;
    try {
      const res = await fetch("/api/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: deriveBody("SIMPLIFY", anchor),
      });
      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? t("reader.deriveFailedStatus", { status: res.status }));
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setSimplifyCard((c) => (c ? { ...c, text: c.text + chunk } : c));
      }
      // A failure mid-stream arrives in-band; an empty stream is a failure too.
      // The note id trailer means the annotation persisted before the stream
      // closed, so the refresh below always finds the stored mark.
      setSimplifyCard((c) => {
        if (!c) return c;
        const note = splitStreamNote(c.text);
        const { text, error } = splitStreamError(note.text);
        return {
          ...c,
          text,
          noteId: note.noteId ?? c.noteId,
          streaming: false,
          error: error ?? (text.trim() ? null : t("reader.emptyResponse")),
          sentences: error || !text.trim() ? null : parseSimplified(text),
          active: null,
        };
      });
      router.refresh();
    } catch (err) {
      // Stopped, not failed: what streamed in stays; an empty card closes.
      if (controller.signal.aborted) {
        setSimplifyCard((c) => (c && c.text.trim() ? { ...c, streaming: false } : null));
        return;
      }
      const message = err instanceof Error ? err.message : t("reader.simplifyFailed");
      setSimplifyCard((c) => (c ? { ...c, streaming: false, error: message } : c));
    } finally {
      if (simplifyAbortRef.current === controller) simplifyAbortRef.current = null;
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
      showToast(err instanceof Error ? err.message : t("reader.recolorFailed"));
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
      await api(`/api/notes/${card.noteId}`, "PATCH", { content });
      router.refresh();
      setAnnotationCard(null);
      showToast(t("common.saved"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("reader.saveFailed"));
      setAnnotationCard((c) => (c ? { ...c, busy: false } : c));
    }
  }

  async function deleteAnnotation() {
    const card = annotationCard;
    if (!card || card.busy) return;
    setAnnotationCard({ ...card, busy: true });
    try {
      await api(`/api/notes/${card.noteId}`, "DELETE");
      router.refresh();
      setAnnotationCard(null);
      showToast(card.kind === "highlight" ? t("reader.highlightRemoved") : t("reader.commentRemoved"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("reader.deleteFailed"));
      setAnnotationCard((c) => (c ? { ...c, busy: false } : c));
    }
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
      await api(`/api/notes/${card.noteId}`, "PATCH", { content });
      router.refresh();
      setCommentCard((c) => (c ? { ...c, saved: content, busy: false } : c));
      showToast(t("common.saved"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("reader.saveFailed"));
      setCommentCard((c) => (c ? { ...c, busy: false } : c));
    }
  }

  async function deleteCommentCard() {
    const card = commentCard;
    if (!card || card.busy || !card.noteId) return;
    setCommentCard({ ...card, busy: true });
    try {
      await api(`/api/notes/${card.noteId}`, "DELETE");
      router.refresh();
      setCommentCard(null);
      showToast(t("reader.commentRemoved"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("reader.deleteFailed"));
      setCommentCard((c) => (c ? { ...c, busy: false } : c));
    }
  }

  // DISTILL: one question, the whole article, the quotes that answer it
  // (SPEC.md §4). The page opens on the ask view; Run scans the article.
  const allDistillations = [
    ...localDistillations.filter((d) => !distillations.some((p) => p.id === d.id)),
    ...distillations,
  ];

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
  // the progress bar under the Distill button showing it.
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

  async function runDistill(question: string) {
    const q = question.trim();
    if (!q || distillRun) return;
    const runDocumentId = documentId;
    const controller = new AbortController();
    distillAbortRef.current = controller;
    setDistillRun({ question: q });
    setDistillError(null);
    setDistillShownId(null);
    try {
      const res = await fetch("/api/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ type: "DISTILL", documentId, notebookId, question: q }),
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
      if (!distillOpenRef.current) showToast(message);
    } finally {
      if (distillAbortRef.current === controller) distillAbortRef.current = null;
      if (documentIdRef.current === runDocumentId) setDistillRun(null);
    }
  }

  async function deleteDistillation(id: string) {
    try {
      await api(`/api/notebooks/${notebookId}/documents/${documentId}`, "PATCH", {
        removeDistillationId: id,
      });
      setLocalDistillations((prev) => prev.filter((d) => d.id !== id));
      if (distillShownId === id) setDistillShownId(null);
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("reader.deleteFailed"));
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
      showToast(err instanceof Error ? err.message : t("reader.addFailed"));
      return false;
    }
  }

  // Jump to a span: scroll to its block, flash it, and tint the exact span
  // while the reader lands on it. Distilled quotes and extract chips share it.
  function flashSpan(blockId: string, start: number, end: number) {
    setSpanFlash({ blockId, start, end });
    if (spanFlashTimer.current) clearTimeout(spanFlashTimer.current);
    spanFlashTimer.current = setTimeout(() => setSpanFlash(null), 2600);
    requestAnimationFrame(() => {
      const el = containerRef.current?.querySelector<HTMLElement>(
        `[data-block-id="${blockId}"], [data-edit-block="${blockId}"]`,
      );
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("anchor-flash");
      setTimeout(() => el.classList.remove("anchor-flash"), 2000);
    });
  }

  // Jump from the distilled page: close it, then land on the quote.
  function jumpToQuote(quote: { blockId: string; start: number; end: number; orphaned: boolean }) {
    if (quote.orphaned) return;
    setDistillOpen(false);
    distillReturnScroll.current = null;
    flashSpan(quote.blockId, quote.start, quote.end);
  }

  // EXTRACT: the highlighted phrase's topic → the passages across the article
  // that reveal it, painted with a label chip that jumps back to the origin
  // (SPEC.md §4).
  async function extract() {
    if (!popover || extractBusy) return;
    const { anchor } = popover;
    await flushLiveBlock(anchor.blockId);
    setPopover(null);
    setSubmenu(null);
    window.getSelection()?.removeAllRanges();
    setExtractBusy(true);
    const controller = new AbortController();
    extractAbortRef.current = controller;
    try {
      const res = await fetch("/api/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: deriveBody("EXTRACT", anchor),
      });
      const json = (await res.json().catch(() => null)) as {
        extraction?: Extraction;
        error?: string;
      } | null;
      if (!res.ok || !json?.extraction) {
        throw new Error(json?.error ?? t("reader.extractFailedStatus", { status: res.status }));
      }
      const label = `E${allExtractionsRef.current.length + 1}`;
      const fresh: ExtractionView = {
        id: json.extraction.id,
        createdAt: json.extraction.createdAt,
        label,
        origin: { ...json.extraction.origin, orphaned: false },
        spans: json.extraction.spans.map((s) => ({ ...s, orphaned: false })),
      };
      freshExtractIdsRef.current.add(fresh.id);
      setLocalExtractions((prev) => [...prev, fresh]);
      showToast(
        t("reader.extractDone", { label, n: fresh.spans.length, s: plural(fresh.spans.length) }),
      );
      router.refresh();
    } catch (err) {
      // Stopped, not failed: nothing was extracted, nothing to say.
      if (controller.signal.aborted) return;
      showToast(err instanceof Error ? err.message : t("reader.extractFailed"));
    } finally {
      if (extractAbortRef.current === controller) extractAbortRef.current = null;
      setExtractBusy(false);
    }
  }

  async function deleteExtraction(id: string) {
    try {
      await api(`/api/notebooks/${notebookId}/documents/${documentId}`, "PATCH", {
        removeExtractionId: id,
      });
      setLocalExtractions((prev) => prev.filter((x) => x.id !== id));
      setExtractCard(null);
      router.refresh();
      showToast(t("reader.extractionRemoved"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("reader.deleteFailed"));
    }
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
    const text = popover.anchor.quotedText.slice(0, 4000);
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
      showToast(err instanceof Error ? err.message : t("reader.voiceFailed"));
    }
  }

  // The article menu's asks: the assistant reads the whole document — no
  // anchor, document scope — and answers in the chat card beside the article.
  // question null opens an empty chat for the reader's own question.
  function openArticleChat(question: string | null) {
    const container = containerRef.current;
    const slot = claimSideSlot("assistant", (container?.scrollTop ?? 0) + 56);
    if (question === null) {
      setAssistantChat({ anchor: null, noteId: null, ...slot, messages: [], input: "", busy: false });
      return;
    }
    setAssistantChat({
      anchor: null,
      noteId: null,
      ...slot,
      messages: [{ role: "user", content: question }],
      input: "",
      busy: true,
    });
    const controller = new AbortController();
    chatAbortRef.current = controller;
    void (async () => {
      try {
        const turn = await assistantTurn(question, null, [], null, controller.signal);
        setAssistantChat((c) =>
          c
            ? {
                ...c,
                busy: false,
                noteId: turn.noteId ?? c.noteId,
                messages: [...c.messages, { role: "assistant", content: turn.reply }],
              }
            : c,
        );
      } catch (err) {
        // Stopped, not failed: the question stays, no reply lands.
        if (controller.signal.aborted) {
          setAssistantChat((c) => (c ? { ...c, busy: false } : c));
          return;
        }
        const message = err instanceof Error ? err.message : t("reader.assistantFailed");
        setAssistantChat((c) =>
          c
            ? { ...c, busy: false, messages: [...c.messages, { role: "assistant", content: message }] }
            : c,
        );
      } finally {
        if (chatAbortRef.current === controller) chatAbortRef.current = null;
      }
    })();
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

  // Manual annotation: highlight (color, content = quote) or comment (user text).
  // Lands ACCEPTED in the hidden Annotations section. The mark paints instantly
  // from the captured anchor; the server's copy replaces it on refresh.
  async function annotate(input: { color?: string; comment?: string }) {
    if (!popover || busy) return;
    if (input.comment !== undefined && !input.comment.trim()) return;
    const { anchor } = popover;
    await flushLiveBlock(anchor.blockId);
    markFreshSpan(anchor.blockId, anchor.startOffset, anchor.endOffset);
    const optimistic = { start: anchor.startOffset, end: anchor.endOffset, color: input.color ?? null };
    setLocalAnchors((prev) => ({
      ...prev,
      [anchor.blockId]: [...(prev[anchor.blockId] ?? []), optimistic],
    }));
    setPopover(null);
    setSubmenu(null);
    setCommentDraft("");
    window.getSelection()?.removeAllRanges();
    setBusy(true);
    try {
      const res = await fetch("/api/annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notebookId,
          documentId,
          anchor,
          color: input.color,
          comment: input.comment,
        }),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? t("reader.annotationFailedStatus", { status: res.status }));
      }
      router.refresh();
    } catch (err) {
      // Offline (SPEC.md §17, Unitos Premium): a highlight or comment is a
      // non-AI annotation — queue it, keep the optimistic paint, sync later.
      if (isOffline() && offlinePremium()) {
        await queueWrite("/api/annotations", "POST", {
          notebookId,
          documentId,
          anchor,
          color: input.color,
          comment: input.comment,
        });
        showToast(t("reader.annotationQueuedOffline"));
        setBusy(false);
        return;
      }
      setLocalAnchors((prev) => ({
        ...prev,
        [anchor.blockId]: (prev[anchor.blockId] ?? []).filter((h) => h !== optimistic),
      }));
      showToast(err instanceof Error ? err.message : t("reader.annotationFailed"));
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
  async function completeLinkTo(to: Anchor): Promise<boolean> {
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
      await api("/api/links", "POST", {
        fromDocumentId: pending.fromDocumentId,
        toDocumentId: documentId,
        anchor: from,
        toAnchor: to,
      });
      broadcastPendingLink(null);
      setCloseLink(null);
      window.getSelection()?.removeAllRanges();
      router.refresh();
      showToast(t("reader.linkCreated"));
      return true;
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("reader.linkFailed"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function completeLink() {
    if (!popover) return;
    const done = await completeLinkTo(popover.anchor);
    if (done) {
      setPopover(null);
      setSubmenu(null);
    }
  }

  // The Close link chip's press: the chip's highlight is the other end. On
  // failure the chip stays for another try; the banner's ✕ still cancels.
  async function completeCloseLink() {
    if (!closeLink) return;
    await completeLinkTo(closeLink.anchor);
  }

  // The assistant engine: command → server-validated plan → approval → the
  // normal API routes. Auto mode skips approval; the toggle persists.
  async function runAssistant(commandText?: string) {
    const command = (commandText ?? aiCommandRef.current).trim();
    if (!command || aiBusy || !popover) return;
    const { anchor, yTop } = popover;
    setAiBusy(true);
    const controller = new AbortController();
    chatAbortRef.current = controller;
    try {
      await flushLiveBlock(anchor.blockId);
      const turn = await assistantTurn(command, anchor, [], null, controller.signal);
      setPopover(null);
      setSubmenu(null);
      setAiCommand("");
      window.getSelection()?.removeAllRanges();
      // The conversation continues in a chat card docked beside the article.
      markFreshSpan(anchor.blockId, anchor.startOffset, anchor.endOffset);
      const slot = claimSideSlot("assistant", yTop);
      setAssistantChat({
        anchor,
        noteId: turn.noteId,
        ...slot,
        messages: [
          { role: "user", content: command },
          { role: "assistant", content: turn.reply },
        ],
        input: "",
        busy: false,
      });
    } catch (err) {
      // Stopped, not failed: the command stays in the box to edit or resend.
      if (controller.signal.aborted) return;
      showToast(err instanceof Error ? err.message : t("reader.assistantFailed"));
    } finally {
      if (chatAbortRef.current === controller) chatAbortRef.current = null;
      setAiBusy(false);
    }
  }

  // One assistant turn: command + history → reply text. Plans route through the
  // existing approval card (or run immediately in Auto), and the chat narrates it.
  async function assistantTurn(
    command: string,
    anchor: Anchor | null,
    history: ChatMessage[],
    conversationNoteId: string | null,
    signal?: AbortSignal,
  ): Promise<{ reply: string; noteId: string | null }> {
    const res = await fetch("/api/assistant/act", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        notebookId,
        documentId,
        command,
        anchor: anchor ? anchorBody(anchor) : undefined,
        history: history.slice(-12),
        conversationNoteId: conversationNoteId ?? undefined,
      }),
    });
    const plan = (await res.json().catch(() => null)) as
      | (AssistantPlan & { error?: string })
      | null;
    if (!res.ok || !plan)
      throw new Error(plan?.error ?? t("reader.assistantFailedStatus", { status: res.status }));
    const parts: string[] = [];
    if (plan.reply) parts.push(plan.reply);
    if (plan.actions.length > 0) {
      const n = plan.actions.length;
      // Every plan waits for approval (SPEC.md §1: nothing applies unaccepted).
      setAiPlan(plan);
      setPlanChecked(new Set(plan.actions.map((_, i) => i)));
      parts.push(t("reader.proposedActions", { n, s: plural(n) }));
    }
    if (parts.length === 0) parts.push(plan.warnings[0] ?? t("reader.noActions"));
    // The anchored conversation persisted server-side; refresh paints its mark.
    if (plan.conversationNoteId) router.refresh();
    return { reply: parts.join("\n\n"), noteId: plan.conversationNoteId ?? null };
  }

  async function sendChatMessage() {
    const chat = assistantChat;
    const text = chat?.input.trim();
    if (!chat || !text || chat.busy) return;
    const history = chat.messages;
    setAssistantChat((c) =>
      c
        ? { ...c, input: "", busy: true, messages: [...c.messages, { role: "user", content: text }] }
        : c,
    );
    const controller = new AbortController();
    chatAbortRef.current = controller;
    try {
      const turn = await assistantTurn(text, chat.anchor, history, chat.noteId, controller.signal);
      setAssistantChat((c) =>
        c
          ? {
              ...c,
              busy: false,
              noteId: turn.noteId ?? c.noteId,
              messages: [...c.messages, { role: "assistant", content: turn.reply }],
            }
          : c,
      );
    } catch (err) {
      // Stopped, not failed: the sent message stays, no reply lands.
      if (controller.signal.aborted) {
        setAssistantChat((c) => (c ? { ...c, busy: false } : c));
        return;
      }
      const message = err instanceof Error ? err.message : t("reader.assistantFailed");
      setAssistantChat((c) =>
        c
          ? { ...c, busy: false, messages: [...c.messages, { role: "assistant", content: message }] }
          : c,
      );
    } finally {
      if (chatAbortRef.current === controller) chatAbortRef.current = null;
    }
  }

  async function executePlan(actions: AssistantAction[], warnings: string[] = []) {
    const sectionIdByTitle = new Map(
      sectionChoices.map((c) => [c.label.toLowerCase(), c.id] as const),
    );
    let applied = 0;
    const failed: string[] = [];
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
            break;
          }
          case "edit_block":
            await api(`/api/blocks/${action.blockId}`, "PATCH", { text: action.newText });
            break;
          case "insert_paragraph":
            await api("/api/blocks", "POST", {
              documentId,
              afterBlockId: action.afterBlockId,
              text: action.text,
            });
            break;
          case "remove_block":
            await api(`/api/blocks/${action.blockId}`, "DELETE");
            break;
          case "highlight":
            await api("/api/annotations", "POST", {
              notebookId,
              documentId,
              anchor: action.anchor,
              color: action.color,
              comment: action.comment,
            });
            break;
          case "comment":
            await api("/api/annotations", "POST", {
              notebookId,
              documentId,
              anchor: action.anchor,
              comment: action.comment,
            });
            break;
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
            }
            // Assistant notes carry their authorship. The plan was approved,
            // so the note lands accepted (SPEC.md §1).
            await api("/api/notes", "POST", {
              sectionId,
              content: action.content,
              source: action.source,
              origin: "assistant",
              pending: false,
            });
            break;
          }
          case "link":
            await api("/api/links", "POST", {
              fromDocumentId: documentId,
              toDocumentId: action.toDocumentId,
              anchor: action.anchor,
            });
            break;
          case "format_block":
            await api(`/api/blocks/${action.blockId}`, "PATCH", { kind: action.kind });
            break;
          case "style":
            await api(`/api/blocks/${action.anchor.blockId}/style`, "POST", {
              startOffset: action.anchor.startOffset,
              endOffset: action.anchor.endOffset,
              style: action.style,
            });
            break;
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
    showToast(summary);
  }

  async function approvePlan() {
    if (!aiPlan) return;
    const actions = aiPlan.actions.filter((_, i) => planChecked.has(i));
    setAiPlan(null);
    await executePlan(actions, aiPlan.warnings);
  }

  // Voice command: browser speech recognition fills the box; in auto mode the
  // command runs when speech ends.
  function toggleVoice() {
    if (aiListening) {
      recognitionRef.current?.stop();
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRec;
      webkitSpeechRecognition?: new () => SpeechRec;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      showToast(t("reader.voiceInputUnavailable"));
      return;
    }
    const rec = new Ctor();
    // Spoken commands come in the app language; the browser locale only
    // decides the English variant.
    rec.lang = langRef.current === "zh" ? "zh-CN" : navigator.language || "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      const transcript = Array.from(
        e.results as ArrayLike<ArrayLike<{ transcript: string }>>,
        (r) => r[0].transcript,
      ).join(" ");
      setAiCommand(transcript);
      aiCommandRef.current = transcript;
    };
    rec.onend = () => {
      setAiListening(false);
      recognitionRef.current = null;
    };
    rec.onerror = () => {
      setAiListening(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = rec;
    setAiListening(true);
    rec.start();
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
      showToast(err instanceof Error ? err.message : t("reader.editFailed"));
    } finally {
      stepping.current = false;
    }
  }
  // The article's editor hands back a way to save what is being typed, so undo
  // can settle it first.
  const flushEditRef = useRef<(() => Promise<void>) | null>(null);

  // Cmd+Z and Shift+Cmd+Z while editing (Ctrl elsewhere). The article's
  // editable is the browser's, so its own undo would fight this one: the
  // article's history is the one that answers, and it holds the typing too.
  useEffect(() => {
    if (!editMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const redo = key === "y" || (key === "z" && e.shiftKey);
      if (key !== "z" && !redo) return;
      e.preventDefault();
      e.stopPropagation();
      void runStep(!redo);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode]);

  // Edit mode: the whole body is editable in place. Every change goes through
  // the same routes as the assistant's, so history and healing stay uniform.
  function toggleEditMode() {
    // A fresh session of editing starts with an empty history.
    undoStack.current = [];
    redoStack.current = [];
    syncHistory();
    setPopover(null);
    setSubmenu(null);
    setBubble(null);
    setSimplifyCard(null);
    editModeRef.current = !editMode;
    setEditMode(!editMode);
  }

  async function formatBlock(
    blockId: string,
    kind: "paragraph" | "h1" | "h2" | "h3" | "list" | "numbered",
    text?: string,
  ) {
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
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("reader.formatFailed"));
    }
  }

  async function toggleStyleSpan(
    blockId: string,
    start: number,
    end: number,
    style:
      | "bold"
      | "italic"
      | "underline"
      | "color-clay"
      | "color-sage"
      | "color-gold"
      | "color-plum",
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
      showToast(err instanceof Error ? err.message : t("reader.styleFailed"));
    }
  }

  async function setFont(next: string) {
    try {
      await api(`/api/documents/${documentId}`, "PATCH", { font: next });
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("reader.fontFailed"));
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
      showToast(err instanceof Error ? err.message : t("reader.insertFailed"));
      return null;
    }
  }

  // A dropped image lands as a figure right after the block it was dropped on
  // (SPEC.md §16), the same insert path a new paragraph takes.
  async function insertImageBlock(afterBlockId: string, image: DroppedImage): Promise<string> {
    const res = await fetch("/api/blocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId,
        afterBlockId,
        type: "FIGURE",
        text: image.name,
        html: imageFigureHtml(image.id, image.name),
      }),
    });
    const json = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
    if (!res.ok || !json?.id) {
      throw new Error(json?.error ?? t("reader.insertFailedStatus", { status: res.status }));
    }
    return json.id;
  }

  // Images drop into the article while editing: the block under the pointer
  // says where they land. Everything else keeps travelling to the window,
  // which adds dropped files as documents (document-bar.tsx).
  const dropPointRef = useRef<{ x: number; y: number } | null>(null);
  const imageDrop = useImageDrop({
    premium,
    enabled: editMode && canEdit,
    t,
    onError: showToast,
    onImages: async (images) => {
      const point = dropPointRef.current;
      const blocks = blocksRef.current;
      const el = point ? document.elementFromPoint(point.x, point.y) : null;
      const dropped = el?.closest<HTMLElement>("[data-edit-block], [data-block-id]");
      const afterId =
        dropped?.dataset.editBlock ??
        dropped?.dataset.blockId ??
        blocks[blocks.length - 1]?.id;
      if (!afterId) return;
      // Each figure lands after the one before it, so several images keep the
      // order they were dropped in.
      let after = afterId;
      for (const image of images) after = await insertImageBlock(after, image);
      router.refresh();
    },
  });

  async function deleteBlock(blockId: string) {
    try {
      const res = await fetch(`/api/blocks/${blockId}`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as { editId?: string; error?: string } | null;
      if (!res.ok) {
        throw new Error(json?.error ?? t("reader.removeFailedStatus", { status: res.status }));
      }
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
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("reader.removeFailed"));
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
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("reader.editFailed"));
    }
  }

/** The format a stored block is in, for a step that puts it back. */
function blockFormatKind(
  block: { type: string; html: string | null; text: string } | undefined,
): "paragraph" | "h1" | "h2" | "h3" | "list" | "numbered" | null {
  if (!block) return null;
  if (block.type === "LIST") return /^\s*\d{1,3}[.)]\s/.test(block.text) ? "numbered" : "list";
  if (block.type !== "HEADING") return "paragraph";
  const level = /^<h([1-3])/.exec(block.html ?? "")?.[1] ?? "2";
  return `h${level}` as "h1" | "h2" | "h3";
}

  // Merge anchor, extraction, term, and link layers per block.
  const highlightsByBlock: Record<string, Highlight[]> = {};
  for (const [blockId, list] of Object.entries(anchorHighlights)) {
    highlightsByBlock[blockId] = list.map((h) => {
      // Narrow reader: a stored AI annotation rests as its tool icon next to
      // the highlighted text; the icon opens the card. Comments keep their
      // always-on icon.
      const stored = narrow ? annotationBubbles[h.sourceId] : undefined;
      const tool = stored && stored.kind !== "comment" ? stored.kind : undefined;
      return { ...h, kind: "anchor" as const, tool };
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
        annotation: false,
        kind: "anchor" as const,
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
      })),
    ];
  }
  const referenceById = new Map(references.map((r) => [r.id, r]));
  for (const [blockId, list] of Object.entries(citationsByBlock)) {
    const existing = highlightsByBlock[blockId] ?? [];
    highlightsByBlock[blockId] = [
      ...existing,
      ...list.map((c) => ({
        sourceId: null,
        start: c.start,
        end: c.end,
        kind: "citation" as const,
        referenceId: c.referenceId,
        referenceText: referenceById.get(c.referenceId)?.text,
      })),
    ];
  }
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
    const { blockId, startOffset, endOffset, quotedText } = simplifyCard.anchor;
    const existing = highlightsByBlock[blockId] ?? [];
    // With a pressed sentence, only its source sentences tint — the mirroring.
    // Otherwise the whole selection keeps the light tint.
    const pressed =
      simplifyCard.active !== null && simplifyCard.sentences
        ? simplifyCard.sentences[simplifyCard.active]
        : null;
    const sourceSpans = pressed ? splitSentences(quotedText) : [];
    const ranges = pressed
      ? pressed.refs
          .map((n) => sourceSpans[n - 1])
          .filter((span): span is SentenceSpan => Boolean(span))
          .map((span) => ({
            sourceId: null,
            start: startOffset + span.start,
            end: startOffset + span.end,
            kind: "simplify" as const,
          }))
      : [];
    highlightsByBlock[blockId] = [
      ...existing,
      ...(ranges.length > 0
        ? ranges
        : [{ sourceId: null, start: startOffset, end: endOffset, kind: "simplify" as const }]),
    ];
  }
  // Extraction layers: the origin phrase and its revealing passages, each
  // carrying the extraction's label chip. Unresolvable spans stay unpainted.
  // A fresh extraction sweeps in staggered: the origin first, then its
  // passages down the document, one after the other.
  for (const extraction of allExtractions) {
    const freshExtract = freshExtractIdsRef.current.has(extraction.id);
    const entries = [
      ...(!extraction.origin.orphaned ? [{ span: extraction.origin, isOrigin: true }] : []),
      ...extraction.spans.filter((s) => !s.orphaned).map((span) => ({ span, isOrigin: false })),
    ];
    entries.forEach(({ span, isOrigin }, i) => {
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
          fresh: freshExtract,
          freshDelay: freshExtract && i > 0 ? i * 90 : undefined,
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
  for (const anchor of [bubble?.anchor, assistantChat?.anchor, commentCard?.anchor]) {
    if (!anchor) continue;
    const existing = highlightsByBlock[anchor.blockId] ?? [];
    const marked = existing.some(
      (h) => h.kind === "anchor" && h.start === anchor.startOffset && h.end === anchor.endOffset,
    );
    if (marked) continue;
    highlightsByBlock[anchor.blockId] = [
      ...existing,
      { sourceId: null, start: anchor.startOffset, end: anchor.endOffset, kind: "anchor" as const },
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
        (h.kind === "anchor" || h.kind === "simplify") &&
        freshSpansRef.current.has(`${blockId}:${h.start}:${h.end}`)
      ) {
        h.fresh = true;
      }
    }
  }

  // The toolbox's own box (top/left/width), in pane coordinates. The bubbles
  // anchored to it (highlight colors, Add to notes) are w-full, so the stack
  // shares one left edge and one width. Coarse pointers get wider boxes to
  // fit the tap-sized rows.
  const popoverBox = popover
    ? (() => {
        const w =
          submenu === "ai" || submenu === "comment" ? (coarse ? 300 : 248) : coarse ? 220 : 176;
        if (popover.side === "right") {
          return { top: popover.yTop, left: Math.min(popover.rightBase, popover.cw - w - 6), width: w };
        }
        if (popover.side === "below") {
          return {
            top: popover.y,
            left: Math.max(6, Math.min(popover.x - w / 2, popover.cw - w - 6)),
            width: w,
          };
        }
        return { top: popover.yTop, left: Math.max(6, popover.textLeft - w - 10), width: w };
      })()
    : { top: 0, left: 0, width: 0 };
  // One row of the toolbox. Coarse pointers get 44px-tall rows.
  const toolRow = coarse ? "px-3.5 py-2.5 text-[14px]" : "px-2.5 py-[5px] text-[12px]";
  // The open popover's content kind and its toolbar (SPEC.md §6).
  const popoverKind: ContentKind = contentKindOf(
    popover ? blocks.find((b) => b.id === popover.anchor.blockId)?.type : undefined,
  );
  const has = (tool: Tool) => TOOLBARS[popoverKind].includes(tool);

  return (
    <div
      ref={containerRef}
      data-reader-root
      onDragOver={(e) => {
        dropPointRef.current = { x: e.clientX, y: e.clientY };
        imageDrop.handlers.onDragOver(e);
      }}
      onDragLeave={imageDrop.handlers.onDragLeave}
      onDrop={(e) => {
        dropPointRef.current = { x: e.clientX, y: e.clientY };
        void imageDrop.handlers.onDrop(e);
      }}
      // The inline restore script finds this pane's stored reading position by
      // its document (lib/reading-position.ts).
      data-document-id={documentId}
      // While the distilled page is open it scrolls itself; the article
      // underneath must not scroll away, so the pane clips instead.
      className={`relative min-h-0 flex-1 print:overflow-visible ${
        distillOpen ? "overflow-hidden" : "overflow-y-auto"
      }`}
    >
      {/* The article menu floats open at the top of the page: frequent asks
          go to the assistant at document scope; Distill opens the distilled
          page; the search icon beside the assistant button expands the
          project search bubble. It hides once the reader scrolls and returns
          at the top. The strip spans the pane so the bubble can size to it;
          only the controls take pointer events. */}
      <div
      data-track-surface="article-menu"
        inert={!atTop}
        className={`pointer-events-none absolute inset-x-4 top-4 z-30 transition duration-200 print:hidden ${
          atTop ? "opacity-100" : "-translate-y-2 opacity-0"
        }`}
      >
        <div className="mb-1.5 flex w-max gap-1.5">
          <button
            onClick={() => {
              setMenuExpanded((v) => !v);
              setSearchOpen(false);
            }}
            data-track="assistant"
            aria-expanded={menuExpanded}
            data-tip={t("reader.assistantMenuTitle")}
            className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-card px-3 py-2 text-[12px] font-semibold text-clay-800 shadow-float"
          >
            <SparkleIcon size={13} />
            {t("reader.assistant")}
          </button>
          <button
            data-project-search
            data-track="search"
            onClick={() => {
              setSearchOpen((v) => !v);
              setMenuExpanded(false);
            }}
            aria-label={t("panes.searchProject")}
            aria-expanded={searchOpen}
            data-tip={t("panes.searchProjectTitle")}
            className={`pointer-events-auto flex w-[34px] items-center justify-center rounded-full bg-card shadow-float ${
              searchOpen ? "text-clay-800" : "text-sand-600 hover:text-clay-800"
            }`}
          >
            <SearchIcon size={15} />
          </button>
        </div>
        <Collapse open={menuExpanded}>
        <div className="pointer-events-auto flex w-56 flex-col overflow-hidden rounded-2xl bg-card py-1.5 shadow-float">
          {canEdit && (
            <>
              <span className="flex items-center gap-1.5 px-4 pt-1.5 pb-1 text-[11px] font-bold tracking-[0.08em] text-clay-800 uppercase">
                <SparkleIcon size={12} />
                {t("reader.assistant")}
              </span>
              {FREQUENT_ASKS.map((ask) => (
                <button
                  key={ask.labelKey}
                  data-track={`ask:${ask.track}`}
                  data-tip={t(ask.questionKey)}
                  onClick={() => {
                    setMenuExpanded(false);
                    openArticleChat(t(ask.questionKey));
                  }}
                  className="px-4 py-2 text-left text-[12.5px] text-sand-800 hover:bg-clay-100 hover:text-clay-800"
                >
                  {t(ask.labelKey)}
                </button>
              ))}
              <button
                onClick={() => {
                  setMenuExpanded(false);
                  openArticleChat(null);
                }}
                data-track="ask-assistant"
                data-tip={t("reader.askAssistantTitle")}
                className="px-4 py-2 text-left text-[12.5px] text-sand-800 hover:bg-clay-100 hover:text-clay-800"
              >
                {t("reader.askAssistant")}
              </button>
              <div className="mx-3 my-1 border-t border-line" />
            </>
          )}
          <button
            onClick={() => {
              setMenuExpanded(false);
              openDistillPage(null);
            }}
            data-track="distill"
            data-tip={t("reader.distillMenuTitle")}
            className="flex items-center gap-1.5 px-4 py-2 text-left text-[12.5px] text-sand-800 hover:bg-clay-100 hover:text-clay-800"
          >
            <DistillIcon size={12} />
            {t("reader.distill")}
            {allDistillations.length > 0 ? ` (${allDistillations.length})` : ""}
          </button>
        </div>
        </Collapse>
        <ProjectSearch
          notebookId={notebookId}
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
        />
      </div>

      <div className="sticky top-4 z-10 float-right mr-4 flex items-center gap-2 print:hidden">
        {extractBusy && (
          <span className="rounded-full bg-card px-3 py-1.5 text-xs shadow-soft">
            <ThinkingIndicator label={t("reader.extracting")} onStop={stopExtract} />
          </span>
        )}
      <Presence show={toast !== null} exit="fade">
        {toast && (
          <span className="flex items-center gap-2 rounded-full bg-ink/90 px-3 py-1.5 text-xs text-paper">
            {toast}
            {toastAction && (
              <button
                onClick={toastAction.run}
                data-track="toast-action"
                className="rounded-full bg-paper/20 px-2.5 py-0.5 font-semibold hover:bg-paper/30"
              >
                {toastAction.label}
              </button>
            )}
          </span>
        )}
      </Presence>
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
        {/* Distill (in Salience's old spot): a link into the distilled page.
            While a distillation runs, a progress bar shows under the button. */}
        <div className="relative">
          <button
            onClick={() => openDistillPage(distillShownId)}
            data-track="distill"
            className="flex items-center gap-1.5 rounded-full bg-sand-100 px-3.5 py-1.5 text-xs font-semibold text-sand-600 shadow-soft hover:text-clay-800"
            data-tip={t("reader.distillButtonTitle")}
          >
            <DistillIcon size={13} />
            {t("reader.distill")}
            {allDistillations.length > 0 ? ` (${allDistillations.length})` : ""}
          </button>
          {distillRun && (
            <span aria-hidden className="progress-track absolute right-1.5 -bottom-[7px] left-1.5">
              <span className="progress-fill" />
            </span>
          )}
        </div>
      </div>

      {editHint && !editMode && (
        <div
          onAnimationEnd={() => setEditHint(false)}
          className={`hint-fade pointer-events-none absolute top-16 right-5 z-10 rounded-2xl bg-card px-4 py-2.5 leading-relaxed text-sand-700 shadow-lift print:hidden ${
            coarse ? "max-w-80 text-[13px]" : "max-w-64 text-[12px]"
          }`}
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
        stylesByBlock={stylesByBlock}
        editedByBlock={editedByBlock}
        pages={
          conversion
            ? { notebookId, canEdit, marksByBlock: pageMarksByBlock, conversion }
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
        banner={
          <TranslationBar
            documentId={documentId}
            text={blocks.map((b) => b.text).join("\n").slice(0, 4000)}
            available={translationAvailable}
            onTranslations={setTranslations}
          />
        }
        translations={translations}
      />

      <Bibliography references={references} />

      <Presence show={annotationCard !== null} exit="pop">
      {annotationCard && (
        <div
          data-selection-popover
          className="pop-in absolute z-30 w-[300px] rounded-2xl bg-card p-3 shadow-float"
          style={{ top: annotationCard.top, left: annotationCard.left }}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
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
              if (e.key === "Escape") setAnnotationCard(null);
            }}
            placeholder={t("reader.addCommentPlaceholder")}
            rows={3}
            className="w-full resize-none rounded-xl bg-sand-100 px-2.5 py-2 text-[13px] outline-none placeholder:text-sand-500"
          />
          <div className="mt-2 flex items-center justify-between">
            <button
              onClick={() => void deleteAnnotation()}
              data-track="annotation-delete"
              data-tip={annotationCard.kind === "highlight" ? t("reader.deleteHighlightTitle") : t("reader.deleteCommentTitle")}
              disabled={annotationCard.busy}
              className="text-xs font-semibold text-red-500 hover:text-red-700 disabled:opacity-40"
            >
              {t("common.delete")}
            </button>
            <button
              onClick={() => void saveAnnotation()}
              data-track="annotation-save"
              disabled={annotationCard.busy || annotationCard.draft.trim() === annotationCard.saved.trim()}
              className="rounded-full bg-clay px-3 py-1 text-[11px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
            >
              {t("common.save")}
            </button>
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
              className="pop-in absolute z-30 w-[280px] rounded-2xl bg-card p-3 shadow-float"
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
              <p className="line-clamp-2 border-l-2 border-sand-300 pl-2 text-xs text-sand-600">
                {extraction.origin.quotedText}
              </p>
              <p className="mt-2 text-xs text-sand-500">
                {t("reader.extractCardBody", {
                  n: extraction.spans.length,
                  s: plural(extraction.spans.length),
                  label: extraction.label,
                })}
              </p>
              <div className="mt-2 flex items-center justify-between">
                <AuthorChip createdById={extraction.createdById} />
                {canEdit && (
                  <button
                    onClick={() => void deleteExtraction(extraction.id)}
                    data-track="extract-card-delete"
                    className="text-xs font-semibold text-red-500 hover:text-red-700"
                    data-tip={t("reader.deleteExtractionTitle")}
                  >
                    {t("common.delete")}
                  </button>
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
          data-track-surface="ai-toolbar"
          onMouseDown={(e) => {
            // Keep the text selection alive under the rail — but let fields
            // take focus, or the inputs could never place a caret.
            const target = e.target as HTMLElement;
            if (target.closest("textarea, input")) return;
            e.preventDefault();
          }}
          className="pop-in absolute z-20 flex flex-col gap-0.5 rounded-2xl bg-card p-1.5 shadow-float"
          style={popoverBox}
        >
          {popover.truncated && (
            <p className="px-2.5 py-1 text-[10.5px] leading-snug text-sand-500">
              {t("reader.anchorsFirstParagraph")}
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
          {pendingLink && (
            <button
              disabled={busy}
              onClick={() => void completeLink()}
              data-track="close-link"
              data-tip={t("reader.closeLinkTitle")}
              className={`flex w-full items-center gap-1.5 rounded-full bg-sage-600 ${toolRow} text-left font-semibold text-sage-fg hover:bg-sage-700 disabled:opacity-40`}
            >
              <LinkIcon size={11} />
              {t("reader.closeLink")}
            </button>
          )}

          <button
            onClick={() => setSubmenu(submenu === "ai" ? null : "ai")}
            data-track="assistant"
            aria-expanded={submenu === "ai"}
            data-tip={t("reader.assistantTitle")}
            className={`flex w-full items-center gap-1.5 rounded-full ${toolRow} text-left font-semibold ${
              submenu === "ai"
                ? "bg-clay-100 text-clay-800"
                : "text-clay-700 hover:bg-clay-100 hover:text-clay-800"
            }`}
          >
            <SparkleIcon size={coarse ? 14 : 12} />
            {t("reader.assistant")}
          </button>
          <Collapse open={submenu === "ai"}>
          {submenu === "ai" && (
            <div className="flex flex-col gap-1.5 p-1">
              <textarea
                autoFocus
                value={aiCommand}
                onChange={(e) => setAiCommand(e.target.value)}
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
                placeholder={t("reader.assistantPlaceholder")}
                rows={2}
                className="w-full resize-none rounded-xl bg-sand-100 p-2 text-[12px] outline-none placeholder:text-sand-500"
              />
              <div className="flex items-center gap-1.5">
                <button
                  onClick={toggleVoice}
                  data-track="assistant-voice"
                  aria-label={aiListening ? t("reader.stopListening") : t("reader.speakCommand")}
                  data-tip={aiListening ? t("reader.stopListening") : t("reader.speakCommand")}
                  className={`flex size-7 items-center justify-center rounded-full ${
                    aiListening
                      ? "animate-pulse bg-red-500 text-white"
                      : "text-sand-600 hover:bg-clay-100 hover:text-clay-800"
                  }`}
                >
                  <MicIcon size={13} />
                </button>
                <button
                  disabled={!aiBusy && !aiCommand.trim()}
                  onClick={() => (aiBusy ? stopAssistantChat() : void runAssistant())}
                  data-track="assistant-run"
                  data-tip={aiBusy ? t("reader.stopAssistant") : t("reader.runTitle")}
                  aria-label={aiBusy ? t("reader.stopAssistant") : undefined}
                  className="ml-auto rounded-full bg-clay px-3 py-1 text-[11px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
                >
                  {aiBusy ? <StopIcon size={11} /> : t("reader.run")}
                </button>
              </div>
              {aiBusy && <ThinkingIndicator className="px-1 pb-0.5 text-[11.5px]" />}
            </div>
          )}
          </Collapse>

          {popover.term && (
            <button
              onClick={() => void extract()}
              data-track="extract-term"
              disabled={extractBusy}
              data-tip={t("reader.extractTermTitle")}
              className={`flex w-full items-center justify-between gap-2 rounded-full bg-clay-100 ${toolRow} text-left font-semibold text-clay-800 hover:bg-clay-200 disabled:opacity-40`}
            >
              <span className="flex items-center gap-1.5">
                <ExtractIcon size={coarse ? 14 : 12} />
                {t("reader.extract")}
              </span>
              <span className="text-[9px] font-bold tracking-[0.06em] text-clay-700 uppercase">
                {t("reader.recommended")}
              </span>
            </button>
          )}

          {/* Analyze leads the table and figure toolbars (SPEC.md §4): the
              three-section analysis beside the article. Never on text. */}
          {has("analyze") && (
            <button
              onClick={() => void analyze()}
              data-track="analyze"
              data-tip={t(popoverKind === "table" ? "reader.analyzeTableTitle" : "reader.analyzeFigureTitle")}
              className={`flex w-full items-center justify-between gap-2 rounded-full bg-clay-100 ${toolRow} text-left font-semibold text-clay-800 hover:bg-clay-200 disabled:opacity-40`}
            >
              <span className="flex items-center gap-1.5">
                <ChartIcon size={coarse ? 14 : 12} />
                {t(popoverKind === "table" ? "reader.analyzeTable" : "reader.analyzeFigure")}
              </span>
              <span className="text-[9px] font-bold tracking-[0.06em] text-clay-700 uppercase">
                {t("reader.recommended")}
              </span>
            </button>
          )}
          {has("explain") && (
          <button
            onClick={() => void explain()}
            data-track="explain"
            data-tip={popoverKind === "figure" ? t("reader.explainFigureTitle") : t("reader.explainTitle")}
            className={`flex w-full items-center gap-1.5 rounded-full ${toolRow} text-left text-sand-800 hover:bg-clay-100 hover:text-clay-800`}
          >
            <QuestionIcon size={coarse ? 14 : 12} />
            {t("reader.explain")}
          </button>
          )}
          {has("simplify") && (
            <button
              onClick={() => void simplify()}
              data-track="simplify"
              data-tip={t("reader.simplifyTitle")}
              className={`flex w-full items-center gap-1.5 rounded-full ${toolRow} text-left text-sand-800 hover:bg-clay-100 hover:text-clay-800`}
            >
              <SummaryIcon size={coarse ? 14 : 12} />
              {t("reader.simplify")}
            </button>
          )}
          {has("extract") && !popover.term && (
            <button
              onClick={() => void extract()}
              data-track="extract"
              disabled={extractBusy}
              data-tip={t("reader.extractTitle")}
              className={`flex w-full items-center gap-1.5 rounded-full ${toolRow} text-left text-sand-800 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40`}
            >
              <ExtractIcon size={coarse ? 14 : 12} />
              {t("reader.extract")}
            </button>
          )}

          {has("comment") && (
          <>
          <button
            onClick={() => setSubmenu(submenu === "comment" ? null : "comment")}
            data-track="comment"
            aria-expanded={submenu === "comment"}
            data-tip={t("reader.commentTitle")}
            className={`flex w-full items-center gap-1.5 rounded-full ${toolRow} text-left ${
              submenu === "comment"
                ? "bg-clay-100 text-clay-800"
                : "text-sand-800 hover:bg-clay-100 hover:text-clay-800"
            }`}
          >
            <CommentIcon size={coarse ? 14 : 12} />
            {t("reader.comment")}
          </button>
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
                onChange={(e) => setCommentDraft(e.target.value)}
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
                  }
                }}
                placeholder={t("reader.commentPlaceholder")}
                rows={2}
                className="w-full resize-none rounded-xl bg-sand-100 p-2 text-[12px] outline-none placeholder:text-sand-500"
              />
              <button
                type="submit"
                data-track="comment-save"
                disabled={busy || !commentDraft.trim()}
                className="self-end rounded-full bg-clay px-3 py-1 text-[11px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
              >
                {t("common.save")}
              </button>
            </form>
          )}
          </Collapse>
          </>
          )}

          {has("link") && (
          <button
            onClick={beginLink}
            data-track="link"
            data-tip={t("reader.linkTitle")}
            className={`flex w-full items-center gap-1.5 rounded-full ${toolRow} text-left text-sand-800 hover:bg-clay-100 hover:text-clay-800`}
          >
            <UnlinkIcon size={coarse ? 14 : 12} />
            {t("reader.linkAcrossTexts")}
          </button>
          )}

          {/* Highlight: a separate bubble right above the toolbox holds the
              color dots, as wide as the toolbox. Near the top of the page it
              drops below instead, under the voice bubble, so it never lands
              out of reach. On a coarse pointer it is the toolbox's first row. */}
          {has("highlight") && (
          <div
            className={
              coarse
                ? "order-first flex items-center justify-around px-2 py-2"
                : `absolute left-0 flex w-full items-center justify-around rounded-full bg-card px-3 py-2 shadow-float ${
                    popover.yTop < 54 ? "top-full mt-[50px]" : "bottom-full mb-2"
                  }`
            }
          >
            {HIGHLIGHT_HUES.map((color) => (
              <button
                key={color}
                disabled={busy}
                onClick={() => void annotate({ color, comment: commentDraft.trim() || undefined })}
                data-track={`highlight:${color}`}
                aria-label={t("reader.highlightIn", { color: t(HUE_KEY[color]) })}
                data-tip={t(
                  commentDraft.trim() ? "reader.highlightInWithNote" : "reader.highlightIn",
                  { color: t(HUE_KEY[color]) },
                )}
                className={`${coarse ? "size-7" : "size-5"} rounded-full transition-transform hover:scale-110 disabled:opacity-40`}
                style={{ background: HUE_DOT[color] }}
              />
            ))}
          </div>
          )}

          {/* Add to notes: a separate bubble above the toolbar, as wide as the
              toolbox. Press it, pick a section, and the highlighted text lands
              there as a quote. It sits one slot higher than the highlight
              bubble; when the highlight bubble drops below near the page top,
              it takes the near slot. On a coarse pointer it is the toolbox's
              second row. */}
          {has("addToNotes") && sectionChoices.length > 0 && (
            <div
              className={
                coarse
                  ? "-order-1 flex flex-col gap-0.5"
                  : `absolute bottom-full left-0 flex w-full flex-col gap-0.5 rounded-2xl bg-card p-1.5 shadow-float ${
                      popover.yTop < 54 ? "mb-2" : "mb-[52px]"
                    }`
              }
            >
              <button
                onClick={() => setSubmenu(submenu === "add" ? null : "add")}
                data-track="add-to-notes"
                aria-expanded={submenu === "add"}
                data-tip={t("reader.addToNotesTitle")}
                className={`flex w-full items-center gap-1.5 rounded-full bg-clay ${toolRow} text-left font-semibold text-clay-fg hover:bg-clay-600`}
              >
                <NotesIcon size={coarse ? 14 : 12} />
                {t("reader.addToNotes")}
              </button>
          <Collapse open={submenu === "add"}>
              {submenu === "add" && (
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
              )}
          </Collapse>
            </div>
          )}

          {/* Voice: a separate bubble under the toolbar reads the highlighted
              text aloud. Press again to stop. Text only. */}
          {has("readAloud") && (
          <div className="absolute top-full left-0 mt-2">
            <button
              onClick={() => void speakSelection()}
              data-track="read-aloud"
              aria-label={voice === "idle" ? t("reader.readAloud") : t("reader.stopReading")}
              data-tip={voice === "idle" ? t("reader.readAloud") : t("reader.stopReading")}
              className={`flex ${coarse ? "size-11" : "size-[34px]"} items-center justify-center rounded-full shadow-float ${
                voice === "idle"
                  ? "bg-card text-sand-700 hover:text-clay-800"
                  : "bg-clay text-clay-fg hover:bg-clay-600"
              }`}
            >
              {voice === "loading" ? (
                <SpinnerIcon size={14} className="motion-safe:animate-spin" />
              ) : voice === "playing" ? (
                <StopIcon size={13} />
              ) : (
                <VolumeIcon size={15} />
              )}
            </button>
          </div>
          )}
        </div>
      )}
      </Presence>

      <Presence show={closeLink !== null} exit="pop">
      {closeLink && (
        <button
          data-selection-popover
          data-track-surface="ai-toolbar"
          data-track="close-link"
          disabled={busy}
          data-tip={t("reader.closeLinkTitle")}
          onMouseDown={(e) => e.preventDefault()} // keep the highlight alive under the press
          onClick={() => void completeCloseLink()}
          className="absolute z-20 flex -translate-y-1/2 items-center gap-1.5 rounded-full bg-sage-600 px-2.5 py-1 text-[11.5px] font-semibold text-sage-fg shadow-float hover:bg-sage-700 disabled:opacity-40"
          style={{ left: closeLink.left, top: closeLink.top }}
        >
          {busy ? (
            <SpinnerIcon size={10} className="motion-safe:animate-spin" />
          ) : (
            <LinkIcon size={10} />
          )}
          {t("reader.closeLink")}
        </button>
      )}
      </Presence>

      <Presence show={bubble !== null} exit="bubble">
      {bubble && (
        <div
          data-selection-popover
          data-side-card="explain"
          className="bubble-in absolute z-20 rounded-[20px] border border-line bg-card/90 p-4 shadow-float backdrop-blur-md"
          style={{ left: bubble.left, top: bubble.top, width: bubble.width }}
        >
          <div
            onPointerDown={dragCard(
              () => (bubble ? { left: bubble.left, top: bubble.top } : null),
              (left, top) => setBubble((b) => (b ? { ...b, left, top } : b)),
            )}
            style={{ touchAction: "none" }}
            data-tip={t("reader.dragToMove")}
            className="mb-2 flex cursor-move items-center justify-between"
          >
            <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.08em] text-clay-800 uppercase">
              {bubble.kind === "analyze" ? <ChartIcon size={12} /> : <QuestionIcon size={12} />}
              {bubble.kind === "analyze"
                ? bubble.streaming
                  ? t("reader.analyzing")
                  : t("reader.analysis")
                : bubble.streaming
                  ? t("reader.explaining")
                  : t("reader.explanation")}
            </span>
            <span className="flex items-center gap-3">
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
              {bubble.noteId && !bubble.streaming && (
                <button
                  onClick={() => void deleteExplain()}
                  data-track={bubble.kind === "analyze" ? "analyze-delete" : "explain-delete"}
                  className="text-xs font-semibold text-red-500 hover:text-red-700"
                  data-tip={t(
                    bubble.kind === "analyze"
                      ? "reader.deleteAnalysisTitle"
                      : "reader.deleteExplainTitle",
                  )}
                >
                  {t("common.delete")}
                </button>
              )}
              <button
                onClick={closeExplain}
                data-track={bubble.kind === "analyze" ? "analyze-close" : "explain-close"}
                className="text-xs text-sand-500 hover:text-clay-700"
                aria-label={t("common.close")}
                data-tip={t("common.close")}
              >
                ✕
              </button>
            </span>
          </div>
          {bubble.error ? (
            <p className="text-sm text-red-600">{bubble.error}</p>
          ) : bubble.text ? (
            <div className="max-h-80 overflow-y-auto text-sm">
              <Markdown>{bubble.text}</Markdown>
            </div>
          ) : (
            <ThinkingIndicator className="py-1 text-[12.5px]" />
          )}
        </div>
      )}
      </Presence>

      <Presence show={simplifyCard !== null} exit="bubble">
      {simplifyCard && (
        <div
          key={`${simplifyCard.anchor.blockId}:${simplifyCard.anchor.startOffset}`}
          data-selection-popover
          data-side-card="simplify"
          className="bubble-in absolute z-20 rounded-[20px] border border-line bg-card/80 p-4 shadow-float backdrop-blur-md"
          style={{ top: simplifyCard.top, left: simplifyCard.left, width: simplifyCard.width }}
        >
          <div
            onPointerDown={dragCard(
              () => (simplifyCard ? { left: simplifyCard.left, top: simplifyCard.top } : null),
              (left, top) => setSimplifyCard((c) => (c ? { ...c, left, top } : c)),
            )}
            style={{ touchAction: "none" }}
            data-tip={t("reader.dragToMove")}
            className="mb-2 flex cursor-move items-center justify-between"
          >
            <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.08em] text-sage-800 uppercase">
              <SummaryIcon size={12} />
              {simplifyCard.streaming ? t("reader.simplifying") : t("reader.simplified")}
            </span>
            <span className="flex items-center gap-3">
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
              {simplifyCard.noteId && !simplifyCard.streaming && (
                <button
                  onClick={() => void deleteSimplify()}
                  data-track="simplify-delete"
                  className="text-xs font-semibold text-red-500 hover:text-red-700"
                  data-tip={t("reader.deleteSimplifyTitle")}
                >
                  {t("common.delete")}
                </button>
              )}
              <button
                onClick={closeSimplify}
                data-track="simplify-close"
                className="text-xs text-sand-500 hover:text-clay-700"
                aria-label={t("common.close")}
                data-tip={t("common.close")}
              >
                ✕
              </button>
            </span>
          </div>
          {simplifyCard.error ? (
            <p className="text-sm text-red-600">{simplifyCard.error}</p>
          ) : simplifyCard.sentences ? (
            <p className="max-h-96 overflow-y-auto text-[13.5px] leading-relaxed whitespace-pre-wrap">
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
            <p className="max-h-96 overflow-y-auto text-[13.5px] leading-relaxed whitespace-pre-wrap">
              {stripSimplifyMarkers(simplifyCard.text) || (
                <ThinkingIndicator className="py-1 text-[12.5px]" />
              )}
            </p>
          )}
        </div>
      )}
      </Presence>

      <Presence show={commentCard !== null} exit="bubble">
      {commentCard && (
        <div
          data-selection-popover
          data-side-card="comment"
          className="bubble-in absolute z-20 rounded-[20px] border border-line bg-card/90 p-4 shadow-float backdrop-blur-md"
          style={{ left: commentCard.left, top: commentCard.top, width: commentCard.width }}
        >
          <div
            onPointerDown={dragCard(
              () => (commentCard ? { left: commentCard.left, top: commentCard.top } : null),
              (left, top) => setCommentCard((c) => (c ? { ...c, left, top } : c)),
            )}
            style={{ touchAction: "none" }}
            data-tip={t("reader.dragToMove")}
            className="mb-2 flex cursor-move items-center justify-between"
          >
            <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.08em] text-clay-800 uppercase">
              <CommentIcon size={12} />
              {t("reader.comment")}
            </span>
            <button
              onClick={closeCommentCard}
              data-track="comment-card-close"
              className="text-xs text-sand-500 hover:text-clay-700"
              aria-label={t("common.close")}
              data-tip={t("common.close")}
            >
              ✕
            </button>
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
                  if (e.key === "Escape") setCommentCard(null);
                }}
                rows={4}
                className="w-full resize-none rounded-xl bg-sand-100 px-2.5 py-2 text-[13px] outline-none placeholder:text-sand-500"
              />
              {commentCard.anchor && (
                <p className="mt-2 line-clamp-2 border-l-2 border-sand-300 pl-2 text-xs text-sand-500">
                  {commentCard.anchor.quotedText}
                </p>
              )}
              <div className="mt-2 flex items-center justify-between">
                <button
                  onClick={() => void deleteCommentCard()}
                  data-track="comment-card-delete"
                  data-tip={t("reader.deleteCommentTitle")}
                  disabled={commentCard.busy}
                  className="text-xs font-semibold text-red-500 hover:text-red-700 disabled:opacity-40"
                >
                  {t("common.delete")}
                </button>
                <button
                  onClick={() => void saveCommentCard()}
                  data-track="comment-card-save"
                  disabled={commentCard.busy || commentCard.draft.trim() === commentCard.saved.trim()}
                  className="rounded-full bg-clay px-3 py-1 text-[11px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
                >
                  {t("common.save")}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="max-h-80 overflow-y-auto text-[13px]">
                <Markdown>{commentCard.draft}</Markdown>
              </div>
              {commentCard.anchor && (
                <p className="mt-2 line-clamp-2 border-l-2 border-sand-300 pl-2 text-xs text-sand-500">
                  {commentCard.anchor.quotedText}
                </p>
              )}
            </>
          )}
        </div>
      )}
      </Presence>

      <Presence show={assistantChat !== null} exit="bubble">
      {assistantChat && (
        <div
          data-selection-popover
          data-side-card="assistant"
          className="bubble-in absolute z-20 flex resize flex-col overflow-hidden rounded-[20px] border border-line bg-card/95 shadow-float backdrop-blur-md"
          style={{
            left: assistantChat.left,
            top: assistantChat.top,
            width: assistantChat.width,
            height: 340,
            minWidth: 260,
            minHeight: 220,
            maxWidth: 680,
            maxHeight: "80vh",
          }}
        >
          <div
            onPointerDown={dragCard(
              () => (assistantChat ? { left: assistantChat.left, top: assistantChat.top } : null),
              (left, top) => setAssistantChat((c) => (c ? { ...c, left, top } : c)),
            )}
            style={{ touchAction: "none" }}
            data-tip={t("reader.dragToMove")}
            className="flex cursor-move items-center justify-between px-4 pt-3 pb-1"
          >
            <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.08em] text-clay-800 uppercase">
              <SparkleIcon size={12} />
              {t("reader.assistant")}
            </span>
            <span className="flex items-center gap-3">
              {assistantChat.noteId && (
                <button
                  onClick={() => void deleteAssistantConversation()}
                  data-track="assistant-card-delete"
                  className="text-xs font-semibold text-red-500 hover:text-red-700"
                  data-tip={t("reader.deleteConversationTitle")}
                >
                  {t("common.delete")}
                </button>
              )}
              <button
                onClick={closeAssistantChat}
                data-track="assistant-card-close"
                className="text-xs text-sand-500 hover:text-clay-700"
                aria-label={t("common.close")}
                data-tip={t("common.close")}
              >
                ✕
              </button>
            </span>
          </div>
          <div ref={chatScrollRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-2">
            {assistantChat.messages.map((message, i) =>
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
            {assistantChat.busy && <ThinkingIndicator className="py-0.5 text-[12px]" />}
          </div>
          <form
            className="flex items-end gap-1.5 px-3 pb-3"
            onSubmit={(e) => {
              e.preventDefault();
              void sendChatMessage();
            }}
          >
            <textarea
              value={assistantChat.input}
              rows={1}
              onChange={(e) =>
                setAssistantChat((c) => (c ? { ...c, input: e.target.value } : c))
              }
              {...ime.props}
              onKeyDown={(e) => {
                if (ime.isImeEnter(e)) return;
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendChatMessage();
                }
              }}
              placeholder={t("reader.replyPlaceholder")}
              aria-label={t("reader.messageAssistant")}
              className="min-h-8 flex-1 resize-none rounded-xl bg-sand-100 px-3 py-1.5 text-[12.5px] outline-none placeholder:text-sand-500"
            />
            <button
              type="submit"
              data-track="assistant-card-send"
              onClick={(e) => {
                if (!assistantChat.busy) return;
                e.preventDefault();
                stopAssistantChat();
              }}
              disabled={!assistantChat.busy && !assistantChat.input.trim()}
              data-tip={assistantChat.busy ? t("reader.stopAssistant") : t("reader.sendTitle")}
              aria-label={assistantChat.busy ? t("reader.stopAssistant") : undefined}
              className="rounded-full bg-clay px-3 py-1.5 text-[11px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
            >
              {assistantChat.busy ? <StopIcon size={11} /> : t("reader.send")}
            </button>
          </form>
        </div>
      )}
      </Presence>

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

      <Presence show={pendingLink !== null} exit="fade">
      {pendingLink && (
        <div className="fixed top-24 left-1/2 z-40 flex max-w-[80vw] -translate-x-1/2 items-center gap-3 rounded-full bg-card px-4 py-2 shadow-float">
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
            className="shrink-0 text-xs text-sand-500 hover:text-clay-700"
          >
            ✕
          </button>
        </div>
      )}
      </Presence>

      <Presence show={aiPlan !== null} exit="pop">
      {aiPlan && (
        <div className="fixed bottom-6 left-1/2 z-40 w-[440px] max-w-[92vw] -translate-x-1/2 rounded-[24px] bg-card p-4 shadow-float">
          <div className="mb-2 flex items-center gap-2">
            <SparkleIcon size={15} className="text-clay" />
            <span className="font-display text-[15px]">{t("reader.assistantPlan")}</span>
            <span className="ml-auto rounded-full bg-sand-200 px-2.5 py-0.5 text-[10px] font-semibold text-sand-600">
              {t("reader.askFirst")}
            </span>
          </div>
          {aiPlan.reply && (
            <div className="mb-2 max-h-36 overflow-y-auto text-[13px]">
              <Markdown>{aiPlan.reply}</Markdown>
            </div>
          )}
          <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
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
          {aiPlan.warnings.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2">
              {aiPlan.warnings.map((w, i) => (
                <li key={i} className="text-[11.5px] font-medium text-amber-700 dark:text-amber-400">
                  ⚠ {w}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex items-center gap-2">
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
              {t("common.cancel")}
            </button>
          </div>
        </div>
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
          onRun={(question) => void runDistill(question)}
          onCancel={cancelDistill}
          onOpen={(id) => {
            setDistillShownId(id);
            setDistillError(null);
          }}
          onAsk={() => setDistillShownId(null)}
          onClose={closeDistillPage}
          onDelete={(id) => void deleteDistillation(id)}
          onJump={jumpToQuote}
          onAddNote={addQuoteNote}
        />
      )}
      </Presence>
    </div>
  );
}

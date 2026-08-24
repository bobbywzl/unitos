"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { SourceInput } from "@/lib/anchors/input";
import {
  parseSimplified,
  splitSentences,
  stripSimplifyMarkers,
  type SentenceSpan,
  type SimplifiedSentence,
} from "@/lib/sentences";
import type { AssistantAction, AssistantPlan } from "@/lib/types";
import type { DocumentReference } from "@/lib/parse/types";
import { splitStreamError, splitStreamNote } from "@/lib/derive/config";
import { findWeblinks } from "@/lib/weblinks";
import { MicIcon, SparkleIcon } from "@/components/icons";
import { Markdown } from "@/components/markdown";
import type { BlockData, Highlight } from "@/components/reader/block-view";
import { Bibliography } from "@/components/reader/bibliography";
import { Reader } from "@/components/reader/reader";

type Anchor = Omit<SourceInput, "documentId">;
type Popover = {
  anchor: Anchor;
  x: number;
  y: number;
  yTop: number;
  textLeft: number;
  truncated: boolean; // selection crossed into another paragraph; anchor covers the first
  figure?: boolean; // opened by the hold-and-circle gesture on a figure; no Simplify or Extract
  // Placement, by proximity to open tool blocks: right of the text first, then
  // left, then directly below the highlighted text. Bases are container coords.
  side: "right" | "left" | "below";
  rightBase: number;
  cw: number;
};

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

/** The concrete target of a plan action, shown before Apply so approval is
    informed: the quote, the section, the color — not just a label. */
function actionDetail(
  action: AssistantAction,
  blocks: BlockData[],
  documents: { id: string; title: string }[],
): string | null {
  const blockText = (id: string) => blocks.find((b) => b.id === id)?.text ?? "";
  switch (action.type) {
    case "highlight":
      return `${action.color} · “${clip(action.anchor.quotedText)}”`;
    case "comment":
    case "style":
      return `“${clip(action.anchor.quotedText)}”`;
    case "add_note": {
      const where = action.sectionTitle ?? "the section";
      return `into ${where} · “${clip(action.content)}”`;
    }
    case "add_section":
      return `“${action.title}”`;
    case "edit_block":
      return `to “${clip(action.newText)}”`;
    case "insert_paragraph":
      return `“${clip(action.text)}”`;
    case "remove_block":
      return `“${clip(blockText(action.blockId))}”`;
    case "link": {
      const target = documents.find((d) => d.id === action.toDocumentId)?.title ?? "a document";
      return `“${clip(action.anchor.quotedText, 60)}” → ${target}`;
    }
    case "format_block":
      return `“${clip(blockText(action.blockId), 60)}” → ${action.kind}`;
    default:
      return null;
  }
}

const ACTION_LABEL: Record<AssistantAction["type"], string> = {
  edit_block: "Edit",
  insert_paragraph: "Add paragraph",
  remove_block: "Remove",
  highlight: "Highlight",
  comment: "Comment",
  add_note: "Note",
  add_section: "Section",
  link: "Link",
  format_block: "Format",
  style: "Style",
};
type ExplainBubble = {
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

const HIGHLIGHT_HUES = ["clay", "sage", "gold", "plum"] as const;
const HUE_DOT: Record<(typeof HIGHLIGHT_HUES)[number], string> = {
  clay: "var(--clay-400)",
  sage: "var(--sage-500)",
  gold: "#d9a54a",
  plum: "#a78bfa",
};

// Three dots that take turns jumping: a tool block is waiting on the model.
function LoadingDots() {
  return (
    <span aria-label="Loading" className="inline-flex items-center gap-1 py-1">
      <span className="loading-dot" />
      <span className="loading-dot" />
      <span className="loading-dot" />
    </span>
  );
}

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

// Client layer over the reader: selection capture, popover, EXPLAIN bubble,
// SIMPLIFY bubble, SALIENCE overlay toggle, EXTRACT, jump-to-anchor.
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
  salienceByBlock,
  hasSalience,
  termsByBlock,
  linksByBlock,
  editedByBlock,
  stylesByBlock,
  contentsLinksByBlock,
  citationsByBlock,
  references,
  font,
}: {
  documentId: string;
  notebookId: string;
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
  // Stored EXPLAIN, SIMPLIFY, comment, and assistant conversation content by
  // source id: clicking their mark (or icon) reopens the card with this content.
  annotationBubbles: Record<
    string,
    { kind: "explain" | "simplify" | "comment" | "assistant"; content: string; noteId: string }
  >;
  salienceByBlock: Record<string, { start: number; end: number }[]>;
  hasSalience: boolean;
  termsByBlock: Record<string, { start: number; end: number; definition: string }[]>;
  linksByBlock: Record<
    string,
    { linkId: string; start: number; end: number; href: string; title: string }[]
  >;
  editedByBlock: Record<string, { start: number; end: number }[]>;
  stylesByBlock: Record<
    string,
    { start: number; end: number; style: "bold" | "italic" | "underline" | "code" }[]
  >;
  // Contents links (targetBlockId: click scrolls the reader to that block) and
  // PDF hyperlinks (href: a plain hyperlink out of the app).
  contentsLinksByBlock: Record<
    string,
    { start: number; end: number; targetBlockId?: string; href?: string }[]
  >;
  citationsByBlock: Record<string, { start: number; end: number; referenceId: string }[]>;
  references: DocumentReference[];
  font: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const [salienceOn, setSalienceOn] = useState(false);
  const [salienceBusy, setSalienceBusy] = useState(false);
  // Optimistic highlight marks: painted the instant a color dot is clicked,
  // cleared when the server's anchors arrive with the refresh.
  const [localAnchors, setLocalAnchors] = useState<
    Record<string, { start: number; end: number; color: string | null }[]>
  >({});
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
  // pane in a split view. Panes share the pending link through a window event.
  const [pendingLink, setPendingLink] = useState<{
    fromDocumentId: string;
    anchor: Anchor;
  } | null>(null);
  const pendingLinkRef = useRef<{ fromDocumentId: string; anchor: Anchor } | null>(null);
  pendingLinkRef.current = pendingLink;
  const documentIdRef = useRef(documentId);
  documentIdRef.current = documentId;

  function broadcastPendingLink(next: { fromDocumentId: string; anchor: Anchor } | null) {
    setPendingLink(next);
    pendingLinkRef.current = next;
    window.dispatchEvent(new CustomEvent("dissect:pending-link", { detail: next }));
  }
  useEffect(() => {
    const onPending = (e: Event) => {
      const next = (e as CustomEvent<{ fromDocumentId: string; anchor: Anchor } | null>).detail;
      setPendingLink(next ?? null);
      pendingLinkRef.current = next ?? null;
    };
    window.addEventListener("dissect:pending-link", onPending);
    return () => window.removeEventListener("dissect:pending-link", onPending);
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
        window.dispatchEvent(new CustomEvent("dissect:pending-link", { detail: next }));
        showToast("Highlight the other end to complete the link.");
        return;
      }
    };
    window.addEventListener("dissect:start-link", onStartLink);
    return () => window.removeEventListener("dissect:start-link", onStartLink);
  }, []);

  // The assistant as an actor: a command becomes a plan; the plan runs after
  // approval, or immediately when the reader toggled auto.
  const [aiCommand, setAiCommand] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiListening, setAiListening] = useState(false);
  const [aiPlan, setAiPlan] = useState<AssistantPlan | null>(null);
  const [planChecked, setPlanChecked] = useState<Set<number>>(new Set());
  // Lazy init: the toggle only ever renders after user interaction, so the
  // SSR pass never shows it and the localStorage read cannot mismatch.
  const [autoRun, setAutoRun] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("unitos-assistant-auto") === "1",
  );
  const autoRunRef = useRef(false);
  autoRunRef.current = autoRun;
  const aiCommandRef = useRef("");
  aiCommandRef.current = aiCommand;
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
    commentCard !== null;
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
  function closeExplain() {
    setBubble(null);
  }
  async function deleteExplain() {
    const card = bubble;
    if (!card?.noteId || card.streaming) return;
    try {
      await api(`/api/notes/${card.noteId}`, "DELETE");
      setBubble(null);
      router.refresh();
      showToast("Explanation removed");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Delete failed");
    }
  }
  function closeSimplify() {
    setSimplifyCard(null);
  }
  async function deleteSimplify() {
    const card = simplifyCard;
    if (!card?.noteId || card.streaming) return;
    try {
      await api(`/api/notes/${card.noteId}`, "DELETE");
      setSimplifyCard(null);
      router.refresh();
      showToast("Simplified removed");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Delete failed");
    }
  }
  function closeAssistantChat() {
    setAssistantChat(null);
  }
  async function deleteAssistantConversation() {
    const chat = assistantChat;
    if (!chat?.noteId || chat.busy) return;
    try {
      await api(`/api/notes/${chat.noteId}`, "DELETE");
      setAssistantChat(null);
      router.refresh();
      showToast("Conversation removed");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Delete failed");
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
  function setAssistantMode(auto: boolean) {
    setAutoRun(auto);
    autoRunRef.current = auto;
    localStorage.setItem("unitos-assistant-auto", auto ? "1" : "0");
  }

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
    setAnnotationCard(null);
    setEditMode(false);
    setCommentDraft("");
    setLocalAnchors({});
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

    const preRange = document.createRange();
    preRange.selectNodeContents(startBlock);
    preRange.setEnd(range.startContainer, range.startOffset);
    const startOffset = preRange.toString().length;

    const inBlockRange = document.createRange();
    inBlockRange.selectNodeContents(startBlock);
    inBlockRange.setStart(range.startContainer, range.startOffset);
    const truncated = !startBlock.contains(range.endContainer);
    if (!truncated) {
      inBlockRange.setEnd(range.endContainer, range.endOffset);
    }
    const quotedText = inBlockRange.toString();
    if (!quotedText.trim()) return null;
    const endOffset = startOffset + quotedText.length;

    const blockText = startBlock.textContent ?? "";
    const prefix = blockText.slice(Math.max(0, startOffset - 32), startOffset);
    const suffix = blockText.slice(endOffset, endOffset + 32);

    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
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
    const side =
      blocksOnSide(rects, articleMid, "right", yTop, POPOVER_ESTIMATE).length === 0
        ? ("right" as const)
        : blocksOnSide(rects, articleMid, "left", yTop, POPOVER_ESTIMATE).length === 0
          ? ("left" as const)
          : ("below" as const);
    return {
      anchor: { blockId, startOffset, endOffset, quotedText, prefix, suffix },
      x: Math.max(margin, Math.min(rawX, containerRect.width - margin)),
      y: rect.bottom - containerRect.top + container.scrollTop + 6,
      yTop,
      textLeft,
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
      if (overlayOpenRef.current) {
        setPopover(null);
        setSubmenu(null);
        setBubble(null);
        setSimplifyCard(null);
        setAssistantChat(null);
        setCommentCard(null);
        setAnnotationCard(null);
        window.getSelection()?.removeAllRanges();
        return;
      }
      if (editModeRef.current) {
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
        // A pending link closes on the next highlighted text — no menu step.
        if (captured && pendingLinkRef.current) {
          setPopover(null);
          setSubmenu(null);
          void completeLinkTo(captured.anchor);
          return;
        }
        setPopover(captured);
        setSubmenu(null);
        setCommentDraft("");
        if (captured) {
          // The assistant panel's Selection scope tracks the latest selection.
          window.dispatchEvent(
            new CustomEvent("dissect:selection", {
              detail: { documentId, ...captured.anchor },
            }),
          );
        }
      });
    };
    container.addEventListener("mouseup", onMouseUp);
    return () => container.removeEventListener("mouseup", onMouseUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureSelection, documentId]);

  // Double-click a text block to edit it in place. The hint card teaches this
  // once; after the first double-click it never shows again.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onDblClick = (e: MouseEvent) => {
      if (editModeRef.current) return;
      const target = e.target as Element;
      if (target.closest("[data-selection-popover]")) return;
      const blockEl = target.closest<HTMLElement>("[data-block-id]");
      const blockId = blockEl?.dataset.blockId;
      if (!blockId) return;
      const block = blocksRef.current.find((b) => b.id === blockId);
      if (!block || block.type === "FIGURE" || block.type === "TABLE" || block.type === "SEPARATOR")
        return;
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
  }, []);

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
      return block && (block.type === "FIGURE" || block.type === "EQUATION") ? blockId : null;
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
    };
    const onMove = (e: PointerEvent) => {
      if (!tracking || e.pointerId !== tracking.pointerId) return;
      tracking.points.push({ x: e.clientX, y: e.clientY });
      tracking.minX = Math.min(tracking.minX, e.clientX);
      tracking.maxX = Math.max(tracking.maxX, e.clientX);
      tracking.minY = Math.min(tracking.minY, e.clientY);
      tracking.maxY = Math.max(tracking.maxY, e.clientY);
      // Spread out past a hand-sized area = a drag or a scroll, not a circle.
      if (tracking.maxX - tracking.minX > 320 || tracking.maxY - tracking.minY > 320) {
        tracking = null;
        return;
      }
      if (tracking.points.length >= 12 && circleSweepDegrees(tracking.points) >= 300) {
        const { blockId } = tracking;
        tracking = null;
        openFigureTools(blockId, e.clientX, e.clientY);
      }
    };
    const onUp = () => {
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
          top: markRect.bottom - containerRect.top + container.scrollTop + 8,
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
      if (stored.kind === "explain") {
        const slot = claimSideSlot("explain", top);
        setBubble({
          ...slot,
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

  // Side cards dock to the article's edge; the notes tray collapsing or the
  // window resizing moves that edge. Re-dock every open card so they stay
  // right next to the content body. Position popovers close instead — their
  // coordinates are stale the moment the layout shifts.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let lastWidth = container.clientWidth;
    const observer = new ResizeObserver(() => {
      const width = container.clientWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      const { articleLeft, articleRight, cw } = measureSideCards(container);
      setBubble((b) => (b ? { ...b, ...dockSideCard(b.side, articleLeft, articleRight, cw) } : b));
      setSimplifyCard((c) =>
        c ? { ...c, ...dockSideCard(c.side, articleLeft, articleRight, cw) } : c,
      );
      setAssistantChat((c) =>
        c ? { ...c, ...dockSideCard(c.side, articleLeft, articleRight, cw) } : c,
      );
      setCommentCard((c) =>
        c ? { ...c, ...dockSideCard(c.side, articleLeft, articleRight, cw) } : c,
      );
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
        setToast("That block is not in the open document.");
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 5000);
        return;
      }
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("anchor-flash");
      setTimeout(() => el.classList.remove("anchor-flash"), 2000);
    };
    window.addEventListener("dissect:flash-block", onFlashBlock);
    return () => window.removeEventListener("dissect:flash-block", onFlashBlock);
  }, []);

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }

  // The figure popover: anchored to the whole caption (offsets 0..length), so
  // provenance validation holds and the annotation lists like any other.
  function openFigureTools(blockId: string, clientX: number, clientY: number) {
    const container = containerRef.current;
    const block = blocksRef.current.find((b) => b.id === blockId);
    if (!container || !block) return;
    const text = block.text;
    if (!text.trim()) {
      showToast("This figure has no caption to anchor to.");
      return;
    }
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
      await api("/api/notes", "POST", {
        sectionId,
        content: popover.anchor.quotedText,
        source: { documentId, ...popover.anchor },
      });
      setPopover(null);
      window.getSelection()?.removeAllRanges();
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Add failed");
    } finally {
      setBusy(false);
    }
  }

  function deriveBody(type: string, anchor: Anchor) {
    return JSON.stringify({
      type,
      documentId,
      notebookId,
      anchor: {
        blockId: anchor.blockId,
        startOffset: anchor.startOffset,
        endOffset: anchor.endOffset,
      },
    });
  }

  // EXPLAIN: stream into a bubble docked beside the article (SPEC.md §4, §6).
  async function explain() {
    if (!popover || busy) return;
    const { anchor, yTop } = popover;
    await flushLiveBlock(anchor.blockId);
    setPopover(null);
    window.getSelection()?.removeAllRanges();
    const slot = claimSideSlot("explain", yTop);
    setBubble({ ...slot, text: "", streaming: true, error: null, anchor, noteId: null });
    try {
      const res = await fetch("/api/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: deriveBody("EXPLAIN", anchor),
      });
      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? `Derive failed (${res.status})`);
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
          error: error ?? (text.trim() ? null : "The model returned an empty response. Try again."),
        };
      });
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Derive failed";
      setBubble((b) => (b ? { ...b, streaming: false, error: message } : b));
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
    try {
      const res = await fetch("/api/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: deriveBody("SIMPLIFY", anchor),
      });
      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? `Derive failed (${res.status})`);
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
          error: error ?? (text.trim() ? null : "The model returned an empty response. Try again."),
          sentences: error || !text.trim() ? null : parseSimplified(text),
          active: null,
        };
      });
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Simplify failed";
      setSimplifyCard((c) => (c ? { ...c, streaming: false, error: message } : c));
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
      showToast(err instanceof Error ? err.message : "Recolor failed");
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
      showToast("Comment is empty. Delete removes it.");
      return;
    }
    setAnnotationCard({ ...card, busy: true });
    try {
      await api(`/api/notes/${card.noteId}`, "PATCH", { content });
      router.refresh();
      setAnnotationCard(null);
      showToast("Saved");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Save failed");
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
      showToast(card.kind === "highlight" ? "Highlight removed" : "Comment removed");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Delete failed");
      setAnnotationCard((c) => (c ? { ...c, busy: false } : c));
    }
  }

  // The comment card edits in place too: same notes API, same refresh.
  async function saveCommentCard() {
    const card = commentCard;
    if (!card || card.busy || !card.noteId) return;
    const content = card.draft.trim();
    if (!content) {
      showToast("Comment is empty. Delete removes it.");
      return;
    }
    setCommentCard({ ...card, busy: true });
    try {
      await api(`/api/notes/${card.noteId}`, "PATCH", { content });
      router.refresh();
      setCommentCard((c) => (c ? { ...c, saved: content, busy: false } : c));
      showToast("Saved");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Save failed");
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
      showToast("Comment removed");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Delete failed");
      setCommentCard((c) => (c ? { ...c, busy: false } : c));
    }
  }

  // EXTRACT: pending note in a section; AI proposes the section (SPEC.md §4).
  async function extract() {
    if (!popover || busy) return;
    if (sectionChoices.length === 0) {
      showToast("Add a section first. Extract needs a section to propose.");
      return;
    }
    const { anchor } = popover;
    await flushLiveBlock(anchor.blockId);
    setPopover(null);
    window.getSelection()?.removeAllRanges();
    setBusy(true);
    showToast("Extracting…");
    try {
      const res = await fetch("/api/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: deriveBody("EXTRACT", anchor),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(json?.error ?? `Extract failed (${res.status})`);
      setToast(null);
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Extract failed");
    } finally {
      setBusy(false);
    }
  }

  // Manual annotation: highlight (color, content = quote) or comment (user text).
  // Lands ACCEPTED in the hidden Annotations section. The mark paints instantly
  // from the captured anchor; the server's copy replaces it on refresh.
  async function annotate(input: { color?: string; comment?: string }) {
    if (!popover || busy) return;
    if (input.comment !== undefined && !input.comment.trim()) return;
    const { anchor } = popover;
    await flushLiveBlock(anchor.blockId);
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
        throw new Error(detail?.error ?? `Annotation failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setLocalAnchors((prev) => ({
        ...prev,
        [anchor.blockId]: (prev[anchor.blockId] ?? []).filter((h) => h !== optimistic),
      }));
      showToast(err instanceof Error ? err.message : "Annotation failed");
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
      showToast("Select a different passage for the other end.");
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
      window.getSelection()?.removeAllRanges();
      router.refresh();
      showToast("Link created");
      return true;
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Link failed");
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

  // The assistant engine: command → server-validated plan → approval → the
  // normal API routes. Auto mode skips approval; the toggle persists.
  async function runAssistant(commandText?: string) {
    const command = (commandText ?? aiCommandRef.current).trim();
    if (!command || aiBusy || !popover) return;
    const { anchor, yTop } = popover;
    setAiBusy(true);
    try {
      await flushLiveBlock(anchor.blockId);
      const turn = await assistantTurn(command, anchor, [], null);
      setPopover(null);
      setSubmenu(null);
      setAiCommand("");
      window.getSelection()?.removeAllRanges();
      // The conversation continues in a chat card docked beside the article.
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
      showToast(err instanceof Error ? err.message : "Assistant failed");
    } finally {
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
  ): Promise<{ reply: string; noteId: string | null }> {
    const res = await fetch("/api/assistant/act", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notebookId,
        documentId,
        command,
        anchor: anchor
          ? {
              blockId: anchor.blockId,
              startOffset: anchor.startOffset,
              endOffset: anchor.endOffset,
            }
          : undefined,
        history: history.slice(-12),
        conversationNoteId: conversationNoteId ?? undefined,
      }),
    });
    const plan = (await res.json().catch(() => null)) as
      | (AssistantPlan & { error?: string })
      | null;
    if (!res.ok || !plan) throw new Error(plan?.error ?? `Assistant failed (${res.status})`);
    const parts: string[] = [];
    if (plan.reply) parts.push(plan.reply);
    if (plan.actions.length > 0) {
      const n = plan.actions.length;
      if (autoRunRef.current) {
        await executePlan(plan.actions, plan.warnings);
        parts.push(`Applied ${n} action${n === 1 ? "" : "s"}.`);
      } else {
        setAiPlan(plan);
        setPlanChecked(new Set(plan.actions.map((_, i) => i)));
        parts.push(`Proposed ${n} action${n === 1 ? "" : "s"} — approve them in the plan card.`);
      }
    }
    if (parts.length === 0) parts.push(plan.warnings[0] ?? "The assistant proposed no actions.");
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
    try {
      const turn = await assistantTurn(text, chat.anchor, history, chat.noteId);
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
      const message = err instanceof Error ? err.message : "Assistant failed";
      setAssistantChat((c) =>
        c
          ? { ...c, busy: false, messages: [...c.messages, { role: "assistant", content: message }] }
          : c,
      );
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
              const title = action.sectionTitle ?? "Notes";
              const created = await api<{ id: string }>("/api/sections", "POST", {
                notebookId,
                title,
                parentId: null,
              });
              sectionId = created.id;
              sectionIdByTitle.set(title.toLowerCase(), created.id);
            }
            // Assistant notes carry their authorship. In Auto mode nobody
            // approved this note, so it lands pending for triage (SPEC.md §1).
            await api("/api/notes", "POST", {
              sectionId,
              content: action.content,
              source: action.source,
              origin: "assistant",
              pending: autoRunRef.current,
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
      `${applied} action${applied === 1 ? "" : "s"} applied`,
      ...(failed.length > 0 ? [`failed: ${failed[0]}`] : []),
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
      showToast("Voice input is not available in this browser.");
      return;
    }
    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
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
      if (autoRunRef.current && aiCommandRef.current.trim()) {
        void runAssistant(aiCommandRef.current);
      }
    };
    rec.onerror = () => {
      setAiListening(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = rec;
    setAiListening(true);
    rec.start();
  }

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

  async function formatBlock(
    blockId: string,
    kind: "paragraph" | "h1" | "h2" | "h3" | "list" | "numbered",
    text?: string,
  ) {
    try {
      await api(`/api/blocks/${blockId}`, "PATCH", {
        kind,
        ...(text !== undefined ? { text } : {}),
      });
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Format failed");
    }
  }

  async function toggleStyleSpan(
    blockId: string,
    start: number,
    end: number,
    style: "bold" | "italic" | "underline",
  ) {
    try {
      await api(`/api/blocks/${blockId}/style`, "POST", {
        startOffset: start,
        endOffset: end,
        style,
      });
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Style failed");
    }
  }

  async function setFont(next: string) {
    try {
      await api(`/api/documents/${documentId}`, "PATCH", { font: next });
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Font change failed");
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
      if (!res.ok || !json?.id) throw new Error(json?.error ?? `Insert failed (${res.status})`);
      router.refresh();
      return json.id;
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Insert failed");
      return null;
    }
  }

  async function deleteBlock(blockId: string) {
    try {
      const res = await fetch(`/api/blocks/${blockId}`, { method: "DELETE" });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? `Remove failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Remove failed");
    }
  }

  async function saveBlockEdit(blockId: string, text: string) {
    try {
      await api(`/api/blocks/${blockId}`, "PATCH", { text });
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Edit failed");
    }
  }

  // SALIENCE: toggleable overlay, off by default; computed once per notebook+document (SPEC.md §6).
  async function toggleSalience() {
    if (salienceBusy) return;
    if (hasSalience || Object.keys(salienceByBlock).length > 0) {
      setSalienceOn(!salienceOn);
      return;
    }
    setSalienceBusy(true);
    showToast("Computing salience…");
    try {
      const res = await fetch("/api/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "SALIENCE", documentId, notebookId }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(json?.error ?? `Salience failed (${res.status})`);
      setToast(null);
      setSalienceOn(true);
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Salience failed");
    } finally {
      setSalienceBusy(false);
    }
  }

  // Merge anchor, salience, term, and link layers per block.
  const highlightsByBlock: Record<string, Highlight[]> = {};
  for (const [blockId, list] of Object.entries(anchorHighlights)) {
    highlightsByBlock[blockId] = list.map((h) => ({ ...h, kind: "anchor" as const }));
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
  if (salienceOn) {
    for (const [blockId, list] of Object.entries(salienceByBlock)) {
      const existing = highlightsByBlock[blockId] ?? [];
      highlightsByBlock[blockId] = [
        ...existing,
        ...list.map((h) => ({ sourceId: null, start: h.start, end: h.end, kind: "salience" as const })),
      ];
    }
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

  return (
    <div
      ref={containerRef}
      data-reader-root
      className="relative min-h-0 flex-1 overflow-y-auto print:overflow-visible"
    >
      <div className="sticky top-4 z-10 float-right mr-4 flex items-center gap-2 print:hidden">
        {toast && (
          <span className="rounded-full bg-ink/90 px-3 py-1.5 text-xs text-paper">{toast}</span>
        )}
        {editMode && (
          <select
            value={font ?? "default"}
            onChange={(e) => void setFont(e.target.value)}
            aria-label="Reader font"
            className="rounded-full bg-sand-100 px-3 py-1.5 text-xs font-semibold text-sand-700 shadow-soft outline-none"
          >
            <option value="default">Figtree</option>
            <option value="serif">Serif</option>
            <option value="mono">Mono</option>
          </select>
        )}
        {editMode && (
          <button
            onClick={toggleEditMode}
            className="rounded-full bg-clay px-3.5 py-1.5 text-xs font-semibold text-clay-fg shadow-soft hover:bg-clay-600"
            title="Back to reading (Esc)"
          >
            Done
          </button>
        )}
        <button
          onClick={() => void toggleSalience()}
          disabled={salienceBusy}
          className={`rounded-full px-3.5 py-1.5 text-xs font-semibold shadow-soft disabled:opacity-40 ${
            salienceOn
              ? "bg-sage-200 text-sage-800"
              : "bg-sand-100 text-sand-600 hover:text-clay-800"
          }`}
          title="Toggle the salience overlay"
        >
          {salienceBusy ? "Salience…" : salienceOn ? "Salience on" : "Salience"}
        </button>
      </div>

      {editHint && !editMode && (
        <div
          onAnimationEnd={() => setEditHint(false)}
          className="hint-fade pointer-events-none absolute top-16 right-5 z-10 max-w-64 rounded-2xl bg-card px-4 py-2.5 text-[12px] leading-relaxed text-sand-700 shadow-lift"
        >
          Double-click any paragraph to edit it. Hold and draw a small circle on a figure for its
          tools.
        </div>
      )}

      <Reader
        title={title}
        blocks={blocks}
        highlightsByBlock={highlightsByBlock}
        mode={editMode ? "edit" : "read"}
        font={font}
        stylesByBlock={stylesByBlock}
        editedByBlock={editedByBlock}
        onSaveText={saveBlockEdit}
        onFormatBlock={formatBlock}
        onToggleStyle={toggleStyleSpan}
        onInsertBlock={insertBlock}
        onDeleteBlock={deleteBlock}
      />

      <Bibliography references={references} />

      {annotationCard && (
        <div
          data-selection-popover
          className="absolute z-30 w-[300px] rounded-2xl bg-card p-3 shadow-float"
          style={{ top: annotationCard.top, left: annotationCard.left }}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
              {annotationCard.kind === "highlight" ? "Highlight" : "Comment"}
            </span>
            <button
              onClick={() => setAnnotationCard(null)}
              aria-label="Close"
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
                  disabled={annotationCard.busy}
                  aria-label={`Recolor ${color}`}
                  title={`Recolor ${color}`}
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
              if (e.key === "Escape") setAnnotationCard(null);
            }}
            placeholder="Add a comment"
            rows={3}
            className="w-full resize-none rounded-xl bg-sand-100 px-2.5 py-2 text-[13px] outline-none placeholder:text-sand-500"
          />
          <div className="mt-2 flex items-center justify-between">
            <button
              onClick={() => void deleteAnnotation()}
              disabled={annotationCard.busy}
              className="text-xs font-semibold text-red-500 hover:text-red-700 disabled:opacity-40"
            >
              Delete
            </button>
            <button
              onClick={() => void saveAnnotation()}
              disabled={annotationCard.busy || annotationCard.draft.trim() === annotationCard.saved.trim()}
              className="rounded-full bg-clay px-3 py-1 text-[11px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      )}

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

      {popover && (
        <div
          data-selection-popover
          onMouseDown={(e) => {
            // Keep the text selection alive under the rail — but let fields
            // take focus, or the inputs could never place a caret.
            const target = e.target as HTMLElement;
            if (target.closest("textarea, input")) return;
            e.preventDefault();
          }}
          className="absolute z-20 flex flex-col gap-0.5 rounded-2xl bg-card p-1.5 shadow-float"
          style={(() => {
            const w = submenu === "ai" || submenu === "comment" ? 248 : 116;
            if (popover.side === "right") {
              return { top: popover.yTop, left: Math.min(popover.rightBase, popover.cw - w - 6), width: w };
            }
            if (popover.side === "below") {
              return { top: popover.y, left: Math.max(6, Math.min(popover.x - w / 2, popover.cw - w - 6)), width: w };
            }
            return { top: popover.yTop, left: Math.max(6, popover.textLeft - w - 10), width: w };
          })()}
        >
          {popover.truncated && (
            <p className="px-2.5 py-1 text-[10.5px] leading-snug text-sand-500">
              Anchors to the first paragraph of the selection
            </p>
          )}
          {popover.figure && (
            <p className="px-2.5 py-1 text-[10.5px] leading-snug text-sand-500">Figure tools</p>
          )}
          {pendingLink && (
            <button
              disabled={busy}
              onClick={() => void completeLink()}
              className="flex w-full items-center rounded-full bg-sage-600 px-2.5 py-[5px] text-left text-[12px] font-semibold text-sage-fg hover:bg-sage-700 disabled:opacity-40"
            >
              Link here
            </button>
          )}

          <button
            onClick={() => setSubmenu(submenu === "ai" ? null : "ai")}
            aria-expanded={submenu === "ai"}
            className={`flex w-full items-center gap-1.5 rounded-full px-2.5 py-[5px] text-left text-[12px] font-semibold ${
              submenu === "ai"
                ? "bg-clay-100 text-clay-800"
                : "text-clay-700 hover:bg-clay-100 hover:text-clay-800"
            }`}
          >
            <SparkleIcon size={12} />
            Assistant
          </button>
          {submenu === "ai" && (
            <div className="flex flex-col gap-1.5 p-1">
              <textarea
                autoFocus
                value={aiCommand}
                onChange={(e) => setAiCommand(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void runAssistant();
                  }
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setSubmenu(null);
                  }
                }}
                placeholder="Tell the assistant what to do with this selection…"
                rows={2}
                className="w-full resize-none rounded-xl bg-sand-100 p-2 text-[12px] outline-none placeholder:text-sand-500"
              />
              <div className="flex items-center gap-1.5">
                <button
                  onClick={toggleVoice}
                  aria-label={aiListening ? "Stop listening" : "Speak the command"}
                  title={aiListening ? "Stop listening" : "Speak the command"}
                  className={`flex size-7 items-center justify-center rounded-full ${
                    aiListening
                      ? "animate-pulse bg-red-500 text-white"
                      : "text-sand-600 hover:bg-clay-100 hover:text-clay-800"
                  }`}
                >
                  <MicIcon size={13} />
                </button>
                <div
                  className="flex overflow-hidden rounded-full border border-line text-[10px] font-semibold"
                  title="Ask first shows every plan for approval. Auto applies it immediately."
                >
                  <button
                    onClick={() => setAssistantMode(false)}
                    className={autoRun ? "px-2 py-0.5 text-sand-600" : "bg-ink px-2 py-0.5 text-paper"}
                  >
                    Ask
                  </button>
                  <button
                    onClick={() => setAssistantMode(true)}
                    className={autoRun ? "bg-ink px-2 py-0.5 text-paper" : "px-2 py-0.5 text-sand-600"}
                  >
                    Auto
                  </button>
                </div>
                <button
                  disabled={aiBusy || !aiCommand.trim()}
                  onClick={() => void runAssistant()}
                  className="ml-auto rounded-full bg-clay px-3 py-1 text-[11px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
                >
                  {aiBusy ? "Working…" : "Run"}
                </button>
              </div>
            </div>
          )}

          <button
            onClick={() => void explain()}
            title={popover.figure ? "The AI deciphers what the visualization shows" : undefined}
            className="flex w-full items-center rounded-full px-2.5 py-[5px] text-left text-[12px] text-sand-800 hover:bg-clay-100 hover:text-clay-800"
          >
            Explain
          </button>
          {!popover.figure && (
            <button
              onClick={() => void simplify()}
              className="flex w-full items-center rounded-full px-2.5 py-[5px] text-left text-[12px] text-sand-800 hover:bg-clay-100 hover:text-clay-800"
            >
              Simplify
            </button>
          )}
          {!popover.figure && (
            <button
              onClick={() => void extract()}
              disabled={busy}
              className="flex w-full items-center rounded-full px-2.5 py-[5px] text-left text-[12px] text-sand-800 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
            >
              Extract
            </button>
          )}

          <div className="flex items-center gap-1.5 px-2.5 py-1">
            {(["clay", "sage", "gold", "plum"] as const).map((color) => (
              <button
                key={color}
                disabled={busy}
                onClick={() => void annotate({ color, comment: commentDraft.trim() || undefined })}
                aria-label={`Highlight in ${color}`}
                title={`Highlight in ${color}${commentDraft.trim() ? " with your note" : ""}`}
                className="size-[18px] rounded-full transition-transform hover:scale-110 disabled:opacity-40"
                style={{
                  background:
                    color === "clay"
                      ? "var(--clay-400)"
                      : color === "sage"
                        ? "var(--sage-500)"
                        : color === "gold"
                          ? "#d9a54a"
                          : "#a78bfa",
                }}
              />
            ))}
          </div>

          <button
            onClick={() => setSubmenu(submenu === "comment" ? null : "comment")}
            aria-expanded={submenu === "comment"}
            className={`flex w-full items-center rounded-full px-2.5 py-[5px] text-left text-[12px] ${
              submenu === "comment"
                ? "bg-clay-100 text-clay-800"
                : "text-sand-800 hover:bg-clay-100 hover:text-clay-800"
            }`}
          >
            Comment
          </button>
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
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && commentDraft.trim()) {
                    e.preventDefault();
                    void annotate({ comment: commentDraft });
                  }
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setSubmenu(null);
                  }
                }}
                placeholder="Comment on this passage — or pick a color to attach it to a highlight"
                rows={2}
                className="w-full resize-none rounded-xl bg-sand-100 p-2 text-[12px] outline-none placeholder:text-sand-500"
              />
              <button
                type="submit"
                disabled={busy || !commentDraft.trim()}
                className="self-end rounded-full bg-clay px-3 py-1 text-[11px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
              >
                Save
              </button>
            </form>
          )}

          {sectionChoices.length > 0 && (
            <button
              onClick={() => setSubmenu(submenu === "add" ? null : "add")}
              aria-expanded={submenu === "add"}
              className={`flex w-full items-center rounded-full px-2.5 py-[5px] text-left text-[12px] ${
                submenu === "add"
                  ? "bg-clay-100 text-clay-800"
                  : "text-sand-800 hover:bg-clay-100 hover:text-clay-800"
              }`}
            >
              Add to ▾
            </button>
          )}
          {submenu === "add" && (
            <div className="flex max-h-44 flex-col overflow-y-auto">
              {sectionChoices.map((choice) => (
                <button
                  key={choice.id}
                  disabled={busy}
                  onClick={() => void addToSection(choice.id)}
                  className="truncate rounded-full px-2.5 py-[5px] text-left text-[12px] text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
                >
                  {choice.label}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={beginLink}
            title="Connect this passage to a passage in this or another document"
            className="flex w-full items-center rounded-full px-2.5 py-[5px] text-left text-[12px] text-sand-800 hover:bg-clay-100 hover:text-clay-800"
          >
            Link across texts
          </button>
        </div>
      )}

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
            title="Drag to move"
            className="mb-2 flex cursor-move items-center justify-between"
          >
            <span className="text-[11px] font-bold tracking-[0.08em] text-clay-800 uppercase">
              {bubble.streaming ? "Explaining…" : "Explanation"}
            </span>
            <span className="flex items-center gap-3">
              {bubble.noteId && !bubble.streaming && (
                <button
                  onClick={() => void deleteExplain()}
                  className="text-xs font-semibold text-red-500 hover:text-red-700"
                  title="Delete this explanation and its mark"
                >
                  Delete
                </button>
              )}
              <button
                onClick={closeExplain}
                className="text-xs text-sand-500 hover:text-clay-700"
                aria-label="Close"
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
            <p className="text-sm text-sand-500">
              <LoadingDots />
            </p>
          )}
        </div>
      )}

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
            title="Drag to move"
            className="mb-2 flex cursor-move items-center justify-between"
          >
            <span className="text-[11px] font-bold tracking-[0.08em] text-sage-800 uppercase">
              {simplifyCard.streaming ? "Simplifying…" : "Simplified"}
            </span>
            <span className="flex items-center gap-3">
              {simplifyCard.noteId && !simplifyCard.streaming && (
                <button
                  onClick={() => void deleteSimplify()}
                  className="text-xs font-semibold text-red-500 hover:text-red-700"
                  title="Delete this simplified rewrite and its mark"
                >
                  Delete
                </button>
              )}
              <button
                onClick={closeSimplify}
                className="text-xs text-sand-500 hover:text-clay-700"
                aria-label="Close"
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
                      title="Press to see what this restates in the original"
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
              {stripSimplifyMarkers(simplifyCard.text) || <LoadingDots />}
            </p>
          )}
        </div>
      )}

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
            title="Drag to move"
            className="mb-2 flex cursor-move items-center justify-between"
          >
            <span className="text-[11px] font-bold tracking-[0.08em] text-clay-800 uppercase">
              Comment
            </span>
            <button
              onClick={closeCommentCard}
              className="text-xs text-sand-500 hover:text-clay-700"
              aria-label="Close"
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
                  disabled={commentCard.busy}
                  className="text-xs font-semibold text-red-500 hover:text-red-700 disabled:opacity-40"
                >
                  Delete
                </button>
                <button
                  onClick={() => void saveCommentCard()}
                  disabled={commentCard.busy || commentCard.draft.trim() === commentCard.saved.trim()}
                  className="rounded-full bg-clay px-3 py-1 text-[11px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
                >
                  Save
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
            title="Drag to move"
            className="flex cursor-move items-center justify-between px-4 pt-3 pb-1"
          >
            <span className="text-[11px] font-bold tracking-[0.08em] text-clay-800 uppercase">
              Assistant
            </span>
            <span className="flex items-center gap-3">
              {assistantChat.noteId && (
                <button
                  onClick={() => void deleteAssistantConversation()}
                  className="text-xs font-semibold text-red-500 hover:text-red-700"
                  title="Delete this conversation and its mark"
                >
                  Delete
                </button>
              )}
              <button
                onClick={closeAssistantChat}
                className="text-xs text-sand-500 hover:text-clay-700"
                aria-label="Close"
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
            {assistantChat.busy && (
              <p className="flex items-center gap-1.5 text-[12px] text-sand-500">
                Thinking
                <LoadingDots />
              </p>
            )}
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
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendChatMessage();
                }
              }}
              placeholder="Reply…"
              aria-label="Message the assistant"
              className="min-h-8 flex-1 resize-none rounded-xl bg-sand-100 px-3 py-1.5 text-[12.5px] outline-none placeholder:text-sand-500"
            />
            <button
              type="submit"
              disabled={assistantChat.busy || !assistantChat.input.trim()}
              className="rounded-full bg-clay px-3 py-1.5 text-[11px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
            >
              Send
            </button>
          </form>
        </div>
      )}

      {pendingLink && (
        <div className="fixed top-24 left-1/2 z-40 flex max-w-[80vw] -translate-x-1/2 items-center gap-3 rounded-full bg-card px-4 py-2 shadow-float">
          <span className="truncate text-[12.5px] text-sand-700">
            Linking “{pendingLink.anchor.quotedText.slice(0, 48)}
            {pendingLink.anchor.quotedText.length > 48 ? "…" : ""}” from{" "}
            {pendingLink.fromDocumentId === documentId
              ? "this document"
              : (attachedDocuments.find((d) => d.id === pendingLink.fromDocumentId)?.title ??
                "another document")}{" "}
            — select the other end, then press Link here
          </span>
          <button
            onClick={() => broadcastPendingLink(null)}
            aria-label="Cancel the link"
            className="shrink-0 text-xs text-sand-500 hover:text-clay-700"
          >
            ✕
          </button>
        </div>
      )}

      {aiPlan && (
        <div className="fixed bottom-6 left-1/2 z-40 w-[440px] max-w-[92vw] -translate-x-1/2 rounded-[24px] bg-card p-4 shadow-float">
          <div className="mb-2 flex items-center gap-2">
            <SparkleIcon size={15} className="text-clay" />
            <span className="font-display text-[15px]">Assistant plan</span>
            <span className="ml-auto rounded-full bg-sand-200 px-2.5 py-0.5 text-[10px] font-semibold text-sand-600">
              Ask first
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
                    {ACTION_LABEL[action.type]}
                  </span>
                  {action.description}
                  {actionDetail(action, blocks, attachedDocuments) && (
                    <span className="mt-0.5 block text-[11px] text-sand-500">
                      {actionDetail(action, blocks, attachedDocuments)}
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
              className="rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
            >
              Apply {planChecked.size} action{planChecked.size === 1 ? "" : "s"}
            </button>
            <button
              onClick={() => setAiPlan(null)}
              className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

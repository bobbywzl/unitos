"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Person } from "@/lib/person";
import { PersonBadge } from "@/components/collab/person-badge";
import { useT } from "@/components/lang-provider";
import { SparkleIcon, CommentIcon } from "@/components/icons";

// Highlighting an assistant answer (SPEC.md §7) offers three things: Start
// side chat, Ask about this, and Comment. Every assistant surface uses the
// pieces here — the panel and the reader's chat card — so the gesture reads
// the same wherever an answer is.
//
// An answer marks itself with data-assistant-answer; a selection anywhere
// else is not an answer selection and opens nothing.
export const ANSWER_MARK = "data-assistant-answer";

export type AnswerSelection = { text: string; top: number; left: number };
// One painted band of the tint: where the highlighted words sit in the
// viewport, clipped to the box that scrolls them.
export type TintRect = { top: number; left: number; width: number; height: number };

/** The quote and the message under it, as one message: the quote as a
    markdown quote, then the reader's words. The transcript, the digest, and
    the model all read the same text. */
export function quoteMessage(quote: string, text: string): string {
  const quoted = quote
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return text.trim() ? `${quoted}\n\n${text.trim()}` : quoted;
}

/** The quote cut to one line for a chip or a header. */
export function quoteLine(quote: string, max = 120): string {
  const line = quote.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// The box that scrolls the words: the tint is clipped to it, so a band never
// paints over the composer or outside the panel when the thread scrolls.
function scrollBoxOf(range: Range): DOMRect | null {
  const node = range.commonAncestorContainer;
  let el: Element | null = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  while (el) {
    const overflow = getComputedStyle(el).overflowY;
    if (overflow === "auto" || overflow === "scroll") return el.getBoundingClientRect();
    el = el.parentElement;
  }
  return null;
}

/** The selection inside an assistant answer, and the tint over the words it
    marks (SPEC.md §7). The positions are the viewport's, so the toolbar and
    the tint sit over the words in any scroller and move with them.

    The tint is what stays: pressing a function takes the browser's own
    selection away — the box it opens takes focus — and the words stay marked
    until the reader is done with them, the reader's selection tint in the
    article (SPEC.md §6). */
export function useAnswerSelection(): {
  selection: AnswerSelection | null;
  tintRects: TintRect[];
  /** Take the highlighted text and keep the words marked: the toolbar
      closes, the browser's selection goes, the tint stays. */
  hold: () => string;
  /** The toolbar and the tint both go. */
  clear: () => void;
} {
  const [selection, setSelection] = useState<AnswerSelection | null>(null);
  const [tintRects, setTintRects] = useState<TintRect[]>([]);
  // The selection as it stands, and the words held marked after a function
  // took it. A Range keeps its place once the selection is gone.
  const rangeRef = useRef<Range | null>(null);
  const heldRef = useRef<Range | null>(null);
  const textRef = useRef("");

  const paint = useCallback(() => {
    const range = heldRef.current ?? rangeRef.current;
    if (!range) {
      // Every keyup comes here: an empty tint keeps its array, so nothing renders.
      setTintRects((rects) => (rects.length === 0 ? rects : []));
      return;
    }
    const box = scrollBoxOf(range);
    const rects: TintRect[] = [];
    for (const rect of range.getClientRects()) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      const top = box ? Math.max(rect.top, box.top) : rect.top;
      const bottom = box ? Math.min(rect.bottom, box.bottom) : rect.bottom;
      const left = box ? Math.max(rect.left, box.left) : rect.left;
      const right = box ? Math.min(rect.right, box.right) : rect.right;
      if (bottom - top <= 1 || right - left <= 1) continue;
      rects.push({ top, left, width: right - left, height: bottom - top });
    }
    setTintRects(rects);
  }, []);

  const place = useCallback(
    (range: Range, text: string) => {
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      setSelection({
        text,
        top: rect.top,
        left: rect.left + rect.width / 2,
      });
      paint();
    },
    [paint],
  );

  const clear = useCallback(() => {
    rangeRef.current = null;
    heldRef.current = null;
    textRef.current = "";
    setSelection(null);
    setTintRects([]);
  }, []);

  const hold = useCallback(() => {
    const text = textRef.current;
    heldRef.current = rangeRef.current;
    rangeRef.current = null;
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    paint();
    return text;
  }, [paint]);

  useEffect(() => {
    const read = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (!sel || sel.rangeCount === 0 || !text) {
        // The held words stay marked: an empty selection is the browser's,
        // not the reader dropping what a function is working on.
        rangeRef.current = null;
        textRef.current = heldRef.current ? textRef.current : "";
        setSelection(null);
        paint();
        return;
      }
      const range = sel.getRangeAt(0);
      const node = range.commonAncestorContainer;
      const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
      if (!el?.closest(`[${ANSWER_MARK}]`)) {
        rangeRef.current = null;
        setSelection(null);
        paint();
        return;
      }
      // A new selection in an answer replaces the words held before it.
      heldRef.current = null;
      rangeRef.current = range.cloneRange();
      textRef.current = text;
      place(range, text);
    };
    // The selection is read when it settles: a drag ends, a key lifts, a tap
    // ends. selectionchange alone fires mid-drag, and a toolbar that moves
    // with the pointer cannot be pressed.
    const onUp = () => window.setTimeout(read, 0);
    const onMove = () => {
      const range = rangeRef.current;
      const text = window.getSelection()?.toString().trim() ?? "";
      if (range && text) place(range, text);
      else paint();
    };
    document.addEventListener("mouseup", onUp);
    document.addEventListener("keyup", onUp);
    document.addEventListener("touchend", onUp);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("keyup", onUp);
      document.removeEventListener("touchend", onUp);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [place, paint]);

  return { selection, tintRects, hold, clear };
}

/** The tint over the highlighted words. Painted on the body, like the
    toolbar, so no card's transform moves it or clips it. */
export function AnswerTint({ rects }: { rects: TintRect[] }) {
  if (typeof document === "undefined" || rects.length === 0) return null;
  return createPortal(
    <div aria-hidden className="pointer-events-none fixed inset-0 z-40">
      {rects.map((rect, i) => (
        <span
          key={i}
          className="answer-tint"
          style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        />
      ))}
    </div>,
    document.body,
  );
}

/** The three things a highlighted answer offers. Start side chat waits for
    the conversation to be saved — a side chat belongs to a conversation. */
export function AnswerToolbar({
  selection,
  canSideChat,
  onSideChat,
  onAsk,
  onComment,
}: {
  selection: AnswerSelection;
  canSideChat: boolean;
  onSideChat: () => void;
  onAsk: () => void;
  onComment: () => void;
}) {
  const t = useT();
  const button =
    "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40";
  // The toolbar renders on the body, never inside the chat it belongs to: a
  // card that animates carries a transform, and a fixed child of a
  // transformed box is positioned by that box and clipped by it.
  // A selection only ever exists after the reader has dragged over an
  // answer, so this never renders on the server or through hydration.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      // The toolbar sits over the selection, out of the flow of any scroller.
      style={{
        position: "fixed",
        top: Math.max(8, selection.top - 40),
        left: Math.min(Math.max(160, selection.left), window.innerWidth - 160),
        transform: "translateX(-50%)",
        // A fixed box with only `left` set is sized by what is left of the
        // viewport, so the labels wrap to nothing near the right edge.
        width: "max-content",
        zIndex: 60,
      }}
      // The selection must survive the press: a mousedown that moves focus
      // clears it before the click lands.
      onMouseDown={(e) => e.preventDefault()}
      className="flex items-center gap-0.5 rounded-full bg-card p-1 whitespace-nowrap shadow-float"
    >
      <button
        type="button"
        onClick={onSideChat}
        disabled={!canSideChat}
        data-track="assistant-side-chat-start"
        data-tip={t(canSideChat ? "assistant.startSideChatTitle" : "assistant.sideChatNeedsConversation")}
        className={button}
      >
        <SparkleIcon size={11} />
        {t("assistant.startSideChat")}
      </button>
      <button
        type="button"
        onClick={onAsk}
        data-track="assistant-quote-ask"
        data-tip={t("assistant.askAboutThisTitle")}
        className={button}
      >
        {t("assistant.askAboutThis")}
      </button>
      <button
        type="button"
        onClick={onComment}
        disabled={!canSideChat}
        data-track="assistant-answer-comment"
        data-tip={t(canSideChat ? "assistant.commentTitle" : "assistant.sideChatNeedsConversation")}
        className={button}
      >
        <CommentIcon size={11} />
        {t("assistant.comment")}
      </button>
    </div>,
    document.body,
  );
}

/** The quote the next message carries, above the box it is typed in. */
export function QuoteChip({
  quote,
  onClear,
  className = "",
}: {
  quote: string;
  onClear: () => void;
  className?: string;
}) {
  const t = useT();
  return (
    <div
      className={`flex items-start gap-1.5 rounded-xl border-l-2 border-clay-300 bg-sand-100 px-2.5 py-1.5 text-[11.5px] text-sand-700 ${className}`}
    >
      <span className="min-w-0 flex-1 truncate">{quoteLine(quote)}</span>
      <button
        type="button"
        onClick={onClear}
        data-track="assistant-quote-remove"
        aria-label={t("assistant.quoteRemove")}
        data-tip={t("assistant.quoteRemove")}
        className="text-sand-500 hover:text-clay-800"
      >
        ✕
      </button>
    </div>
  );
}

/** The side chats of a conversation, each opening from its quote. */
export function SideChatChips({
  sideChats,
  onOpen,
  className = "",
}: {
  sideChats: { key: string; quote: string }[];
  onOpen: (key: string) => void;
  className?: string;
}) {
  const t = useT();
  if (sideChats.length === 0) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      <span className="text-[10.5px] font-bold tracking-[0.08em] text-sand-500 uppercase">
        {t("assistant.sideChats")}
      </span>
      {sideChats.map((s) => (
        <button
          key={s.key}
          type="button"
          onClick={() => onOpen(s.key)}
          data-track="assistant-side-chat-open"
          data-tip={s.quote}
          className="max-w-[180px] truncate rounded-full bg-card px-2.5 py-0.5 text-[11px] text-sand-600 shadow-soft hover:text-clay-800"
        >
          {quoteLine(s.quote, 40)}
        </button>
      ))}
    </div>
  );
}

/** The head of an open side chat: the quote it started from, and the way
    back to the conversation it belongs to. */
export function SideChatHeader({
  quote,
  onBack,
  className = "",
}: {
  quote: string;
  onBack: () => void;
  className?: string;
}) {
  const t = useT();
  return (
    <div className={`flex items-start gap-2 rounded-xl bg-sand-100 px-2.5 py-1.5 ${className}`}>
      <span className="text-[10.5px] font-bold tracking-[0.08em] text-sand-500 uppercase">
        {t("assistant.sideChat")}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11.5px] text-sand-700">{quoteLine(quote)}</span>
      <button
        type="button"
        onClick={onBack}
        data-track="assistant-side-chat-back"
        data-tip={t("assistant.backToConversationTitle")}
        className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold text-sand-600 hover:text-clay-800"
      >
        {t("assistant.backToConversation")}
      </button>
    </div>
  );
}

export type AnswerComment = {
  id: string;
  content: string;
  userId: string;
  createdAt: string;
};

/** The box a comment is written in: the quote it is on, then the words. */
export function CommentBox({
  quote,
  busy,
  onCancel,
  onSubmit,
  className = "",
}: {
  quote: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (text: string) => void;
  className?: string;
}) {
  const t = useT();
  const [text, setText] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim() && !busy) onSubmit(text);
      }}
      className={`flex flex-col gap-1.5 rounded-2xl bg-card p-2 shadow-soft ${className}`}
    >
      <QuoteChip quote={quote} onClear={onCancel} />
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (text.trim() && !busy) onSubmit(text);
          }
          if (e.key === "Escape") onCancel();
        }}
        rows={2}
        placeholder={t("assistant.commentPlaceholder")}
        className="w-full resize-none rounded-xl bg-sand-100 p-2 text-[12.5px] outline-none placeholder:text-sand-500"
      />
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          data-track="assistant-comment-cancel"
          className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-sand-600 hover:text-clay-800"
        >
          {t("common.cancel")}
        </button>
        <button
          type="submit"
          disabled={busy || !text.trim()}
          data-track="assistant-comment-send"
          className="ml-auto rounded-full bg-clay px-3 py-1 text-[11px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
        >
          {t("assistant.comment")}
        </button>
      </div>
    </form>
  );
}

/** The comments on this conversation, oldest first, each with its author. */
export function CommentList({
  comments,
  people,
  myId,
  onDelete,
  className = "",
}: {
  comments: AnswerComment[];
  people: Record<string, Person>;
  myId: string | null;
  onDelete: (id: string) => void;
  className?: string;
}) {
  const t = useT();
  if (comments.length === 0) return null;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-[10.5px] font-bold tracking-[0.08em] text-sand-500 uppercase">
        {t("assistant.comments")}
      </span>
      {comments.map((c) => {
        const person = people[c.userId] ?? null;
        // The comment's quote is its first lines, written as a quote.
        const lines = c.content.split("\n");
        const quoted = lines
          .filter((l) => l.startsWith(">"))
          .map((l) => l.replace(/^>\s?/, ""))
          .join(" ");
        const text = lines
          .filter((l) => !l.startsWith(">"))
          .join("\n")
          .trim();
        return (
          <div key={c.id} className="rounded-xl bg-card px-2.5 py-1.5 shadow-soft">
            <div className="flex items-center gap-1.5">
              {person && <PersonBadge person={person} size={16} />}
              <span className="text-[11px] font-semibold text-sand-600">{person?.name ?? ""}</span>
              {c.userId === myId && (
                <button
                  type="button"
                  onClick={() => onDelete(c.id)}
                  data-track="assistant-comment-delete"
                  aria-label={t("assistant.commentDelete")}
                  data-tip={t("assistant.commentDelete")}
                  className="ml-auto text-[11px] text-sand-500 hover:text-clay-800"
                >
                  ✕
                </button>
              )}
            </div>
            {quoted && (
              <p className="mt-1 border-l-2 border-clay-300 pl-2 text-[11px] text-sand-600">
                {quoteLine(quoted)}
              </p>
            )}
            {text && <p className="mt-1 text-[12.5px] whitespace-pre-wrap text-sand-800">{text}</p>}
          </div>
        );
      })}
    </div>
  );
}

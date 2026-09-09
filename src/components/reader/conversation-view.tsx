"use client";

import { useEffect, useRef } from "react";
import { isImeKey } from "@/lib/ime";
import type { ChatTurn } from "@/lib/conversation";
import { useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { ThinkingIndicator } from "@/components/thinking";

// The full conversation view (SPEC.md §21): one conversation whole, over the
// pane it was opened from. A card beside the article is capped at the pane's
// height and its body scrolls inside it; this view is where a conversation
// too long for a card is read — the turns in one wide column that scrolls,
// the box at the foot, always in reach. Every conversation opens it: the
// assistant's, and a tool's output continued into one.
export function ConversationView({
  title,
  icon,
  output,
  messages,
  busy = false,
  foot,
  onClose,
}: {
  title: string;
  icon?: React.ReactNode;
  output?: string | null; // a tool's output, read as the conversation's first message
  messages: ChatTurn[];
  busy?: boolean;
  foot?: React.ReactNode; // the box; a stored conversation read from a panel has none
  onClose: () => void;
}) {
  const t = useT();
  const bodyRef = useRef<HTMLDivElement>(null);

  // Escape closes the view before anything under it reacts (capture, like the
  // distilled page).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape that dismisses a pinyin candidate list stays the IME's.
      if (isImeKey(e)) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // The view opens on the newest turn and follows every turn after it.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <div
      data-selection-popover
      className="content-in absolute inset-0 z-30 flex flex-col bg-paper print:hidden"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-6 py-3">
        <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.08em] text-clay-800 uppercase">
          {icon}
          {title}
        </span>
        <button
          onClick={onClose}
          data-track="conversation-view-close"
          aria-label={t("common.close")}
          data-tip={t("reader.collapseConversationTitle")}
          className="ml-auto flex size-8 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
        >
          ✕
        </button>
      </div>
      <div
        ref={bodyRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5"
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {output && (
            <div className="text-[14px]">
              <Markdown>{output}</Markdown>
            </div>
          )}
          {messages.map((message, i) =>
            message.role === "user" ? (
              <p
                key={i}
                className="ml-10 self-end rounded-2xl bg-clay-100 px-3.5 py-2 text-[13.5px] text-clay-800"
              >
                {message.content}
              </p>
            ) : (
              <div key={i} className="text-[14px]">
                <Markdown>{message.content}</Markdown>
              </div>
            ),
          )}
          {busy && <ThinkingIndicator className="text-[12.5px]" />}
        </div>
      </div>
      {foot && (
        <div className="shrink-0 border-t border-line px-6 py-3">
          <div className="mx-auto max-w-2xl">{foot}</div>
        </div>
      )}
    </div>
  );
}

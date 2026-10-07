"use client";

import { useEffect, useRef, useState } from "react";
import type { NoteAssistantAnswer } from "@/app/api/notes/[noteId]/assistant/route";
import { api } from "@/lib/api";
import { isImeKey } from "@/lib/ime";
import { splitNote } from "@/lib/note-title";
import { quotesOf } from "@/lib/notes/quote-sources";
import { useThinking } from "@/components/assistant/thinking-chips";
import { useWeb, WebChip } from "@/components/assistant/web-chip";
import { SparkleIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { ThinkingIndicator } from "@/components/thinking";
import { VoiceTypingButton } from "@/components/voice/voice-typing-button";

// The note's assistant (SPEC.md §6): a panel docked at the bottom of an open
// note, the way Gemini sits at the bottom of a Google Doc — a sparkle and a
// close at its head, the conversation above, and one box: "Describe any
// changes you want to make…". A message is a question about the note or a
// change to make to it (`POST /api/notes/[noteId]/assistant`); the answer
// reads the note as the editor holds it, its document whole, and the
// reader's other notes. A change comes back as the note as it should read,
// shown under the reply with Apply and Discard. Apply puts it into the
// editor's draft, which saves like any edit; Undo puts the draft back, and
// Cancel on the note restores what it said before the editor opened. The
// panel never writes to the note itself.
//
// The panel starts folded to one Assistant chip, so the open note keeps its
// room for the note; a press opens it, and the choice is remembered in this
// browser. The words typed in the box are kept in this browser until they
// are sent, so a reload never loses them, and a note with words waiting in
// the box opens with the panel open. The hint under the head shows while
// the box is empty and has the caret.
const OPEN_KEY = "unitos-note-assistant";
const DRAFT_KEY = "unitos-note-assistant-draft:";

type Turn =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      // The change the answer proposes, and what became of it.
      proposal?: { content: string; warnings: string[]; state: "open" | "applied" | "discarded"; before?: string };
    };

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "open";
  } catch {
    return false;
  }
}

function writeOpen(open: boolean) {
  try {
    localStorage.setItem(OPEN_KEY, open ? "open" : "closed");
  } catch {
    // A blocked store only loses the memory of the choice.
  }
}

function readTyped(noteId: string): string {
  try {
    return localStorage.getItem(DRAFT_KEY + noteId) ?? "";
  } catch {
    return "";
  }
}

function writeTyped(noteId: string, text: string) {
  try {
    if (text) localStorage.setItem(DRAFT_KEY + noteId, text);
    else localStorage.removeItem(DRAFT_KEY + noteId);
  } catch {
    // The words stay in the box for this session.
  }
}

const normalize = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** How many of the note's quotes the change takes out. */
function quotesLost(before: string, after: string): number {
  const kept = new Set(quotesOf(after).map(normalize));
  return quotesOf(before).filter((q) => normalize(q).length >= 8 && !kept.has(normalize(q))).length;
}

export function NoteAssistant({
  noteId,
  draft,
  onApply,
  className = "",
}: {
  noteId: string;
  /** The note as the editor holds it: title line and body. */
  draft: string;
  /** Put this content into the editor's draft. */
  onApply: (content: string) => void;
  className?: string;
}) {
  const t = useT();
  const thinking = useThinking();
  const web = useWeb();
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // The browser's memory after the first render, so the server's render and
  // the first client render agree.
  useEffect(() => {
    const typed = readTyped(noteId);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(readOpen() || typed.trim().length > 0);
    setInput(typed);
  }, [noteId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // The newest turn in view: the conversation scrolls to its end, and the
  // panel into the tray's view when the card runs past it.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    if (turns.length > 0) sectionRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns, busy]);

  function toggle(next: boolean) {
    setOpen(next);
    writeOpen(next);
    if (next) requestAnimationFrame(() => inputRef.current?.focus());
  }

  function type(text: string) {
    setInput(text);
    writeTyped(noteId, text);
  }

  async function send() {
    const message = input.trim();
    if (!message || busy) return;
    setError(null);
    setBusy(true);
    const history = turns.map((turn) => ({
      role: turn.role,
      content:
        turn.role === "assistant" && turn.proposal
          ? `${turn.content}\n\n(The note as proposed:)\n${turn.proposal.content}`
          : turn.content,
    }));
    setTurns((prev) => [...prev, { role: "user", content: message }]);
    // The document open in the reader (?doc=): the note's own document wins
    // on the server.
    const documentId = new URLSearchParams(window.location.search).get("doc") ?? undefined;
    // The words leave the box only once the server has them.
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const answer = await api<NoteAssistantAnswer>(
        `/api/notes/${noteId}/assistant`,
        "POST",
        { message, draft, history, documentId, thinking, web },
        { signal: controller.signal },
      );
      type("");
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content: answer.reply,
          ...(answer.content !== null
            ? { proposal: { content: answer.content, warnings: answer.warnings, state: "open" as const } }
            : {}),
        },
      ]);
      if (answer.content === null && answer.warnings.length > 0) setError(answer.warnings.join(" "));
    } catch (err) {
      // The message stays in the box: nothing was answered.
      setTurns((prev) => prev.slice(0, -1));
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function settle(index: number, state: "applied" | "discarded" | "open") {
    const turn = turns[index];
    if (!turn || turn.role !== "assistant" || !turn.proposal) return;
    const proposal = turn.proposal;
    let next: typeof proposal;
    if (state === "applied") {
      onApply(proposal.content);
      next = { ...proposal, state, before: draft };
    } else {
      // Undo: the draft as it stood before Apply.
      if (state === "open" && proposal.before !== undefined) onApply(proposal.before);
      next = { ...proposal, state, before: undefined };
    }
    setTurns((prev) => prev.map((t, i) => (i === index && t.role === "assistant" ? { ...t, proposal: next } : t)));
  }

  if (!open) {
    return (
      <div className={`flex shrink-0 justify-end ${className}`}>
        <button
          type="button"
          data-no-drag
          onClick={() => toggle(true)}
          data-track="note-assistant-open"
          data-tip={t("assistant.noteAssistantTitle")}
          className="flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1 text-xs font-semibold text-sand-700 shadow-soft hover:text-clay-800"
        >
          <SparkleIcon size={13} className="text-[var(--kind-assistant)]" />
          {t("assistant.noteAssistant")}
        </button>
      </div>
    );
  }

  const canSend = input.trim().length > 0 && !busy;
  return (
    <section
      ref={sectionRef}
      data-no-drag
      aria-label={t("assistant.noteAssistant")}
      className={`flex max-h-[min(55vh,460px)] min-h-0 shrink-0 flex-col rounded-2xl border border-[color-mix(in_srgb,var(--kind-assistant)_28%,transparent)] bg-card shadow-soft ${className}`}
    >
      <div className="flex items-center gap-2 px-3 pt-2">
        <SparkleIcon size={16} className="text-[var(--kind-assistant)]" />
        <span className="sr-only">{t("assistant.noteAssistant")}</span>
        <button
          type="button"
          onClick={() => toggle(false)}
          data-track="note-assistant-close"
          aria-label={t("assistant.noteAssistantClose")}
          data-tip={t("assistant.noteAssistantClose")}
          className="ml-auto rounded-full px-1.5 text-sm text-sand-500 hover:bg-clay-100 hover:text-clay-800"
        >
          ✕
        </button>
      </div>

      {(turns.length > 0 || busy) && (
        <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 pt-1 pb-2 text-[13px]">
          {turns.map((turn, i) =>
            turn.role === "user" ? (
              <p
                key={i}
                className="ml-8 self-end rounded-2xl bg-clay-100 px-3 py-1.5 whitespace-pre-wrap text-clay-800"
              >
                {turn.content}
              </p>
            ) : (
              <div key={i} className="flex flex-col gap-2 text-sand-800">
                {turn.content && <Markdown>{turn.content}</Markdown>}
                {turn.proposal && (
                  <Proposal
                    proposal={turn.proposal}
                    lost={quotesLost(turn.proposal.before ?? draft, turn.proposal.content)}
                    onApply={() => settle(i, "applied")}
                    onDiscard={() => settle(i, "discarded")}
                    onUndo={() => settle(i, "open")}
                  />
                )}
              </div>
            ),
          )}
          {busy && <ThinkingIndicator className="text-xs" onStop={stop} />}
        </div>
      )}
      {turns.length === 0 && !busy && focused && !input.trim() && (
        <p className="px-3.5 pt-0.5 pb-1 text-[11.5px] leading-snug text-sand-500">{t("assistant.noteAssistantEmpty")}</p>
      )}
      {error && <p className="px-3.5 pb-1 text-[11.5px] text-red-500">{error}</p>}

      <div className="flex items-end gap-2 border-t border-line px-3 py-2">
        <WebChip small className="mb-1 shrink-0" />
        <textarea
          ref={inputRef}
          value={input}
          rows={1}
          onChange={(e) => type(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (isImeKey(e)) return;
            // The note editor's own keys stay the note's: Enter sends here.
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={t("assistant.noteAssistantPlaceholder")}
          className="max-h-32 min-h-[34px] flex-1 resize-none bg-transparent py-1.5 text-[13.5px] text-ink outline-none placeholder:text-sand-500 [field-sizing:content]"
        />
        <VoiceTypingButton field={inputRef} track="note-assistant-voice-typing" className="mb-0.5 size-8" size={15} />
        <button
          type="button"
          onClick={() => void send()}
          disabled={!canSend}
          data-track="note-assistant-send"
          aria-label={t("assistant.noteAssistantSend")}
          data-tip={t("assistant.noteAssistantSend")}
          className={`mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-base font-bold transition-colors ${
            canSend ? "bg-[var(--kind-assistant)] text-white hover:opacity-90" : "bg-sand-100 text-sand-400"
          }`}
        >
          ↑
        </button>
      </div>
    </section>
  );
}

function Proposal({
  proposal,
  lost,
  onApply,
  onDiscard,
  onUndo,
}: {
  proposal: NonNullable<Extract<Turn, { role: "assistant" }>["proposal"]>;
  lost: number;
  onApply: () => void;
  onDiscard: () => void;
  onUndo: () => void;
}) {
  const t = useT();
  const shown = splitNote(proposal.content);
  return (
    <div className="shrink-0 rounded-xl border border-line bg-paper/60">
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[11px] font-bold tracking-[0.06em] text-sand-500 uppercase">
        {t("assistant.noteAssistantChange")}
      </div>
      {/* The note as it will read: its title row, then its body, the way
          the note card draws them. */}
      <div className={`note-body px-3 py-2 ${proposal.state === "discarded" ? "opacity-50" : ""}`}>
        {shown.title && <h3 className="note-title mb-1">{shown.title}</h3>}
        {shown.body.trim() !== "" && <Markdown breaks>{shown.body}</Markdown>}
      </div>
      {(proposal.warnings.length > 0 || (lost > 0 && proposal.state === "open")) && (
        <ul className="mx-3 mb-2 flex flex-col gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5">
          {lost > 0 && proposal.state === "open" && (
            <li className="text-[11.5px] font-medium text-amber-700 dark:text-amber-400">
              ⚠ {t("assistant.noteAssistantQuotesLost", { n: String(lost), s: lost === 1 ? "" : "s" })}
            </li>
          )}
          {proposal.warnings.map((w, j) => (
            <li key={j} className="text-[11.5px] font-medium text-amber-700 dark:text-amber-400">
              ⚠ {w}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2 px-3 pb-2">
        {proposal.state === "open" && (
          <>
            <button
              type="button"
              onClick={onApply}
              data-track="note-assistant-apply"
              className="rounded-full bg-sage-600 px-3 py-1 text-xs font-semibold text-sage-fg hover:bg-sage-700"
            >
              {t("assistant.noteAssistantApply")}
            </button>
            <button
              type="button"
              onClick={onDiscard}
              data-track="note-assistant-discard"
              className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
            >
              {t("assistant.noteAssistantDiscard")}
            </button>
          </>
        )}
        {proposal.state === "applied" && (
          <>
            <span className="text-[11.5px] text-sage-700">{t("assistant.noteAssistantApplied")}</span>
            <button
              type="button"
              onClick={onUndo}
              data-track="note-assistant-undo"
              className="ml-auto rounded-full border border-line px-2.5 py-0.5 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
            >
              {t("assistant.noteAssistantUndo")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

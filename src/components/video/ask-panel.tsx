"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { splitStreamError } from "@/lib/derive/config";
import { useImeGuard } from "@/lib/ime";
import { QuestionIcon, StopIcon } from "@/components/icons";
import { useCollab } from "@/components/collab/collab-context";
import { useWeb } from "@/components/assistant/web-chip";
import { useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { ThinkingIndicator } from "@/components/thinking";
import { formatTime, parseTimeInput } from "@/lib/video/types";
import { VoiceTypingButton } from "@/components/voice/voice-typing-button";
import { ClearConversation } from "@/components/assistant/clear-conversation";
import { failureLine, modelFetch } from "@/components/assistant/failure";
import { isOffline } from "@/lib/offline/queue";
import { readChatDraft, useChatDraft, useKeptChat, writeChatDraft, type KeptTurn } from "@/lib/kept-chat";

// Ask about a range (SPEC.md §11): the reader names a start and an end time
// and asks a question; the model answers from the transcript inside that
// range and streams the answer here. The question and its answer are kept
// for the account per document (lib/kept-chat.ts), so closing the card,
// leaving the page, or a reload keeps them; Clear conversation removes them.
// A new ask replaces the kept exchange only once its answer has words: a
// failure, Stop before the first words, or no network leaves the last answer
// as it was, with the one failure line under the box. The words typed in
// the box are kept in this browser until the answer lands; after that the
// box shows the kept question. "Add to notes" lands the answer as a PENDING
// note with a time source for the range.
type Range = { startTime: number; endTime: number };
type AskTurn = KeptTurn & { data?: { range?: Range; saved?: boolean } };
type Answer = { text: string; range: Range; question: string; saved: boolean };

/** The kept question and answer, as the card draws them; null with none. */
function answerOf(turns: AskTurn[]): Answer | null {
  const answer = turns[turns.length - 1];
  const question = turns[turns.length - 2];
  if (!answer || answer.role !== "assistant" || !question || !answer.data?.range) return null;
  return { text: answer.content, range: answer.data.range, question: question.content, saved: answer.data.saved === true };
}
export function AskRange({
  notebookId,
  documentId,
  audio,
  hasTranscript,
  defaultStart,
  defaultEnd,
  sectionChoices,
  onSeek,
  onClose,
}: {
  notebookId: string;
  documentId: string;
  audio: boolean;
  hasTranscript: boolean;
  defaultStart: number;
  defaultEnd: number;
  sectionChoices: { id: string; label: string }[];
  onSeek: (startTime: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const web = useWeb();
  const router = useRouter();
  const ime = useImeGuard();
  const { canEdit } = useCollab();
  const [startTime, setStartTime] = useState(formatTime(defaultStart));
  const [endTime, setEndTime] = useState(formatTime(defaultEnd));
  // null: nothing typed here yet, and the box shows the kept question.
  const [typed, setQuestionState] = useState<string | null>(null);
  const draftKey = `ask:${notebookId}:${documentId}`;
  useChatDraft(draftKey, setQuestionState);
  function setQuestion(text: string) {
    setQuestionState(text);
    writeChatDraft(draftKey, text);
  }
  const kept = useKeptChat<AskTurn>(notebookId, `ask:${documentId}`, "replace");
  const busy = kept.busy;
  const answer = answerOf(kept.turns);
  // Opened again (a reload, the card closed): the box shows the kept
  // question until a key is typed, so the answer reads with what it answers.
  const question = typed ?? answer?.question ?? "";
  const saved = answer?.saved === true;
  const { setTurns } = kept;
  /** The answer on screen: a new one, a change to it, or none. */
  function setAnswer(update: (a: Answer | null) => Answer | null) {
    setTurns((turns) => {
      const next = update(answerOf(turns));
      if (!next) return [];
      return [
        { role: "user", content: next.question },
        { role: "assistant", content: next.text, data: { range: next.range, saved: next.saved } },
      ];
    });
  }
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The ask on its way, drawn in the answer's place until its first words.
  const [pending, setPending] = useState<{ range: Range; question: string } | null>(null);
  const shown: Answer | null = pending ? { text: "", ...pending, saved: false } : answer;
  const stop = kept.stop;

  async function ask() {
    const q = question.trim();
    if (!q || busy || !hasTranscript) return;
    const start = parseTimeInput(startTime);
    const end = parseTimeInput(endTime);
    if (start === null || end === null || end <= start) {
      setError(t("video.timesInvalid"));
      return;
    }
    await run(q, { startTime: start, endTime: end });
  }
  // Regenerate asks the answer's own question over its own range again, so an
  // edited box does not change what runs (SPEC.md §4).
  async function run(q: string, range: { startTime: number; endTime: number }) {
    if (busy || !hasTranscript) return;
    setError(null);
    // The kept exchange stands until the new answer has words.
    const before = kept.turns;
    let started = false;
    const show = (text: string) => {
      if (started) setAnswer((a) => (a ? { ...a, text } : a));
      else if (text.trim()) {
        started = true;
        setPending(null);
        setAnswer(() => ({ text, range, question: q, saved: false }));
      }
    };
    setPending({ range, question: q });
    const controller = kept.begin();
    try {
      const res = await modelFetch(
        "/api/derive",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ type: "ASK", documentId, notebookId, question: q, video: range, web }),
        },
        t,
      );
      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? t("assistant.failedServer"));
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let raw = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        show(splitStreamError(raw).text);
      }
      const { text, error: streamError } = splitStreamError(raw);
      if (streamError || !text.trim()) throw new Error(streamError ?? t("assistant.failedServer"));
      show(text);
      // Asked: the box shows the kept question from now on (words typed
      // since stay kept).
      if (readChatDraft(draftKey).trim() === q) writeChatDraft(draftKey, "");
    } catch (err) {
      // Stopped, not failed: what streamed in stays; with no words yet the
      // last answer stays.
      if (controller.signal.aborted) return;
      // Failed: nothing is stored; the last answer comes back if words of
      // the new one had replaced it, and the question stays in the box.
      if (started) setTurns(() => before);
      setError(isOffline() ? t("common.offlineAi") : failureLine(err, t));
    } finally {
      setPending(null);
      kept.end(controller);
    }
  }

  async function save() {
    const section = sectionChoices[0];
    if (!answer || !section || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api("/api/notes", "POST", {
        sectionId: section.id,
        content: `**${answer.question}**\n\n${answer.text.trim()}`,
        video: { documentId, ...answer.range },
        origin: "ask",
      });
      setAnswer((a) => (a ? { ...a, saved: true } : a));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("video.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  const timeInput =
    "w-16 rounded-full bg-sand-100 px-2.5 py-1 text-center text-xs tabular-nums outline-none";

  return (
    <div className="mt-3 rounded-2xl bg-card p-4 shadow-float" data-ask-range>
      <div className="mb-2.5 flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.08em] text-clay-800 uppercase">
          <QuestionIcon size={12} />
          {t("video.askRange")}
        </span>
        <input
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          aria-label={t("video.startTime")}
          className={timeInput}
        />
        <span className="text-xs text-sand-500">{t("video.to")}</span>
        <input
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
          aria-label={t("video.endTime")}
          className={timeInput}
        />
        {answer && !busy && (
          <ClearConversation onClear={kept.clear} track="video-ask-clear" className="ml-auto" />
        )}
        <button
          // A running answer keeps running: it lands in the kept
          // conversation, and the card shows it when it opens again.
          onClick={onClose}
          data-track="video-ask-close"
          aria-label={t("common.close")}
          data-tip={t("common.close")}
          className={`${answer && !busy ? "" : "ml-auto "}rounded-full px-1.5 text-sand-500 hover:text-clay-800`}
        >
          ✕
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
        className="flex items-center gap-2"
      >
        <input
          autoFocus
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          {...ime.props}
          onKeyDown={(e) => {
            if (ime.isImeEnter(e)) e.preventDefault();
          }}
          placeholder={
            hasTranscript
              ? t(audio ? "video.askPlaceholderAudio" : "video.askPlaceholder")
              : t("video.skillNeedsTranscript")
          }
          aria-label={t("video.askRange")}
          disabled={!hasTranscript}
          className="min-w-0 flex-1 rounded-full bg-sand-100 px-4 py-2 text-[13px] outline-none placeholder:text-sand-500 disabled:opacity-60"
        />
        {hasTranscript && <VoiceTypingButton track="video-ask-voice-typing" className="size-8" size={14} />}
        <button
          type="submit"
          data-track="video-ask"
          onClick={(e) => {
            if (!busy) return;
            e.preventDefault();
            stop();
          }}
          disabled={!busy && (!question.trim() || !hasTranscript)}
          data-tip={busy ? t("video.stopAsk") : t("video.askTitle")}
          aria-label={busy ? t("video.stopAsk") : undefined}
          className="rounded-full bg-clay px-4 py-2 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
        >
          {busy ? <StopIcon size={12} /> : t("video.ask")}
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      {shown && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center gap-2">
            <button
              onClick={() => onSeek(shown.range.startTime)}
              data-track="video-ask-seek"
              className="rounded-full bg-clay-100 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-clay-800 hover:bg-clay-200"
              data-tip={t("video.jumpToPart")}
            >
              {formatTime(shown.range.startTime)}–{formatTime(shown.range.endTime)}
            </button>
            {busy && <ThinkingIndicator className="text-xs" onStop={stop} />}
          </div>
          {shown.text && (
            <div className="text-[13px] leading-relaxed text-sand-800">
              <Markdown>{shown.text}</Markdown>
            </div>
          )}
          {!busy && shown.text.trim() && (
            <div className="mt-2.5 flex items-center gap-2">
              <button
                onClick={() => void run(shown.question, shown.range)}
                data-track="video-ask-regenerate"
                data-tip={t("video.regenerateAnswerTitle")}
                className="rounded-full border border-line px-3 py-1 text-[11.5px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800"
              >
                {t("common.regenerate")}
              </button>
              {!canEdit ? null : saved ? (
                <span className="text-[11.5px] font-semibold text-sage-700">
                  {t("video.addedPending")}
                </span>
              ) : (
                <button
                  onClick={() => void save()}
                  data-track="video-ask-add-note"
                  disabled={saving || sectionChoices.length === 0}
                  data-tip={
                    sectionChoices.length === 0
                      ? t("video.addSectionFirst")
                      : t("video.addAsPendingNote", { section: sectionChoices[0].label })
                  }
                  className="rounded-full border border-line px-3 py-1 text-[11.5px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
                >
                  {saving ? t("video.adding") : t("video.addToNotes")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { splitStreamError } from "@/lib/derive/config";
import { useImeGuard } from "@/lib/ime";
import { QuestionIcon, StopIcon } from "@/components/icons";
import { useCollab } from "@/components/collab/collab-context";
import { useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { ThinkingIndicator } from "@/components/thinking";
import { formatTime, parseTimeInput } from "@/lib/video/types";

// Ask about a range (SPEC.md §11): the reader names a start and an end time
// and asks a question; the model answers from the transcript inside that
// range and streams the answer here. Nothing persists: "Add to notes" lands
// the answer as a PENDING note with a time source for the range.
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
  const router = useRouter();
  const ime = useImeGuard();
  const { canEdit } = useCollab();
  const [startTime, setStartTime] = useState(formatTime(defaultStart));
  const [endTime, setEndTime] = useState(formatTime(defaultEnd));
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{
    text: string;
    range: { startTime: number; endTime: number };
    question: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  function stop() {
    abortRef.current?.abort();
  }

  async function ask() {
    const q = question.trim();
    if (!q || busy || !hasTranscript) return;
    const start = parseTimeInput(startTime);
    const end = parseTimeInput(endTime);
    if (start === null || end === null || end <= start) {
      setError(t("video.timesInvalid"));
      return;
    }
    setError(null);
    setSaved(false);
    setBusy(true);
    const range = { startTime: start, endTime: end };
    setAnswer({ text: "", range, question: q });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ type: "ASK", documentId, notebookId, question: q, video: range }),
      });
      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? t("video.requestFailedStatus", { status: res.status }));
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let raw = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        const { text } = splitStreamError(raw);
        setAnswer((a) => (a ? { ...a, text } : a));
      }
      const { text, error: streamError } = splitStreamError(raw);
      if (streamError || !text.trim()) {
        setAnswer(null);
        throw new Error(streamError ?? t("video.assistantNoReply"));
      }
      setAnswer((a) => (a ? { ...a, text } : a));
    } catch (err) {
      // Stopped, not failed: what streamed in stays; an empty card closes.
      if (controller.signal.aborted) {
        setAnswer((a) => (a && a.text.trim() ? a : null));
        return;
      }
      setError(err instanceof Error ? err.message : t("video.askFailed"));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
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
      setSaved(true);
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
        <button
          onClick={() => {
            stop();
            onClose();
          }}
          data-track="video-ask-close"
          aria-label={t("common.close")}
          data-tip={t("common.close")}
          className="ml-auto rounded-full px-1.5 text-sand-500 hover:text-clay-800"
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
      {answer && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center gap-2">
            <button
              onClick={() => onSeek(answer.range.startTime)}
              data-track="video-ask-seek"
              className="rounded-full bg-clay-100 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-clay-800 hover:bg-clay-200"
              data-tip={t("video.jumpToPart")}
            >
              {formatTime(answer.range.startTime)}–{formatTime(answer.range.endTime)}
            </button>
            {busy && <ThinkingIndicator className="text-xs" onStop={stop} />}
          </div>
          {answer.text && (
            <div className="text-[13px] leading-relaxed text-sand-800">
              <Markdown>{answer.text}</Markdown>
            </div>
          )}
          {!busy && answer.text.trim() && canEdit && (
            <div className="mt-2.5">
              {saved ? (
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

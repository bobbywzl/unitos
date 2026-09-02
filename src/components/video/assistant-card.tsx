"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useImeGuard } from "@/lib/ime";
import { SparkleIcon, StopIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { ThinkingIndicator } from "@/components/thinking";
import { runFormalize } from "@/lib/video/formalize-client";
import { formatTimeRange, type Region } from "@/lib/video/types";
import type { AssistantPlan, FormalizedArticle, FormalizeFormat } from "@/lib/types";

// The assistant on the media pane (SPEC.md §11): a chat card under the tool
// bar, document scope — the model reads the whole timed transcript. Facing
// video and audio it carries two skills as suggestion chips: Formalize into an
// article (stores on the attachment, renders under the transcript) and
// Formalize into bullet-point notes (PENDING notes with time sources). Typed
// commands go to /api/assistant/act like the reader's chat.

type ChatMessage = { role: "user" | "assistant"; content: string };

export function MediaAssistant({
  notebookId,
  documentId,
  hasTranscript,
  sectionChoices,
  spot,
  captureFrame,
  onClose,
}: {
  notebookId: string;
  documentId: string;
  hasTranscript: boolean;
  sectionChoices: { id: string; label: string }[];
  // The circled spot on the player, if one is open: commands carry it — the
  // frame, the time range, the drawn region — so the model sees what the
  // reader circled. The chip's ✕ sends commands without it.
  spot: { startTime: number; endTime: number; region: Region | null } | null;
  captureFrame: (region: Region | null, time: number) => Promise<string | undefined>;
  onClose: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const ime = useImeGuard();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The running send() or skill, so Stop can abort it — the reply never
  // lands, but the sent message stays in the transcript.
  const sendAbortRef = useRef<AbortController | null>(null);
  function stopSend() {
    sendAbortRef.current?.abort();
    sendAbortRef.current = null;
    setBusy(false);
  }
  // A cleared chip stays cleared until a new spot is circled.
  const [spotCleared, setSpotCleared] = useState(false);
  const spotKey = spot ? `${spot.startTime}-${spot.endTime}` : null;
  const [prevSpotKey, setPrevSpotKey] = useState(spotKey);
  if (prevSpotKey !== spotKey) {
    setPrevSpotKey(spotKey);
    setSpotCleared(false);
  }
  const activeSpot = spot && !spotCleared ? spot : null;

  useEffect(() => {
    const box = scrollRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages, busy]);

  function push(message: ChatMessage) {
    setMessages((m) => [...m, message]);
  }

  // One skill run: the chip label lands as the reader's turn, the outcome as
  // the assistant's, and the pane refreshes to show what was made.
  async function runSkill(format: FormalizeFormat) {
    if (busy || !hasTranscript) return;
    push({
      role: "user",
      content: t(format === "article" ? "video.skillArticle" : "video.skillNotes"),
    });
    setBusy(true);
    const controller = new AbortController();
    sendAbortRef.current = controller;
    try {
      const result = await runFormalize(
        {
          documentId,
          notebookId,
          format,
          sectionId: format === "notes" ? sectionChoices[0]?.id : undefined,
        },
        controller.signal,
      );
      push({
        role: "assistant",
        content:
          format === "article"
            ? t("video.articleReady")
            : t("video.notesReady", {
                n: result.noteCount ?? 0,
                section: result.sectionTitle ?? "",
              }),
      });
      router.refresh();
      // The article is a document now (SPEC.md §11) — open it, ready to work on.
      if (format === "article" && result.article?.documentId) {
        router.push(`/n/${notebookId}?doc=${result.article.documentId}`);
      }
    } catch (err) {
      // Stopped, not failed: the skill line stays, no outcome lands.
      if (controller.signal.aborted) return;
      push({
        role: "assistant",
        content: err instanceof Error ? err.message : t("video.assistantFailed"),
      });
    } finally {
      if (sendAbortRef.current === controller) sendAbortRef.current = null;
      setBusy(false);
    }
  }

  async function send() {
    const command = input.trim();
    if (!command || busy) return;
    const history = messages.slice(-12);
    setInput("");
    push({ role: "user", content: command });
    setBusy(true);
    const controller = new AbortController();
    sendAbortRef.current = controller;
    try {
      // The circled spot rides along: frame captured now, at the spot's start.
      let video: { startTime: number; endTime: number; region?: Region; frame?: string } | undefined;
      if (activeSpot) {
        const frame = await captureFrame(activeSpot.region, activeSpot.startTime);
        video = {
          startTime: activeSpot.startTime,
          endTime: activeSpot.endTime,
          region: activeSpot.region ?? undefined,
          frame,
        };
      }
      const res = await fetch("/api/assistant/act", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ notebookId, documentId, command, history, video }),
      });
      const plan = (await res.json().catch(() => null)) as
        | (AssistantPlan & { error?: string })
        | null;
      if (!res.ok || !plan || plan.error) {
        throw new Error(plan?.error ?? t("video.requestFailedStatus", { status: res.status }));
      }
      const reply = plan.reply ?? t("video.assistantNoReply");
      // The media pane executes no plan actions yet; the reply still answers.
      const notice = plan.actions.length > 0 ? `\n\n${t("video.assistantActionsUnsupported")}` : "";
      push({ role: "assistant", content: reply + notice });
    } catch (err) {
      // Stopped, not failed: the sent message stays, no reply lands.
      if (controller.signal.aborted) return;
      push({
        role: "assistant",
        content: err instanceof Error ? err.message : t("video.assistantFailed"),
      });
    } finally {
      if (sendAbortRef.current === controller) sendAbortRef.current = null;
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  const chip =
    "rounded-full border border-line px-3 py-1.5 text-[11.5px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40";

  return (
    <div className="mt-3 rounded-2xl bg-card p-4 shadow-float">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.08em] text-clay-800 uppercase">
          <SparkleIcon size={12} />
          {t("video.assistant")}
        </span>
        <button
          onClick={() => {
            // A turn still in flight aborts too — closing the card means
            // nobody will read the reply, so there is nothing left for it to
            // finish for.
            sendAbortRef.current?.abort();
            sendAbortRef.current = null;
            onClose();
          }}
          aria-label={t("common.close")}
          className="ml-auto rounded-full px-1.5 text-sand-500 hover:text-clay-800"
        >
          ✕
        </button>
      </div>

      {/* The skills: systematic transcript rewrites, one click each. */}
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <button
          onClick={() => void runSkill("article")}
          disabled={busy || !hasTranscript}
          title={hasTranscript ? t("video.skillArticleTitle") : t("video.skillNeedsTranscript")}
          className={chip}
        >
          {t("video.skillArticle")}
        </button>
        <button
          onClick={() => void runSkill("notes")}
          disabled={busy || !hasTranscript}
          title={hasTranscript ? t("video.skillNotesTitle") : t("video.skillNeedsTranscript")}
          className={chip}
        >
          {t("video.skillNotes")}
        </button>
      </div>

      {activeSpot && (
        <div className="mb-2.5 flex items-center">
          <span className="flex items-center gap-1.5 rounded-full bg-clay-100 px-3 py-1 text-[11.5px] font-semibold text-clay-800">
            {t("video.assistantSpotChip", {
              range: formatTimeRange(activeSpot.startTime, activeSpot.endTime),
            })}
            <button
              onClick={() => setSpotCleared(true)}
              aria-label={t("video.assistantSpotClear")}
              title={t("video.assistantSpotClear")}
              className="rounded-full px-0.5 text-clay-700 hover:text-clay-900"
            >
              ✕
            </button>
          </span>
        </div>
      )}

      {messages.length > 0 && (
        <div ref={scrollRef} className="mb-2.5 flex max-h-72 flex-col gap-2.5 overflow-y-auto">
          {messages.map((message, i) =>
            message.role === "user" ? (
              <p
                key={i}
                className="self-end rounded-2xl bg-sand-100 px-3.5 py-2 text-[13px] text-sand-800"
              >
                {message.content}
              </p>
            ) : (
              <div key={i} className="text-[13px] leading-relaxed text-sand-800">
                <Markdown>{message.content}</Markdown>
              </div>
            ),
          )}
          {busy && <ThinkingIndicator className="text-xs" />}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-center gap-2"
      >
        <input
          ref={inputRef}
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          {...ime.props}
          onKeyDown={(e) => {
            if (ime.isImeEnter(e)) e.preventDefault();
          }}
          placeholder={t("video.assistantPlaceholder")}
          aria-label={t("video.assistant")}
          className="min-w-0 flex-1 rounded-full bg-sand-100 px-4 py-2 text-[13px] outline-none placeholder:text-sand-500"
        />
        <button
          type="submit"
          onClick={(e) => {
            if (!busy) return;
            e.preventDefault();
            stopSend();
          }}
          disabled={!busy && input.trim() === ""}
          title={busy ? t("video.stopAssistant") : undefined}
          aria-label={busy ? t("video.stopAssistant") : undefined}
          className="rounded-full bg-clay px-4 py-2 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
        >
          {busy ? <StopIcon size={12} /> : t("video.assistantSend")}
        </button>
      </form>
    </div>
  );
}

// The formalized article, under the transcript (SPEC.md §11). Open as
// document is the lead action: the article lives as a document in the corpus,
// with every reader tool. Copy takes the markdown out for publishing;
// Regenerate overwrites, like summaries — the same document's blocks rewrite.
export function ArticleSection({
  notebookId,
  documentId,
  article,
  canEdit,
}: {
  notebookId: string;
  documentId: string;
  article: FormalizedArticle | null;
  canEdit: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!article) return null;

  async function regenerate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await runFormalize({ documentId, notebookId, format: "article" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("video.assistantFailed"));
    } finally {
      setBusy(false);
    }
  }

  // Articles stored before they became documents get one on first open —
  // parsed from the stored markdown, no model call.
  async function open() {
    if (!article || opening) return;
    if (article.documentId) {
      router.push(`/n/${notebookId}?doc=${article.documentId}`);
      return;
    }
    setOpening(true);
    setError(null);
    try {
      const result = await api<{ articleDocumentId: string }>(
        `/api/documents/${documentId}/article`,
        "POST",
        { notebookId },
      );
      router.push(`/n/${notebookId}?doc=${result.articleDocumentId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setOpening(false);
    }
  }

  async function copy() {
    if (!article) return;
    try {
      await navigator.clipboard.writeText(`# ${article.title}\n\n${article.markdown}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError(t("video.copyFailed"));
    }
  }

  const action =
    "rounded-full px-2 py-0.5 text-[11px] font-semibold text-sand-600 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40";

  return (
    <section className="mt-6">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
          {t("video.article")}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {(article.documentId || canEdit) && (
            <button
              onClick={() => void open()}
              disabled={opening}
              className="rounded-full px-2 py-0.5 text-[11px] font-bold text-clay-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
              title={t("video.openArticleTitle")}
            >
              {opening ? t("common.working") : t("video.openArticle")}
            </button>
          )}
          <button onClick={() => void copy()} className={action} title={t("video.copyMarkdownTitle")}>
            {copied ? t("video.copied") : t("video.copyMarkdown")}
          </button>
          {canEdit && (
            <button
              onClick={() => void regenerate()}
              disabled={busy}
              className={action}
              title={t("video.regenerateArticleTitle")}
            >
              {busy ? t("common.working") : t("common.regenerate")}
            </button>
          )}
        </div>
      </div>
      <div className="rounded-2xl bg-card px-6 py-5 shadow-soft">
        <h3 className="mb-3 text-[19px] font-bold text-sand-900">{article.title}</h3>
        <Markdown>{article.markdown}</Markdown>
      </div>
      {error && <p className="mt-2 px-1 text-xs text-red-500">{error}</p>}
    </section>
  );
}

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { isImeKey } from "@/lib/ime";
import { SearchIcon, SparkleIcon, SpinnerIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { ThinkingIndicator } from "@/components/thinking";
import { ArticleSection, MediaAssistant } from "@/components/video/assistant-card";
import { Visual } from "@/components/video/visual";
import type { ThumbnailSource } from "@/components/video/use-thumbnails";
import { useCollab } from "@/components/collab/collab-context";
import { DocumentTitle } from "@/components/reader/document-title";
import { FindPanel } from "@/components/video/find-panel";
import { Transcript } from "@/components/video/transcript";
import {
  VideoPlayer,
  type VideoPlayerHandle,
  type VideoSource,
} from "@/components/video/video-player";
import { splitStreamError, splitStreamNote } from "@/lib/derive/config";
import type { FormalizedArticle } from "@/lib/types";
import { captureStoryboardFrame } from "@/lib/video/frame-client";
import {
  formatTime,
  formatTimeRange,
  isAudioMime,
  parseTimeInput,
  type Region,
  type TranscriptLine,
  type VideoAnnotationItem,
  type VideoInfo,
} from "@/lib/video/types";

// The video pane (SPEC.md §11): the player with everything for dissecting the
// video in one surface under it — circle and comment, Find, the transcript.
// Transcription starts on its own when the video is added; a floating caption
// teaches the tools for a few seconds. Source chips seek here instead of
// scrolling.

type Composer = {
  region: Region | null;
  startTime: string;
  endTime: string;
  text: string;
  busy: boolean;
  error: string | null;
};

type CreatedNote = {
  id: string;
  sources: { id: string }[];
};

export function VideoPane({
  notebookId,
  documentId,
  title,
  video,
  transcript,
  formalized,
  annotations,
  seekBySource,
  sectionChoices,
}: {
  notebookId: string;
  documentId: string;
  title: string;
  video: VideoInfo;
  transcript: TranscriptLine[];
  /** The formalized article on this corpus's attachment; null = none yet. */
  formalized: FormalizedArticle | null;
  annotations: VideoAnnotationItem[];
  /** startTime per source id, for every time anchor in this document — note
      chips and annotation cards jump through ?src=. */
  seekBySource: Record<string, number>;
  sectionChoices: { id: string; label: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canEdit } = useCollab();
  const t = useT();
  const playerRef = useRef<VideoPlayerHandle>(null);
  const currentTimeRef = useRef(0);
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [composer, setComposer] = useState<Composer | null>(null);
  const [explaining, setExplaining] = useState<{
    content: string;
    done: boolean;
    error: string | null;
  } | null>(null);
  const [openNote, setOpenNote] = useState<VideoAnnotationItem | null>(null);
  const [flashSourceId, setFlashSourceId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The tool caption floats over the player for a few seconds on open.
  const [hint, setHint] = useState(true);
  // The assistant chat card under the tool bar (SPEC.md §11).
  const [assistantOpen, setAssistantOpen] = useState(false);

  // Optimistic annotations and deletes, reconciled when the server props land.
  const [added, setAdded] = useState<VideoAnnotationItem[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [prevAnnotations, setPrevAnnotations] = useState(annotations);
  if (prevAnnotations !== annotations) {
    setPrevAnnotations(annotations);
    setAdded([]);
    setRemoved(new Set());
  }
  const all = useMemo(() => {
    const ids = new Set(annotations.map((a) => a.sourceId));
    return [...annotations, ...added.filter((a) => !ids.has(a.sourceId))]
      .filter((a) => !removed.has(a.noteId))
      .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);
  }, [annotations, added, removed]);

  // Audio document: no frame, so no circling, no Visual thumbnails, no frame
  // capture on Explain. Everything else is the same surface (SPEC.md §11).
  const audio = video.kind === "UPLOAD" && isAudioMime(video.mimeType);
  const source: VideoSource =
    video.kind === "YOUTUBE" && video.youtubeId
      ? { kind: "youtube", youtubeId: video.youtubeId }
      : { kind: "upload", src: `/api/video/${documentId}` };
  // Visual cards draw from the file when there is one; a YouTube frame comes
  // from the storyboard sheets instead (SPEC.md §11).
  const thumbnailSource: ThumbnailSource =
    source.kind === "upload"
      ? { kind: "upload", src: source.src }
      : { kind: "youtube", documentId };
  const aspect =
    video.width && video.height && video.height > 0 ? video.width / video.height : 16 / 9;

  // ── Transcription: starts on its own, polls in, retries on demand ─────────
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const autoFired = useRef(false);

  async function transcribe() {
    if (transcribing) return;
    setTranscribing(true);
    setTranscribeError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/transcribe`, { method: "POST" });
      // 409 = a run started elsewhere (the add already kicked one off); benign.
      if (!res.ok && res.status !== 409) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? t("video.requestFailedStatus", { status: res.status }));
      }
    } catch (err) {
      setTranscribeError(err instanceof Error ? err.message : t("video.transcriptionFailed"));
    } finally {
      setTranscribing(false);
      router.refresh();
    }
  }

  // Adding the video already starts transcription server-side; this covers
  // documents from before that, and local runs where the kick-off died.
  useEffect(() => {
    if (autoFired.current || transcript.length > 0 || video.transcriptStatus !== "NONE") return;
    autoFired.current = true;
    void transcribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While a run is live server-side, refresh until the lines land.
  useEffect(() => {
    if (video.transcriptStatus !== "PENDING" || video.transcriptStale || transcribing) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [video.transcriptStatus, video.transcriptStale, transcribing, router]);

  const transcriptPending =
    transcribing || (video.transcriptStatus === "PENDING" && !video.transcriptStale);
  // Stored transcription errors are language-neutral English diagnostics; the
  // known classes render in the UI language, the rest as stored.
  const describeTranscriptError = (message: string): string => {
    if (/no speech found/i.test(message)) return t("video.errNoSpeech");
    if (/transcription cap/i.test(message)) return t("video.errTooLarge");
    if (/caption/i.test(message)) return t("video.errCaptions");
    if (/is not set/i.test(message)) return t("video.errNotConfigured");
    return message;
  };
  const transcriptFailedMessage =
    transcribeError ??
    (video.transcriptStatus === "FAILED"
      ? video.transcriptError && describeTranscriptError(video.transcriptError)
      : video.transcriptStale
        ? t("video.lastRunUnfinished")
        : null);

  function flash(sourceId: string) {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlashSourceId(sourceId);
    flashTimer.current = setTimeout(() => setFlashSourceId(null), 1800);
  }

  function seekToSource(sourceId: string) {
    const t = seekBySource[sourceId];
    if (t === undefined) return;
    playerRef.current?.seek(t);
    flash(sourceId);
  }

  // Source chips navigate with ?src=<sourceId>; a second click on the same chip
  // arrives as the dissect:flash-source event (same contract as the reader).
  const srcParam = searchParams.get("src");
  useEffect(() => {
    if (srcParam) seekToSource(srcParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcParam]);
  useEffect(() => {
    const onFlash = (e: Event) => {
      const { sourceId } = (e as CustomEvent<{ sourceId: string }>).detail;
      seekToSource(sourceId);
    };
    const onOpen = (e: Event) => {
      const { sourceId } = (e as CustomEvent<{ sourceId: string }>).detail;
      seekToSource(sourceId);
    };
    window.addEventListener("dissect:flash-source", onFlash);
    window.addEventListener("dissect:open-annotation", onOpen);
    return () => {
      window.removeEventListener("dissect:flash-source", onFlash);
      window.removeEventListener("dissect:open-annotation", onOpen);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekBySource]);

  // Report duration and frame size once metadata loads, when the stored values
  // are missing or stale.
  const reported = useRef(false);
  function onMetadata(m: { duration: number; width?: number; height?: number }) {
    if (reported.current) return;
    reported.current = true;
    const stale =
      video.duration === null ||
      Math.abs(video.duration - m.duration) > 0.25 ||
      (m.width !== undefined && video.width !== m.width) ||
      (m.height !== undefined && video.height !== m.height);
    if (stale) void api(`/api/video/${documentId}`, "PATCH", m).catch(() => {});
  }

  useEffect(() => {
    if (!drawing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawing(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawing]);

  // ── Annotate: circle a spot or take the whole frame, then comment or explain.
  // Audio has no frame to circle: the button opens the composer on the current
  // moment directly.
  function toggleAnnotate() {
    if (!canEdit) return;
    if (drawing || composer || explaining) {
      setDrawing(false);
      setComposer(null);
      setExplaining(null);
      return;
    }
    playerRef.current?.pause();
    if (audio) onDrawn(null);
    else setDrawing(true);
  }

  function onDrawn(region: Region | null) {
    setDrawing(false);
    const t = Math.floor(playerRef.current?.time() ?? 0);
    setComposer({
      region,
      startTime: formatTime(t),
      endTime: formatTime(t + 4),
      text: "",
      busy: false,
      error: null,
    });
  }

  async function saveComposer() {
    if (!composer || composer.busy) return;
    const startTime = parseTimeInput(composer.startTime);
    const endTime = parseTimeInput(composer.endTime);
    if (startTime === null || endTime === null || endTime <= startTime) {
      setComposer({ ...composer, error: t("video.timesInvalid") });
      return;
    }
    const text = composer.text.trim();
    if (!text) {
      setComposer({ ...composer, error: t("video.writeCommentFirst") });
      return;
    }
    setComposer({ ...composer, busy: true, error: null });
    try {
      const note = await api<CreatedNote>("/api/annotations", "POST", {
        notebookId,
        documentId,
        video: { startTime, endTime, region: composer.region ?? undefined, comment: text },
      });
      const sourceId = note.sources[0]?.id;
      if (sourceId) {
        setAdded((prev) => [
          ...prev,
          {
            noteId: note.id,
            sourceId,
            kind: "comment",
            content: text,
            startTime,
            endTime,
            region: composer.region,
          },
        ]);
      }
      setComposer(null);
      router.refresh();
    } catch (err) {
      setComposer((c) =>
        c
          ? { ...c, busy: false, error: err instanceof Error ? err.message : t("video.saveFailed") }
          : c,
      );
    }
  }

  // Explain the circled spot (SPEC.md §11): capture the paused frame cropped
  // toward the loop, stream EXPLAIN with the time anchor. The server persists
  // the output as an annotation at that range, so it joins Visual.
  async function explainComposer() {
    if (!composer || composer.busy) return;
    const startTime = parseTimeInput(composer.startTime);
    const endTime = parseTimeInput(composer.endTime);
    if (startTime === null || endTime === null || endTime <= startTime) {
      setComposer({ ...composer, error: t("video.timesInvalid") });
      return;
    }
    setComposer({ ...composer, busy: true, error: null });
    await runExplain({ startTime, endTime, region: composer.region });
  }

  // The frame at a moment, cropped to what was circled: drawn from the file
  // for an upload, pulled from the storyboard sheets for a YouTube video.
  // Audio has no frame; Explain works from the transcript alone.
  async function captureFrame(region: Region | null, time: number) {
    if (audio) return undefined;
    if (source.kind === "upload") {
      return (await playerRef.current?.captureAt(time, region)) ?? undefined;
    }
    return (await captureStoryboardFrame(documentId, time, region)) ?? undefined;
  }

  // The running Explain, so Stop can abort it: what streamed in stays, an
  // empty card closes, nothing persists.
  const explainAbortRef = useRef<AbortController | null>(null);
  function stopExplain() {
    explainAbortRef.current?.abort();
  }

  async function runExplain(anchor: { startTime: number; endTime: number; region: Region | null }) {
    const { startTime, endTime, region } = anchor;
    setOpenNote(null);
    setExplaining({ content: "", done: false, error: null });
    explainAbortRef.current?.abort();
    const controller = new AbortController();
    explainAbortRef.current = controller;
    try {
      const frame = await captureFrame(region, startTime);
      const res = await fetch("/api/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          type: "EXPLAIN",
          documentId,
          notebookId,
          video: { startTime, endTime, region: region ?? undefined, frame },
        }),
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
        const text = splitStreamNote(splitStreamError(raw).text).text;
        setExplaining({ content: text, done: false, error: null });
      }
      const { text: withoutError, error: streamError } = splitStreamError(raw);
      const { text } = splitStreamNote(withoutError);
      setExplaining({ content: text, done: true, error: streamError });
      if (!streamError) router.refresh();
    } catch (err) {
      if (controller.signal.aborted) {
        setExplaining((e) => (e && e.content.trim() ? { ...e, done: true } : null));
        return;
      }
      setExplaining({
        content: "",
        done: true,
        error: err instanceof Error ? err.message : t("video.explainFailed"),
      });
    } finally {
      if (explainAbortRef.current === controller) explainAbortRef.current = null;
      setComposer((c) => (c ? { ...c, busy: false } : c));
    }
  }

  // A transcript line is an anchor like a circled spot: same tools, same time
  // range, no drawn region (SPEC.md §11).
  function commentOnLine(line: TranscriptLine) {
    if (!canEdit) return;
    playerRef.current?.seek(line.startTime);
    setActiveLineId(line.id);
    setDrawing(false);
    setExplaining(null);
    setOpenNote(null);
    setComposer({
      region: null,
      startTime: formatTime(line.startTime),
      endTime: formatTime(Math.ceil(line.endTime)),
      text: "",
      busy: false,
      error: null,
    });
  }

  function explainLine(line: TranscriptLine) {
    if (!canEdit) return;
    playerRef.current?.seek(line.startTime);
    setActiveLineId(line.id);
    setDrawing(false);
    setComposer(null);
    void runExplain({
      startTime: line.startTime,
      endTime: Math.ceil(line.endTime),
      region: null,
    });
  }

  async function onVisualDelete(noteId: string) {
    setRemoved((prev) => new Set(prev).add(noteId));
    router.refresh();
  }

  const annotateOn = drawing || composer !== null || explaining !== null;

  // The circled spot the assistant reads (SPEC.md §11): the open composer's
  // range and region, once the times parse. Null while nothing is circled.
  const composerStart = composer ? parseTimeInput(composer.startTime) : null;
  const composerEnd = composer ? parseTimeInput(composer.endTime) : null;
  const assistantSpot =
    composer && composerStart !== null && composerEnd !== null && composerEnd > composerStart
      ? { startTime: composerStart, endTime: composerEnd, region: composer.region }
      : null;

  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto">
      {/* Fluid column: the player grows with the pane — collapsing the tray
          widens it — capped so the frame stays fully on screen. */}
      <article
        className="reader-prose mx-auto w-full px-8 py-11"
        style={{ maxWidth: audio ? "760px" : `max(640px, calc((100vh - 320px) * ${aspect}))` }}
      >
        <p className="mb-2.5 text-[11px] font-bold tracking-[0.09em] text-clay-700 uppercase">
          {video.kind === "YOUTUBE" ? "YouTube" : audio ? t("video.kindAudio") : t("video.kindVideo")}
          {video.duration !== null ? ` · ${formatTime(video.duration)}` : ""}
        </p>
        <DocumentTitle documentId={documentId} title={title} />

        <div className="relative">
          <VideoPlayer
            ref={playerRef}
            source={source}
            audio={audio}
            aspect={aspect}
            storedDuration={video.duration}
            annotations={all}
            flashSourceId={flashSourceId}
            drawing={drawing}
            onDrawn={onDrawn}
            pendingRegion={composer?.region ?? null}
            onMetadata={onMetadata}
            onTime={(t) => {
              currentTimeRef.current = t;
              // The transcript follows playback: one state change per line, not
              // one per tick.
              const line = transcript.find((l) => t >= l.startTime && t < l.endTime) ?? null;
              setActiveLineId((prev) => (prev === (line?.id ?? null) ? prev : (line?.id ?? null)));
            }}
            onAnnotate={toggleAnnotate}
            canAnnotate={canEdit}
          />
          {/* The tool caption: floats up for a few seconds, then fades. */}
          {hint && (
            <div className="pointer-events-none absolute bottom-20 left-1/2 z-10 -translate-x-1/2">
              <div
                onAnimationEnd={() => setHint(false)}
                className="hint-fade rounded-full bg-black/75 px-5 py-2.5 text-[12.5px] font-medium whitespace-nowrap text-[#f5ead8] backdrop-blur-sm"
              >
                {audio ? t("video.hintCaptionAudio") : t("video.hintCaption")}
              </div>
            </div>
          )}
        </div>

        {/* The tool bar: everything for dissecting the video, one surface. */}
        <div className="mt-4">
          <FindPanel
            notebookId={notebookId}
            documentId={documentId}
            audio={audio}
            hasTranscript={transcript.length > 0}
            sectionChoices={sectionChoices}
            onSeek={(startTime) => {
              playerRef.current?.seek(startTime);
            }}
            leading={
              !canEdit ? null : (
              <>
              <button
                onClick={toggleAnnotate}
                title={audio ? t("video.audioCommentTitle") : t("video.circleCommentTitle")}
                className={
                  annotateOn
                    ? "flex shrink-0 items-center gap-1.5 rounded-full bg-clay px-3.5 py-2 text-xs font-semibold text-clay-fg"
                    : "flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3.5 py-2 text-xs font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                }
              >
                <SearchIcon size={13} />
                {audio ? t("video.comment") : t("video.circleComment")}
              </button>
              <button
                onClick={() => setAssistantOpen((open) => !open)}
                title={t("video.assistantButtonTitle")}
                className={
                  assistantOpen
                    ? "flex shrink-0 items-center gap-1.5 rounded-full bg-clay px-3.5 py-2 text-xs font-semibold text-clay-fg"
                    : "flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3.5 py-2 text-xs font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                }
              >
                <SparkleIcon size={13} />
                {t("video.assistant")}
              </button>
              </>
              )
            }
            trailing={
              transcript.length > 0 ? (
                <span className="shrink-0 rounded-full bg-sand-100 px-3 py-1.5 text-[11.5px] font-semibold text-sand-600">
                  {t("video.linesCount", { n: transcript.length })}
                </span>
              ) : transcriptFailedMessage ? (
                <span className="shrink-0 rounded-full bg-sand-100 px-3 py-1.5 text-[11.5px] font-semibold text-red-500">
                  {t("video.transcriptFailedChip")}
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-sand-100 px-3 py-1.5 text-[11.5px] font-semibold text-sand-600">
                  <SpinnerIcon size={12} className="text-clay motion-safe:animate-spin" />
                  {t("video.transcribing")}
                </span>
              )
            }
          />
        </div>

        {assistantOpen && canEdit && (
          <MediaAssistant
            notebookId={notebookId}
            documentId={documentId}
            hasTranscript={transcript.length > 0}
            sectionChoices={sectionChoices}
            spot={assistantSpot}
            captureFrame={captureFrame}
            onClose={() => setAssistantOpen(false)}
          />
        )}

        {drawing && (
          <p className="mt-3 text-[13px] text-sand-600">{t("video.drawHelp")}</p>
        )}

        {openNote && !explaining && (
          <div className="mt-4 rounded-2xl bg-card p-4 shadow-float">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
                {openNote.kind === "explain" ? t("video.explanation") : t("video.comment")}
              </span>
              <span className="rounded-full bg-clay-100 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-clay-800">
                {formatTimeRange(openNote.startTime, openNote.endTime)}
              </span>
              <button
                onClick={() => setOpenNote(null)}
                aria-label={t("common.close")}
                className="ml-auto rounded-full px-1.5 text-sand-500 hover:text-clay-800"
              >
                ✕
              </button>
            </div>
            <Markdown>{openNote.content}</Markdown>
          </div>
        )}

        {explaining && (
          <div className="mt-4 rounded-2xl bg-card p-4 shadow-float">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
                {t("video.explanation")}
              </span>
              {!explaining.done && (
                <ThinkingIndicator className="text-xs" onStop={stopExplain} />
              )}
              {explaining.done && !explaining.error && (
                <span className="text-xs text-sand-500">{t("video.savedAsAnnotation")}</span>
              )}
              <button
                onClick={() => {
                  explainAbortRef.current?.abort();
                  setExplaining(null);
                  setComposer(null);
                }}
                aria-label={t("common.close")}
                className="ml-auto rounded-full px-1.5 text-sand-500 hover:text-clay-800"
              >
                ✕
              </button>
            </div>
            {explaining.content && <Markdown>{explaining.content}</Markdown>}
            {explaining.error && <p className="mt-1.5 text-xs text-red-500">{explaining.error}</p>}
          </div>
        )}

        {composer && !explaining && (
          <div className="mt-4 rounded-2xl bg-card p-4 shadow-float">
            <div className="mb-2.5 flex items-center gap-2">
              <span className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
                {t("video.newAnnotation")}
              </span>
              <input
                value={composer.startTime}
                onChange={(e) => setComposer({ ...composer, startTime: e.target.value })}
                aria-label={t("video.startTime")}
                className="w-16 rounded-full bg-sand-100 px-2.5 py-1 text-center text-xs tabular-nums outline-none"
              />
              <span className="text-xs text-sand-500">{t("video.to")}</span>
              <input
                value={composer.endTime}
                onChange={(e) => setComposer({ ...composer, endTime: e.target.value })}
                aria-label={t("video.endTime")}
                className="w-16 rounded-full bg-sand-100 px-2.5 py-1 text-center text-xs tabular-nums outline-none"
              />
              <span className="text-xs text-sand-500">
                {composer.region
                  ? t("video.regionShows")
                  : audio
                    ? t("video.audioRangeShows")
                    : t("video.wholeFrameShows")}
              </span>
              <button
                onClick={() => setComposer(null)}
                aria-label={t("common.close")}
                className="ml-auto rounded-full px-1.5 text-sand-500 hover:text-clay-800"
              >
                ✕
              </button>
            </div>
            <textarea
              autoFocus
              value={composer.text}
              onChange={(e) => setComposer({ ...composer, text: e.target.value })}
              onKeyDown={(e) => {
                if (isImeKey(e)) return;
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void saveComposer();
                if (e.key === "Escape") setComposer(null);
              }}
              placeholder={
                composer.region
                  ? t("video.commentCircledPlaceholder")
                  : t("video.commentMomentPlaceholder")
              }
              rows={2}
              className="w-full resize-y rounded-2xl bg-sand-100 px-3.5 py-2.5 text-sm outline-none placeholder:text-sand-500"
            />
            {composer.error && <p className="mt-1.5 text-xs text-red-500">{composer.error}</p>}
            <div className="mt-2.5 flex items-center gap-2">
              <button
                onClick={() => void saveComposer()}
                disabled={composer.busy}
                className="rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
              >
                {composer.busy ? t("common.saving") : t("video.saveAnnotation")}
              </button>
              <button
                onClick={() => void explainComposer()}
                disabled={composer.busy}
                title={audio ? t("video.audioExplainButtonTitle") : t("video.explainButtonTitle")}
                className="rounded-full border border-line px-3.5 py-1.5 text-xs font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
              >
                {composer.region ? t("video.explainCircled") : t("video.explainThisMoment")}
              </button>
              <button
                onClick={() => setComposer(null)}
                className="rounded-full border border-line px-3.5 py-1.5 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        )}

        <Visual
          source={thumbnailSource}
          audio={audio}
          annotations={all}
          onOpen={(a) => {
            playerRef.current?.seek(a.startTime);
            flash(a.sourceId);
            setExplaining(null);
            setOpenNote(a);
          }}
          onDelete={onVisualDelete}
        />

        <Transcript
          transcript={transcript}
          audio={audio}
          activeLineId={activeLineId}
          annotations={all}
          pending={transcriptPending}
          failedMessage={transcriptFailedMessage}
          onSeek={(line) => {
            playerRef.current?.seek(line.startTime);
            setActiveLineId(line.id);
          }}
          onComment={commentOnLine}
          onExplain={explainLine}
          onOpenAnnotation={(a) => {
            playerRef.current?.seek(a.startTime);
            flash(a.sourceId);
            setExplaining(null);
            setOpenNote(a);
          }}
          onTranscribe={() => void transcribe()}
        />

        <ArticleSection
          notebookId={notebookId}
          documentId={documentId}
          article={formalized}
          canEdit={canEdit}
        />
      </article>
    </div>
  );
}

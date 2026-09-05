"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { isImeKey } from "@/lib/ime";
import {
  CommentIcon,
  LocateIcon,
  QuestionIcon,
  SearchIcon,
  SparkleIcon,
  SpinnerIcon,
} from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { ThinkingIndicator } from "@/components/thinking";
import { AskRange } from "@/components/video/ask-panel";
import { ArticleSection, MediaAssistant } from "@/components/video/assistant-card";
import { Visual } from "@/components/video/visual";
import type { ThumbnailSource } from "@/components/video/use-thumbnails";
import { useCollab } from "@/components/collab/collab-context";
import { DocumentTitle } from "@/components/reader/document-title";
import { ReaderInteractions } from "@/components/reader/reader-interactions";
import type { TranscriptVariant } from "@/components/reader/reader";
import { FindPanel } from "@/components/video/find-panel";
import { TranscriptEmpty, TranscriptHeader } from "@/components/video/transcript";
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
// scrolling. The pane is the reader's interaction layer with the transcript
// lines as its blocks: the player and the video tools render above the lines,
// and every text tool of an article — the selection toolbar, marks, links —
// works on the lines through the same code path.

// The text layer's props, as the page builds them for any document.
type ReaderTextProps = Omit<
  React.ComponentProps<typeof ReaderInteractions>,
  | "documentId"
  | "notebookId"
  | "sectionChoices"
  | "title"
  | "blocks"
  | "translationAvailable"
  | "transcript"
>;

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
  translationAvailable,
  reader,
}: {
  notebookId: string;
  documentId: string;
  title: string;
  video: VideoInfo;
  /** The text layer over the transcript lines: marks, links, terms, cards. */
  reader: ReaderTextProps;
  /** DEEPL_API_KEY is set: the Translate offer shows when the languages differ (SPEC.md §19). */
  translationAvailable: boolean;
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
  // Ask about a range (SPEC.md §11): the card opens on the current moment,
  // five minutes ahead or to the end, whichever comes first.
  const [askRange, setAskRange] = useState<{ start: number; end: number } | null>(null);
  function toggleAsk() {
    if (askRange) {
      setAskRange(null);
      return;
    }
    const start = Math.max(0, Math.floor(currentTimeRef.current));
    const limit = video.duration !== null && video.duration > start ? video.duration : start + 300;
    setAskRange({ start, end: Math.min(limit, start + 300) });
  }

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

  // The pasted transcript (SPEC.md §11): stored through the same cleanup and
  // writes as a transcribed one. True when it landed; the reason shows in
  // the pane's failed state otherwise.
  async function pasteTranscript(text: string): Promise<boolean> {
    setTranscribeError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? t("video.requestFailedStatus", { status: res.status }));
      }
      router.refresh();
      return true;
    } catch (err) {
      setTranscribeError(err instanceof Error ? err.message : t("video.transcriptionFailed"));
      return false;
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

  // The first annotation covering each line, so a line reads as annotated the
  // way a highlighted span does in the reader, and its hover tools open it.
  const annotationByLine = useMemo(() => {
    const map = new Map<string, VideoAnnotationItem>();
    for (const line of transcript) {
      const hit = all.find((a) => a.startTime < line.endTime && a.endTime > line.startTime);
      if (hit) map.set(line.id, hit);
    }
    return map;
  }, [transcript, all]);
  const annotatedLineIds = useMemo(() => new Set(annotationByLine.keys()), [annotationByLine]);

  const lineAction =
    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-sand-600 hover:bg-clay-100 hover:text-clay-800";
  // The moment's tools on a transcript line: a line is an anchor like a
  // circled spot — same tools, same time range, no drawn region.
  const lineTools = (line: TranscriptLine) => {
    const annotated = annotationByLine.get(line.id);
    return (
      <>
        {canEdit && (
          <button
            onClick={() => commentOnLine(line)}
            data-track="video-line-comment"
            className={lineAction}
            data-tip={t("video.commentOnLineTitle")}
          >
            <CommentIcon size={11} />
            {t("video.comment")}
          </button>
        )}
        {canEdit && (
          <button
            onClick={() => explainLine(line)}
            data-track="video-line-explain"
            className={lineAction}
            data-tip={t("video.explainThisMoment")}
          >
            <QuestionIcon size={11} />
            {t("video.explain")}
          </button>
        )}
        {annotated && (
          <button
            onClick={() => openAnnotation(annotated)}
            data-track="video-line-open-note"
            className={lineAction}
            data-tip={t("video.openNoteTitle")}
          >
            <LocateIcon size={11} />
            {t("video.openNote")}
          </button>
        )}
      </>
    );
  };
  function openAnnotation(a: VideoAnnotationItem) {
    playerRef.current?.seek(a.startTime);
    flash(a.sourceId);
    setExplaining(null);
    setOpenNote(a);
  }

  // Above the lines: the player and everything for dissecting the video.
  const prelude = (
    <>
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
            <>
            {canEdit && (
            <>
            <button
              onClick={toggleAnnotate}
              data-track="video-circle-comment"
              data-tip={audio ? t("video.audioCommentTitle") : t("video.circleCommentTitle")}
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
              data-track="video-assistant"
              data-tip={t("video.assistantButtonTitle")}
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
            )}
            <button
              onClick={toggleAsk}
              data-track="video-ask-open"
              data-tip={t(audio ? "video.askButtonTitleAudio" : "video.askButtonTitle")}
              className={
                askRange
                  ? "flex shrink-0 items-center gap-1.5 rounded-full bg-clay px-3.5 py-2 text-xs font-semibold text-clay-fg"
                  : "flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3.5 py-2 text-xs font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800"
              }
            >
              <QuestionIcon size={13} />
              {t("video.askRange")}
            </button>
            </>
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

      {askRange && (
        <AskRange
          notebookId={notebookId}
          documentId={documentId}
          audio={audio}
          hasTranscript={transcript.length > 0}
          defaultStart={askRange.start}
          defaultEnd={askRange.end}
          sectionChoices={sectionChoices}
          onSeek={(startTime) => playerRef.current?.seek(startTime)}
          onClose={() => setAskRange(null)}
        />
      )}

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
              data-track="video-note-close"
              aria-label={t("common.close")}
              data-tip={t("common.close")}
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
              data-track="video-explain-close"
              aria-label={t("common.close")}
              data-tip={t("common.close")}
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
              data-track="video-composer-close"
              aria-label={t("common.close")}
              data-tip={t("common.close")}
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
              data-track="video-save-annotation"
              disabled={composer.busy}
              className="rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
            >
              {composer.busy ? t("common.saving") : t("video.saveAnnotation")}
            </button>
            <button
              onClick={() => void explainComposer()}
              data-track="video-explain"
              disabled={composer.busy}
              data-tip={audio ? t("video.audioExplainButtonTitle") : t("video.explainButtonTitle")}
              className="rounded-full border border-line px-3.5 py-1.5 text-xs font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
            >
              {composer.region ? t("video.explainCircled") : t("video.explainThisMoment")}
            </button>
            <button
              onClick={() => setComposer(null)}
              data-track="video-composer-cancel"
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
        onOpen={openAnnotation}
        onDelete={onVisualDelete}
      />

      <TranscriptHeader
        count={transcript.length}
        audio={audio}
        pending={transcriptPending}
        onTranscribe={() => void transcribe()}
      />
    </>
  );

  // Below the lines: the failed state when there are none, the article.
  const epilogue = (
    <>
      {transcript.length === 0 && (
        <TranscriptEmpty
          audio={audio}
          pending={transcriptPending}
          failedMessage={transcriptFailedMessage}
          onTranscribe={() => void transcribe()}
          onPaste={pasteTranscript}
          pasteHelp={t(video.kind === "YOUTUBE" ? "video.pasteHelpYoutube" : "video.pasteHelpFile")}
        />
      )}
      {transcript.length > 0 && transcriptFailedMessage && (
        <p className="mt-2 px-1 text-xs text-red-500">{transcriptFailedMessage}</p>
      )}
      <ArticleSection
        notebookId={notebookId}
        documentId={documentId}
        article={formalized}
        canEdit={canEdit}
      />
    </>
  );

  const transcriptView: TranscriptVariant = {
    lines: transcript,
    activeLineId,
    onSeek: (line) => {
      playerRef.current?.seek(line.startTime);
      setActiveLineId(line.id);
    },
    annotatedLineIds,
    lineTools,
    prelude,
    epilogue,
    // Fluid column: the player grows with the pane — collapsing the tray
    // widens it — capped so the frame stays fully on screen.
    columnStyle: {
      maxWidth: audio ? "760px" : `max(640px, calc((100vh - 320px) * ${aspect}))`,
    },
  };

  return (
    <ReaderInteractions
      documentId={documentId}
      notebookId={notebookId}
      sectionChoices={sectionChoices}
      title={title}
      translationAvailable={translationAvailable}
      blocks={transcript.map((l) => ({ id: l.id, type: "TRANSCRIPT" as const, text: l.text, html: null }))}
      {...reader}
      transcript={transcriptView}
    />
  );
}

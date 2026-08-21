"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Markdown } from "@/components/markdown";
import { Deck } from "@/components/video/deck";
import { FindPanel } from "@/components/video/find-panel";
import { TranscriptPane } from "@/components/video/transcript-pane";
import {
  VideoPlayer,
  type VideoPlayerHandle,
  type VideoSource,
} from "@/components/video/video-player";
import { splitStreamError, splitStreamNote } from "@/lib/derive/config";
import {
  formatTime,
  parseTimeInput,
  type Region,
  type TranscriptLine,
  type VideoAnnotationItem,
  type VideoInfo,
} from "@/lib/video/types";

// The video pane (SPEC.md §11): player + overlay + deck in the reader's place.
// Circle a spot, comment on it, and the annotation replays whenever playback
// crosses its time range. Source chips seek here instead of scrolling.

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
  annotations,
  seekBySource,
  sectionChoices,
}: {
  notebookId: string;
  documentId: string;
  title: string;
  video: VideoInfo;
  transcript: TranscriptLine[];
  annotations: VideoAnnotationItem[];
  /** startTime per source id, for every time anchor in this document — note
      chips and annotation cards jump through ?src=. */
  seekBySource: Record<string, number>;
  sectionChoices: { id: string; label: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const [flashSourceId, setFlashSourceId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const source: VideoSource =
    video.kind === "YOUTUBE" && video.youtubeId
      ? { kind: "youtube", youtubeId: video.youtubeId }
      : { kind: "upload", src: `/api/video/${documentId}` };
  // Deck thumbnails capture from the file; a YouTube frame cannot be captured
  // cross-origin, so those cards fall back to their time tile.
  const captureSrc = source.kind === "upload" ? source.src : null;
  const aspect =
    video.width && video.height && video.height > 0 ? video.width / video.height : 16 / 9;

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

  // ── Annotate: circle, then comment or explain ─────────────────────────────
  function toggleAnnotate() {
    if (drawing || composer || explaining) {
      setDrawing(false);
      setComposer(null);
      setExplaining(null);
      return;
    }
    playerRef.current?.pause();
    setDrawing(true);
  }

  function onDrawn(region: Region) {
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
      setComposer({ ...composer, error: "Times are m:ss, and the end must be after the start." });
      return;
    }
    const text = composer.text.trim();
    if (!text) {
      setComposer({ ...composer, error: "Write the comment first." });
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
        c ? { ...c, busy: false, error: err instanceof Error ? err.message : "Save failed" } : c,
      );
    }
  }

  // Explain the circled spot (SPEC.md §11): capture the paused frame cropped
  // toward the circle, stream EXPLAIN with the time anchor. The server persists
  // the output as an annotation at that range, so it joins the deck.
  async function explainComposer() {
    if (!composer || composer.busy) return;
    const startTime = parseTimeInput(composer.startTime);
    const endTime = parseTimeInput(composer.endTime);
    if (startTime === null || endTime === null || endTime <= startTime) {
      setComposer({ ...composer, error: "Times are m:ss, and the end must be after the start." });
      return;
    }
    const frame = playerRef.current?.capture(composer.region) ?? undefined;
    setComposer({ ...composer, busy: true, error: null });
    setExplaining({ content: "", done: false, error: null });
    try {
      const res = await fetch("/api/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "EXPLAIN",
          documentId,
          notebookId,
          video: { startTime, endTime, region: composer.region ?? undefined, frame },
        }),
      });
      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? `Request failed (${res.status})`);
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
      setExplaining({
        content: "",
        done: true,
        error: err instanceof Error ? err.message : "Explain failed",
      });
    } finally {
      setComposer((c) => (c ? { ...c, busy: false } : c));
    }
  }

  async function onDeckDelete(noteId: string) {
    setRemoved((prev) => new Set(prev).add(noteId));
    router.refresh();
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="relative min-h-0 min-w-0 flex-1 overflow-y-auto">
      <article className="reader-prose mx-auto w-[860px] max-w-full px-6 py-11">
        <p className="mb-2.5 text-[11px] font-bold tracking-[0.09em] text-clay-700 uppercase">
          {video.kind === "YOUTUBE" ? "YouTube" : "Video"}
          {video.duration !== null ? ` · ${formatTime(video.duration)}` : ""}
          {transcript.length > 0 ? ` · ${transcript.length} transcript lines` : ""}
        </p>
        <h2 className="mb-[26px] text-[33px]">{title}</h2>

        <VideoPlayer
          ref={playerRef}
          source={source}
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
        />

        {drawing && (
          <p className="mt-3 text-[13px] text-sand-600">
            Drag on the frame to circle a spot. Esc or the circle button cancels.
          </p>
        )}

        {explaining && (
          <div className="mt-4 rounded-2xl bg-card p-4 shadow-float">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
                Explanation
              </span>
              {!explaining.done && (
                <span className="text-xs text-sand-500">streaming…</span>
              )}
              {explaining.done && !explaining.error && (
                <span className="text-xs text-sand-500">Saved as an annotation</span>
              )}
              <button
                onClick={() => {
                  setExplaining(null);
                  setComposer(null);
                }}
                aria-label="Close"
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
                New annotation
              </span>
              <input
                value={composer.startTime}
                onChange={(e) => setComposer({ ...composer, startTime: e.target.value })}
                aria-label="Start time"
                className="w-16 rounded-full bg-sand-100 px-2.5 py-1 text-center text-xs tabular-nums outline-none"
              />
              <span className="text-xs text-sand-500">to</span>
              <input
                value={composer.endTime}
                onChange={(e) => setComposer({ ...composer, endTime: e.target.value })}
                aria-label="End time"
                className="w-16 rounded-full bg-sand-100 px-2.5 py-1 text-center text-xs tabular-nums outline-none"
              />
              <span className="text-xs text-sand-500">
                The annotation shows whenever playback is inside this range.
              </span>
              <button
                onClick={() => setComposer(null)}
                aria-label="Close"
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
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void saveComposer();
                if (e.key === "Escape") setComposer(null);
              }}
              placeholder="Comment on the circled spot"
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
                {composer.busy ? "Saving…" : "Save annotation"}
              </button>
              <button
                onClick={() => void explainComposer()}
                disabled={composer.busy}
                title="The model reads the circled frame and the transcript; the explanation saves as an annotation here"
                className="rounded-full border border-line px-3.5 py-1.5 text-xs font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
              >
                Explain the circled spot
              </button>
              <button
                onClick={() => setComposer(null)}
                className="rounded-full border border-line px-3.5 py-1.5 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <Deck
          src={captureSrc}
          annotations={all}
          onSeek={(sourceId, t) => {
            playerRef.current?.seek(t);
            flash(sourceId);
          }}
          onDelete={onDeckDelete}
        />
      </article>
      </div>

      <aside className="flex w-[280px] shrink-0 flex-col border-l border-line">
        <FindPanel
          notebookId={notebookId}
          documentId={documentId}
          hasTranscript={transcript.length > 0}
          sectionChoices={sectionChoices}
          onSeek={(startTime) => {
            playerRef.current?.seek(startTime);
          }}
        />
        <TranscriptPane
          documentId={documentId}
          video={video}
          transcript={transcript}
          activeLineId={activeLineId}
          onSeek={(line) => {
            playerRef.current?.seek(line.startTime);
            setActiveLineId(line.id);
          }}
        />
      </aside>
    </div>
  );
}

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Deck } from "@/components/video/deck";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/video/video-player";
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
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const playerRef = useRef<VideoPlayerHandle>(null);
  const currentTimeRef = useRef(0);
  const [drawing, setDrawing] = useState(false);
  const [composer, setComposer] = useState<Composer | null>(null);
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

  const src = `/api/video/${documentId}`;
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
  function onMetadata(m: { duration: number; width: number; height: number }) {
    if (reported.current) return;
    reported.current = true;
    const stale =
      video.duration === null ||
      Math.abs(video.duration - m.duration) > 0.25 ||
      video.width !== m.width ||
      video.height !== m.height;
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

  // ── Annotate: circle, then comment ────────────────────────────────────────
  function toggleAnnotate() {
    if (drawing || composer) {
      setDrawing(false);
      setComposer(null);
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

  async function onDeckDelete(noteId: string) {
    setRemoved((prev) => new Set(prev).add(noteId));
    router.refresh();
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto">
      <article className="reader-prose mx-auto w-[860px] max-w-full px-6 py-11">
        <p className="mb-2.5 text-[11px] font-bold tracking-[0.09em] text-clay-700 uppercase">
          Video
          {video.duration !== null ? ` · ${formatTime(video.duration)}` : ""}
          {transcript.length > 0 ? ` · ${transcript.length} transcript lines` : ""}
        </p>
        <h2 className="mb-[26px] text-[33px]">{title}</h2>

        <VideoPlayer
          ref={playerRef}
          src={src}
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
          }}
          onAnnotate={toggleAnnotate}
        />

        {drawing && (
          <p className="mt-3 text-[13px] text-sand-600">
            Drag on the frame to circle a spot. Esc or the circle button cancels.
          </p>
        )}

        {composer && (
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
                onClick={() => setComposer(null)}
                className="rounded-full border border-line px-3.5 py-1.5 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <Deck
          src={src}
          annotations={all}
          onSeek={(sourceId, t) => {
            playerRef.current?.seek(t);
            flash(sourceId);
          }}
          onDelete={onDeckDelete}
        />
      </article>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import { formatTime } from "@/lib/video/types";

// The range step of a video or audio add (SPEC.md §15): once the file is
// uploaded, the reader plays it from the browser's own copy and moves two
// handles to keep part of it. The file is stored whole; the transcription
// keeps the lines inside the range alone, so the assistant and every tool
// read that part and nothing else.

export type MediaClip = { start: number; end: number };

// The handles never cross: a part is at least this long.
const MIN_SECONDS = 1;

export function MediaRange({ file, onDone }: { file: File; onDone: (clip: MediaClip | null) => void }) {
  const t = useT();
  const audio = file.type.startsWith("audio/");
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);

  function onMetadata() {
    const d = mediaRef.current?.duration;
    if (!d || !Number.isFinite(d)) return;
    setDuration(d);
    setEnd(d);
  }

  // Moving a handle seeks the preview to it, so the reader hears where the
  // part starts or ends.
  function seek(time: number) {
    const media = mediaRef.current;
    if (media) media.currentTime = time;
  }
  function moveStart(value: number) {
    const next = Math.min(value, end - MIN_SECONDS);
    setStart(Math.max(0, next));
    seek(next);
  }
  function moveEnd(value: number) {
    const next = Math.max(value, start + MIN_SECONDS);
    setEnd(duration === null ? next : Math.min(duration, next));
    seek(Math.max(0, next - 3));
  }

  const whole = duration === null || (start <= 0 && end >= duration);
  const left = duration ? (start / duration) * 100 : 0;
  const right = duration ? (end / duration) * 100 : 100;
  const handle =
    "pointer-events-none absolute inset-x-0 top-0 h-6 w-full appearance-none bg-transparent " +
    "[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-clay [&::-webkit-slider-thumb]:shadow-soft " +
    "[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-clay";

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] font-semibold text-sand-800">{t("panes.uploadRangeTitle")}</p>
      <p className="text-xs text-sand-600">{t("panes.uploadRangeDesc")}</p>
      {audio ? (
        <audio
          ref={(el) => {
            mediaRef.current = el;
          }}
          src={url}
          controls
          preload="metadata"
          onLoadedMetadata={onMetadata}
          className="w-full"
        />
      ) : (
        <video
          ref={(el) => {
            mediaRef.current = el;
          }}
          src={url}
          controls
          preload="metadata"
          playsInline
          onLoadedMetadata={onMetadata}
          className="max-h-56 w-full rounded-xl bg-ink"
        />
      )}
      {duration === null ? (
        <p className="text-xs text-sand-500">{t("panes.uploadRangeLoading")}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="relative h-6">
            <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-sand-200" />
            <div
              className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-clay"
              style={{ left: `${left}%`, right: `${100 - right}%` }}
            />
            <input
              type="range"
              min={0}
              max={duration}
              step={0.1}
              value={start}
              onChange={(e) => moveStart(Number(e.target.value))}
              aria-label={t("panes.uploadRangeStart")}
              className={handle}
            />
            <input
              type="range"
              min={0}
              max={duration}
              step={0.1}
              value={end}
              onChange={(e) => moveEnd(Number(e.target.value))}
              aria-label={t("panes.uploadRangeEnd")}
              className={handle}
            />
          </div>
          <div className="flex justify-between font-mono text-xs text-sand-600">
            <span>{formatTime(start)}</span>
            <span>{formatTime(end)}</span>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => onDone(whole ? null : { start, end })}
          data-track="upload-range-continue"
          className="rounded-full bg-clay px-5 py-2 text-xs font-semibold text-clay-fg hover:bg-clay-600"
        >
          {whole
            ? t("panes.uploadRangeWhole")
            : t("panes.uploadRangePart", { start: formatTime(start), end: formatTime(end) })}
        </button>
        {!whole && (
          <button
            onClick={() => onDone(null)}
            data-track="upload-range-whole"
            className="rounded-full px-3.5 py-1.5 text-xs text-sand-600 hover:bg-clay-100 hover:text-clay-800"
          >
            {t("panes.uploadRangeWhole")}
          </button>
        )}
      </div>
    </div>
  );
}

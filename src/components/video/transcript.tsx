"use client";

import { useEffect, useRef } from "react";
import { SpinnerIcon } from "@/components/icons";
import { formatTime, type TranscriptLine } from "@/lib/video/types";

// The transcript under the player (SPEC.md §11): click a line to seek; the
// current line highlights and follows playback inside its own scroll box, so
// the player never moves. Transcription starts on its own when the video is
// added; the pane owns that machinery and passes the state down.
export function Transcript({
  transcript,
  activeLineId,
  pending,
  failedMessage,
  onSeek,
  onTranscribe,
}: {
  transcript: TranscriptLine[];
  activeLineId: string | null;
  pending: boolean;
  failedMessage: string | null;
  onSeek: (line: TranscriptLine) => void;
  onTranscribe: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const hoveredRef = useRef(false);

  // Follow playback by scrolling the list box only — never the page — and
  // never fighting a hand on the list.
  useEffect(() => {
    const list = listRef.current;
    if (!activeLineId || !list || hoveredRef.current) return;
    const el = list.querySelector<HTMLElement>(`[data-line-id="${activeLineId}"]`);
    if (!el) return;
    const target = el.offsetTop - list.clientHeight / 2 + el.clientHeight / 2;
    list.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [activeLineId]);

  return (
    <section className="mt-6">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
          Transcript
        </span>
        {transcript.length > 0 && (
          <span className="text-[13px] text-sand-600">{transcript.length}</span>
        )}
        {transcript.length > 0 && !pending && (
          <button
            onClick={onTranscribe}
            className="ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold text-sand-600 hover:bg-clay-100 hover:text-clay-800"
            title="Transcribe the video again; the lines are replaced"
          >
            Transcribe again
          </button>
        )}
      </div>

      {transcript.length > 0 ? (
        <div
          ref={listRef}
          onPointerEnter={() => (hoveredRef.current = true)}
          onPointerLeave={() => (hoveredRef.current = false)}
          className="max-h-[380px] overflow-y-auto rounded-2xl bg-card p-2 shadow-soft"
        >
          {transcript.map((line) => (
            <button
              key={line.id}
              data-line-id={line.id}
              onClick={() => onSeek(line)}
              className={`flex w-full gap-3 rounded-xl px-3 py-1.5 text-left ${
                line.id === activeLineId
                  ? "bg-clay-100 text-clay-900"
                  : "text-sand-700 hover:bg-sand-100"
              }`}
            >
              <span className="w-10 shrink-0 pt-[2px] text-[11px] tabular-nums text-sand-500">
                {formatTime(line.startTime)}
              </span>
              <span className="min-w-0 text-[13px] leading-relaxed">{line.text}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl bg-card px-4 py-4 shadow-soft">
          {pending ? (
            <p className="flex items-center gap-2 text-[13px] text-sand-600">
              <SpinnerIcon size={14} className="shrink-0 text-clay motion-safe:animate-spin" />
              Transcribing… takes a minute or two. Read along, click a line to seek, and search
              the video once it lands.
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              <p className="text-[13px] leading-relaxed text-sand-600">
                The transcript did not land. It powers read-along, click-to-seek, and Find.
              </p>
              {failedMessage && <p className="text-xs text-red-500">{failedMessage}</p>}
              <button
                onClick={onTranscribe}
                className="self-start rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      )}
      {transcript.length > 0 && failedMessage && (
        <p className="mt-2 px-1 text-xs text-red-500">{failedMessage}</p>
      )}
    </section>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SpinnerIcon } from "@/components/icons";
import { formatTime, type TranscriptLine, type VideoInfo } from "@/lib/video/types";

// The transcript beside the player (SPEC.md §11): click a line to seek; the
// current line highlights and follows playback. Transcribe sends the video to
// Whisper and writes the timed lines as TRANSCRIPT blocks.
export function TranscriptPane({
  documentId,
  video,
  transcript,
  activeLineId,
  onSeek,
}: {
  documentId: string;
  video: VideoInfo;
  transcript: TranscriptLine[];
  activeLineId: string | null;
  onSeek: (line: TranscriptLine) => void;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const hoveredRef = useRef(false);

  const pending = running || video.transcriptStatus === "PENDING";
  const failedMessage = error ?? (video.transcriptStatus === "FAILED" ? video.transcriptError : null);

  // Transcription may have been started in another tab; while it runs, refresh
  // until the lines land.
  useEffect(() => {
    if (video.transcriptStatus !== "PENDING" || running) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [video.transcriptStatus, running, router]);

  // Follow playback — unless the pointer is on the list, so reading ahead is
  // never fought.
  useEffect(() => {
    if (!activeLineId || hoveredRef.current) return;
    const el = listRef.current?.querySelector(`[data-line-id="${activeLineId}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeLineId]);

  async function transcribe() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/transcribe`, { method: "POST" });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? `Request failed (${res.status})`);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transcription failed");
    } finally {
      setRunning(false);
      router.refresh();
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
          Transcript
        </span>
        {transcript.length > 0 && (
          <span className="text-[13px] text-sand-600">{transcript.length}</span>
        )}
        {transcript.length > 0 && !pending && (
          <button
            onClick={() => void transcribe()}
            className="ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold text-sand-600 hover:bg-clay-100 hover:text-clay-800"
            title="Transcribe the video again; the lines are replaced"
          >
            Transcribe again
          </button>
        )}
      </div>

      <div
        ref={listRef}
        onPointerEnter={() => (hoveredRef.current = true)}
        onPointerLeave={() => (hoveredRef.current = false)}
        className="min-h-0 flex-1 overflow-y-auto p-2"
      >
        {transcript.length > 0 ? (
          transcript.map((line) => (
            <button
              key={line.id}
              data-line-id={line.id}
              onClick={() => onSeek(line)}
              className={`flex w-full gap-2.5 rounded-xl px-2.5 py-1.5 text-left ${
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
          ))
        ) : (
          <div className="flex flex-col gap-3 px-3 py-4">
            {pending ? (
              <p className="flex items-center gap-2 text-[13px] text-sand-600">
                <SpinnerIcon size={14} className="shrink-0 text-clay motion-safe:animate-spin" />
                Transcribing… takes a minute or two.
              </p>
            ) : (
              <>
                <p className="text-[13px] leading-relaxed text-sand-600">
                  No transcript yet. Transcribe to read along, click a line to seek, and search
                  the video.
                </p>
                {failedMessage && <p className="text-xs text-red-500">{failedMessage}</p>}
                <button
                  onClick={() => void transcribe()}
                  className="self-start rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600"
                >
                  Transcribe
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {transcript.length > 0 && failedMessage && (
        <p className="border-t border-line px-4 py-2 text-xs text-red-500">{failedMessage}</p>
      )}
    </div>
  );
}

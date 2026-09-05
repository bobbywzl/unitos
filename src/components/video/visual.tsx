"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/components/lang-provider";
import { markdownPreview } from "@/lib/markdown-preview";
import { useVideoThumbnails, type ThumbnailSource } from "@/components/video/use-thumbnails";
import {
  formatTimeRange,
  regionPathD,
  type VideoAnnotationItem,
} from "@/lib/video/types";

// Visual (SPEC.md §11): a strip of cards, one per annotation — the frame at
// the moment it was made, the loop drawn on it, the time range, the note.
// Clicking a card seeks there and opens what the AI wrote at that moment.
// The video itself is never modified; this is the visual note layer.
export function Visual({
  source,
  audio,
  annotations,
  onOpen,
  onDelete,
}: {
  source: ThumbnailSource;
  /** Audio document: no frames to draw — cards carry the time range and the
      note only. */
  audio?: boolean;
  annotations: VideoAnnotationItem[];
  onOpen: (annotation: VideoAnnotationItem) => void;
  onDelete: (noteId: string) => Promise<void>;
}) {
  const t = useT();
  const [busyId, setBusyId] = useState<string | null>(null);
  const times = useMemo(
    () => (audio ? [] : annotations.map((a) => a.startTime)),
    [audio, annotations],
  );
  const thumbs = useVideoThumbnails(source, times);

  if (annotations.length === 0) return null;

  async function remove(noteId: string) {
    setBusyId(noteId);
    try {
      await api(`/api/notes/${noteId}`, "DELETE");
      await onDelete(noteId);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mt-6">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
          {t(audio ? "video.visualAudio" : "video.visual")}
        </span>
        <span className="text-[13px] text-sand-600">{annotations.length}</span>
      </div>
      <div className="flex gap-3.5 overflow-x-auto pb-2.5">
        {annotations.map((a) => {
          const thumb = thumbs[a.startTime.toFixed(1)];
          return (
            <div
              key={a.sourceId}
              className="group/card w-[218px] shrink-0 overflow-hidden rounded-2xl bg-card shadow-soft"
            >
              <button
                onClick={() => onOpen(a)}
                data-track="video-visual-open"
                data-tip={t("video.jumpOpenNote")}
                className={`relative block w-full bg-[#12100e] ${audio ? "h-9" : "aspect-video"}`}
              >
                {thumb && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="" className="h-full w-full object-cover" />
                )}
                {a.region && (
                  <svg
                    aria-hidden
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    className="absolute inset-0 h-full w-full"
                  >
                    {a.region.kind === "ellipse" ? (
                      <ellipse
                        cx={a.region.cx}
                        cy={a.region.cy}
                        rx={a.region.rx}
                        ry={a.region.ry}
                        fill="none"
                        stroke="var(--clay-400)"
                        strokeWidth={2}
                        vectorEffect="non-scaling-stroke"
                      />
                    ) : (
                      <path
                        d={regionPathD(a.region.points)}
                        fill="none"
                        stroke="var(--clay-400)"
                        strokeWidth={2}
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                  </svg>
                )}
                <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/65 px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-[#f5ead8]">
                  {formatTimeRange(a.startTime, a.endTime)}
                </span>
              </button>
              <div className="flex items-start gap-1.5 px-3 py-2.5">
                <button
                  onClick={() => onOpen(a)}
                  data-track="video-visual-open"
                  data-tip={t("video.jumpOpenNote")}
                  className="min-w-0 flex-1 text-left text-[12.5px] leading-snug text-sand-800 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden hover:text-clay-800"
                >
                  {markdownPreview(a.content)}
                </button>
                <button
                  onClick={() => void remove(a.noteId)}
                  data-track="video-visual-delete"
                  disabled={busyId === a.noteId}
                  aria-label={t("video.deleteAnnotation")}
                  data-tip={t("video.deleteAnnotation")}
                  className="rounded-full px-1 text-xs text-sand-400 opacity-0 group-hover/card:opacity-100 hover:text-red-500 disabled:opacity-40"
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

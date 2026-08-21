"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useVideoThumbnails } from "@/components/video/use-thumbnails";
import {
  formatTimeRange,
  type VideoAnnotationItem,
} from "@/lib/video/types";

// The deck (SPEC.md §11): a filmstrip of annotation cards under the player —
// the captured frame with the drawn region on it, the time range, the comment.
// Click a card to seek there. The video itself is never modified; the deck is
// the visual note layer, spliced to specific parts.
export function Deck({
  src,
  annotations,
  onSeek,
  onDelete,
}: {
  src: string;
  annotations: VideoAnnotationItem[];
  onSeek: (sourceId: string, startTime: number) => void;
  onDelete: (noteId: string) => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const times = useMemo(() => annotations.map((a) => a.startTime), [annotations]);
  const thumbs = useVideoThumbnails(src, times);

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
          Deck
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
                onClick={() => onSeek(a.sourceId, a.startTime)}
                title="Jump to this moment"
                className="relative block aspect-video w-full bg-[#12100e]"
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
                  </svg>
                )}
                <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/65 px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-[#f5ead8]">
                  {formatTimeRange(a.startTime, a.endTime)}
                </span>
              </button>
              <div className="flex items-start gap-1.5 px-3 py-2.5">
                <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-sand-800 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
                  {a.content}
                </p>
                <button
                  onClick={() => void remove(a.noteId)}
                  disabled={busyId === a.noteId}
                  aria-label="Delete the annotation"
                  title="Delete the annotation"
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

"use client";

import { useEffect, useRef, useState } from "react";
import { useCollab } from "@/components/collab/collab-context";
import { SpinnerIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { api } from "@/lib/api";
import type { ContentsEntry } from "@/lib/contents";
import type { TranscriptLine } from "@/lib/video/types";

// The chapters of a media document (SPEC.md §26): the Chapters button in
// the media pane's view bar, and the list under it. Stored chapters list
// as jumps — a click seeks the player to the chapter's line; none stored:
// the ask and Generate chapters (an editor), which runs the one Jev pass
// (lib/video/chapters.ts). The list is fetched when the button opens.
export function ChaptersMenu({
  documentId,
  lines,
  onSeek,
}: {
  documentId: string;
  lines: TranscriptLine[];
  onSeek: (line: TranscriptLine) => void;
}) {
  const t = useT();
  const { canEdit } = useCollab();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState<ContentsEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Generate answered no chapters: the recording is too short to have any.
  const [none, setNone] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function load(generate: boolean) {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ parts: ContentsEntry[] }>(`/api/documents/${documentId}/contents`, "POST", generate ? { generate: true } : {});
      setParts(result.parts);
      if (generate && result.parts.length === 0) setNone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("video.chaptersFailed"));
    } finally {
      setBusy(false);
    }
  }

  const lineById = new Map(lines.map((l) => [l.id, l]));
  const shown = (parts ?? []).filter((p) => lineById.has(p.blockId));

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && parts === null && !busy) void load(false);
        }}
        data-track="chapters"
        aria-expanded={open}
        data-tip={t("video.chaptersTitle")}
        className={
          open
            ? "rounded-full bg-clay-100 px-3 py-1 text-[12px] font-semibold text-clay-800"
            : "rounded-full px-3 py-1 text-[12px] font-semibold text-sand-600 hover:bg-sand-100 hover:text-clay-800"
        }
      >
        {t("video.chapters")}
      </button>
      {open && (
        <div className="absolute top-full right-0 z-30 mt-1.5 w-[300px] max-w-[calc(100vw-24px)] rounded-2xl bg-card p-2 shadow-float">
          {busy && parts === null ? (
            <p className="flex items-center gap-1.5 px-2 py-1.5 text-[12px] text-sand-600">
              <SpinnerIcon size={12} className="motion-safe:animate-spin" />
              {t("video.chaptersGenerating")}
            </p>
          ) : shown.length > 0 ? (
            <ol className="flex max-h-72 flex-col overflow-y-auto">
              {shown.map((part) => {
                const line = lineById.get(part.blockId)!;
                const s = Math.floor(line.startTime);
                return (
                  <li key={part.blockId}>
                    <button
                      onClick={() => {
                        onSeek(line);
                        setOpen(false);
                      }}
                      data-track="chapter-jump"
                      className="flex w-full items-baseline gap-2 rounded-full px-2.5 py-1 text-left text-[12px] text-sand-800 hover:bg-clay-100 hover:text-clay-800"
                    >
                      <span className="shrink-0 tabular-nums text-sand-500">
                        {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
                      </span>
                      <span className="truncate">{part.title}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="flex flex-col gap-2 px-2 py-1.5">
              <p className="text-[12px] text-sand-700">
                {none ? t("video.chaptersNone") : !canEdit ? t("video.chaptersViewer") : t("video.chaptersAsk")}
              </p>
              {error && <p className="text-[11.5px] text-red-500">{error}</p>}
              {canEdit && !none && (
                <button
                  onClick={() => void load(true)}
                  disabled={busy}
                  data-track="chapters-generate"
                  className="flex items-center gap-1.5 self-start rounded-full bg-clay px-3 py-1 text-[11px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
                >
                  {busy && <SpinnerIcon size={11} className="motion-safe:animate-spin" />}
                  {busy ? t("video.chaptersGenerating") : t("video.chaptersGenerate")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

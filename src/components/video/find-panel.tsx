"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { useImeGuard } from "@/lib/ime";
import { SearchIcon, SpinnerIcon } from "@/components/icons";
import { useCollab } from "@/components/collab/collab-context";
import { useT } from "@/components/lang-provider";
import { ThinkingIndicator } from "@/components/thinking";
import { formatTimeRange, type VideoFindMatch } from "@/lib/video/types";

// Find (SPEC.md §11): the video content reader, front and center in the tool
// bar under the player. Ask for something; the model searches the timed
// transcript and each match renders as a card with a seek chip. "Add to notes"
// lands the match as a PENDING note with a time source — nothing enters notes
// without the user. `leading`/`trailing` slot the annotate button and the
// transcript status into the same bar, one unified surface.
export function FindPanel({
  notebookId,
  documentId,
  audio,
  hasTranscript,
  sectionChoices,
  onSeek,
  leading,
  trailing,
}: {
  notebookId: string;
  documentId: string;
  audio: boolean;
  hasTranscript: boolean;
  sectionChoices: { id: string; label: string }[];
  onSeek: (startTime: number, endTime: number) => void;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  const router = useRouter();
  const { canEdit } = useCollab();
  const t = useT();
  const ime = useImeGuard();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [matches, setMatches] = useState<VideoFindMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState<number | null>(null);
  // The running find, so Stop can abort it.
  const findAbortRef = useRef<AbortController | null>(null);
  function stopFind() {
    findAbortRef.current?.abort();
  }

  async function find() {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setMatches(null);
    setSaved(new Set());
    const controller = new AbortController();
    findAbortRef.current = controller;
    try {
      const res = await api<{ matches: VideoFindMatch[] }>(
        "/api/derive",
        "POST",
        { type: "FIND", documentId, notebookId, query: q },
        { signal: controller.signal },
      );
      setMatches(res.matches);
    } catch (err) {
      // Stopped, not failed: no matches, no error.
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : t("video.findFailed"));
    } finally {
      if (findAbortRef.current === controller) findAbortRef.current = null;
      setBusy(false);
    }
  }

  async function save(index: number, match: VideoFindMatch) {
    const section = sectionChoices[0];
    if (!section || saving !== null) return;
    setSaving(index);
    setError(null);
    try {
      await api("/api/notes", "POST", {
        sectionId: section.id,
        content: match.explanation,
        video: { documentId, startTime: match.startTime, endTime: match.endTime },
        origin: "find",
      });
      setSaved((prev) => new Set(prev).add(index));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("video.saveFailed"));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div>
      {/* The unified tool bar: circle and comment, Find, transcript status. */}
      <div className="flex items-center gap-2 rounded-2xl bg-card p-2 shadow-soft">
        {leading}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void find();
          }}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-sand-100 px-3.5 py-2"
        >
          <SearchIcon size={14} className="shrink-0 text-sand-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            {...ime.props}
            onKeyDown={(e) => {
              if (ime.isImeEnter(e)) e.preventDefault();
            }}
            placeholder={
              hasTranscript
                ? t(audio ? "video.findPlaceholderAudio" : "video.findPlaceholder")
                : t(
                    audio
                      ? "video.findPlaceholderNeedsTranscriptAudio"
                      : "video.findPlaceholderNeedsTranscript",
                  )
            }
            aria-label={t(audio ? "video.findAriaAudio" : "video.findAria")}
            disabled={!hasTranscript}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-sand-500 disabled:opacity-60"
          />
          {busy && <SpinnerIcon size={13} className="shrink-0 text-clay motion-safe:animate-spin" />}
        </form>
        {trailing}
      </div>

      {busy && (
        <p className="mt-2 px-1 text-xs">
          <ThinkingIndicator onStop={stopFind} />
        </p>
      )}
      {error && <p className="mt-2 px-1 text-xs text-red-500">{error}</p>}
      {matches !== null && matches.length === 0 && (
        <p className="mt-2 px-1 text-xs text-sand-600">
          {t(audio ? "video.findEmptyAudio" : "video.findEmpty")}
        </p>
      )}
      {matches !== null && matches.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-2">
          {matches.map((match, i) => (
            <div key={i} className="rounded-2xl bg-card p-3.5 shadow-soft">
              <button
                onClick={() => onSeek(match.startTime, match.endTime)}
                className="rounded-full bg-clay-100 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-clay-800 hover:bg-clay-200"
                title={t("video.jumpToPart")}
              >
                {formatTimeRange(match.startTime, match.endTime)}
              </button>
              <p className="mt-2 text-[13px] leading-relaxed text-sand-800">{match.explanation}</p>
              <p className="mt-1.5 text-[12px] leading-snug text-sand-500">“{match.quotedText}”</p>
              <div className="mt-2">
                {!canEdit ? null : saved.has(i) ? (
                  <span className="text-[11.5px] font-semibold text-sage-700">
                    {t("video.addedPending")}
                  </span>
                ) : (
                  <button
                    onClick={() => void save(i, match)}
                    disabled={saving !== null || sectionChoices.length === 0}
                    title={
                      sectionChoices.length === 0
                        ? t("video.addSectionFirst")
                        : t("video.addAsPendingNote", { section: sectionChoices[0].label })
                    }
                    className="rounded-full border border-line px-3 py-1 text-[11.5px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
                  >
                    {saving === i ? t("video.adding") : t("video.addToNotes")}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

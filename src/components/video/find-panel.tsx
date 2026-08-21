"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { SearchIcon, SpinnerIcon } from "@/components/icons";
import { formatTimeRange, type VideoFindMatch } from "@/lib/video/types";

// Find (SPEC.md §11): the video content reader. Ask for something; the model
// searches the timed transcript and each match renders as a card with a seek
// chip. "Add to notes" lands the match as a PENDING note with a time source —
// nothing enters notes without the user.
export function FindPanel({
  notebookId,
  documentId,
  hasTranscript,
  sectionChoices,
  onSeek,
}: {
  notebookId: string;
  documentId: string;
  hasTranscript: boolean;
  sectionChoices: { id: string; label: string }[];
  onSeek: (startTime: number, endTime: number) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [matches, setMatches] = useState<VideoFindMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState<number | null>(null);

  async function find() {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setMatches(null);
    setSaved(new Set());
    try {
      const res = await api<{ matches: VideoFindMatch[] }>("/api/derive", "POST", {
        type: "FIND",
        documentId,
        notebookId,
        query: q,
      });
      setMatches(res.matches);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Find failed");
    } finally {
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
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="shrink-0 border-b border-line p-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void find();
        }}
        className="flex items-center gap-2 rounded-full bg-sand-100 px-3.5 py-2"
      >
        <SearchIcon size={14} className="shrink-0 text-sand-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find in this video…"
          aria-label="Find in this video"
          disabled={!hasTranscript}
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-sand-500 disabled:opacity-60"
        />
        {busy && <SpinnerIcon size={13} className="shrink-0 text-clay motion-safe:animate-spin" />}
      </form>
      {!hasTranscript && (
        <p className="mt-2 px-1 text-xs text-sand-500">
          Transcribe first — Find searches the transcript.
        </p>
      )}
      {error && <p className="mt-2 px-1 text-xs text-red-500">{error}</p>}
      {matches !== null && matches.length === 0 && (
        <p className="mt-2 px-1 text-xs text-sand-600">Nothing in the video answers that.</p>
      )}
      {matches !== null && matches.length > 0 && (
        <div className="mt-2.5 flex max-h-[40vh] flex-col gap-2 overflow-y-auto">
          {matches.map((match, i) => (
            <div key={i} className="rounded-2xl bg-card p-3 shadow-soft">
              <button
                onClick={() => onSeek(match.startTime, match.endTime)}
                className="rounded-full bg-clay-100 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-clay-800 hover:bg-clay-200"
                title="Jump the player to this part"
              >
                {formatTimeRange(match.startTime, match.endTime)}
              </button>
              <p className="mt-2 text-[12.5px] leading-relaxed text-sand-800">
                {match.explanation}
              </p>
              <p className="mt-1.5 text-[11.5px] leading-snug text-sand-500">
                “{match.quotedText}”
              </p>
              <div className="mt-2">
                {saved.has(i) ? (
                  <span className="text-[11.5px] font-semibold text-sage-700">
                    Added — pending in Notes
                  </span>
                ) : (
                  <button
                    onClick={() => void save(i, match)}
                    disabled={saving !== null || sectionChoices.length === 0}
                    title={
                      sectionChoices.length === 0
                        ? "Add a section first"
                        : `Add as a pending note in ${sectionChoices[0].label}`
                    }
                    className="rounded-full border border-line px-3 py-1 text-[11.5px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
                  >
                    {saving === i ? "Adding…" : "Add to notes"}
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

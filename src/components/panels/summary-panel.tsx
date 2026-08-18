"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { splitStreamError } from "@/lib/derive/config";
import { SUMMARY_DEPTHS, type SummaryDepth, type SummaryLevels } from "@/lib/types";
import { Markdown } from "@/components/markdown";

const DEPTH_LABEL: Record<SummaryDepth, string> = {
  layman: "Layman",
  intermediate: "Intermediate",
  professional: "Professional",
};

const DEPTH_HINT: Record<SummaryDepth, string> = {
  layman: "Everyday words, no jargon",
  intermediate: "Field terms, specialized ones defined",
  professional: "The document's own terminology",
};

// Summary tab of the reader side panel. One summary per depth, persisted per
// notebook+document (SPEC.md §4); Summarize streams, Regenerate overwrites.
export function SummaryPanel({
  notebookId,
  documentId,
  initial,
}: {
  notebookId: string;
  documentId: string | null;
  initial: SummaryLevels;
}) {
  const router = useRouter();
  const [depth, setDepth] = useState<SummaryDepth>("layman");
  // Summaries generated in this session; the stored ones arrive via `initial`.
  const [texts, setTexts] = useState<SummaryLevels>({});
  const [streamingDepth, setStreamingDepth] = useState<SummaryDepth | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!documentId) {
    return <p className="text-[13px] text-sand-600">No document open. Summary needs one.</p>;
  }

  const summary = texts[depth] ?? initial[depth];
  const streaming = streamingDepth === depth;

  async function summarize() {
    if (!documentId || streamingDepth) return;
    const target = depth;
    setStreamingDepth(target);
    setError(null);
    setTexts((t) => ({ ...t, [target]: "" }));
    try {
      const res = await fetch("/api/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "SUMMARIZE", documentId, notebookId, depth: target }),
      });
      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? `Summarize failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let streamed = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        streamed += chunk;
        setTexts((t) => ({ ...t, [target]: (t[target] ?? "") + chunk }));
      }
      // A failure mid-stream arrives in-band; an empty stream is a failure too.
      const { text, error: streamError } = splitStreamError(streamed);
      if (streamError || !text.trim()) {
        throw new Error(streamError ?? "The model returned an empty response. Try again.");
      }
      setTexts((t) => ({ ...t, [target]: text }));
      router.refresh();
    } catch (err) {
      setTexts((t) => {
        const next = { ...t };
        delete next[target];
        return next;
      });
      setError(err instanceof Error ? err.message : "Summarize failed");
    } finally {
      setStreamingDepth(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex rounded-full bg-sand-200 p-1 text-[12px] font-semibold">
        {SUMMARY_DEPTHS.map((d) => (
          <button
            key={d}
            onClick={() => setDepth(d)}
            title={DEPTH_HINT[d]}
            aria-pressed={depth === d}
            className={`flex-1 rounded-full px-2 py-1 ${
              depth === d ? "bg-card text-clay-800 shadow-soft" : "text-sand-600 hover:text-clay-800"
            }`}
          >
            {DEPTH_LABEL[d]}
          </button>
        ))}
      </div>

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {summary === undefined ? (
        <div className="flex flex-col items-start gap-2.5 rounded-2xl bg-card p-3.5 shadow-soft">
          <p className="text-[13px] text-sand-600">
            No summary at this depth yet. {DEPTH_HINT[depth]}.
          </p>
          <button
            onClick={() => void summarize()}
            disabled={streamingDepth !== null}
            className="rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
          >
            {streamingDepth !== null ? "Summarizing…" : "Summarize"}
          </button>
        </div>
      ) : (
        <div className="rounded-2xl bg-card p-3.5 shadow-soft">
          {streaming && (
            <p className="mb-2 text-[11px] font-bold tracking-[0.08em] text-clay-800 uppercase">
              Summarizing…
            </p>
          )}
          {summary ? (
            <div className="text-[13px]">
              <Markdown>{summary}</Markdown>
            </div>
          ) : (
            <p className="text-sm text-sand-500">…</p>
          )}
          {!streaming && (
            <button
              onClick={() => void summarize()}
              disabled={streamingDepth !== null}
              className="mt-3 text-xs text-sand-600 hover:text-clay-700 disabled:opacity-40"
            >
              Regenerate
            </button>
          )}
        </div>
      )}
    </div>
  );
}

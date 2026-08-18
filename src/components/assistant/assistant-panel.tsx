"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { splitStreamError } from "@/lib/derive/config";
import type { SummaryDepth, SummaryLevels } from "@/lib/types";
import { Markdown } from "@/components/markdown";

type Scope = "selection" | "document" | "notebook" | "corpus";
type Task = "contradictions" | "gaps" | "unsourced";
type Issue = { noteIds: string[]; issue: string; explanation: string };
type SelectionDetail = {
  documentId: string;
  blockId: string;
  startOffset: number;
  endOffset: number;
  quotedText: string;
};

const SCOPES: { id: Scope; label: string }[] = [
  { id: "selection", label: "Selection" },
  { id: "document", label: "Document" },
  { id: "notebook", label: "Notebook" },
  { id: "corpus", label: "Corpus" },
];

// Recommended functions for the open document, in this order. Insiders
// Insights leads: industry-insider findings, honest when there are none.
const RECOMMENDED: { depth: SummaryDepth; label: string; hint: string }[] = [
  {
    depth: "insights",
    label: "Insiders Insights",
    hint: "Findings only an industry insider would catch — honest when there are none",
  },
  { depth: "layman", label: "Layman summary", hint: "The core of the document, in plain words" },
  {
    depth: "professional",
    label: "Professional summary",
    hint: "In the author's own industry wording",
  },
];

// One assistant panel with the Recommended functions and a scope control (SPEC.md §7).
export function AssistantPanel({
  notebookId,
  documentId,
  summaries,
}: {
  notebookId: string;
  documentId: string | null;
  summaries: SummaryLevels;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>("notebook");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [taskRun, setTaskRun] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionDetail | null>(null);
  // Recommended output: generated in this session, over the stored initials.
  const [recDepth, setRecDepth] = useState<SummaryDepth | null>(null);
  const [recTexts, setRecTexts] = useState<SummaryLevels>({});
  const [recBusy, setRecBusy] = useState<SummaryDepth | null>(null);
  const [recError, setRecError] = useState<string | null>(null);

  // The reader broadcasts the latest selection; Selection scope uses it.
  useEffect(() => {
    const onSelection = (e: Event) => {
      setSelection((e as CustomEvent<SelectionDetail>).detail);
    };
    window.addEventListener("dissect:selection", onSelection);
    return () => window.removeEventListener("dissect:selection", onSelection);
  }, []);

  function reset() {
    setAnswer("");
    setIssues(null);
    setTaskRun(null);
    setError(null);
  }

  // Recommended: open shows what exists; generating streams into the card.
  function openRecommended(depth: SummaryDepth) {
    if (recBusy) return;
    setRecDepth(depth);
    setRecError(null);
    if (!(recTexts[depth] ?? summaries[depth])) void generateRecommended(depth);
  }

  async function generateRecommended(depth: SummaryDepth) {
    if (!documentId || recBusy) return;
    setRecBusy(depth);
    setRecDepth(depth);
    setRecError(null);
    setRecTexts((t) => ({ ...t, [depth]: "" }));
    try {
      const res = await fetch("/api/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "SUMMARIZE", documentId, notebookId, depth }),
      });
      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let streamed = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        streamed += chunk;
        setRecTexts((t) => ({ ...t, [depth]: (t[depth] ?? "") + chunk }));
      }
      // A failure mid-stream arrives in-band; an empty stream is a failure too.
      const { text, error: streamError } = splitStreamError(streamed);
      if (streamError || !text.trim()) {
        throw new Error(streamError ?? "The model returned an empty response. Try again.");
      }
      setRecTexts((t) => ({ ...t, [depth]: text }));
      router.refresh();
    } catch (err) {
      setRecTexts((t) => {
        const next = { ...t };
        delete next[depth];
        return next;
      });
      setRecError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setRecBusy(null);
    }
  }

  async function ask() {
    const q = question.trim();
    if (!q || busy) return;
    reset();
    setBusy(true);
    try {
      const body: Record<string, unknown> = { notebookId, scope, task: "ask", question: q };
      if (scope === "document" || scope === "selection") {
        body.documentId = documentId;
        if (scope === "selection") {
          if (!selection || selection.documentId !== documentId) {
            throw new Error("Select text in the reader first.");
          }
          body.anchor = {
            blockId: selection.blockId,
            startOffset: selection.startOffset,
            endOffset: selection.endOffset,
          };
        }
      }
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? `Assistant failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setAnswer((a) => a + chunk);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assistant failed");
    } finally {
      setBusy(false);
    }
  }

  async function runTask(task: Task) {
    if (busy) return;
    reset();
    setBusy(true);
    setTaskRun(task);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notebookId, scope: "notebook", task }),
      });
      const json = (await res.json().catch(() => null)) as
        | { issues?: Issue[]; error?: string }
        | null;
      if (!res.ok) throw new Error(json?.error ?? `Task failed (${res.status})`);
      setIssues(json?.issues ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Task failed");
    } finally {
      setBusy(false);
    }
  }

  function showNote(noteId: string) {
    window.dispatchEvent(new CustomEvent("dissect:show-note", { detail: { noteId } }));
  }

  const recommendedShown = recDepth ? (recTexts[recDepth] ?? summaries[recDepth] ?? "") : "";
  const recommendedLabel = RECOMMENDED.find((r) => r.depth === recDepth)?.label ?? "";

  return (
    <div className="space-y-3">
      {documentId && (
        <div className="space-y-2">
          <span className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
            Recommended
          </span>
          <div className="flex flex-col gap-1.5">
            {RECOMMENDED.map((r) => (
              <button
                key={r.depth}
                onClick={() => openRecommended(r.depth)}
                disabled={recBusy !== null}
                aria-pressed={recDepth === r.depth}
                className={`rounded-2xl px-3.5 py-2 text-left shadow-soft disabled:opacity-60 ${
                  recDepth === r.depth
                    ? "bg-clay-100 text-clay-800"
                    : "bg-card text-sand-800 hover:bg-clay-100 hover:text-clay-800"
                }`}
              >
                <span className="flex items-center gap-2 text-[13px] font-semibold">
                  {r.label}
                  {recBusy === r.depth && (
                    <span className="inline-flex items-center gap-1">
                      <span className="loading-dot" />
                      <span className="loading-dot" />
                      <span className="loading-dot" />
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-sand-500">{r.hint}</span>
              </button>
            ))}
          </div>
          {recDepth && (recommendedShown || recError) && (
            <div className="rounded-2xl bg-card p-4 shadow-soft">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-bold tracking-[0.08em] text-clay-800 uppercase">
                  {recommendedLabel}
                </span>
                <button
                  onClick={() => void generateRecommended(recDepth)}
                  disabled={recBusy !== null}
                  className="text-xs text-sand-500 hover:text-clay-700 disabled:opacity-40"
                >
                  Regenerate
                </button>
              </div>
              {recError ? (
                <p className="text-sm text-red-600">{recError}</p>
              ) : (
                <div className="text-sm">
                  <Markdown>{recommendedShown}</Markdown>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        {SCOPES.map((s) => (
          <button
            key={s.id}
            onClick={() => setScope(s.id)}
            disabled={(s.id === "document" || s.id === "selection") && !documentId}
            className={`rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-40 ${
              scope === s.id
                ? "bg-ink text-paper"
                : "bg-card text-sand-600 shadow-soft hover:text-clay-800"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {scope === "selection" && (
        <p className="truncate text-xs text-sand-500">
          {selection ? `Selection: "${selection.quotedText.slice(0, 80)}"` : "Select text in the reader."}
        </p>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={
            scope === "corpus" ? "Have I read about…" : scope === "notebook" ? "Ask about your notes" : "Ask about this scope"
          }
          className="min-w-0 flex-1 rounded-full bg-card px-4 py-2 text-sm shadow-soft outline-none placeholder:text-sand-500"
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          className="rounded-full bg-clay px-4 py-2 text-sm font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
        >
          Ask
        </button>
      </form>

      {scope === "notebook" && (
        <div className="flex flex-wrap gap-1.5">
          {(["contradictions", "gaps", "unsourced"] as Task[]).map((task) => (
            <button
              key={task}
              onClick={() => void runTask(task)}
              disabled={busy}
              className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
            >
              {task === "contradictions" ? "Contradictions" : task === "gaps" ? "Gaps" : "Unsourced"}
            </button>
          ))}
        </div>
      )}

      {busy && !answer && <p className="text-xs text-sand-500">Working…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {answer && (
        <div className="rounded-2xl bg-card p-4 text-sm shadow-soft">
          <Markdown>{answer}</Markdown>
        </div>
      )}

      {issues && (
        <div className="space-y-2">
          {issues.length === 0 && (
            <p className="text-sm text-sand-600">No {taskRun} found. Clean.</p>
          )}
          {issues.map((issue, i) => (
            <div
              key={i}
              className="rounded-2xl bg-card p-3.5 shadow-soft outline-2 outline-clay-300"
            >
              <p className="text-sm font-semibold text-clay-800">{issue.issue}</p>
              <p className="mt-1 text-xs text-sand-600">{issue.explanation}</p>
              {issue.noteIds.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {issue.noteIds.map((id) => (
                    <button
                      key={id}
                      onClick={() => showNote(id)}
                      className="rounded-full bg-clay-100 px-2.5 py-0.5 text-xs font-semibold text-clay-800 hover:bg-clay-200"
                    >
                      note {id.slice(-6)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
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

// One assistant panel with a scope control (SPEC.md §7).
export function AssistantPanel({
  notebookId,
  documentId,
}: {
  notebookId: string;
  documentId: string | null;
}) {
  const [scope, setScope] = useState<Scope>("notebook");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [taskRun, setTaskRun] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionDetail | null>(null);

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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {SCOPES.map((s) => (
          <button
            key={s.id}
            onClick={() => setScope(s.id)}
            disabled={(s.id === "document" || s.id === "selection") && !documentId}
            className={`rounded-full px-2.5 py-1 text-xs disabled:opacity-40 ${
              scope === s.id
                ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                : "bg-neutral-100 text-neutral-600 hover:text-neutral-900 dark:bg-neutral-800 dark:text-neutral-300"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {scope === "selection" && (
        <p className="truncate text-xs text-neutral-500">
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
          className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
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
              className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:border-neutral-500 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300"
            >
              {task === "contradictions" ? "Contradictions" : task === "gaps" ? "Gaps" : "Unsourced"}
            </button>
          ))}
        </div>
      )}

      {busy && !answer && <p className="text-xs text-neutral-500">Working…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {answer && (
        <div className="rounded-md border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <Markdown>{answer}</Markdown>
        </div>
      )}

      {issues && (
        <div className="space-y-2">
          {issues.length === 0 && (
            <p className="text-sm text-neutral-500">No {taskRun} found. Clean.</p>
          )}
          {issues.map((issue, i) => (
            <div
              key={i}
              className="rounded-md border border-orange-200 bg-orange-50 p-2.5 dark:border-orange-900 dark:bg-neutral-900"
            >
              <p className="text-sm font-medium text-orange-900 dark:text-orange-300">{issue.issue}</p>
              <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{issue.explanation}</p>
              {issue.noteIds.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {issue.noteIds.map((id) => (
                    <button
                      key={id}
                      onClick={() => showNote(id)}
                      className="rounded-full border border-orange-300 px-2 py-0.5 text-xs text-orange-800 hover:bg-orange-100 dark:border-orange-800 dark:text-orange-300"
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

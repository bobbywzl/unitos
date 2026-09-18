"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useCollab } from "@/components/collab/collab-context";
import { SparkleIcon, StopIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { ThinkingIndicator } from "@/components/thinking";
import { runHeartbeat } from "@/lib/derive/heartbeat-client";
import { useImeGuard } from "@/lib/ime";
import type { GraphNode, StitchDocument, StitchResult } from "@/lib/types";
import { transcriptErrorKey } from "@/lib/video/types";

// Stitch (SPEC.md §22): the box at the foot of the graph, ready for any
// command across the project's documents — gather every passage on a
// topic, connect the passages that answer a question, find the
// contradictions, write a new page. The command reads the documents picked
// in the graph, or every document when none is picked: the box says which,
// lists the pick as chips, and Pick documents turns a node click into a
// pick. Every turn is one command; the reply says what was done, links
// await Accept under Recommended links, and a written page opens from
// Generated content. Under every reply, what was read of each document: a
// video or audio document reads as its transcript, and a document with
// nothing to read says why (the transcript still being written, or failed
// with the stored reason). The conversation is kept per project for the
// browser tab, so closing the graph and opening it again keeps it. The box
// folds to a pill so the canvas is clear.

type Turn = { role: "user" | "assistant"; content: string; result?: StitchResult };
const threads = new Map<string, Turn[]>();

const SUGGESTIONS = [
  "stitch.stitchSuggestGather",
  "stitch.stitchSuggestConnect",
  "stitch.stitchSuggestContradict",
  "stitch.stitchSuggestSynthesis",
] as const;

export function StitchBox({
  notebookId,
  nodes,
  selectedIds,
  picking,
  onPickingChange,
  onUnpick,
  onClearPick,
  onOpenDocument,
}: {
  notebookId: string;
  nodes: GraphNode[];
  // The documents picked in the graph; empty = every document.
  selectedIds: Set<string>;
  picking: boolean;
  onPickingChange: (picking: boolean) => void;
  onUnpick: (documentId: string) => void;
  onClearPick: () => void;
  onOpenDocument: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const ime = useImeGuard();
  const { canEdit } = useCollab();
  const [turns, setTurnsState] = useState<Turn[]>(() => threads.get(notebookId) ?? []);
  const [command, setCommand] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function setTurns(update: (turns: Turn[]) => Turn[]) {
    setTurnsState((prev) => {
      const next = update(prev);
      threads.set(notebookId, next);
      return next;
    });
  }

  // The newest turn stays in view.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [turns.length, running, open]);

  function stop() {
    abortRef.current?.abort();
  }

  async function send() {
    const text = command.trim();
    if (!text || running) return;
    setError(null);
    setCommand("");
    onPickingChange(false);
    // A turn with no text (an answer that was only links or a page) has
    // nothing for the model to read, and the route refuses an empty one.
    const history = turns
      .filter((turn) => turn.content.trim())
      .slice(-20)
      .map((turn) => ({ role: turn.role, content: turn.content }));
    setTurns((prev) => [...prev, { role: "user", content: text }]);
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await runHeartbeat<StitchResult>(
        `/api/notebooks/${notebookId}/stitch`,
        {
          command: text,
          history,
          ...(selectedIds.size > 0 ? { documentIds: [...selectedIds] } : {}),
        },
        controller.signal,
      );
      setTurns((prev) => [...prev, { role: "assistant", content: result.reply, result }]);
      // The graph's new curves and the generated list arrive with a refresh.
      if (result.linkCount > 0 || result.document) router.refresh();
    } catch (err) {
      // Stopped: the command stays in the thread and nothing more is stored.
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : t("common.requestFailed"));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setRunning(false);
    }
  }

  function suggest(key: (typeof SUGGESTIONS)[number]) {
    setCommand(t(key));
    inputRef.current?.focus();
  }

  function openDocument(documentId: string) {
    router.push(`/n/${notebookId}?doc=${documentId}`);
    onOpenDocument();
  }

  const picked = nodes.filter((n) => selectedIds.has(n.id));

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        data-track="stitch-expand"
        aria-label={t("stitch.stitchExpand")}
        data-tip={t("stitch.stitchTitle")}
        className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-paper shadow-float hover:bg-clay-800 print:hidden"
      >
        <SparkleIcon size={14} />
        {t("stitch.stitch")}
        {turns.length > 0 && (
          <span className="rounded-full bg-paper/20 px-1.5 text-[11px] tabular-nums">{turns.length}</span>
        )}
      </button>
    );
  }

  return (
    <div
      data-track-surface="sidebar"
      className="absolute bottom-4 left-1/2 z-20 flex w-[680px] max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col rounded-[22px] border border-line bg-card/95 shadow-float backdrop-blur-md print:hidden"
      role="region"
      aria-label={t("stitch.stitch")}
    >
      <div className="flex items-center gap-2 px-4 pt-3">
        <SparkleIcon size={15} className="shrink-0 text-clay" />
        <span className="font-display text-[16px]">{t("stitch.stitch")}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-sand-500">{t("stitch.stitchHint")}</span>
        {turns.length > 0 && !running && (
          <button
            onClick={() => setTurns(() => [])}
            data-track="stitch-new"
            className="shrink-0 rounded-full px-2.5 py-1 text-[11px] text-sand-600 hover:bg-clay-100 hover:text-clay-800"
          >
            {t("stitch.stitchNew")}
          </button>
        )}
        <button
          onClick={() => {
            setOpen(false);
            onPickingChange(false);
          }}
          data-track="stitch-collapse"
          aria-label={t("stitch.stitchCollapse")}
          data-tip={t("stitch.stitchCollapse")}
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
        >
          ✕
        </button>
      </div>

      {/* The scope: which documents the command reads. */}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 pt-2 text-[11px] text-sand-600">
          <span className="font-semibold text-sand-700">
            {picked.length > 0
              ? t("stitch.stitchScopePicked", { n: picked.length })
              : t("stitch.stitchScopeAll", { n: nodes.length })}
          </span>
          {picked.map((n) => (
            <button
              key={n.id}
              onClick={() => onUnpick(n.id)}
              data-track="stitch-unpick"
              data-tip={t("stitch.stitchUnpick", { title: n.title })}
              className="flex max-w-[200px] items-center gap-1 rounded-full bg-clay-100 px-2.5 py-0.5 text-clay-800 hover:bg-clay-200"
            >
              <span className="truncate">{n.title}</span>
              <span aria-hidden>✕</span>
            </button>
          ))}
          <button
            onClick={() => onPickingChange(!picking)}
            data-track="stitch-pick"
            aria-pressed={picking}
            data-tip={t("stitch.stitchPickTitle")}
            className={`rounded-full border px-2.5 py-0.5 hover:bg-clay-100 hover:text-clay-800 ${
              picking ? "border-clay bg-clay text-clay-fg hover:bg-clay-600 hover:text-clay-fg" : "border-line"
            }`}
          >
            {t(picking ? "stitch.stitchPickDone" : "stitch.stitchPick")}
          </button>
          {picked.length > 0 && (
            <button
              onClick={onClearPick}
              data-track="stitch-pick-clear"
              data-tip={t("stitch.stitchPickClearTitle")}
              className="rounded-full px-2 py-0.5 text-sand-500 hover:bg-clay-100 hover:text-clay-800"
            >
              {t("stitch.stitchPickClear")}
            </button>
          )}
        </div>
      )}

      {turns.length > 0 && (
        <div ref={bodyRef} className="flex max-h-[40vh] flex-col gap-2.5 overflow-y-auto px-4 pt-3">
          {turns.map((turn, i) =>
            turn.role === "user" ? (
              <p key={i} className="ml-auto max-w-[85%] rounded-2xl bg-sand-100 px-3.5 py-2 text-[13px] text-sand-800">
                {turn.content}
              </p>
            ) : (
              <div key={i} className="flex max-w-[92%] flex-col gap-1.5 text-[13px] text-sand-800">
                {turn.content && <Markdown>{turn.content}</Markdown>}
                {turn.result && <ResultLine result={turn.result} onOpen={openDocument} />}
              </div>
            ),
          )}
          {running && <ThinkingIndicator label={t("stitch.stitchRunning")} onStop={stop} stopLabel={t("stitch.stitchStop")} />}
        </div>
      )}

      {turns.length === 0 && canEdit && (
        <div className="flex flex-wrap gap-1.5 px-4 pt-3">
          {SUGGESTIONS.map((key) => (
            <button
              key={key}
              onClick={() => suggest(key)}
              data-track={`stitch-suggest:${key.replace("stitch.stitchSuggest", "").toLowerCase()}`}
              className="rounded-full bg-sand-100 px-3 py-1 text-[12px] text-sand-700 hover:bg-clay-100 hover:text-clay-800"
            >
              {t(key)}
            </button>
          ))}
        </div>
      )}

      {error && <p className="px-4 pt-2 text-xs text-red-500">{error}</p>}

      {canEdit ? (
        <form
          className="flex items-end gap-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={inputRef}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            {...ime.props}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !ime.isImeEnter(e)) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={t("stitch.stitchPlaceholder")}
            rows={1}
            aria-label={t("stitch.stitch")}
            className="min-h-[38px] flex-1 resize-none rounded-2xl bg-sand-100 px-4 py-2.5 text-sm outline-none placeholder:text-sand-500"
          />
          {running ? (
            <button
              type="button"
              onClick={stop}
              data-track="stitch-stop"
              className="flex h-[38px] items-center gap-1.5 rounded-full border border-line px-4 text-xs font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800"
            >
              <StopIcon size={12} />
              {t("stitch.stitchStop")}
            </button>
          ) : (
            <button
              type="submit"
              data-track="stitch-send"
              disabled={!command.trim()}
              className="h-[38px] rounded-full bg-clay px-5 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
            >
              {t("stitch.stitchSend")}
            </button>
          )}
        </form>
      ) : (
        <p className="px-4 py-3 text-xs text-sand-500">{t("stitch.stitchViewer")}</p>
      )}
    </div>
  );
}

// What one command stored — the links proposed, the page written, or
// nothing — and what was read of each document.
function ResultLine({ result, onOpen }: { result: StitchResult; onOpen: (id: string) => void }) {
  const t = useT();
  const readCount = result.documents.filter((d) => d.status === "read").length;
  const ran = readCount >= 2;
  return (
    <div className="flex flex-col gap-1 text-xs text-sand-600">
      {!ran && <p className="text-red-500">{t("stitch.stitchNotEnoughRead")}</p>}
      {ran && result.linkCount === 0 && !result.document && (
        <p className="text-sand-500">{t("stitch.stitchNothingStored")}</p>
      )}
      {result.linkCount > 0 && (
        <p>{t(result.linkCount === 1 ? "stitch.stitchLinksMade1" : "stitch.stitchLinksMadeN", { n: result.linkCount })}</p>
      )}
      {result.document && (
        <p className="flex items-center gap-2">
          <span>{t("stitch.stitchDocumentMade", { title: result.document.title })}</span>
          <button
            onClick={() => onOpen(result.document!.id)}
            data-track="stitch-open-document"
            data-tip={t("stitch.openGenerated")}
            className="rounded-full bg-clay px-3 py-0.5 text-[11px] font-semibold text-clay-fg hover:bg-clay-600"
          >
            {t("stitch.stitchOpenDocument")}
          </button>
        </p>
      )}
      <DocumentsRead documents={result.documents} readCount={readCount} />
    </div>
  );
}

// One row per document: what of it went to the model, or why nothing did.
function DocumentsRead({ documents, readCount }: { documents: StitchDocument[]; readCount: number }) {
  const t = useT();
  return (
    <div className="mt-0.5 flex flex-col gap-0.5">
      <p className="text-sand-500">{t("stitch.stitchDocumentsRead", { read: readCount, total: documents.length })}</p>
      <ul className="flex flex-col gap-0.5">
        {documents.map((d) => {
          const unread = d.status === "empty";
          return (
            <li key={d.id} className="flex min-w-0 gap-1.5">
              <span className="min-w-0 max-w-[45%] truncate text-sand-700" title={d.title}>
                {d.title}
              </span>
              <span className={`min-w-0 flex-1 ${unread ? "text-red-500" : "text-sand-500"}`}>
                {documentLine(d, t)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function documentLine(d: StitchDocument, t: ReturnType<typeof useT>): string {
  const unit = t(
    d.kind === "text"
      ? "stitch.stitchUnitText"
      : d.kind === "handwritten"
        ? "stitch.stitchUnitConverted"
        : "stitch.stitchUnitTranscript",
  );
  switch (d.status) {
    case "read":
      return t("stitch.stitchDocumentRead", { n: d.blocks, unit });
    case "empty":
      return emptyLine(d, t);
  }
}

// A stored transcription error is an English diagnostic; the known classes
// render in the UI language (lib/video/types.ts), the rest as stored.
function emptyLine(d: StitchDocument, t: ReturnType<typeof useT>): string {
  switch (d.reason) {
    case "transcriptPending":
      return t("stitch.stitchDocumentTranscriptPending");
    case "transcriptStale":
      return t("stitch.stitchDocumentTranscriptStale");
    case "transcriptFailed": {
      const key = d.detail ? transcriptErrorKey(d.detail) : null;
      return t("stitch.stitchDocumentTranscriptFailed", { detail: key ? t(key) : (d.detail ?? "") }).trim();
    }
    case "transcriptNone":
      return t("stitch.stitchDocumentTranscriptNone");
    case "conversionPending":
      return t("stitch.stitchDocumentConversionPending");
    case "conversionFailed":
      return t("stitch.stitchDocumentConversionFailed", { detail: d.detail ?? "" }).trim();
    case "conversionNone":
      return t("stitch.stitchDocumentConversionNone");
    default:
      return t("stitch.stitchDocumentNoText");
  }
}

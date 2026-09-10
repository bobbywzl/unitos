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
import type { StitchResult } from "@/lib/types";

// The Stitch assistant (SPEC.md §22): the box under a multi upload, ready
// for any command across the members — gather every passage on a topic,
// connect the passages that answer a question, find the contradictions,
// write a new page. Every turn is one command; the reply says what was
// done, links await Accept in the graph, and a written page opens from
// Generated content. The conversation is kept per multi upload for the
// browser tab, so leaving and coming back keeps it.

type Turn = { role: "user" | "assistant"; content: string; result?: StitchResult };
const threads = new Map<string, Turn[]>();

const SUGGESTIONS = [
  "multi.stitchSuggestGather",
  "multi.stitchSuggestConnect",
  "multi.stitchSuggestContradict",
  "multi.stitchSuggestSynthesis",
] as const;

export function StitchBox({
  notebookId,
  multiId,
  // Docked (the reader with a multi upload open): the box floats at the
  // bottom of the reader and folds to a pill. Inline (the multi upload
  // page): the box sits at the foot of the page, always open.
  docked = false,
}: {
  notebookId: string;
  multiId: string;
  docked?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const ime = useImeGuard();
  const { canEdit } = useCollab();
  const [turns, setTurnsState] = useState<Turn[]>(() => threads.get(multiId) ?? []);
  const [command, setCommand] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(!docked);
  const abortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function setTurns(update: (turns: Turn[]) => Turn[]) {
    setTurnsState((prev) => {
      const next = update(prev);
      threads.set(multiId, next);
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
    const history = turns.slice(-20).map((turn) => ({ role: turn.role, content: turn.content }));
    setTurns((prev) => [...prev, { role: "user", content: text }]);
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await runHeartbeat<StitchResult>(
        `/api/multi/${multiId}/stitch`,
        { command: text, history },
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

  const openHref = (documentId: string) => `/n/${notebookId}?doc=${documentId}&multi=${multiId}`;

  const shell = docked
    ? "fixed bottom-4 left-1/2 z-40 flex w-[680px] max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col rounded-[22px] border border-line bg-card/95 shadow-float backdrop-blur-md print:hidden"
    : "flex w-full flex-col rounded-[22px] border border-line bg-card shadow-soft";

  if (docked && !open) {
    return (
      <button
        onClick={() => setOpen(true)}
        data-track="stitch-expand"
        aria-label={t("multi.stitchExpand")}
        data-tip={t("multi.stitchTitle")}
        className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-paper shadow-float hover:bg-clay-800 print:hidden"
      >
        <SparkleIcon size={14} />
        {t("multi.stitch")}
        {turns.length > 0 && (
          <span className="rounded-full bg-paper/20 px-1.5 text-[11px] tabular-nums">{turns.length}</span>
        )}
      </button>
    );
  }

  return (
    <div data-track-surface="sidebar" className={shell} role="region" aria-label={t("multi.stitch")}>
      <div className="flex items-center gap-2 px-4 pt-3">
        <SparkleIcon size={15} className="shrink-0 text-clay" />
        <span className="font-display text-[16px]">{t("multi.stitch")}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-sand-500">{t("multi.stitchHint")}</span>
        {turns.length > 0 && !running && (
          <button
            onClick={() => setTurns(() => [])}
            data-track="stitch-new"
            className="shrink-0 rounded-full px-2.5 py-1 text-[11px] text-sand-600 hover:bg-clay-100 hover:text-clay-800"
          >
            {t("multi.stitchNew")}
          </button>
        )}
        {docked && (
          <button
            onClick={() => setOpen(false)}
            data-track="stitch-collapse"
            aria-label={t("multi.stitchCollapse")}
            data-tip={t("multi.stitchCollapse")}
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
          >
            ✕
          </button>
        )}
      </div>

      {turns.length > 0 && (
        <div ref={bodyRef} className={`flex flex-col gap-2.5 overflow-y-auto px-4 pt-3 ${docked ? "max-h-[40vh]" : "max-h-[60vh]"}`}>
          {turns.map((turn, i) =>
            turn.role === "user" ? (
              <p key={i} className="ml-auto max-w-[85%] rounded-2xl bg-sand-100 px-3.5 py-2 text-[13px] text-sand-800">
                {turn.content}
              </p>
            ) : (
              <div key={i} className="flex max-w-[92%] flex-col gap-1.5 text-[13px] text-sand-800">
                {turn.content && <Markdown>{turn.content}</Markdown>}
                {turn.result && <ResultLine result={turn.result} openHref={openHref} />}
              </div>
            ),
          )}
          {running && <ThinkingIndicator label={t("multi.stitchRunning")} onStop={stop} stopLabel={t("multi.stitchStop")} />}
        </div>
      )}

      {turns.length === 0 && canEdit && (
        <div className="flex flex-wrap gap-1.5 px-4 pt-3">
          {SUGGESTIONS.map((key) => (
            <button
              key={key}
              onClick={() => suggest(key)}
              data-track={`stitch-suggest:${key.replace("multi.stitchSuggest", "").toLowerCase()}`}
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
            placeholder={t("multi.stitchPlaceholder")}
            rows={docked ? 1 : 2}
            aria-label={t("multi.stitch")}
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
              {t("multi.stitchStop")}
            </button>
          ) : (
            <button
              type="submit"
              data-track="stitch-send"
              disabled={!command.trim()}
              className="h-[38px] rounded-full bg-clay px-5 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
            >
              {t("multi.stitchSend")}
            </button>
          )}
        </form>
      ) : (
        <p className="px-4 py-3 text-xs text-sand-500">{t("multi.stitchViewer")}</p>
      )}
    </div>
  );
}

// What one command stored: the links proposed, the page written, or nothing.
function ResultLine({ result, openHref }: { result: StitchResult; openHref: (id: string) => string }) {
  const t = useT();
  const router = useRouter();
  if (result.linkCount === 0 && !result.document) {
    return <p className="text-xs text-sand-500">{t("multi.stitchNothingStored")}</p>;
  }
  return (
    <div className="flex flex-col gap-1 text-xs text-sand-600">
      {result.linkCount > 0 && (
        <p>{t(result.linkCount === 1 ? "multi.stitchLinksMade1" : "multi.stitchLinksMadeN", { n: result.linkCount })}</p>
      )}
      {result.document && (
        <p className="flex items-center gap-2">
          <span>{t("multi.stitchDocumentMade", { title: result.document.title })}</span>
          <button
            onClick={() => router.push(openHref(result.document!.id))}
            data-track="stitch-open-document"
            data-tip={t("multi.openGenerated")}
            className="rounded-full bg-clay px-3 py-0.5 text-[11px] font-semibold text-clay-fg hover:bg-clay-600"
          >
            {t("multi.stitchOpenDocument")}
          </button>
        </p>
      )}
    </div>
  );
}

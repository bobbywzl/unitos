"use client";

import { useState, useSyncExternalStore } from "react";
import type { ChatTurn } from "@/lib/conversation";
import { annotationKindColor } from "@/lib/annotations/kind";
import { useT } from "@/components/lang-provider";
import { SparkleIcon } from "@/components/icons";
import { ThinkingIndicator } from "@/components/thinking";

// The assistant's suggestions (SPEC.md §29): the row under a command's turn,
// in the reader's chat card and in the assistant panel. The reader that
// lands a command's suggestions publishes the run here by its key and the
// row reads it, so the panel's row follows a run another tree holds and
// keeps its count once that page closes.

export type SuggestRun = {
  running: boolean;
  /** The command's suggestions still in the text. */
  count: number;
  /** Why changes did not land, in the reader's language. */
  skipped: string[];
  summary: string;
  /** What the reader should know about the run: a failure, a cap. */
  notes: string[];
  /** The page that holds the run, while it is open. */
  act?: { stop: () => void; review: () => void; settle: (accept: boolean) => void };
};

const runs = new Map<string, SuggestRun>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export function publishSuggestRun(key: string, run: SuggestRun): void {
  runs.set(key, run);
  for (const listener of listeners) listener();
}

export const hasSuggestRun = (key: string): boolean => runs.has(key);

/** The panel's command over the open document: its reader takes it by the
    document id, runs it, and publishes the run under `key`. */
export const SUGGEST_EVENT = "dissect:assistant-suggest";
export type SuggestRequest = {
  documentId: string;
  key: string;
  /** The reader's message, and what the assistant's answer asks of it. */
  command: string;
  instruction: string;
  blockIds?: string[];
  /** The answer, which the command may ask to use. */
  material: string;
  history: ChatTurn[];
};

export function SuggestionRow({ runKey, withSummary = false }: { runKey: string; withSummary?: boolean }) {
  const t = useT();
  const run = useSyncExternalStore(subscribe, () => runs.get(runKey), () => undefined);
  const [reasonsOpen, setReasonsOpen] = useState(false);
  if (!run) return null;
  const { act, count } = run;
  const counted =
    count === 0
      ? t("docsSuggest.noSuggestions")
      : count === 1
        ? t("docsSuggest.oneSuggestion")
        : t("docsSuggest.suggestionCount", { n: count });
  const button = "rounded-full bg-sand-100 px-2.5 py-0.5 font-semibold text-sand-700 hover:bg-sand-200";
  return (
    <div className="mt-2 flex flex-col gap-1.5 text-[12px] text-sand-600">
      {withSummary && run.summary && <p className="text-[13px] text-sand-800">{run.summary}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {run.running ? (
          <ThinkingIndicator label={t("assistant.suggestWriting")} onStop={act?.stop} className="mr-1" />
        ) : (
          <span style={{ color: annotationKindColor("assistant", null) }}>
            <SparkleIcon size={12} />
          </span>
        )}
        {(count > 0 || !run.running) && <span className="mr-1 font-semibold text-sand-700">{counted}</span>}
        {act && count > 0 && (
          <>
            <button
              type="button"
              onClick={act.review}
              data-track="assistant-suggestions:review"
              data-tip={t("assistant.suggestReviewTitle")}
              className={button}
            >
              {t("assistant.suggestReview")}
            </button>
            <button
              type="button"
              onClick={() => act.settle(true)}
              data-track="assistant-suggestions:accept-all"
              data-tip={t("assistant.suggestAcceptAllTitle")}
              className={button}
            >
              {t("docsSuggest.acceptAll")}
            </button>
            <button
              type="button"
              onClick={() => act.settle(false)}
              data-track="assistant-suggestions:reject-all"
              data-tip={t("assistant.suggestRejectAllTitle")}
              className={button}
            >
              {t("docsSuggest.rejectAll")}
            </button>
          </>
        )}
      </div>
      {run.skipped.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setReasonsOpen((open) => !open)}
            aria-expanded={reasonsOpen}
            data-tip={t("assistant.suggestSkippedTitle")}
            className="font-semibold text-sand-500 hover:text-clay-800"
          >
            {t("assistant.suggestSkipped", { n: run.skipped.length })} {reasonsOpen ? "▴" : "▾"}
          </button>
          {reasonsOpen && (
            <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4 text-[11.5px] text-sand-600">
              {run.skipped.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {run.notes.map((note, i) => (
        <p key={i} className="text-[11.5px] font-medium text-amber-700 dark:text-amber-400">
          ⚠ {note}
        </p>
      ))}
    </div>
  );
}

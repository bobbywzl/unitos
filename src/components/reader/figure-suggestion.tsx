"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SparkleIcon } from "@/components/icons";
import { CheckIcon, CloseIcon } from "@/components/docs/icons";
import { useT } from "@/components/lang-provider";
import { annotationKindColor } from "@/lib/annotations/kind";
import type { AssistantAction } from "@/lib/types";

// Words from a figure (SPEC.md §7): on a document without rich text, the
// words the assistant read from a figure and was asked to put under it are
// the assistant's suggestion, drawn under the figure in the assistant's kind
// color until the reader accepts (✓) or rejects (✕) it. Nothing is written
// before Accept: Accept runs the insert_paragraph actions through the plan's
// own runner (reader-interactions.tsx), with its Undo. The reader that holds
// the plan publishes the suggestion here by the figure's block id; the
// figure's row in the article reads it.

type InsertAction = Extract<AssistantAction, { type: "insert_paragraph" }>;

export type FigureSuggestion = {
  actions: InsertAction[];
  /** Accept runs the actions and resolves true once they ran; Reject drops them. */
  settle: (accept: boolean) => Promise<boolean>;
};

const suggestions = new Map<string, FigureSuggestion>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const keyOf = (documentId: string, blockId: string) => `${documentId}:${blockId}`;

/** The figure's suggestion, or none (null). A new one takes the old one's place. */
export function publishFigureSuggestion(documentId: string, blockId: string, suggestion: FigureSuggestion | null): void {
  const key = keyOf(documentId, blockId);
  if (suggestion) suggestions.set(key, suggestion);
  else suggestions.delete(key);
  for (const listener of listeners) listener();
}

/** The actions of a plan that put words under a figure, by figure, and the rest. */
export function splitFigureSuggestions(
  actions: AssistantAction[],
  isFigure: (blockId: string) => boolean,
): { byFigure: Map<string, InsertAction[]>; rest: AssistantAction[] } {
  const byFigure = new Map<string, InsertAction[]>();
  const rest: AssistantAction[] = [];
  for (const action of actions) {
    if (action.type === "insert_paragraph" && action.afterBlockId && isFigure(action.afterBlockId)) {
      byFigure.set(action.afterBlockId, [...(byFigure.get(action.afterBlockId) ?? []), action]);
    } else rest.push(action);
  }
  return { byFigure, rest };
}

/** One action's words as the article will draw them: a list's lines with their markers. */
function linesOf(action: InsertAction): { text: string; heading: boolean }[] {
  const lines = action.text.split("\n").map((l) => l.trim()).filter(Boolean);
  const heading = action.kind === "h1" || action.kind === "h2" || action.kind === "h3";
  if (action.kind === "list") return lines.map((l) => ({ text: `• ${l.replace(/^(?:[-*+•]|\d+[.)])\s+/, "")}`, heading }));
  if (action.kind === "numbered") return lines.map((l, i) => ({ text: `${i + 1}. ${l.replace(/^(?:[-*+•]|\d+[.)])\s+/, "")}`, heading }));
  return [{ text: lines.join(" "), heading }];
}

export function FigureSuggestionCard({ documentId, blockId }: { documentId: string; blockId: string }) {
  const t = useT();
  const key = keyOf(documentId, blockId);
  const suggestion = useSyncExternalStore(subscribe, () => suggestions.get(key), () => undefined);
  const [busy, setBusy] = useState(false);
  // A new suggestion comes into view: the card that answered says it is
  // here (TOOL13-04).
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (suggestion) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [suggestion]);
  if (!suggestion) return null;
  const color = annotationKindColor("assistant", null);
  const settle = async (accept: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const done = await suggestion.settle(accept);
      // A failed Accept keeps the suggestion, so the words are not lost.
      if (done && suggestions.get(key) === suggestion) publishFigureSuggestion(documentId, blockId, null);
    } finally {
      setBusy(false);
    }
  };
  const button =
    "flex size-7 items-center justify-center rounded-full bg-card text-sand-700 shadow-soft hover:text-clay-800 disabled:opacity-40";
  return (
    <div
      ref={ref}
      data-figure-suggestion={blockId}
      role="group"
      aria-label={t("docsSuggest.suggestion")}
      className="pop-in my-3 rounded-2xl border-l-[3px] bg-sand-100 py-2 pr-2 pl-3"
      style={{ borderLeftColor: color }}
    >
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold" style={{ color }}>
        <SparkleIcon size={12} />
        <span>{t("docsSuggest.suggestion")}</span>
        {/* Beside the label, not at the far edge: a card docked beside the
            article covers the column's right side. */}
        <span className="ml-2 flex items-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => void settle(true)}
            data-track="figure-suggestion-accept"
            aria-label={t("docsSuggest.acceptSuggestion")}
            data-tip={t("docsSuggest.acceptSuggestion")}
            className={button}
          >
            <CheckIcon size={16} />
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void settle(false)}
            data-track="figure-suggestion-reject"
            aria-label={t("docsSuggest.rejectSuggestion")}
            data-tip={t("docsSuggest.rejectSuggestion")}
            className={button}
          >
            <CloseIcon size={16} />
          </button>
        </span>
      </div>
      {suggestion.actions.map((action, i) => (
        <div key={i} className="mt-1 text-[14px] leading-relaxed" style={{ color }}>
          {linesOf(action).map((line, j) => (
            <p key={j} className={line.heading ? "font-semibold" : undefined}>
              {line.text}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

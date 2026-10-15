"use client";

import type { Editor } from "@tiptap/react";
import { createPortal } from "react-dom";
import { focusSuggestion, readSuggestions, settleSuggestions } from "@/components/docs/ext/suggest";
import { CloseIcon, ExpandLessIcon, ExpandMoreIcon } from "@/components/docs/icons";
import { whyOf } from "@/components/docs/suggest/assistant";
import { describe } from "@/components/docs/suggest/card";
import { DialogButton } from "@/components/docs/toolbar/dialog";
import { useT } from "@/components/lang-provider";

// Review suggested edits (SPEC.md §29): Google Docs' box under the toolbar,
// on every suggestion or on one command's of the assistant. The assistant's
// run opens it on its own when its suggestions land: the box names the run,
// shows the change the caret is in with its why and Accept and Reject for
// it, keeps Accept all and Reject all, and says why a change did not land.

export function ReviewPanel({
  editor,
  header,
  ids,
  scoped,
  at,
  canSettle,
  onClose,
  summary,
  skipped,
  assistant,
}: {
  editor: Editor;
  /** The page editor's header: the box hangs from its bottom edge. */
  header: HTMLElement;
  /** The suggestions it reviews, in the order of the text, and the one the
      caret is in. */
  ids: string[];
  /** Some suggestions, not every one: Accept all and Reject all settle them alone. */
  scoped: boolean;
  at: string | null;
  canSettle: boolean;
  onClose: () => void;
  /** The assistant's run: what it says it changed. */
  summary?: string;
  /** Why some of its changes did not land. */
  skipped?: readonly string[];
  assistant?: boolean;
}) {
  const t = useT();
  const current = at && ids.includes(at) ? (readSuggestions(editor.state.doc).find((s) => s.id === at) ?? null) : null;
  const why = current ? whyOf(current.id) : undefined;
  const skippedList = skipped ?? [];
  const step = (direction: 1 | -1) => {
    const index = at ? ids.indexOf(at) : direction === 1 ? -1 : 0;
    const next = ids[(index + direction + ids.length) % ids.length];
    if (next) focusSuggestion(editor, next);
  };
  const none = ids.length === 0;
  const buttons = [
    { label: t("docsSuggest.previousSuggestion"), icon: <ExpandLessIcon />, run: () => step(-1), off: none },
    { label: t("docsSuggest.nextSuggestion"), icon: <ExpandMoreIcon />, run: () => step(1), off: none },
    { label: t("docs.close"), icon: <CloseIcon />, run: onClose, off: false },
  ];
  return createPortal(
    <div
      role="dialog"
      aria-label={t("docsSuggest.reviewSuggestedEdits")}
      className="docs-suggest-review"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="docs-suggest-review-head">
        <span className="docs-suggest-review-count" aria-live="polite">
          {assistant ? `${t("docsSuggest.assistantSuggestions")} · ` : ""}
          {none
            ? t("docsSuggest.noSuggestions")
            : ids.length === 1
              ? t("docsSuggest.oneSuggestion")
              : t("docsSuggest.suggestionCount", { n: ids.length })}
        </span>
        {buttons.map((b) => (
          <button
            key={b.label}
            type="button"
            disabled={b.off}
            aria-label={b.label}
            data-tip={b.label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={b.run}
            className="docs-comment-button"
          >
            {b.icon}
          </button>
        ))}
      </div>
      {summary && <p className="docs-suggest-review-summary">{summary}</p>}
      {none && skippedList.length > 0 && <p className="docs-suggest-review-summary">{t("docsSuggest.noneLanded")}</p>}
      {current && (
        <div className="docs-suggest-review-current" onMouseDown={(e) => e.preventDefault()}>
          <div className="docs-suggest-review-change">
            {describe(current, t).map((line, i) => (
              <span key={i}>{line} </span>
            ))}
          </div>
          {why && <div className="docs-suggest-review-why">{why}</div>}
          {canSettle && (
            <div className="docs-suggest-review-actions">
              <DialogButton onClick={() => settleSuggestions(editor, true, current.id)}>{t("docsSuggest.acceptSuggestion")}</DialogButton>
              <DialogButton onClick={() => settleSuggestions(editor, false, current.id)}>{t("docsSuggest.rejectSuggestion")}</DialogButton>
            </div>
          )}
        </div>
      )}
      {canSettle && !none && (
        // The page keeps the focus: Ctrl+Z then takes the settling back.
        <div className="docs-suggest-review-actions" onMouseDown={(e) => e.preventDefault()}>
          <DialogButton onClick={() => settleSuggestions(editor, true, scoped ? ids : undefined)}>{t("docsSuggest.acceptAll")}</DialogButton>
          <DialogButton onClick={() => settleSuggestions(editor, false, scoped ? ids : undefined)}>{t("docsSuggest.rejectAll")}</DialogButton>
        </div>
      )}
      {skippedList.length > 0 && (
        <details className="docs-suggest-review-skipped">
          <summary>{t("assistant.suggestSkipped", { n: skippedList.length })}</summary>
          <ul>
            {skippedList.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </details>
      )}
    </div>,
    header,
  );
}

"use client";

import { selectSuggestion } from "@handlewithcare/prosemirror-suggest-changes";
import { useEditorState, type Editor } from "@tiptap/react";
import { createPortal } from "react-dom";
import { settleSuggestions, suggestionAt, suggestionIds } from "@/components/docs/ext/suggest";
import { CloseIcon, ExpandLessIcon, ExpandMoreIcon } from "@/components/docs/icons";
import { DialogButton } from "@/components/docs/toolbar/dialog";
import { useT } from "@/components/lang-provider";

// Review suggested edits (SPEC.md §29), Google Docs' box at the top right
// under the toolbar: how many suggestions the document holds, the previous
// and the next one (the caret goes to it and its card opens), and, for an
// editor, Accept all and Reject all.

export function ReviewPanel({
  editor,
  header,
  canSettle,
  onClose,
}: {
  editor: Editor;
  /** The page editor's header: the box hangs from its bottom edge. */
  header: HTMLElement;
  canSettle: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const { ids, at } = useEditorState({
    editor,
    selector: ({ editor: e }) => ({ ids: suggestionIds(e.state.doc), at: suggestionAt(e.state) }),
  });
  const step = (direction: 1 | -1) => {
    const index = at ? ids.indexOf(at) : direction === 1 ? -1 : 0;
    const next = ids[(index + direction + ids.length) % ids.length];
    if (next && selectSuggestion(next)(editor.state, (tr) => editor.view.dispatch(tr))) editor.view.focus();
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
      {canSettle && !none && (
        <div className="docs-suggest-review-actions">
          <DialogButton onClick={() => settleSuggestions(editor, true)}>{t("docsSuggest.acceptAll")}</DialogButton>
          <DialogButton onClick={() => settleSuggestions(editor, false)}>{t("docsSuggest.rejectAll")}</DialogButton>
        </div>
      )}
    </div>,
    header,
  );
}

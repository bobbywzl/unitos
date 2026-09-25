"use client";

import { useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useReducer, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/lang-provider";
import { MoreVertIcon, UndoIcon } from "@/components/docs/icons";
import { keepFocus } from "@/components/docs/menu";
import { TYPING_EVENT, fireTyping } from "@/components/docs/typing/events";
import { traceAtCaret, undoCorrection } from "@/components/docs/typing/trace";

// The autocorrect bubble (SPEC.md §29, typing): with the caret on a word
// Docs corrected, a small bubble under it offers Undo — the word goes back
// and is never corrected again — and More options: stop correcting the
// word, or open Tools > Preferences.

export function AutocorrectBubble({ editor }: { editor: Editor }) {
  const t = useT();
  const [menu, setMenu] = useState(false);
  const trace = useEditorState({
    editor,
    selector: ({ editor: e }) => (e.isEditable ? traceAtCaret(e.state) : null),
    equalityFn: (a, b) => a?.from === b?.from && a?.to === b?.to && a?.original === b?.original,
  });
  // The bubble follows its word when the page scrolls.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!trace) return;
    window.addEventListener("scroll", rerender, true);
    window.addEventListener("resize", rerender);
    return () => {
      window.removeEventListener("scroll", rerender, true);
      window.removeEventListener("resize", rerender);
    };
  }, [trace]);
  const [lastTrace, setLastTrace] = useState(trace);
  if (lastTrace !== trace) {
    setLastTrace(trace);
    setMenu(false);
  }
  if (!trace || typeof document === "undefined") return null;
  let box: { left: number; top: number };
  try {
    const c = editor.view.coordsAtPos(trace.from);
    box = { left: c.left, top: c.bottom + 6 };
  } catch {
    return null;
  }
  const undo = () => undoCorrection(editor.view, trace);
  return createPortal(
    <div
      className="docs-ac-bubble"
      style={{ left: box.left, top: box.top }}
      data-edit-control
      data-docs-typing
      onMouseDown={keepFocus}
      onMouseUp={(e) => e.stopPropagation()}
    >
      <span className="docs-sr-only" aria-live="polite">
        {t("docsTyping.autocorrectedTo", { word: trace.fixed })}
      </span>
      <button type="button" className="docs-find-btn" aria-label={t("docsTyping.undoAutocorrect")} data-tip={t("docsTyping.undoAutocorrect")} onClick={undo}>
        <UndoIcon size={18} />
      </button>
      <button
        type="button"
        className="docs-find-btn"
        aria-label={t("docsTyping.moreOptions")}
        aria-haspopup="menu"
        aria-expanded={menu}
        data-tip={menu ? undefined : t("docsTyping.moreOptions")}
        onClick={() => setMenu((m) => !m)}
      >
        <MoreVertIcon size={18} />
      </button>
      {menu && (
        <div role="menu" className="docs-ac-menu">
          <button type="button" role="menuitem" className="docs-wc-item" onClick={undo}>
            {t("docsTyping.stopCorrecting", { word: trace.original })}
          </button>
          <button
            type="button"
            role="menuitem"
            className="docs-wc-item"
            onClick={() => {
              setMenu(false);
              fireTyping(TYPING_EVENT.preferences);
            }}
          >
            {t("docsTyping.autocorrectOptions")}
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}

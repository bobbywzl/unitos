"use client";

import { useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/lang-provider";
import { MoreVertIcon, UndoIcon } from "@/components/docs/icons";
import { DropdownPanel, keepFocus, MenuItem } from "@/components/docs/menu";
import { TYPING_EVENT, fireTyping } from "@/components/docs/typing/events";
import { traceAtCaret, undoCorrection } from "@/components/docs/typing/trace";

// The autocorrect bubble (SPEC.md §29, typing): with the caret on a word
// Docs corrected, a small bubble under it offers Undo — the word goes back
// and is never corrected again — and More options: stop correcting the
// word, or open Tools > Preferences.

export function AutocorrectBubble({ editor }: { editor: Editor }) {
  const t = useT();
  const [menu, setMenu] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const trace = useEditorState({ editor, selector: ({ editor: e }) => (e.isEditable ? traceAtCaret(e.state) : null) });
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
    <div className="docs-ac-bubble" style={box} data-edit-control data-docs-typing onMouseDown={keepFocus} onMouseUp={(e) => e.stopPropagation()}>
      <span className="sr-only" aria-live="polite">
        {t("docsTyping.autocorrectedTo", { word: trace.fixed })}
      </span>
      <button type="button" className="docs-icon-btn" aria-label={t("docs.undo")} data-tip={t("docs.undo")} onClick={undo}>
        <UndoIcon size={18} />
      </button>
      <button
        ref={moreRef}
        type="button"
        className="docs-icon-btn"
        aria-label={t("docsTyping.moreOptions")}
        aria-haspopup="menu"
        aria-expanded={menu}
        data-tip={menu ? undefined : t("docsTyping.moreOptions")}
        onClick={() => setMenu((m) => !m)}
      >
        <MoreVertIcon size={18} />
      </button>
      <DropdownPanel open={menu} anchorRef={moreRef} onClose={() => setMenu(false)} className="docs-menu-plain">
        <MenuItem onSelect={undo}>{t("docsTyping.stopCorrecting", { word: trace.original })}</MenuItem>
        <MenuItem
          onSelect={() => {
            setMenu(false);
            fireTyping(TYPING_EVENT.preferences);
          }}
        >
          {t("docsTyping.autocorrectOptions")}
        </MenuItem>
      </DropdownPanel>
    </div>,
    document.body,
  );
}

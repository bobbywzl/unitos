"use client";

import { useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/lang-provider";
import { CloseIcon, ExpandLessIcon, ExpandMoreIcon, MoreVertIcon } from "@/components/docs/icons";
import { keepFocus } from "@/components/docs/menu";
import { DialogButton } from "@/components/docs/toolbar/dialog";
import { findState, replaceAll, replaceResult, searchFrom, stepResult, type FindOptions } from "@/components/docs/typing/find";

// The find bar (Ctrl+F) and the Find and replace dialog (Ctrl+H), Google
// Docs' own (SPEC.md §29, typing). The bar floats at the top right under the
// toolbar: a 208 px field with "N of M" inside it, Previous, Next, More
// options, and Close. Esc closes it and leaves the current result selected.

export type FindMode = "bar" | "dialog" | null;

/** The search as the plugin holds it, re-read on every transaction. */
function useFind(editor: Editor) {
  return useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const f = findState(e.state);
      return { open: f.open, query: f.query, options: f.options, count: f.results.length, current: f.current };
    },
    equalityFn: (a, b) =>
      !!b &&
      a.open === b.open &&
      a.query === b.query &&
      a.count === b.count &&
      a.current === b.current &&
      a.options.matchCase === b.options.matchCase &&
      a.options.regex === b.options.regex &&
      a.options.ignoreDiacritics === b.options.ignoreDiacritics,
  });
}

function Counter({ count, current, query }: { count: number; current: number; query: string }) {
  const t = useT();
  if (!query) return null;
  return (
    <span className="docs-find-counter" aria-live="polite">
      {t("docsTyping.resultOf", { n: count ? current + 1 : 0, total: count })}
    </span>
  );
}

/** Where the bar sits: under the page editor's header, 44 px from its right edge. */
function useBarPosition(editor: Editor, open: boolean) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const shell = editor.view.dom.closest<HTMLElement>("[data-docs-editor]");
    const header = shell?.querySelector<HTMLElement>(".docs-header");
    if (!shell) return;
    const measure = () => {
      const s = shell.getBoundingClientRect();
      const h = header?.getBoundingClientRect();
      setPos({ top: Math.max(8, (h ? h.bottom : s.top) + 4), right: Math.max(8, window.innerWidth - s.right + 44) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    if (header) observer.observe(header);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [editor, open]);
  return pos;
}

export function FindBar({
  editor,
  open,
  focusToken,
  onClose,
  onMore,
}: {
  editor: Editor;
  open: boolean;
  /** Changes each time the bar is asked to take focus (Ctrl+F again). */
  focusToken: number;
  onClose: () => void;
  onMore: () => void;
}) {
  const t = useT();
  const find = useFind(editor);
  const inputRef = useRef<HTMLInputElement>(null);
  const pos = useBarPosition(editor, open);
  const [draft, setDraft] = useState(find.query);
  const [prevQuery, setPrevQuery] = useState(find.query);
  if (prevQuery !== find.query) {
    setPrevQuery(find.query);
    setDraft(find.query);
  }

  const placed = pos !== null;
  useEffect(() => {
    if (!open || !placed) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [open, focusToken, placed]);

  if (!open || typeof document === "undefined") return null;
  const view = editor.view;
  const search = (query: string) => {
    setDraft(query);
    searchFrom(view, { query });
  };
  const none = find.count === 0;
  return createPortal(
    <div
      role="search"
      className="docs-findbar"
      style={pos ? { top: pos.top, right: pos.right } : { visibility: "hidden" }}
      data-edit-control
      data-docs-typing
      onMouseUp={(e) => e.stopPropagation()}
    >
      <div className="docs-find-field">
        <input
          ref={inputRef}
          value={draft}
          placeholder={t("docsTyping.findInDocument")}
          aria-label={t("docsTyping.findInDocument")}
          onChange={(e) => search(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              stepResult(view, e.shiftKey ? -1 : 1);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
          }}
          className="docs-find-input"
          spellCheck={false}
        />
        <Counter count={find.count} current={find.current} query={find.query} />
      </div>
      <div className="docs-find-buttons">
        <button
          type="button"
          className="docs-find-btn"
          aria-label={t("docsTyping.previous")}
          data-tip={t("docsTyping.previous")}
          disabled={none}
          onMouseDown={keepFocus}
          onClick={() => stepResult(view, -1)}
        >
          <ExpandLessIcon />
        </button>
        <button
          type="button"
          className="docs-find-btn"
          aria-label={t("docsTyping.next")}
          data-tip={t("docsTyping.next")}
          disabled={none}
          onMouseDown={keepFocus}
          onClick={() => stepResult(view, 1)}
        >
          <ExpandMoreIcon />
        </button>
        <button
          type="button"
          className="docs-find-btn"
          aria-label={t("docsTyping.moreOptions")}
          data-tip={t("docsTyping.moreOptions")}
          onMouseDown={keepFocus}
          onClick={onMore}
        >
          <MoreVertIcon />
        </button>
        <button
          type="button"
          className="docs-find-btn"
          aria-label={t("docsTyping.close")}
          data-tip={t("docsTyping.close")}
          onMouseDown={keepFocus}
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>
    </div>,
    document.body,
  );
}

export function FindReplaceDialog({ editor, open, onClose }: { editor: Editor; open: boolean; onClose: () => void }) {
  const t = useT();
  const find = useFind(editor);
  const findRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(find.query);
  const [prevQuery, setPrevQuery] = useState(find.query);
  if (prevQuery !== find.query) {
    setPrevQuery(find.query);
    setDraft(find.query);
  }
  const [replacement, setReplacement] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    findRef.current?.focus();
    findRef.current?.select();
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  const view = editor.view;
  const none = find.count === 0;
  const search = (query: string) => {
    setDraft(query);
    setMessage("");
    searchFrom(view, { query });
  };
  const setOption = (patch: Partial<FindOptions>) => {
    setMessage("");
    searchFrom(view, { options: { ...find.options, ...patch } });
  };
  const step = (dir: 1 | -1) => {
    const wrapped = stepResult(view, dir);
    setMessage(wrapped ? t("docsTyping.looping") : "");
  };
  return createPortal(
    <div
      role="dialog"
      aria-label={t("docsTyping.findAndReplace")}
      className="docs-replace"
      data-edit-control
      data-docs-typing
      onMouseUp={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="docs-replace-head">
        <h2>{t("docsTyping.findAndReplace")}</h2>
        <button type="button" className="docs-find-btn" aria-label={t("docsTyping.close")} onClick={onClose}>
          <CloseIcon size={24} />
        </button>
      </div>
      <div className="docs-replace-body">
        <label className="docs-outlined">
          <span className="docs-outlined-label">{t("docsTyping.find")}</span>
          <input
            ref={findRef}
            value={draft}
            onChange={(e) => search(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                step(e.shiftKey ? -1 : 1);
              }
            }}
            spellCheck={false}
          />
          <Counter count={find.count} current={find.current} query={find.query} />
        </label>
        <label className="docs-outlined">
          <span className="docs-outlined-label">{t("docsTyping.replaceWith")}</span>
          <input value={replacement} onChange={(e) => setReplacement(e.target.value)} spellCheck={false} />
        </label>
        <div className="docs-replace-checks">
          <label className="docs-ty-check">
            <input type="checkbox" checked={find.options.matchCase} onChange={(e) => setOption({ matchCase: e.target.checked })} />
            {t("docsTyping.matchCase")}
          </label>
          <label className="docs-ty-check">
            <input type="checkbox" checked={find.options.regex} onChange={(e) => setOption({ regex: e.target.checked })} />
            {t("docsTyping.useRegex")}
          </label>
          <label className="docs-ty-check">
            <input
              type="checkbox"
              checked={find.options.ignoreDiacritics}
              onChange={(e) => setOption({ ignoreDiacritics: e.target.checked })}
            />
            {t("docsTyping.ignoreDiacritics")}
          </label>
        </div>
        <p className="docs-replace-message" aria-live="polite">
          {message}
        </p>
      </div>
      <div className="docs-replace-actions">
        <DialogButton
          disabled={none || !editor.isEditable}
          onClick={() => {
            setMessage("");
            replaceResult(view, Math.max(0, find.current), replacement);
          }}
        >
          {t("docsTyping.replace")}
        </DialogButton>
        <DialogButton
          disabled={none || !editor.isEditable}
          onClick={() => {
            const query = find.query;
            const count = replaceAll(view, replacement);
            setMessage(t("docsTyping.replaced", { count, query }));
          }}
        >
          {t("docsTyping.replaceAll")}
        </DialogButton>
        <DialogButton disabled={none} onClick={() => step(-1)}>
          {t("docsTyping.previous")}
        </DialogButton>
        <DialogButton primary disabled={none} onClick={() => step(1)}>
          {t("docsTyping.next")}
        </DialogButton>
      </div>
    </div>,
    document.body,
  );
}

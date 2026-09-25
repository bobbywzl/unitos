"use client";

import type { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/lang-provider";
import { DOCS_EVENT } from "@/components/docs/extensions";
import { CloseIcon } from "@/components/docs/icons";

// Word count (Ctrl+Shift+C), as Google Docs counts: pages, words,
// characters, and characters without spaces — of the selection out of the
// whole document when text is selected. "Display word count while typing"
// keeps a small counter at the bottom left of the page area.

const SHOW_KEY = "unitos-docs-word-count";

type Counts = { words: number; chars: number; charsNoSpaces: number };

/** Words are runs of letters, digits, and joined punctuation between spaces;
    each CJK character counts as a word. */
export function countText(text: string): Counts {
  const cjk = text.match(/[぀-ヿ㐀-䶿一-鿿가-힯]/g)?.length ?? 0;
  const rest = text.replace(/[぀-ヿ㐀-䶿一-鿿가-힯]/g, " ");
  const words = (rest.match(/[^\s]+/g) ?? []).filter((w) => /[\p{L}\p{N}]/u.test(w)).length + cjk;
  const chars = text.replace(/\n/g, "").length;
  const charsNoSpaces = text.replace(/\s/g, "").length;
  return { words, chars, charsNoSpaces };
}

function pagesOf(editor: Editor): number {
  const pages = editor.view.dom.closest("[data-docs-editor]")?.querySelectorAll("[data-docs-page-sheet]").length;
  if (pages) return pages;
  const page = editor.view.dom.closest<HTMLElement>("[data-docs-page]");
  if (!page) return 1;
  const pageHeight = parseFloat(page.style.minHeight || "1056");
  return Math.max(1, Math.ceil(page.scrollHeight / pageHeight));
}

export function WordCountDialog({ editor }: { editor: Editor }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [show, setShow] = useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(SHOW_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [, setTick] = useState(0);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(DOCS_EVENT.wordCount, onOpen);
    return () => window.removeEventListener(DOCS_EVENT.wordCount, onOpen);
  }, []);

  // The counter follows typing and the selection.
  useEffect(() => {
    if (!show && !open) return;
    const bump = () => setTick((n) => n + 1);
    editor.on("transaction", bump);
    return () => {
      editor.off("transaction", bump);
    };
  }, [editor, show, open]);

  const all = countText(editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n", "\n"));
  const { from, to, empty } = editor.state.selection;
  const part = empty ? null : countText(editor.state.doc.textBetween(from, to, "\n", "\n"));
  const of = (n: number, total: number) => (part ? t("docs.countOf", { n, total }) : String(total));

  const setShowing = (on: boolean) => {
    setShow(on);
    try {
      localStorage.setItem(SHOW_KEY, on ? "1" : "0");
    } catch {
      // The choice holds for this page only.
    }
  };

  if (typeof document === "undefined") return null;
  return (
    <>
      {show && (
        <button type="button" className="docs-word-counter" onClick={() => setOpen(true)} data-edit-control>
          {part ? t("docs.wordsOf", { n: part.words, total: all.words }) : t("docs.words", { n: all.words })}
        </button>
      )}
      {open &&
        createPortal(
          <div
            className="docs-dialog-backdrop"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
            data-edit-control
          >
            <div role="dialog" aria-modal="true" aria-label={t("docs.wordCount")} className="docs-dialog">
              <div className="docs-dialog-head">
                <h2>{t("docs.wordCount")}</h2>
                <button type="button" className="docs-tb-btn" aria-label={t("docs.close")} onClick={() => setOpen(false)}>
                  <CloseIcon size={20} />
                </button>
              </div>
              <table className="docs-count-table">
                <tbody>
                  <tr>
                    <td>{t("docs.countPages")}</td>
                    <td>{pagesOf(editor)}</td>
                  </tr>
                  <tr>
                    <td>{t("docs.countWords")}</td>
                    <td>{of(part?.words ?? 0, all.words)}</td>
                  </tr>
                  <tr>
                    <td>{t("docs.countCharacters")}</td>
                    <td>{of(part?.chars ?? 0, all.chars)}</td>
                  </tr>
                  <tr>
                    <td>{t("docs.countCharactersNoSpaces")}</td>
                    <td>{of(part?.charsNoSpaces ?? 0, all.charsNoSpaces)}</td>
                  </tr>
                </tbody>
              </table>
              <label className="docs-check-row">
                <input type="checkbox" checked={show} onChange={(e) => setShowing(e.target.checked)} />
                {t("docs.showWordCount")}
              </label>
              <div className="docs-dialog-actions">
                <button
                  type="button"
                  autoFocus
                  className="docs-button-primary"
                  onClick={() => {
                    setOpen(false);
                    editor.commands.focus();
                  }}
                >
                  {t("docs.ok")}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

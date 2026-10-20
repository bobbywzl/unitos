"use client";

import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/lang-provider";
import { CloseIcon, ExpandLessIcon, ExpandMoreIcon } from "@/components/docs/icons";
import { useBarPosition } from "@/components/docs/typing/find-ui";
import { serverTypingPrefs, setTypingPrefs, subscribeTypingPrefs, typingPrefs } from "@/components/docs/typing/prefs";
import { allSquiggles } from "@/components/docs/typing/proofing";
import { expectedOf, replaceWords } from "@/components/docs/typing/proofing-layer";
import { addToDictionary, ignoreAll } from "@/components/docs/typing/spelling";
import { ignoreIssue } from "@/components/proofing/grammar-queue";
import { spellingSuggestions } from "@/components/proofing/spell-service";
import { useEscapeLayer } from "@/lib/escape-layers";

// The Spelling and grammar panel (SPEC.md §29, typing): the toolbar's
// Spelling and grammar check button opens it under the toolbar, at the
// right. It steps through the document's squiggles in order, red and blue,
// and selects each one's words in the text: Accept, Ignore, Ignore all, and
// Add to dictionary act as on the squiggle's card (proofing-layer.tsx). It
// changes nothing in the text until the reader presses a button. Once the
// reader types or clicks in the text, the panel no longer moves the
// selection until a button of the panel is pressed again.

const keep = (e: React.MouseEvent) => e.preventDefault();
const chip = "rounded-full px-3 py-1 text-[13px] font-semibold transition-colors";

export function ProofingPanel({ editor, documentId, premium, onClose }: { editor: Editor; documentId: string; premium: boolean; onClose: () => void }) {
  const t = useT();
  const pos = useBarPosition(editor, true);
  const prefs = useSyncExternalStore(subscribeTypingPrefs, typingPrefs, serverTypingPrefs);
  const [index, setIndex] = useState(0);
  const [suggestions, setSuggestions] = useState<{ word: string; list: string[] } | null>(null);
  // The list is read from the page on every change.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  // Whether the last act was the panel's: only then does it select words.
  const steering = useRef(true);
  useEscapeLayer(true, onClose);

  useEffect(() => {
    const dom = editor.view.dom;
    const handOver = () => {
      steering.current = false;
    };
    editor.on("transaction", rerender);
    dom.addEventListener("keydown", handOver);
    dom.addEventListener("mousedown", handOver);
    return () => {
      editor.off("transaction", rerender);
      dom.removeEventListener("keydown", handOver);
      dom.removeEventListener("mousedown", handOver);
    };
  }, [editor]);

  const list = allSquiggles(editor.state);
  const at = Math.min(index, list.length - 1);
  const current = at >= 0 ? list[at] : null;
  const from = current?.from ?? -1;
  const to = current?.to ?? -1;
  const expected = current ? expectedOf(current) : "";
  const word = current?.kind === "spelling" ? current.word : null;
  const fix = current?.kind === "spelling" ? current.fix : undefined;

  // The current squiggle's words selected and scrolled into view.
  useEffect(() => {
    if (from < 0 || !steering.current) return;
    const { state } = editor;
    if (to > state.doc.content.size || state.doc.textBetween(from, to) !== expected) return;
    if (state.selection.from === from && state.selection.to === to) return;
    editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)).scrollIntoView());
  }, [editor, from, to, expected, at]);

  useEffect(() => {
    if (word === null) return;
    let live = true;
    void spellingSuggestions(word, fix).then((found) => {
      if (live) setSuggestions({ word, list: found });
    });
    return () => {
      live = false;
    };
  }, [word, fix]);

  if (typeof document === "undefined") return null;
  /** A press of the panel's: it steers the selection again. */
  const act = (run: () => void) => () => {
    steering.current = true;
    run();
  };
  const step = (dir: 1 | -1) => act(() => setIndex((list.length + at + dir) % list.length));
  const off = !prefs.showSpelling && (!premium || !prefs.showGrammar);

  let body: React.ReactNode;
  if (!current) {
    body = <p className="docs-proof-panel-empty">{t(off ? "docsTyping.proofingOff" : "docsTyping.noProofing")}</p>;
  } else if (current.kind === "grammar") {
    const { issue } = current;
    body = (
      <>
        <p className="docs-proof-panel-kind">{t("docsTyping.grammarCard")}</p>
        <div className="flex flex-wrap items-baseline gap-1.5">
          <button
            type="button"
            data-track="grammar-panel-accept"
            onMouseDown={keep}
            onClick={act(() => replaceWords(editor, current.from, current.to, issue.wrong, issue.replacement))}
            className={`${chip} bg-clay-100 text-clay-800 hover:bg-clay-200`}
          >
            {issue.replacement || t("docsTyping.removeWords", { words: issue.wrong })}
          </button>
          {issue.replacement && <span className="text-[14px] text-sand-500 line-through">{issue.wrong}</span>}
        </div>
        <p className="mt-1.5 px-1 text-[13px] leading-snug text-sand-700">{issue.reason}</p>
        <div className="mt-2 flex flex-wrap gap-2 border-t border-sand-200 pt-2">
          <button
            type="button"
            data-track="grammar-panel-ignore"
            onMouseDown={keep}
            onClick={act(() => ignoreIssue(current.text, issue))}
            className={`${chip} bg-sand-100 text-sand-800 hover:bg-sand-200`}
          >
            {t("docsTyping.ignore")}
          </button>
        </div>
      </>
    );
  } else {
    const found = suggestions?.word === current.word ? suggestions.list : null;
    body = (
      <>
        <p className="docs-proof-panel-kind">{t("docsTyping.spellingCard")}</p>
        <p className="mb-1.5 px-1 text-[14px] text-sand-500 line-through">{current.word}</p>
        <div className="flex flex-wrap gap-1.5">
          {found === null ? (
            <span className="px-1 text-[13px] text-sand-500">…</span>
          ) : found.length === 0 ? (
            <span className="px-1 text-[13px] text-sand-500">{t("docsTyping.noSpellingSuggestions")}</span>
          ) : (
            found.map((s) => (
              <button
                key={s}
                type="button"
                data-track="spelling-panel-suggestion"
                onMouseDown={keep}
                onClick={act(() => replaceWords(editor, current.from, current.to, current.word, s))}
                className={`${chip} bg-clay-100 text-clay-800 hover:bg-clay-200`}
              >
                {s}
              </button>
            ))
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-2 border-t border-sand-200 pt-2">
          <button
            type="button"
            data-track="spelling-panel-add"
            onMouseDown={keep}
            onClick={act(() => addToDictionary(current.word))}
            className={`${chip} bg-sand-100 text-sand-800 hover:bg-sand-200`}
          >
            {t("docsTyping.addToDictionary")}
          </button>
          <button
            type="button"
            data-track="spelling-panel-ignore-all"
            onMouseDown={keep}
            onClick={act(() => ignoreAll(documentId, current.word))}
            className={`${chip} bg-sand-100 text-sand-800 hover:bg-sand-200`}
          >
            {t("docsTyping.ignoreAll")}
          </button>
        </div>
      </>
    );
  }

  return createPortal(
    <div
      role="dialog"
      aria-label={t("docsTyping.spellingAndGrammar")}
      className="docs-proof-panel"
      style={pos ? { top: pos.top, right: pos.right } : { visibility: "hidden" }}
      data-edit-control
      data-docs-typing
      onMouseDown={keep}
      onMouseUp={(e) => e.stopPropagation()}
    >
      <div className="docs-proof-panel-head">
        <h2>{t("docsTyping.spellingAndGrammar")}</h2>
        {list.length > 0 && <span className="docs-proof-panel-count">{t("docsTyping.resultOf", { n: at + 1, total: list.length })}</span>}
        <button type="button" className="docs-icon-btn" aria-label={t("docsTyping.previous")} disabled={list.length < 2} onClick={step(-1)}>
          <ExpandLessIcon />
        </button>
        <button type="button" className="docs-icon-btn" aria-label={t("docsTyping.next")} disabled={list.length < 2} onClick={step(1)}>
          <ExpandMoreIcon />
        </button>
        <button type="button" className="docs-icon-btn" aria-label={t("docs.close")} onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <div className="docs-proof-panel-body">{body}</div>
      <div className="docs-proof-panel-foot">
        <label className="docs-ty-check">
          <input type="checkbox" checked={prefs.showSpelling} onChange={(e) => setTypingPrefs({ showSpelling: e.target.checked })} />
          {t("docsTyping.showSpelling")}
        </label>
        {premium && (
          <label className="docs-ty-check">
            <input type="checkbox" checked={prefs.showGrammar} onChange={(e) => setTypingPrefs({ showGrammar: e.target.checked })} />
            {t("docsTyping.showGrammar")}
          </label>
        )}
      </div>
    </div>,
    document.body,
  );
}

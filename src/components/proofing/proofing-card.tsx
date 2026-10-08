"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/lang-provider";
import type { GrammarIssue } from "@/lib/grammar";

// The card a squiggle opens (SPEC.md §29, typing), in the page editor and
// the note editor. A blue squiggle's card: the words that replace the
// wrong ones (a press accepts them), why, and Ignore. A red squiggle's card: the word's
// spelling suggestions, Add to dictionary, and Ignore all. The card never
// takes the focus: the caret stays in the text. Nothing changes the text
// until the reader presses a button.

export type CardContent =
  | { kind: "grammar"; issue: GrammarIssue }
  | { kind: "spelling"; word: string; suggestions: string[] | null };

type Props = {
  /** Where the card stands: under the squiggle's start, in the window. */
  box: { left: number; top: number };
  content: CardContent;
  /** Accept: the replacement (a grammar issue's, or a spelling suggestion). */
  onAccept: (replacement: string) => void;
  /** Ignore (a grammar issue) or Ignore all (a misspelled word). */
  onIgnore: () => void;
  onAddToDictionary?: () => void;
  onClose: () => void;
  className?: string;
};

const keep = (e: React.MouseEvent) => e.preventDefault();
const chip = "rounded-full px-3 py-1 text-[13px] font-semibold transition-colors";

export function ProofingCard({ box, content, onAccept, onIgnore, onAddToDictionary, onClose, className = "" }: Props) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // Escape or a press anywhere else closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, []);

  if (typeof document === "undefined") return null;
  const left = Math.max(8, Math.min(box.left, window.innerWidth - 328));
  const card =
    content.kind === "grammar" ? (
      <>
        <div className="flex flex-wrap items-baseline gap-1.5">
          {/* The words are the accept, as a spelling card's chips are. */}
          <button
            type="button"
            data-track="grammar-accept-words"
            onMouseDown={keep}
            onClick={() => onAccept(content.issue.replacement)}
            className={`${chip} bg-clay-100 text-clay-800 hover:bg-clay-200`}
          >
            {content.issue.replacement || t("docsTyping.removeWords", { words: content.issue.wrong })}
          </button>
          {content.issue.replacement && <span className="text-[14px] text-sand-500 line-through">{content.issue.wrong}</span>}
        </div>
        <p className="mt-1.5 px-1 text-[13px] leading-snug text-sand-700">{content.issue.reason}</p>
        <div className="mt-2 flex gap-2 border-t border-sand-200 pt-2">
          <button type="button" data-track="grammar-ignore" onMouseDown={keep} onClick={onIgnore} className={`${chip} bg-sand-100 text-sand-800 hover:bg-sand-200`}>
            {t("docsTyping.ignore")}
          </button>
        </div>
      </>
    ) : (
      <>
        <div className="flex flex-wrap gap-1.5">
          {content.suggestions === null ? (
            <span className="px-1 text-[13px] text-sand-500">…</span>
          ) : content.suggestions.length === 0 ? (
            <span className="px-1 text-[13px] text-sand-500">{t("docsTyping.noSpellingSuggestions")}</span>
          ) : (
            content.suggestions.map((s) => (
              <button
                key={s}
                type="button"
                data-track="spelling-suggestion"
                onMouseDown={keep}
                onClick={() => onAccept(s)}
                className={`${chip} bg-clay-100 text-clay-800 hover:bg-clay-200`}
              >
                {s}
              </button>
            ))
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-2 border-t border-sand-200 pt-2">
          {onAddToDictionary && (
            <button type="button" data-track="spelling-add" onMouseDown={keep} onClick={onAddToDictionary} className={`${chip} bg-sand-100 text-sand-800 hover:bg-sand-200`}>
              {t("docsTyping.addToDictionary")}
            </button>
          )}
          <button type="button" data-track="spelling-ignore-all" onMouseDown={keep} onClick={onIgnore} className={`${chip} bg-sand-100 text-sand-800 hover:bg-sand-200`}>
            {t("docsTyping.ignoreAll")}
          </button>
        </div>
      </>
    );
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={t(content.kind === "grammar" ? "docsTyping.grammarCard" : "docsTyping.spellingCard")}
      data-edit-control
      data-docs-typing
      data-proofing-card={content.kind}
      onMouseDown={keep}
      onMouseUp={(e) => e.stopPropagation()}
      className={`menu-in fixed z-[60] w-max max-w-[320px] rounded-2xl bg-card p-3 text-sand-800 shadow-float ${className}`}
      style={{ left, top: box.top }}
    >
      {card}
    </div>,
    document.body,
  );
}

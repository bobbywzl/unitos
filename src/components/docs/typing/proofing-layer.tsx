"use client";

import type { Editor } from "@tiptap/react";
import { useEffect, useReducer, useState } from "react";
import { squiggleAt, type Squiggle } from "@/components/docs/typing/proofing";
import { addToDictionary, ignoreAll } from "@/components/docs/typing/spelling";
import { ignoreIssue } from "@/components/proofing/grammar-queue";
import { ProofingCard, type CardContent } from "@/components/proofing/proofing-card";
import { spellingSuggestions } from "@/components/proofing/spell-service";

// A click on a squiggle in the page editor opens its card (SPEC.md §29,
// typing; typing/proofing.ts draws the squiggles). Accept puts the words in
// place as one edit — in Suggesting mode the page makes it the reader's own
// suggestion, as any edit there — and Ignore hides the issue for the
// paragraph's text. The card closes when its words change or the caret
// leaves them.

type Open = { squiggle: Squiggle; suggestions: string[] | null };

/** Put `replacement` where `expected` stands, with its marks: one undo step.
    Nothing happens when the words there changed. */
function replaceWords(editor: Editor, from: number, to: number, expected: string, replacement: string): void {
  const { state } = editor;
  if (to > state.doc.content.size || state.doc.textBetween(from, to) !== expected) return;
  const marks = state.doc.resolve(from).marksAcross(state.doc.resolve(to)) ?? undefined;
  const tr = replacement ? state.tr.replaceWith(from, to, state.schema.text(replacement, marks)) : state.tr.delete(from, to);
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
}

const expectedOf = (s: Squiggle) => (s.kind === "grammar" ? s.issue.wrong : s.word);

export function ProofingLayer({ editor, documentId }: { editor: Editor; documentId: string }) {
  const [open, setOpen] = useState<Open | null>(null);
  // The card follows its words when the page scrolls.
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  // A click (not a drag) on a squiggle opens its card.
  useEffect(() => {
    const dom = editor.view.dom;
    const onUp = (e: MouseEvent) => {
      if (e.button !== 0 || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
      // After the editor has put the caret where the click landed.
      setTimeout(() => {
        if (editor.isDestroyed || !editor.isEditable) return;
        const { selection } = editor.state;
        const squiggle = selection.empty ? squiggleAt(editor.state, selection.head) : null;
        if (!squiggle) return setOpen(null);
        setOpen({ squiggle, suggestions: null });
        if (squiggle.kind === "spelling") {
          void spellingSuggestions(squiggle.word).then((suggestions) =>
            setOpen((o) => (o && o.squiggle === squiggle ? { ...o, suggestions } : o)),
          );
        }
      }, 0);
    };
    dom.addEventListener("mouseup", onUp);
    return () => dom.removeEventListener("mouseup", onUp);
  }, [editor]);

  // The card closes when its words change, the caret leaves them, or the
  // page leaves Editing and Suggesting.
  useEffect(() => {
    if (!open) return;
    const check = () => {
      const { state } = editor;
      const { from, to } = open.squiggle;
      const head = state.selection.head;
      const same = to <= state.doc.content.size && state.doc.textBetween(from, to) === expectedOf(open.squiggle);
      if (!editor.isEditable || !same || head < from || head > to) setOpen(null);
    };
    editor.on("transaction", check);
    window.addEventListener("scroll", rerender, true);
    window.addEventListener("resize", rerender);
    return () => {
      editor.off("transaction", check);
      window.removeEventListener("scroll", rerender, true);
      window.removeEventListener("resize", rerender);
    };
  }, [editor, open]);

  if (!open) return null;
  const { squiggle } = open;
  let box: { left: number; top: number };
  try {
    const c = editor.view.coordsAtPos(squiggle.from);
    box = { left: c.left - 8, top: c.bottom + 6 };
  } catch {
    return null;
  }
  const content: CardContent =
    squiggle.kind === "grammar" ? { kind: "grammar", issue: squiggle.issue } : { kind: "spelling", word: squiggle.word, suggestions: open.suggestions };
  const close = () => setOpen(null);
  return (
    <ProofingCard
      box={box}
      content={content}
      className="docs-proof-card"
      onClose={close}
      onAccept={(replacement) => {
        close();
        replaceWords(editor, squiggle.from, squiggle.to, expectedOf(squiggle), replacement);
      }}
      onIgnore={() => {
        close();
        if (squiggle.kind === "grammar") ignoreIssue(squiggle.text, squiggle.issue);
        else ignoreAll(documentId, squiggle.word);
      }}
      onAddToDictionary={
        squiggle.kind === "spelling"
          ? () => {
              close();
              addToDictionary(squiggle.word);
            }
          : undefined
      }
    />
  );
}

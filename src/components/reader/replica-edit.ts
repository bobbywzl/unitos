"use client";

import { useEffect, type RefObject } from "react";
import { anchorableText } from "@/lib/anchors/dom";

// Editing a replica in place (SPEC.md §27): a double-click on a sheet's
// cell or on a line of a slide makes that one piece editable. Enter, or a
// press outside, saves; Escape puts the piece back. The replica's DOM text
// is the block's text (the one rule), so the words to save are read off the
// replica as it stands after the typing, and the server rewrites the html
// from them (lib/replica.ts): the cell's value, the line's runs, a sheet's
// formulas computed again. One piece at a time, and its gaps (.cell-gap)
// and furniture ([data-anchor-skip]) are not editable, so typing never
// joins two cells or two lines. A refused save puts the piece back as it
// was and says why.

/** The reader saves a replica's new text: the page answers settle(true)
    when the server took it. */
export const REPLICA_SAVE_EVENT = "dissect:replica-save";
export type ReplicaSave = { blockId: string; text: string; settle: (ok: boolean) => void };
/** A line the reader should read about a piece that does not open. */
export const REPLICA_NOTICE_EVENT = "dissect:replica-notice";
export type ReplicaNotice = { blockId: string; text: string };

const SKIP = ".cell-gap, [data-anchor-skip]";

/** The piece a press lands on: a cell, or a slide's line. */
function pieceOf(target: EventTarget | null, root: HTMLElement): HTMLElement | null {
  if (!(target instanceof Element) || target.closest("[data-anchor-skip]")) return null;
  const piece = target.closest<HTMLElement>("p.sp, td, th");
  if (!piece || !root.contains(piece) || piece.closest("[data-anchor-skip]")) return null;
  return piece;
}

/** Words typed after a piece's gap belong before it: a gap ends its piece. */
function tidyGaps(piece: HTMLElement) {
  const gaps = [...piece.querySelectorAll<HTMLElement>(":scope > .cell-gap")];
  const last = gaps[gaps.length - 1];
  if (!last) return;
  for (let node = last.nextSibling; node; ) {
    const next = node.nextSibling;
    if (node.nodeType === Node.TEXT_NODE || (node instanceof Element && !node.matches(SKIP))) piece.insertBefore(node, last);
    node = next;
  }
}

export function useReplicaEdit(ref: RefObject<HTMLElement | null>, blockId: string, text: string, enabled: boolean, formulaWords: string) {
  useEffect(() => {
    const root = ref.current;
    if (!root || !enabled) return;
    let editing: { piece: HTMLElement; before: string; pictured: Element | null; done: boolean } | null = null;

    const end = (restore: boolean) => {
      const state = editing;
      if (!state || state.done) return;
      state.done = true;
      editing = null;
      const { piece } = state;
      piece.removeEventListener("keydown", onKey);
      piece.removeEventListener("blur", onBlur);
      piece.removeEventListener("paste", onPaste);
      piece.removeEventListener("beforeinput", onBeforeInput);
      if (restore) piece.innerHTML = state.before;
      piece.removeAttribute("contenteditable");
      piece.removeAttribute("data-replica-editing");
      piece.removeAttribute("spellcheck");
      for (const el of piece.querySelectorAll<HTMLElement>(SKIP)) el.removeAttribute("contenteditable");
      // A slide's picture comes back over words that did not change.
      if (restore) state.pictured?.classList.add("slide-pictured");
    };

    const commit = () => {
      const state = editing;
      if (!state || state.done) return;
      tidyGaps(state.piece);
      const next = anchorableText(root);
      if (next === text) {
        end(true);
        return;
      }
      const { piece, before, pictured } = state;
      end(false);
      piece.setAttribute("data-replica-saving", "");
      const detail: ReplicaSave = {
        blockId,
        text: next,
        settle: (ok) => {
          piece.removeAttribute("data-replica-saving");
          if (ok) return;
          // Refused or failed: the piece as it was, the picture over it.
          piece.innerHTML = before;
          pictured?.classList.add("slide-pictured");
        },
      };
      window.dispatchEvent(new CustomEvent(REPLICA_SAVE_EVENT, { detail }));
    };

    function onKey(e: KeyboardEvent) {
      if (e.isComposing) return;
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        end(true);
      }
    }
    function onBlur() {
      commit();
    }
    // A paste lands as plain words on one line.
    function onPaste(e: ClipboardEvent) {
      e.preventDefault();
      const words = (e.clipboardData?.getData("text/plain") ?? "").replace(/[\t\r\n]+/g, " ");
      if (words) document.execCommand("insertText", false, words);
    }
    // A piece is one line: no new paragraph, no line break.
    function onBeforeInput(e: InputEvent) {
      if (e.inputType === "insertParagraph" || e.inputType === "insertLineBreak") e.preventDefault();
    }

    const onDoubleClick = (e: MouseEvent) => {
      if (editing) return;
      const piece = pieceOf(e.target, root);
      if (!piece) return;
      e.preventDefault();
      e.stopPropagation();
      // A formula's cell computes its value (its formula rides on it as the
      // tip): the reader is told so before typing, not after.
      if (piece.matches('td[title^="="]')) {
        const detail: ReplicaNotice = { blockId, text: formulaWords };
        window.dispatchEvent(new CustomEvent(REPLICA_NOTICE_EVENT, { detail }));
        return;
      }
      window.getSelection()?.removeAllRanges();
      // Over a slide's picture the words are transparent: the replica shows
      // while a line is edited.
      const pictured = piece.closest(".slide-frame.slide-pictured");
      pictured?.classList.remove("slide-pictured");
      editing = { piece, before: piece.innerHTML, pictured, done: false };
      for (const el of piece.querySelectorAll<HTMLElement>(SKIP)) el.setAttribute("contenteditable", "false");
      piece.setAttribute("contenteditable", "true");
      piece.setAttribute("data-replica-editing", "");
      piece.setAttribute("spellcheck", "false");
      piece.addEventListener("keydown", onKey);
      piece.addEventListener("blur", onBlur);
      piece.addEventListener("paste", onPaste);
      piece.addEventListener("beforeinput", onBeforeInput);
      piece.focus();
      // The caret where the press landed; in an empty cell, before its gap.
      const selection = window.getSelection();
      const at = document.caretRangeFromPoint?.(e.clientX, e.clientY) ?? null;
      const range = document.createRange();
      const gap = piece.querySelector(":scope > .cell-gap");
      if (at && piece.contains(at.startContainer) && !(at.startContainer instanceof Element ? at.startContainer : at.startContainer.parentElement)?.closest(SKIP)) {
        range.setStart(at.startContainer, at.startOffset);
      } else if (gap) {
        range.setStartBefore(gap);
      } else {
        range.selectNodeContents(piece);
        range.collapse(false);
      }
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
    };

    root.addEventListener("dblclick", onDoubleClick);
    return () => {
      root.removeEventListener("dblclick", onDoubleClick);
      end(true);
    };
  }, [ref, blockId, text, enabled, formulaWords]);
}

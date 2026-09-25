"use client";

import { useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useCollab } from "@/components/collab/collab-context";
import type { DocsAreaProps } from "@/components/docs/areas/types";
import { registerDocsCommands } from "@/components/docs/commands";
import { readSuggestions, setSuggesting, settleSuggestions, suggestionAt } from "@/components/docs/ext/suggest";
import { belowSlot, pageGeometry, slotAt } from "@/components/docs/layer/margin";
import { SuggestionCard } from "@/components/docs/suggest/card";
import { ReviewPanel } from "@/components/docs/suggest/review";
import { suggestionAuthor } from "@/lib/docs/schema";
import { personColor } from "@/lib/person";

// Suggesting mode in the page editor (SPEC.md §29): the authors' colors,
// every suggestion's card, and Review suggested edits.

/** Raised on the page's text by Review suggested edits. */
const REVIEW_EVENT = "docs:review-suggestions";
/** The space between two cards. */
const CARD_GAP = 8;

const settleable = (editor: Editor) => editor.isEditable && readSuggestions(editor.state.doc).length > 0;

registerDocsCommands([
  {
    id: "suggest:review",
    label: "docsSuggest.reviewSuggestedEdits",
    menu: "tools",
    keywords: ["suggestions", "track changes", "建议"],
    shortcut: "Mod+Alt+O U",
    run: (editor) => editor.view.dom.dispatchEvent(new Event(REVIEW_EVENT)),
  },
  {
    id: "suggest:accept-all",
    label: "docsSuggest.acceptAllSuggestions",
    menu: "tools",
    keywords: ["suggestions", "建议"],
    run: (editor) => settleSuggestions(editor, true),
    enabled: settleable,
  },
  {
    id: "suggest:reject-all",
    label: "docsSuggest.rejectAllSuggestions",
    menu: "tools",
    keywords: ["suggestions", "建议"],
    run: (editor) => settleSuggestions(editor, false),
    enabled: settleable,
  },
]);

/** The cards stand beside the page in one column, each level with its words
    or clear of its neighbors: the active card level with its words, the
    cards below it pushed down, the cards above it up. With no room beside
    the page, only the active card shows, under its words. */
function placeCards(editor: Editor, pane: HTMLElement): void {
  const geo = pageGeometry(pane, 0);
  if (!geo) return;
  const slot = slotAt(geo, 0);
  const { left, width } = slot ?? belowSlot(geo, 0);
  const active = suggestionAt(editor.state);
  const from = new Map(readSuggestions(editor.state.doc).map((s) => [s.id, s.from]));
  const paneTop = pane.getBoundingClientRect().top - pane.scrollTop;
  const all = [...pane.querySelectorAll<HTMLElement>("[data-suggestion-card]")];
  const cards = all.flatMap((el) => {
    const id = el.dataset.suggestionCard ?? "";
    const at = from.get(id);
    return at !== undefined && (slot || id === active) ? [{ el, id, top: editor.view.coordsAtPos(at).top - paneTop + (slot ? 0 : 34) }] : [];
  });
  const shown = new Set(cards.map((c) => c.el));
  for (const el of all) el.style.display = shown.has(el) ? "" : "none";
  cards.sort((a, b) => a.top - b.top);
  const heights = cards.map((c) => c.el.offsetHeight);
  const first = Math.max(0, cards.findIndex((c) => c.id === active));
  for (let i = first + 1; i < cards.length; i++) cards[i].top = Math.max(cards[i].top, cards[i - 1].top + heights[i - 1] + CARD_GAP);
  for (let i = first - 1; i >= 0; i--) cards[i].top = Math.min(cards[i].top, cards[i + 1].top - CARD_GAP - heights[i]);
  for (const { el, top } of cards) Object.assign(el.style, { left: `${left}px`, width: `${width}px`, top: `${top}px` });
}

export function SuggestLayer({ editor, canEdit, editing, suggesting }: DocsAreaProps & { suggesting: boolean }) {
  const { myId, people } = useCollab();
  const [reviewing, setReviewing] = useState(false);
  const { active, ids } = useEditorState({
    editor,
    selector: ({ editor: e }) => ({ active: suggestionAt(e.state), ids: readSuggestions(e.state.doc).map((s) => s.id) }),
  });
  const viewing = canEdit && !editing;
  const pane = viewing ? null : editor.view.dom.closest<HTMLElement>("[data-reader-root]");

  useEffect(() => {
    setSuggesting(editor, suggesting ? myId : null);
  }, [editor, suggesting, myId]);

  // While the document holds suggestions the page keeps the margin their
  // cards stand in, as Google Docs keeps it for its discussions.
  const holdMargin = ids.length > 0 && !viewing;
  useEffect(() => {
    const root = editor.view.dom.closest("[data-reader-root]");
    const hold = (on: boolean) => {
      root?.dispatchEvent(new CustomEvent<boolean>("docs:margin", { detail: on }));
    };
    hold(holdMargin);
    return () => hold(false);
  }, [editor, holdMargin]);

  // Review suggested edits: its command, and Google's chord (hold Ctrl+Alt,
  // press O then U), which the chord reader runs (typing/navigate.ts).
  useEffect(() => {
    const dom = editor.view.dom;
    const open = () => setReviewing(true);
    dom.addEventListener(REVIEW_EVENT, open);
    return () => dom.removeEventListener(REVIEW_EVENT, open);
  }, [editor]);

  // The cards move with their words once the pages are laid out (a frame
  // after a change), and when the pane or the page moves. A new card takes
  // its place at once.
  useLayoutEffect(() => {
    if (!pane) return;
    let frame = 0;
    const place = () => {
      frame = 0;
      placeCards(editor, pane);
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    if ([...pane.querySelectorAll<HTMLElement>("[data-suggestion-card]")].some((card) => !card.style.top)) placeCards(editor, pane);
    later();
    editor.on("transaction", later);
    const observer = new ResizeObserver(later);
    observer.observe(pane);
    observer.observe(editor.view.dom);
    pane.addEventListener("transitionend", later);
    return () => {
      cancelAnimationFrame(frame);
      editor.off("transaction", later);
      observer.disconnect();
      pane.removeEventListener("transitionend", later);
    };
  }, [editor, pane, ids]);

  // Each author's color, and a tint on the suggestion whose card is open.
  const colors = useMemo(
    () =>
      [...new Set(ids.map(suggestionAuthor))].map(
        (author) => `.docs-prose [data-author="${CSS.escape(author)}"]{--docs-suggest:${people[author]?.color ?? personColor(author)}}`,
      ),
    [ids, people],
  );
  const canSettle = canEdit && editing;
  // The cards, made once per list: typing re-renders the page, not them.
  const cards = useMemo(() => ids.map((id) => <SuggestionCard key={id} editor={editor} id={id} canSettle={canSettle} />), [ids, editor, canSettle]);
  const header = editor.view.dom.closest("[data-docs-editor]")?.querySelector<HTMLElement>(".docs-header");
  return (
    <>
      <style>
        {[...colors, active && !viewing ? `.docs-prose [data-suggestion="${CSS.escape(active)}"]{--docs-suggest-tint:24%}` : ""].join("\n")}
      </style>
      {pane && createPortal(cards, pane)}
      {reviewing && header && !viewing && (
        <ReviewPanel
          editor={editor}
          header={header}
          ids={ids}
          at={active}
          canSettle={canSettle}
          onClose={() => setReviewing(false)}
        />
      )}
    </>
  );
}

"use client";

import { useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useAuthor, useCollab } from "@/components/collab/collab-context";
import type { DocsAreaProps } from "@/components/docs/areas/types";
import { registerDocsCommands } from "@/components/docs/commands";
import { focusSuggestion, readSuggestions, setSuggesting, settleSuggestions, suggestionAt } from "@/components/docs/ext/suggest";
import { belowSlot, pageGeometry, paneReach, slotAt } from "@/components/docs/layer/margin";
import { applyAssistantOps, type Landing } from "@/components/docs/suggest/assistant";
import { SuggestionCard } from "@/components/docs/suggest/card";
import { ReviewPanel } from "@/components/docs/suggest/review";
import { DOCS_EVENT, fireDocs } from "@/components/docs/typing/events";
import type { TKey } from "@/lib/i18n/dictionaries";
import { assistantAuthor, type ResolvedOp } from "@/lib/docs/assistant-suggestions";
import { suggestionAuthor } from "@/lib/docs/schema";
import { personColor } from "@/lib/person";
import type { SuggestCommand } from "@/lib/prompts/suggest";

// Suggesting mode in the page editor (SPEC.md §29): the authors' colors,
// every suggestion's card, and Review suggested edits, of a person's
// suggestions and the assistant's. The layer also places the card column's
// comment and suggestion cards (layer/comment-card.tsx CardColumn).

/** Raised on the page's text by Review suggested edits. */
const REVIEW_EVENT = "docs:review-suggestions";
/** The space between two cards. */
const CARD_GAP = 8;
/** The column's comment and suggestion cards. */
const COLUMN_CARD = "[data-suggestion-card], [data-comment-card]";
/** What stands in the column and stays where it is: the toolbar and the
    tools' cards. */
const FIXED = "[data-layer-toolbar], [data-side-card], [data-annotation-card]";

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

// The assistant on the selection, or on the paragraph the caret stands in:
// the reader layer opens its box, or runs one of its commands there.
const COMMANDS: [SuggestCommand, TKey][] = [
  ["rephrase", "reader.commandRephrase"],
  ["shorten", "reader.commandShorten"],
  ["elaborate", "reader.commandElaborate"],
  ["formal", "reader.commandFormal"],
  ["casual", "reader.commandCasual"],
  ["bulleted", "reader.commandBulleted"],
  ["grammar", "reader.commandFix"],
];
registerDocsCommands([
  {
    id: "assistant:ask",
    label: "docsInsert.askAssistant",
    menu: "tools",
    keywords: ["ai", "助手"],
    run: (editor) => fireDocs(editor, DOCS_EVENT.tool, { tool: "assistant" }),
  },
  ...COMMANDS.map(([command, label]) => ({
    id: `assistant:${command}`,
    label,
    menu: "tools" as const,
    keywords: ["ai", "assistant", "助手"],
    run: (editor: Editor) => fireDocs(editor, DOCS_EVENT.tool, { tool: "assistant", command }),
    enabled: (editor: Editor) => editor.isEditable,
  })),
]);

/** The column's box over the pane and the notes tray beside it (in a split
    pane, the pane alone), under the title row and the toolbar; its inside
    in the pane's coordinates. */
function fitColumn(pane: HTMLElement, column: HTMLElement): void {
  const box = column.parentElement;
  if (!box) return;
  const r = pane.getBoundingClientRect();
  const top = Math.max(r.top, pane.querySelector(".docs-header")?.getBoundingClientRect().bottom ?? r.top);
  Object.assign(box.style, {
    left: `${r.left}px`,
    top: `${top}px`,
    width: `${paneReach(pane)}px`,
    height: `${Math.max(0, r.bottom - top)}px`,
  });
  column.style.top = `${r.top - top}px`;
  column.style.setProperty("--docs-scroll", `${pane.scrollHeight - pane.clientHeight}`);
  // The pane's scroll timeline moves the inside (css/layer.css); where there
  // is none, this does, a frame late.
  column.style.transform = `translateY(${-pane.scrollTop}px)`;
}

/** Where a card's words start: a suggestion's first letter, a comment's
    first mark (its chip, when a smaller mark names the words). */
function wordsAt(editor: Editor, card: HTMLElement, from: Map<string, number>): number | null {
  const id = card.dataset.suggestionCard;
  if (id !== undefined) return from.get(id) ?? null;
  const mark = editor.view.dom.querySelector(`[data-source-id="${CSS.escape(card.dataset.commentCard ?? "")}"]`);
  return mark ? editor.view.posAtDOM(mark, 0) : null;
}

/** The comment and suggestion cards stand in one column beside the page,
    in the order of their words, each level with its words or clear of its
    neighbors: the open card level with its words, the cards below it pushed
    down, the cards above it up. The text toolbar and the tools' cards
    beside the page stay where they are, and the cards flow around them the
    same way. With no column (a split pane, no room), only the open cards
    show, under their words. The column's end stretches the pane, so the
    lowest card can be scrolled to. True when the column holds a card. */
function placeCards(editor: Editor, pane: HTMLElement, column: HTMLElement): boolean {
  const geo = pageGeometry(pane, 0);
  const page = pane.querySelector("[data-docs-page]");
  if (!geo || !page) return false;
  const slot = column.parentElement?.hasAttribute("data-split") ? null : slotAt(geo, 0);
  const { left, width } = slot ?? belowSlot(geo, 0);
  const paneRect = pane.getBoundingClientRect();
  const paneTop = paneRect.top - pane.scrollTop;
  const from = new Map(readSuggestions(editor.state.doc).map((s) => [s.id, s.from]));
  const cards: { el: HTMLElement; at: number; top: number; open: boolean }[] = [];
  for (const el of column.querySelectorAll<HTMLElement>(COLUMN_CARD)) {
    if (el.closest(".presence-exit")) continue;
    const at = wordsAt(editor, el, from);
    const open = el.hasAttribute("data-active") || el.dataset.sideCard === "comment";
    const shown = at !== null && (slot !== null || open);
    el.style.display = shown ? "" : "none";
    if (shown) cards.push({ el, at, open, top: editor.view.coordsAtPos(at).top - paneTop + (slot ? 0 : 34) });
  }
  // What the cards flow around, in the column's width: the toolbar with its
  // bubbles, and the tools' cards. The toolbar's own box is level with its
  // words, the selection.
  const fixed: { top: number; bottom: number; words?: number }[] = [];
  const inColumn = (r: DOMRect) => r.width > 0 && r.left < paneRect.left + left + width && r.right > paneRect.left + left;
  for (const el of slot ? column.querySelectorAll<HTMLElement>(FIXED) : []) {
    if (el.matches(COLUMN_CARD) || el.closest(".presence-exit")) continue;
    const toolbar = el.matches("[data-layer-toolbar]");
    const rects = [el, ...(toolbar ? el.children : [])].map((e) => e.getBoundingClientRect());
    if (!rects.some(inColumn)) continue;
    fixed.push({
      top: Math.min(...rects.map((r) => r.top)) - paneTop,
      bottom: Math.max(...rects.map((r) => r.bottom)) - paneTop,
      words: toolbar ? rects[0].top - paneTop : undefined,
    });
  }
  cards.sort((a, b) => a.top - b.top || a.at - b.at);
  const heights = cards.map((c) => c.el.offsetHeight);
  const tops = cards.map((c) => c.top);
  const clear = (top: number, h: number, down: boolean) => {
    for (let moved = true; moved; ) {
      moved = false;
      for (const f of fixed) {
        if (top >= f.bottom + CARD_GAP || top + h + CARD_GAP <= f.top) continue;
        top = down ? f.bottom + CARD_GAP : f.top - CARD_GAP - h;
        moved = true;
      }
    }
    return top;
  };
  const pushDown = (start: number) => {
    for (let i = start; i < cards.length; i++) {
      tops[i] = clear(i > start ? Math.max(tops[i], tops[i - 1] + heights[i - 1] + CARD_GAP) : tops[i], heights[i], true);
    }
  };
  // The cards flow around the toolbar, else the open card, else the first:
  // the cards whose words come before its words go above it.
  const words = fixed.find((f) => f.words !== undefined)?.words;
  const anchor = words !== undefined ? cards.findIndex((c) => c.top >= words) : Math.max(0, cards.findIndex((c) => c.open));
  const a = anchor < 0 ? cards.length : anchor;
  if (slot) {
    pushDown(a);
    for (let i = a - 1; i >= 0; i--) {
      tops[i] = clear(i + 1 < cards.length ? Math.min(tops[i], tops[i + 1] - CARD_GAP - heights[i]) : tops[i], heights[i], false);
    }
    // None goes above the page, out of reach.
    const pageTop = page.getBoundingClientRect().top - paneTop;
    if (tops[0] < pageTop) {
      tops[0] = pageTop;
      pushDown(0);
    }
  }
  cards.forEach(({ el }, i) => Object.assign(el.style, { left: `${left}px`, width: `${width}px`, top: `${tops[i]}px` }));
  const end = pane.querySelector<HTMLElement>("[data-docs-column-end]");
  if (end) end.style.top = `${Math.max(0, ...fixed.map((f) => f.bottom), ...cards.map((_, i) => tops[i] + heights[i])) + CARD_GAP}px`;
  return slot !== null && cards.length > 0;
}

export function SuggestLayer({ editor, canEdit, editing, suggesting }: DocsAreaProps & { suggesting: boolean }) {
  const { myId, people } = useCollab();
  const [reviewing, setReviewing] = useState(false);
  const { active, ids } = useEditorState({
    editor,
    selector: ({ editor: e }) => ({ active: suggestionAt(e.state), ids: readSuggestions(e.state.doc).map((s) => s.id) }),
  });
  const viewing = canEdit && !editing;
  // The reader pane's card column, once the page is in the pane.
  const [column, setColumn] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const found = editor.view.dom.closest("[data-reader-root]")?.querySelector<HTMLElement>("[data-docs-column] > .docs-column-in");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setColumn(found ?? null);
  }, [editor]);

  useEffect(() => {
    setSuggesting(editor, suggesting ? myId : null);
  }, [editor, suggesting, myId]);

  // Review suggested edits: its command, and Google's chord (hold Ctrl+Alt,
  // press O then U), which the chord reader runs (typing/navigate.ts).
  useEffect(() => {
    const dom = editor.view.dom;
    const open = () => setReviewing(true);
    dom.addEventListener(REVIEW_EVENT, open);
    return () => dom.removeEventListener(REVIEW_EVENT, open);
  }, [editor]);

  // The cards move with their words once the pages are laid out (a frame
  // after a change), when the pane or the page moves, and when a card or
  // the toolbar comes, goes, grows, or moves. A new card takes its place
  // before it shows.
  useLayoutEffect(() => {
    const pane = column?.closest<HTMLElement>("[data-reader-root]");
    if (!pane || !column) return;
    let frame = 0;
    // While the column holds a card the page keeps the margin it stands in,
    // as Google Docs keeps it for its discussions.
    let held = false;
    const hold = (on: boolean) => {
      if (on === held) return;
      held = on;
      pane.dispatchEvent(new CustomEvent<boolean>("docs:margin", { detail: on }));
    };
    const fit = () => fitColumn(pane, column);
    const place = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      fit();
      hold(placeCards(editor, pane, column));
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    const boxes = `${FIXED}, ${COLUMN_CARD}`;
    const sizes = new ResizeObserver(later);
    const watch = () => {
      sizes.disconnect();
      for (const el of [pane, editor.view.dom.closest("[data-docs-editor]"), ...column.querySelectorAll(boxes)]) {
        if (el) sizes.observe(el);
      }
    };
    // The column's and the cards' own places are this layer's writes, and
    // what changes inside a card changes its size.
    const changes = new MutationObserver((records) => {
      const own = (r: MutationRecord) =>
        (r.type === "attributes" && (r.target === column || (r.target as Element).matches(COLUMN_CARD))) ||
        r.target.parentElement?.closest(boxes);
      if (records.every(own)) return;
      watch();
      place();
    });
    place();
    watch();
    editor.on("transaction", later);
    changes.observe(column, { childList: true, subtree: true, attributeFilter: ["style"] });
    pane.addEventListener("transitionend", later);
    // The pane's scroll, and a split view's strip moving the pane.
    document.addEventListener("scroll", fit, true);
    window.addEventListener("resize", later);
    return () => {
      cancelAnimationFrame(frame);
      editor.off("transaction", later);
      sizes.disconnect();
      changes.disconnect();
      pane.removeEventListener("transitionend", later);
      document.removeEventListener("scroll", fit, true);
      window.removeEventListener("resize", later);
      hold(false);
    };
  }, [editor, column]);

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
      {column && !viewing && createPortal(cards, column)}
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

"use client";

import type { Highlight } from "@/components/reader/block-view";
import type { TFunc } from "@/lib/i18n/dictionaries";

// Marks inside a table's html (SPEC.md §6): a table with rendered text is
// article text — a selection inside it opens the text toolbar, and its
// highlights, annotations, and the selection tint paint on the passage, as
// they do in a paragraph — not a figure that rings whole. Text blocks paint
// their marks in the React tree (block-view.tsx markedText); a table's html
// is set as one string, so its marks are painted here, on the DOM, after
// the html lands: the block's text offsets map onto the html's text nodes
// (the table's DOM text equals the stored block text, globals.css
// .cell-gap), each passage is wrapped in a <mark> with the same classes as
// a paragraph's, and every repaint unwraps the last paint first, so the
// offsets are always taken over the html's own text.

const MARK = "data-table-mark";
const SKIP = "[data-anchor-skip]";

// The kinds a table paints. Links, citations, and styles live in the html
// itself; the rest are the reader's marks.
const PAINTED = new Set<Highlight["kind"]>([
  "anchor",
  "selection",
  "pending-link",
  "salience",
  "simplify",
  "extract",
  "term",
]);

function anchorClass(color: string | null | undefined): string {
  if (color === "sage") return "hl-sage";
  if (color === "gold") return "hl-gold";
  if (color === "plum") return "hl-plum";
  return "anchor-mark";
}

/** What the paint depends on: the same string, the same paint. */
export function marksSignature(highlights: Highlight[]): string {
  return JSON.stringify(
    highlights
      .filter((h) => PAINTED.has(h.kind))
      .map((h) => [h.kind, h.start, h.end, h.sourceId, h.color, h.fresh, h.leaving, h.noteId, h.annotation, h.extractId, h.extractLabel, h.extractOrigin, h.definition]),
  );
}

function unpaint(container: HTMLElement): void {
  for (const mark of Array.from(container.querySelectorAll(`[${MARK}]`))) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  }
  container.normalize();
}

/** The text nodes that count for offsets, in order, each with the offset
    its first character has in the block text. */
function textNodes(container: HTMLElement): { node: Text; start: number }[] {
  const out: { node: Text; start: number }[] = [];
  let at = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    if (node.parentElement?.closest(SKIP)) continue;
    out.push({ node, start: at });
    at += node.length;
  }
  return out;
}

// One passage [from, to) wrapped: every text node it crosses is split at
// the passage's ends and the piece inside is wrapped in its own mark.
function wrap(container: HTMLElement, from: number, to: number, make: () => HTMLElement): void {
  for (const { node, start } of textNodes(container)) {
    const end = start + node.length;
    if (end <= from || start >= to) continue;
    let piece = node;
    if (from > start) piece = piece.splitText(from - start);
    if (to < end) piece.splitText(to - Math.max(from, start));
    const mark = make();
    piece.parentNode?.insertBefore(mark, piece);
    mark.appendChild(piece);
  }
}

/** Paint the block's marks into the table's html. False when the html's
    text is not the block text — then nothing is painted, and the caller
    rings the block instead. */
export function paintTableMarks(container: HTMLElement, text: string, highlights: Highlight[], t: TFunc): boolean {
  unpaint(container);
  const nodes = textNodes(container);
  const domText = nodes.map((n) => n.node.data).join("");
  if (domText !== text) return false;
  const painted = highlights.filter((h) => PAINTED.has(h.kind));
  if (painted.length === 0) return true;

  const bounds = new Set<number>([0, text.length]);
  for (const h of painted) {
    bounds.add(Math.max(0, Math.min(h.start, text.length)));
    bounds.add(Math.max(0, Math.min(h.end, text.length)));
  }
  const points = [...bounds].sort((a, b) => a - b);
  for (let i = 0; i < points.length - 1; i++) {
    const [from, to] = [points[i], points[i + 1]];
    if (from === to) continue;
    const covering = painted.filter((h) => h.start <= from && h.end >= to);
    if (covering.length === 0) continue;
    const anchors = covering.filter((h) => h.kind === "anchor");
    const anchor =
      anchors.length > 1 ? anchors.reduce((n, h) => (h.end - h.start < n.end - n.start ? h : n)) : anchors[0];
    const salience = covering.find((h) => h.kind === "salience");
    const simplify = covering.find((h) => h.kind === "simplify");
    const extract = covering.find((h) => h.kind === "extract");
    const term = covering.find((h) => h.kind === "term");
    const selection = covering.find((h) => h.kind === "selection" || h.kind === "pending-link");
    if (anchor || salience || simplify || extract || selection) {
      const leaving = Boolean(anchor?.leaving);
      const focusable = Boolean(anchor?.annotation && anchor.sourceId && !leaving);
      const noteMark = !anchor?.annotation && anchor?.noteId && !leaving ? anchor.noteId : null;
      const extractMark = extract && !focusable && !noteMark ? extract : null;
      const markClass = simplify
        ? "simplify-mark"
        : anchor
          ? anchorClass(anchor.color)
          : extract
            ? extract.extractOrigin
              ? "extract-origin-mark"
              : "extract-mark"
            : salience
              ? "salience-mark"
              : "";
      const selectionClass = selection ? (selection.kind === "pending-link" ? " link-pending-mark" : " selection-mark") : "";
      const painter = simplify ?? anchor ?? extract ?? salience;
      const sweep = Boolean(painter?.fresh && !leaving);
      const className = `${markClass}${selectionClass}${anchors.length > 1 ? " hl-stacked" : ""}${sweep ? " mark-sweep" : ""}${leaving ? " mark-out" : ""} rounded-[4px] ${focusable || noteMark || extractMark ? "annotation-mark" : ""}`;
      const tip = focusable
        ? t("panes.viewAnnotation")
        : noteMark
          ? t("panes.viewNote")
          : extractMark
            ? t("panes.extractOpenCard", { label: extractMark.extractLabel ?? "" })
            : undefined;
      wrap(container, from, to, () => {
        const mark = document.createElement("mark");
        mark.setAttribute(MARK, "");
        mark.className = className.replace(/\s+/g, " ").trim();
        if (anchor?.sourceId) mark.dataset.sourceId = anchor.sourceId;
        if (tip) mark.dataset.tip = tip;
        if (sweep && painter?.freshDelay) mark.style.animationDelay = `${painter.freshDelay}ms`;
        if (focusable && anchor?.sourceId) mark.dataset.openAnnotation = anchor.sourceId;
        else if (noteMark) mark.dataset.openNote = noteMark;
        else if (extractMark) mark.dataset.openExtract = extractMark.extractId ?? "";
        return mark;
      });
    } else if (term) {
      // Glossary term, as in a paragraph: hover for the definition; press
      // for the selection toolbar on the term.
      const tip = term.definition ? `${term.definition}\n\n${t("panes.clickForTools")}` : t("panes.clickForTools");
      wrap(container, from, to, () => {
        const span = document.createElement("span");
        span.setAttribute(MARK, "");
        span.className = "glossary-term cursor-pointer border-b-2 border-dotted border-clay-400 hover:border-clay-600";
        span.dataset.tip = tip;
        span.dataset.termStart = String(term.start);
        span.dataset.termEnd = String(term.end);
        return span;
      });
    }
  }
  return true;
}

/** A click on a painted mark opens what a paragraph's mark opens: the
    annotation, the note, or the match card. Bound once per container. */
export function bindTableMarkClicks(container: HTMLElement): () => void {
  const onClick = (e: MouseEvent) => {
    const mark = (e.target as Element | null)?.closest<HTMLElement>(`[${MARK}]`);
    if (!mark) return;
    const { openAnnotation, openNote, openExtract } = mark.dataset;
    if (openAnnotation) {
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent("dissect:open-annotation", { detail: { sourceId: openAnnotation } }));
    } else if (openNote) {
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent("dissect:show-note", { detail: { noteId: openNote } }));
    } else if (openExtract !== undefined) {
      e.stopPropagation();
      window.dispatchEvent(
        new CustomEvent("dissect:extract-chip", { detail: { extractId: openExtract, element: mark } }),
      );
    }
  };
  // A term opens its toolbar on mousedown, so the toolbar survives the
  // selection capture on mouseup (block-view.tsx).
  const onDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    const term = (e.target as Element | null)?.closest<HTMLElement>("[data-term-start]");
    if (!term) return;
    e.stopPropagation();
    window.dispatchEvent(
      new CustomEvent("dissect:term-tools", {
        detail: { start: Number(term.dataset.termStart), end: Number(term.dataset.termEnd), origin: term },
      }),
    );
  };
  container.addEventListener("click", onClick);
  container.addEventListener("mousedown", onDown);
  return () => {
    container.removeEventListener("click", onClick);
    container.removeEventListener("mousedown", onDown);
  };
}

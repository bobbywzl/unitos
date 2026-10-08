"use client";

import type { Highlight } from "@/components/reader/block-view";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { anchorablePieces } from "@/lib/anchors/dom";
import { endSweep } from "@/lib/mark-sweep";

// Marks inside a table's html (SPEC.md §6): a table with rendered text is
// article text — a selection inside it opens the text toolbar, and its
// highlights, annotations, and the selection tint paint on the passage, as
// they do in a paragraph — not a figure that rings whole. Text blocks paint
// their marks in the React tree (block-view.tsx markedText); a table's html
// is set as one string, so its marks are painted here, on the DOM, after
// the html lands: the block's text offsets map onto the html's text nodes,
// each passage is wrapped in a <mark> with the same classes as a
// paragraph's, and every repaint unwraps the last paint first, so the
// offsets are always taken over the html's own text. The html's text is
// read as a selection reads it (lib/anchors/dom.ts): the cell gaps the html
// carries (globals.css .cell-gap), or the separators the walk adds to a
// table without them, so it equals the stored block text. Where a web
// table's cells keep blank text the stored text does not (spaces around a
// cell's words), the offsets map over the words alone.

const MARK = "data-table-mark";

// The kinds a table paints. Web links, citations, and styles live in the
// html itself; the rest are the reader's marks, and the links across texts
// the reader made (kind "link"), drawn as a paragraph draws them.
const PAINTED = new Set<Highlight["kind"]>([
  "link",
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

/** The order of the anchors on one stretch of words: the innermost (the
    shortest) first, then by source id. Source ids are made in time order,
    so equal spans keep the order they were made in on every load. */
function byStack(a: Highlight, b: Highlight): number {
  return a.end - a.start - (b.end - b.start) || (a.sourceId ?? "").localeCompare(b.sourceId ?? "");
}

/** The notes and annotations on one stretch of words (SPEC.md §6), for a
    paragraph's marks, a table's, and a figure's label alike. anchors: every
    one, innermost first. anchor: the one the mark paints — the innermost,
    except that a plain note's mark is the default clay, so where a
    highlight or a comment also covers the words the reader's own color
    shows. stack: every one a click can open; more than one, and the click
    opens the chooser. */
export function markStack(covering: Highlight[]): {
  anchors: Highlight[];
  anchor: Highlight | undefined;
  stack: Highlight[];
} {
  const anchors = covering.filter((h) => h.kind === "anchor").sort(byStack);
  const inner = anchors[0];
  const anchor =
    inner && !inner.annotation ? (anchors.find((h) => h.annotation && (h.color || h.comment)) ?? inner) : inner;
  const stack = anchors.filter((h) => h.sourceId && (h.annotation || h.noteId) && !h.leaving);
  return { anchors, anchor, stack };
}

/** What the paint depends on: the same string, the same paint. */
export function marksSignature(highlights: Highlight[]): string {
  return JSON.stringify(
    highlights
      .filter((h) => PAINTED.has(h.kind))
      .map((h) => [h.kind, h.start, h.end, h.sourceId, h.color, h.fresh, h.leaving, h.noteId, h.annotation, h.comment, h.extractId, h.extractLabel, h.extractOrigin, h.definition, h.href, h.linkId, h.linkTitle, h.linkReason]),
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
    its first character has in the html's anchorable text. */
function textNodes(container: HTMLElement): { node: Text; start: number }[] {
  return anchorablePieces(container).flatMap((p) => (p.node ? [{ node: p.node, start: p.start }] : []));
}

const BLANK = /\s/u;

/** Block text offsets → offsets in the html's text, when the two hold the
    same words and differ only in blank text: a passage's start maps to its
    first word character, its end to just after its last. Null when the
    words differ. */
export function blankTolerantMap(domText: string, text: string): ((offset: number, end: boolean) => number) | null {
  // dom[k]: where the block text's k-th non-blank character stands in domText.
  const dom: number[] = [];
  const words: number[] = [];
  let j = 0;
  for (let i = 0; i < text.length; i++) {
    if (BLANK.test(text[i])) continue;
    while (j < domText.length && BLANK.test(domText[j])) j++;
    if (j >= domText.length || domText[j] !== text[i]) return null;
    words.push(i);
    dom.push(j);
    j++;
  }
  for (; j < domText.length; j++) if (!BLANK.test(domText[j])) return null;
  // first[i]: index into words of the first non-blank character at or after i.
  const first: number[] = new Array(text.length + 1);
  for (let i = text.length, k = words.length; i >= 0; i--) {
    while (k > 0 && words[k - 1] >= i) k--;
    first[i] = k;
  }
  return (offset, end) => {
    const i = Math.max(0, Math.min(offset, text.length));
    const k = first[i];
    if (end) return k > 0 ? dom[k - 1] + 1 : 0;
    return k < dom.length ? dom[k] : domText.length;
  };
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
    words are not the block text's — then nothing is painted, and the caller
    rings the block instead. */
export function paintTableMarks(container: HTMLElement, blockId: string, text: string, highlights: Highlight[], t: TFunc): boolean {
  unpaint(container);
  const domText = anchorablePieces(container)
    .map((p) => p.text)
    .join("");
  // The selection tint's offsets were taken over the html's text
  // (reader-interactions captureSelection); every stored mark's over the
  // block text, mapped onto the html's text when the two differ in blanks.
  const map = domText === text ? null : blankTolerantMap(domText, text);
  if (domText !== text && !map) return false;
  // origin: a mapped mark's own highlight, which keeps the block offsets.
  const origin = new Map<Highlight, Highlight>();
  const painted = highlights
    .filter((h) => PAINTED.has(h.kind))
    .map((h) => {
      if (!map || h.kind === "selection" || h.kind === "pending-link") return h;
      const start = map(h.start, false);
      const mapped = { ...h, start, end: Math.max(start, map(h.end, true)) };
      origin.set(mapped, h);
      return mapped;
    });
  if (painted.length === 0) return true;

  const bounds = new Set<number>([0, domText.length]);
  for (const h of painted) {
    bounds.add(Math.max(0, Math.min(h.start, domText.length)));
    bounds.add(Math.max(0, Math.min(h.end, domText.length)));
  }
  const points = [...bounds].sort((a, b) => a - b);
  for (let i = 0; i < points.length - 1; i++) {
    const [from, to] = [points[i], points[i + 1]];
    if (from === to) continue;
    const covering = painted.filter((h) => h.start <= from && h.end >= to);
    if (covering.length === 0) continue;
    const { anchors, anchor, stack } = markStack(covering);
    const salience = covering.find((h) => h.kind === "salience");
    const simplify = covering.find((h) => h.kind === "simplify");
    const extract = covering.find((h) => h.kind === "extract");
    const term = covering.find((h) => h.kind === "term");
    const selection = covering.find((h) => h.kind === "selection" || h.kind === "pending-link");
    if (anchor || salience || simplify || extract || selection) {
      const leaving = Boolean(anchor?.leaving);
      const stacked = stack.length > 1;
      const focusable = Boolean(anchor?.annotation && anchor.sourceId && !leaving) || (stacked && !leaving);
      const noteMark = !focusable && !anchor?.annotation && anchor?.noteId && !leaving ? anchor.noteId : null;
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
      const shown = simplify ?? anchor ?? extract ?? salience;
      const painter = shown ? (origin.get(shown) ?? shown) : undefined;
      const sweep = Boolean(painter?.fresh && !leaving);
      const className = `${markClass}${selectionClass}${anchors.length > 1 ? " hl-stacked" : ""}${sweep ? " mark-sweep" : ""}${leaving ? " mark-out" : ""} rounded-[4px] ${focusable || noteMark || extractMark ? "annotation-mark" : ""}`;
      const tip =
        focusable && (anchor?.annotation || stack.some((h) => h.annotation))
          ? t("panes.viewAnnotation")
          : focusable || noteMark
          ? t("panes.viewNote")
          : extractMark
            ? t("panes.extractOpenCard", { label: extractMark.extractLabel ?? "" })
            : undefined;
      // The keyboard, as in a paragraph (block-view.tsx markTab): a mark's
      // first words take the focus, named by its tip, and Enter opens what
      // a click opens (bindTableMarkClicks).
      let markTab = focusable && (anchor?.start === from || stack.some((h) => h.start === from));
      wrap(container, from, to, () => {
        const mark = document.createElement("mark");
        mark.setAttribute(MARK, "");
        if (markTab) {
          markTab = false;
          mark.tabIndex = 0;
          mark.setAttribute("role", "button");
          if (tip) mark.setAttribute("aria-label", tip);
        }
        mark.className = className.replace(/\s+/g, " ").trim();
        if (anchor?.sourceId) mark.dataset.sourceId = anchor.sourceId;
        // Stacked words: every source on them (block-view.tsx data-source-ids).
        if (stacked) mark.dataset.sourceIds = stack.map((h) => h.sourceId).join(" ");
        if (tip) mark.dataset.tip = tip;
        if (sweep && painter?.freshDelay) mark.style.animationDelay = `${painter.freshDelay}ms`;
        if (sweep && painter) {
          // The sweep ran: the class comes off (lib/mark-sweep.ts).
          mark.addEventListener("animationend", (e) => {
            if (e.animationName !== "mark-sweep") return;
            painter.fresh = false;
            endSweep(mark, { blockId, start: painter.start, end: painter.end });
          });
        }
        const opens = anchor?.sourceId ?? stack[0]?.sourceId;
        if (focusable && opens) mark.dataset.openAnnotation = opens;
        else if (noteMark) mark.dataset.openNote = noteMark;
        else if (extractMark) mark.dataset.openExtract = extractMark.extractId ?? "";
        return mark;
      });
    } else if (term) {
      const own = origin.get(term) ?? term;
      // Glossary term, as in a paragraph: hover for the definition; press
      // for the selection toolbar on the term.
      const tip = term.definition ? `${term.definition}\n\n${t("panes.clickForTools")}` : t("panes.clickForTools");
      wrap(container, from, to, () => {
        const span = document.createElement("span");
        span.setAttribute(MARK, "");
        span.className = "glossary-term cursor-pointer border-b-2 border-dotted border-clay-400 hover:border-clay-600";
        span.dataset.tip = tip;
        span.dataset.termStart = String(own.start);
        span.dataset.termEnd = String(own.end);
        return span;
      });
    }
  }
  // A link across texts the reader made: its words wrapped in the link, over
  // any mark on them, as a paragraph draws it (block-view.tsx markedText).
  // The text is not changed, so the replica's text stays the block's.
  for (const link of painted) {
    if (link.kind !== "link" || !link.href) continue;
    const tip = [link.linkTitle ? t("panes.linkedTo", { title: link.linkTitle }) : null, link.linkReason]
      .filter((s): s is string => Boolean(s))
      .join("\n");
    wrap(container, Math.max(0, link.start), Math.min(domText.length, link.end), () => {
      const a = document.createElement("a");
      a.setAttribute(MARK, "");
      a.href = link.href ?? "";
      a.draggable = false;
      a.className = "link-mark rounded-[4px]";
      if (link.linkId) a.dataset.linkId = link.linkId;
      if (tip) a.dataset.tip = tip;
      return a;
    });
  }
  return true;
}

function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  const r = document.caretRangeFromPoint?.(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : null;
}

/** A press where the browser starts no selection — a slide's chart (its
    data rides hidden under the drawing), a sheet's row number, a link
    across texts — starts one here (SPEC.md §27): at the chart's first data
    word, the row's first cell, or the link's word under the pointer. The
    selection follows the pointer until it lifts; a release on the same
    chart or row number selects it whole. The selection toolbar opens on the
    words as for any drag. */
function pressSelect(container: HTMLElement, e: MouseEvent): void {
  if (e.button !== 0 || e.detail > 1 || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target as Element | null;
  const link = target?.closest<HTMLElement>(`a[${MARK}]`);
  const chart = link ? null : target?.closest<HTMLElement>(".reader-slide .sh.sc");
  const row = link || chart ? null : target?.closest<HTMLElement>("th.sheet-rn");
  const own = link ?? chart ?? row;
  if (!own || !container.contains(own)) return;
  const scope = chart ? chart.querySelector<HTMLElement>(".scd-hidden") : row ? row.closest("tr") : null;
  const words = scope ? anchorablePieces(scope as HTMLElement).filter((p) => p.node && p.text.trim()) : [];
  const first = words[0]?.node;
  const last = words[words.length - 1]?.node;
  const start = link ? caretAt(e.clientX, e.clientY) : first ? { node: first, offset: 0 } : null;
  const selection = window.getSelection();
  if (!start || !selection) return;
  e.preventDefault();
  selection.collapse(start.node, start.offset);
  const onMove = (ev: MouseEvent) => {
    const at = caretAt(ev.clientX, ev.clientY);
    if (at && container.contains(at.node)) selection.extend(at.node, at.offset);
  };
  // Capture: the selection is whole before the reader reads it on mouseup.
  const onUp = (ev: MouseEvent) => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp, true);
    if (!link && first && last && ev.target instanceof Node && own.contains(ev.target)) {
      selection.setBaseAndExtent(first, 0, last, last.length);
    }
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp, true);
}

// Where the last press on a mark began.
let press: { x: number; y: number } | null = null;

/** Note where a press on a mark begins (a paragraph's mark and a table's). */
export function pressMark(e: { button: number; clientX: number; clientY: number }): void {
  press = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
}

/** Whether the click on a mark ends a drag: the press selected words, or the
    pointer moved more than 4px since it went down. A drag inside a mark is a
    selection, and the selection toolbar opens on its words; only a plain
    click opens what the mark opens. */
export function clickEndsDrag(e: { clientX: number; clientY: number; detail: number }): boolean {
  const from = press;
  press = null;
  if (e.detail === 0) return false;
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && selection.toString().trim() !== "") return true;
  return from !== null && Math.hypot(e.clientX - from.x, e.clientY - from.y) > 4;
}

/** A click on a painted mark opens what a paragraph's mark opens: the
    annotation, the note, or the match card. Bound once per container. */
export function bindTableMarkClicks(container: HTMLElement): () => void {
  const onClick = (e: MouseEvent) => {
    const mark = (e.target as Element | null)?.closest<HTMLElement>(`[${MARK}]`);
    if (!mark) return;
    // A link across texts: a plain click follows it; the click that ends a
    // drag follows nothing.
    if (mark instanceof HTMLAnchorElement) {
      if (!clickEndsDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (clickEndsDrag(e)) return;
    open(mark, e.clientX, e.clientY, e);
  };
  // What a press on a mark opens: the annotation, the note, or the match card.
  const open = (mark: HTMLElement, x: number, y: number, e: Event) => {
    const { openAnnotation, openNote, openExtract, sourceIds } = mark.dataset;
    if (openAnnotation) {
      e.stopPropagation();
      // Stacked words: the chooser at the click lists every one (SPEC.md §6).
      const sources = sourceIds?.split(" ") ?? [];
      window.dispatchEvent(
        new CustomEvent("dissect:open-annotation", {
          detail: {
            sourceId: openAnnotation,
            ...(sources.length > 1 ? { sources, x, y } : {}),
          },
        }),
      );
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
    const mark = (e.target as Element | null)?.closest<HTMLElement>(`[${MARK}]`);
    if (mark) pressMark(e);
    // The press focuses a mark on the Tab path after this handler: the focus
    // goes back to the page once it has, so Space still scrolls.
    const focused = (e.target as Element | null)?.closest<HTMLElement>(`[${MARK}][tabindex]`);
    if (focused) {
      window.setTimeout(() => {
        if (document.activeElement === focused) focused.blur();
      }, 0);
    }
    if (e.button !== 0) return;
    pressSelect(container, e);
    const term = (e.target as Element | null)?.closest<HTMLElement>("[data-term-start]");
    if (!term) return;
    e.stopPropagation();
    window.dispatchEvent(
      new CustomEvent("dissect:term-tools", {
        detail: { start: Number(term.dataset.termStart), end: Number(term.dataset.termEnd), origin: term },
      }),
    );
  };
  // Enter on a mark the keys reached opens it; Space stays the page's.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    const mark = (e.target as Element | null)?.closest<HTMLElement>(`[${MARK}][tabindex]`);
    if (!mark) return;
    e.preventDefault();
    const r = mark.getBoundingClientRect();
    open(mark, r.left, r.bottom - 12, e);
  };
  container.addEventListener("click", onClick);
  container.addEventListener("mousedown", onDown);
  container.addEventListener("keydown", onKey);
  return () => {
    container.removeEventListener("click", onClick);
    container.removeEventListener("mousedown", onDown);
    container.removeEventListener("keydown", onKey);
  };
}

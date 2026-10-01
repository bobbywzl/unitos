import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { PX_PER_PT } from "@/components/docs/page/geometry";

// Tab stops (SPEC.md §29), Google Docs': a paragraph's own stops — left,
// center, or right, in points from the text column's left edge — and past
// the last one the default stops every half inch. A paragraph stores its
// stops as one string ("72:left 144:center"). A tab is drawn as wide as it
// takes to reach its stop: its tab-size puts the tab's end there, with the
// words after it left of, around, or right of the stop.

export type TabAlign = "left" | "center" | "right";
export type TabStop = { pt: number; align: TabAlign };

const STOP = /(\d+(?:\.\d+)?):(left|center|right)/g;
const DEFAULT_STEP = 36 * PX_PER_PT;

export function parseTabStops(value: unknown): TabStop[] {
  if (typeof value !== "string") return [];
  return [...value.matchAll(STOP)].map((m) => ({ pt: Number(m[1]), align: m[2] as TabAlign })).sort((a, b) => a.pt - b.pt);
}

function formatTabStops(stops: TabStop[]): string | null {
  const sorted = [...stops].sort((a, b) => a.pt - b.pt);
  return sorted.length > 0 ? sorted.map((s) => `${Math.round(s.pt * 100) / 100}:${s.align}`).join(" ") : null;
}

/** Change the stops of every paragraph in the selection, one undo step. */
export function editTabStops(editor: Editor, change: (stops: TabStop[]) => TabStop[]): void {
  const { state } = editor;
  const tr = state.tr;
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
    if (node.type.name !== "paragraph" && node.type.name !== "heading") return true;
    const next = formatTabStops(change(parseTabStops(node.attrs.tabStops)));
    if (next !== (node.attrs.tabStops ?? null)) tr.setNodeMarkup(pos, undefined, { ...node.attrs, tabStops: next });
    return false;
  });
  if (tr.docChanged) editor.view.dispatch(tr);
  editor.commands.focus();
}

type Rect = { left: number; top: number; bottom: number };

/** Two places on one line: they share half the shorter one's height. A
    formula or a superscript stands higher or lower than the words around
    it, so the tops alone do not tell a line. */
function sameLine(a: Rect, b: Rect): boolean {
  return Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) >= Math.min(a.bottom - a.top, b.bottom - b.top) / 2;
}

/** Each tab's tab-size in px, by its document position, in the paragraphs
    with stops of their own. Every length is in CSS px at 100%, from the text
    column's left edge. */
export function tabSizes(view: EditorView): Map<number, number> {
  const sizes = new Map<number, number>();
  // The layout is read only for a paragraph with stops and tabs: each pass
  // runs this, on every key.
  let column: DOMRect | null = null;
  const x = (clientX: number) => {
    column ??= view.dom.getBoundingClientRect();
    const scale = view.dom.offsetWidth > 0 ? column.width / view.dom.offsetWidth : 1;
    return (clientX - column.left) / scale;
  };
  view.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const stops = parseTabStops(node.attrs.tabStops);
    if (stops.length === 0 || !node.textContent.includes("\t")) return false;
    const el = view.nodeDOM(pos);
    if (!(el instanceof HTMLElement)) return false;
    // CSS measures tab stops from the paragraph's content box.
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const origin = x(box.left) + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.borderLeftWidth) || 0);
    const right = x(box.right) - (parseFloat(cs.paddingRight) || 0) - (parseFloat(cs.borderRightWidth) || 0);
    // A tab narrower than half a character jumps to the stop after.
    const least = (parseFloat(cs.fontSize) || 15) * 0.4;
    const tabs: { pos: number; start: Rect }[] = [];
    node.descendants((child, offset) => {
      if (!child.isText || !child.text) return false;
      for (let i = child.text.indexOf("\t"); i >= 0; i = child.text.indexOf("\t", i + 1)) {
        const at = pos + 1 + offset + i;
        tabs.push({ pos: at, start: view.coordsAtPos(at, 1) });
      }
      return false;
    });
    const endPos = pos + node.nodeSize - 1;
    let cursor = 0;
    tabs.forEach((tab, i) => {
      const next = tabs[i + 1];
      const lineStart = i === 0 || !sameLine(tabs[i - 1].start, tab.start);
      if (lineStart) cursor = x(tab.start.left);
      // The words after the tab, up to the next tab or the paragraph's end,
      // measured where they stand: on the tab's line, or on the next once
      // they wrapped (a tab sent to a right stop took their room).
      const to = next ? next.pos : endPos;
      let words = 0;
      if (to > tab.pos + 1) {
        const a = view.coordsAtPos(tab.pos + 1, 1);
        const b = view.coordsAtPos(to, -1);
        if (sameLine(a, b)) words = Math.max(0, x(b.left) - x(a.left));
      }
      let stopAt = (Math.floor((cursor + least) / DEFAULT_STEP) + 1) * DEFAULT_STEP;
      for (const stop of stops) {
        const at = stop.pt * PX_PER_PT;
        if (at <= cursor) continue;
        const lead = stop.align === "left" ? 0 : stop.align === "center" ? words / 2 : words;
        stopAt = Math.max(cursor + least, at - lead);
        // Words to a right stop at the line's end that find no room before
        // it go to the next line with their tab (docs.css .docs-tab breaks a
        // line before a tab) and end at the stop there, as TeX sets a
        // proof's box. The tab's size is the same on either line.
        if (stop.align === "right" && at >= right - 1 && at - words - origin >= least) stopAt = at - words;
        break;
      }
      // Rounded down: words to a right stop at the column's edge end on it,
      // never a hair past it, which would wrap them.
      sizes.set(tab.pos, Math.floor((stopAt - origin) * 100) / 100);
      cursor = stopAt + words;
    });
    return false;
  });
  return sizes;
}

// Each tab's span carries a class (docs.css). .docs-tab lets a line break
// before the tab, as Word takes a tab that finds no room to the next line:
// the page keeps its spaces (white-space: break-spaces), so a tab at a
// line's end takes room, and without the break the word before it went to
// the next line with it. .docs-tab-line draws an underlined tab's line, as
// Word draws one: a form's blank to fill in ("Name:" and the line after it
// to its stop); Chromium draws no underline under a tab. The set is kept as
// the text changes: each transaction reads again only the paragraphs its
// steps touched.

const tabLinesKey = new PluginKey<DecorationSet>("docsTabLines");

/** The tabs in the paragraphs from `from` to `to`; code keeps its tabs. */
function tabLines(doc: PMNode, from: number, to: number): Decoration[] {
  const out: Decoration[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return !node.type.spec.code;
    const text = node.text ?? "";
    if (!text.includes("\t")) return false;
    const underlined = node.marks.some((m) => m.type.name === "underline");
    for (let i = text.indexOf("\t"); i >= 0; i = text.indexOf("\t", i + 1)) out.push(Decoration.inline(pos + i, pos + i + 1, { class: underlined ? "docs-tab docs-tab-line" : "docs-tab" }));
    return false;
  });
  return out;
}

/** The part of the new document a transaction's steps touched, widened to
    whole paragraphs; null when it touched none. */
function touched(tr: Transaction): [number, number] | null {
  let from = Infinity;
  let to = -Infinity;
  tr.steps.forEach((step, i) => {
    const range = step as unknown as { from?: unknown; to?: unknown };
    if (typeof range.from !== "number" || typeof range.to !== "number") return;
    const rest = tr.mapping.slice(i);
    from = Math.min(from, rest.map(range.from, -1));
    to = Math.max(to, rest.map(range.to, 1));
  });
  if (from > to) return null;
  const size = tr.doc.content.size;
  const $from = tr.doc.resolve(Math.max(0, Math.min(size, from)));
  const $to = tr.doc.resolve(Math.max(0, Math.min(size, to)));
  return [$from.depth > 0 ? $from.before(1) : $from.pos, $to.depth > 0 ? $to.after(1) : $to.pos];
}

/** The underlined tabs' lines (the page editor's pages, ext/page.ts). */
export function tabLinesPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: tabLinesKey,
    state: {
      init: (_, state) => DecorationSet.create(state.doc, tabLines(state.doc, 0, state.doc.content.size)),
      apply: (tr, set) => {
        if (!tr.docChanged) return set;
        const range = touched(tr);
        const mapped = set.map(tr.mapping, tr.doc);
        if (!range) return mapped;
        return mapped.remove(mapped.find(range[0], range[1])).add(tr.doc, tabLines(tr.doc, range[0], range[1]));
      },
    },
    props: { decorations: (state) => tabLinesKey.getState(state) },
  });
}

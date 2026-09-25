import type { Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
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

/** Each tab's tab-size in px, by its document position, in the paragraphs
    with stops of their own. Every length is in CSS px at 100%, from the text
    column's left edge. */
export function tabSizes(view: EditorView): Map<number, number> {
  const sizes = new Map<number, number>();
  const column = view.dom.getBoundingClientRect();
  const scale = view.dom.offsetWidth > 0 ? column.width / view.dom.offsetWidth : 1;
  const x = (clientX: number) => (clientX - column.left) / scale;
  view.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const stops = parseTabStops(node.attrs.tabStops);
    const el = view.nodeDOM(pos);
    if (stops.length === 0 || !node.textContent.includes("\t") || !(el instanceof HTMLElement)) return false;
    // CSS measures tab stops from the paragraph's content box.
    const cs = getComputedStyle(el);
    const origin = x(el.getBoundingClientRect().left) + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.borderLeftWidth) || 0);
    // A tab narrower than half a character jumps to the stop after.
    const least = (parseFloat(cs.fontSize) || 15) * 0.4;
    const tabs: { pos: number; left: number; right: number; top: number }[] = [];
    node.descendants((child, offset) => {
      if (!child.isText || !child.text) return false;
      for (let i = child.text.indexOf("\t"); i >= 0; i = child.text.indexOf("\t", i + 1)) {
        const at = pos + 1 + offset + i;
        const start = view.coordsAtPos(at, 1);
        tabs.push({ pos: at, left: x(start.left), right: x(view.coordsAtPos(at + 1, -1).left), top: start.top });
      }
      return false;
    });
    const end = view.coordsAtPos(pos + node.nodeSize - 1, -1);
    let cursor = 0;
    tabs.forEach((tab, i) => {
      const next = tabs[i + 1];
      const lineStart = i === 0 || tabs[i - 1].top !== tab.top;
      if (lineStart) cursor = tab.left;
      // The words after the tab, up to the next tab or the line's end.
      const upTo = next && next.top === tab.top ? next.left : end.top === tab.top ? x(end.left) : tab.right;
      const words = Math.max(0, upTo - tab.right);
      let stopAt = (Math.floor((cursor + least) / DEFAULT_STEP) + 1) * DEFAULT_STEP;
      for (const stop of stops) {
        const at = stop.pt * PX_PER_PT;
        if (at <= cursor) continue;
        stopAt = Math.max(cursor + least, stop.align === "left" ? at : stop.align === "center" ? at - words / 2 : at - words);
        break;
      }
      sizes.set(tab.pos, Math.round((stopAt - origin) * 100) / 100);
      cursor = stopAt + words;
    });
    return false;
  });
  return sizes;
}

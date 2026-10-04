import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// The left-off mark in the page editor (SPEC.md §6, §30): the block reader's
// small ribbon and faint line above the block of the reading position the
// document opened with (reader.tsx LeftOffMark), so the reader finds the
// place again after scrolling away. Its tooltip reads You left off here. It
// is drawn over the page, never written into the rich text: a widget at the
// block's start that takes no room (css/layer.css .docs-left-off), and it
// moves with the block as the text changes. It never prints.

const leftOffKey = new PluginKey<DecorationSet>("docsLeftOff");

type Meta = { blockId: string | null; label: string };

/** Where the block with this id starts its words: a paragraph's, a heading's,
    a list line's, a cell's; null when the page has no such block. */
function blockStart(doc: PMNode, blockId: string): number | null {
  let at: number | null = null;
  doc.descendants((node, pos) => {
    if (at !== null) return false;
    if (node.isTextblock) {
      if (node.attrs.blockId === blockId) at = pos;
      return false;
    }
    return true;
  });
  return at;
}

function markDom(label: string): HTMLElement {
  const mark = document.createElement("span");
  mark.className = "docs-left-off";
  mark.contentEditable = "false";
  mark.dataset.anchorSkip = "";
  mark.dataset.leftOff = "";
  const line = document.createElement("span");
  line.className = "docs-left-off-line";
  line.setAttribute("aria-hidden", "true");
  const ribbon = document.createElement("span");
  ribbon.className = "docs-left-off-ribbon";
  ribbon.setAttribute("role", "img");
  ribbon.setAttribute("aria-label", label);
  ribbon.dataset.tip = label;
  ribbon.innerHTML =
    '<svg aria-hidden="true" width="10" height="13" viewBox="0 0 10 13"><path d="M1 0h8a1 1 0 0 1 1 1v12l-5-3.2L0 13V1a1 1 0 0 1 1-1z" fill="currentColor"/></svg>';
  mark.append(line, ribbon);
  return mark;
}

function decorationsFor(doc: PMNode, meta: Meta): DecorationSet {
  const at = meta.blockId ? blockStart(doc, meta.blockId) : null;
  if (at === null) return DecorationSet.empty;
  const node = doc.nodeAt(at);
  if (!node) return DecorationSet.empty;
  return DecorationSet.create(doc, [
    Decoration.node(at, at + node.nodeSize, { class: "docs-left-off-block" }),
    Decoration.widget(at + 1, () => markDom(meta.label), { key: `left-off:${meta.blockId}`, side: -1, ignoreSelection: true, stopEvent: () => true }),
  ]);
}

function leftOffPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: leftOffKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, set) => {
        const meta = tr.getMeta(leftOffKey) as Meta | undefined;
        if (meta) return decorationsFor(tr.doc, meta);
        return tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
      },
    },
    props: { decorations: (state) => leftOffKey.getState(state) },
  });
}

/** Draws the mark above the block, or takes it away (null). Returns the
    cleanup that takes the plugin off the editor. */
export function showLeftOff(editor: Editor, blockId: string | null, label: string): () => void {
  if (!leftOffKey.getState(editor.state)) editor.registerPlugin(leftOffPlugin());
  editor.view.dispatch(editor.state.tr.setMeta(leftOffKey, { blockId, label } satisfies Meta).setMeta("addToHistory", false));
  return () => {
    if (!editor.isDestroyed) editor.unregisterPlugin(leftOffKey);
  };
}

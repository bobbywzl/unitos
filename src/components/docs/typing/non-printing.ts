import { InvisibleCharacters } from "@tiptap/extension-invisible-characters";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// Non-printing characters (Ctrl+Shift+P, SPEC.md §29): ¶ at a paragraph's
// end, ↵ at a line break, → for a tab, · for a space. Hidden until asked for.
//
// Tiptap's extension keeps its commands, its state (shown or hidden), and its
// style tag. Its own plugin marked every space of the document when the page
// opened, shown or not, one mark at a time: a long import took 2 s to open.
// The marks are drawn here instead, only while they are shown, all at once.

/** The meta Tiptap's show, hide, and toggle commands set. */
const SHOWN_META = "setInvisibleCharactersVisible";

type Kind = "space" | "tab" | "paragraph" | "break";

/** One mark: an empty span the extension's styles draw the glyph on. */
function mark(pos: number, kind: Kind): Decoration {
  return Decoration.widget(
    pos,
    () => {
      const el = document.createElement("span");
      el.className = `tiptap-invisible-character tiptap-invisible-character--${kind}`;
      return el;
    },
    { key: kind, marks: [], side: 1000 },
  );
}

/** The marks from `from` to `to`: each space and tab of the text, each
    paragraph's end, each line break. */
function marksBetween(doc: PMNode, from: number, to: number): Decoration[] {
  const marks: Decoration[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText) {
      const text = node.text ?? "";
      for (let at = Math.max(from, pos); at < Math.min(to, pos + text.length); at++) {
        const char = text[at - pos];
        if (char === " ") marks.push(mark(at, "space"));
        else if (char === "\t") marks.push(mark(at, "tab"));
      }
      return false;
    }
    const end = pos + node.nodeSize - 1;
    if (node.type.name === "paragraph" && end >= from && end <= to) marks.push(mark(end, "paragraph"));
    if (node.type.name === "hardBreak" && end >= from && end <= to) marks.push(mark(end, "break"));
    return true;
  });
  return marks;
}

/** What a transaction changed, in the new document, each range widened to
    the textblocks it touches: a paragraph's end moves with its words. */
function changedRanges(tr: Transaction): [number, number][] {
  const size = tr.doc.content.size;
  const ranges: [number, number][] = [];
  tr.mapping.maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      const $from = tr.doc.resolve(Math.min(size, rest.map(newStart)));
      const $to = tr.doc.resolve(Math.min(size, rest.map(newEnd)));
      const from = $from.parent.isTextblock ? $from.before() : $from.pos;
      const to = $to.parent.isTextblock ? $to.after() : $to.pos;
      ranges.push([from, to]);
    });
  });
  return ranges;
}

type Marks = { shown: boolean; set: DecorationSet | null };
const marksKey = new PluginKey<Marks>("docsNonPrinting");

function marksPlugin(shown: boolean): Plugin<Marks> {
  const all = (doc: PMNode) => DecorationSet.create(doc, marksBetween(doc, 0, doc.content.size));
  return new Plugin<Marks>({
    key: marksKey,
    state: {
      init: (_, state) => ({ shown, set: shown ? all(state.doc) : null }),
      apply(tr, prev, _old, state) {
        const meta = tr.getMeta(SHOWN_META) as boolean | undefined;
        const next = meta ?? prev.shown;
        if (!next) return prev.set === null && !prev.shown ? prev : { shown: false, set: null };
        if (prev.set === null) return { shown: true, set: all(state.doc) };
        if (!tr.docChanged) return prev.shown ? prev : { shown: true, set: prev.set };
        let set = prev.set.map(tr.mapping, tr.doc);
        for (const [from, to] of changedRanges(tr)) {
          set = set.remove(set.find(from, to)).add(tr.doc, marksBetween(tr.doc, from, to));
        }
        return { shown: true, set };
      },
    },
    props: {
      decorations: (state) => marksKey.getState(state)?.set ?? null,
    },
  });
}

export const NonPrinting = InvisibleCharacters.extend({
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), marksPlugin(this.options.visible)];
  },
}).configure({ visible: false, builders: [] });

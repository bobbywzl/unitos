import { Extension, Node, type Editor } from "@tiptap/core";
import { Fragment, Slice, type Node as PMNode, type NodeType } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";
import { AttrStep, Mapping, ReplaceAroundStep, ReplaceStep } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { atMenuState } from "@/components/docs/insert/at-plugin";
import { insertContext } from "@/components/docs/insert/context";
import { importedOf } from "@/components/docs/insert/figure";
import { DEFAULT_LANG } from "@/lib/i18n/config";
import { translatorFor, type TFunc } from "@/lib/i18n/dictionaries";

// A page start (SPEC.md §29): the point in an import's text where a page of
// its PDF begins. An inline atom that holds only the page; it adds no words.
// Its number ("p. 7", or the PDF's own label) is drawn by CSS in the page's
// left margin, level with its line (css/import.css), so it is never
// selected, copied, counted, or printed. Where no inline atom fits (a page
// that begins at a figure, an equation, or inside a code block) the block
// carries the page as its pageStart attribute and draws it at its top.
//
// A page start is kept: a change that takes one (a deletion, an accepted
// suggestion, Undo, a stored copy) puts it back where the deletion closed,
// or at the next paragraph's start when its paragraph went whole. A paste
// never brings one, and the arrow keys, Backspace, and Delete step over it.

/** The blocks a page can begin at when no inline atom fits. */
const PAGE_BLOCKS: ReadonlySet<string> = new Set(["codeBlock", "blockMath", "figure"]);

function pageOf(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

/** The page a node begins: a page start's page, or a block's pageStart. */
function beginsPage(node: PMNode): number | null {
  if (node.type.name === "pageStart") return pageOf(node.attrs.page);
  return PAGE_BLOCKS.has(node.type.name) ? pageOf(node.attrs.pageStart) : null;
}

/** The page's language before the insert area stands (the first drawing). */
function translator(editor: Editor | undefined): TFunc {
  const context = editor ? insertContext(editor) : null;
  if (context) return context.t;
  const zh = typeof document !== "undefined" && document.documentElement.lang.toLowerCase().startsWith("zh");
  return translatorFor(zh ? "zh" : DEFAULT_LANG);
}

/** A PDF page's name: its label when the PDF names its pages, else its number. */
export function pageName(editor: Editor | undefined, page: number): string {
  const labels = editor ? importedOf(editor)?.pageLabels : null;
  return labels?.[page - 1] || String(page);
}

/** What a page start draws: "p. 7". */
export function pageStartLabel(editor: Editor | undefined, page: number): string {
  return translator(editor)("docsInsert.pageStart", { page: pageName(editor, page) });
}

/** Whether a fragment holds a page start. */
function fragmentHolds(fragment: Fragment): boolean {
  let found = false;
  fragment.descendants((node) => {
    if (found) return false;
    if (beginsPage(node) !== null) found = true;
    return !found;
  });
  return found;
}

/** Whether a transaction took out, brought in, or moved a page start: the
    ranges its steps replaced held one, a slice it put in holds one, or it
    set a block's pageStart. Typing never does, so it pays for nothing more. */
function touchesPageStarts(tr: Transaction): boolean {
  return tr.steps.some((step, i) => {
    if (step instanceof AttrStep) return step.attr === "pageStart";
    if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) return false;
    const doc = tr.docs[i];
    let hit = fragmentHolds(step.slice.content);
    step.getMap().forEach((from, to) => {
      if (hit || to <= from) return;
      doc.nodesBetween(from, to, (node) => {
        if (hit) return false;
        if (beginsPage(node) !== null) hit = true;
        return !hit;
      });
    });
    return hit;
  });
}

/** Each page that begins in the document, and where its first start stands. */
function pagesIn(doc: PMNode): Map<number, number> {
  const pages = new Map<number, number>();
  doc.descendants((node, pos) => {
    const page = beginsPage(node);
    if (page !== null && !pages.has(page)) pages.set(page, pos);
    return !node.isLeaf;
  });
  return pages;
}

/** Where a page start that a change took out goes back: at `pos` when that
    is in a paragraph before words; else at the next paragraph's start; at
    the end of the document, the last paragraph's end. */
function placeFor(doc: PMNode, pos: number, type: NodeType): number | null {
  const at = Math.max(0, Math.min(pos, doc.content.size));
  const $at = doc.resolve(at);
  const takes = $at.parent.inlineContent && $at.parent.canReplaceWith($at.index(), $at.index(), type);
  if (takes && (at < $at.end() || $at.parent.content.size === 0)) return at;
  let next: number | null = null;
  doc.nodesBetween(at, doc.content.size, (node, p) => {
    if (next !== null) return false;
    if (!node.inlineContent) return true;
    if (p + 1 >= at && node.canReplaceWith(0, 0, type)) next = p + 1;
    return false;
  });
  if (next !== null) return next;
  if (takes) return at;
  let last: number | null = null;
  doc.nodesBetween(0, at, (node, p) => {
    if (!node.inlineContent) return true;
    if (node.canReplaceWith(node.childCount, node.childCount, type)) last = p + node.nodeSize - 1;
    return false;
  });
  return last;
}

/** A page number that stood in the document before a change and stands
    nowhere after it goes back as a page start. A page start that only
    moved is left alone. Every change counts — typing, an accepted
    suggestion, Undo, Redo, a collaborator's stored copy — and the put-back
    joins the change's own undo step (or stays out of the history with it). */
function keepPageStarts(): Plugin {
  return new Plugin({
    key: new PluginKey("docsPageStartKeep"),
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged && touchesPageStarts(tr))) return null;
      const type = newState.schema.nodes.pageStart;
      const before = pagesIn(oldState.doc);
      if (!type || before.size === 0) return null;
      const after = pagesIn(newState.doc);
      const lost = [...before].filter(([page]) => !after.has(page)).sort((a, b) => a[0] - b[0]);
      if (lost.length === 0) return null;
      const mapping = new Mapping();
      for (const tr of transactions) mapping.appendMapping(tr.mapping);
      // Every place is read in the changed document; pages that go back at
      // one place stand there in their order.
      const places = lost.map(([page, pos]) => ({ page, at: placeFor(newState.doc, mapping.map(pos, 1), type) }));
      const tr = newState.tr;
      for (const { page, at } of places) {
        if (at !== null) tr.insert(tr.mapping.map(at, 1), type.create({ page }));
      }
      return tr.docChanged ? tr : null;
    },
  });
}

/** The page a code block, an equation, or a figure begins, drawn at its top
    (css/import.css) from the block's data-page-label. */
function blockPageLabels(editor: Editor): Plugin<DecorationSet> {
  const key = new PluginKey<DecorationSet>("docsPageStartBlocks");
  const build = (doc: PMNode): DecorationSet => {
    const decorations: Decoration[] = [];
    doc.descendants((node, pos) => {
      if (node.isInline) return false;
      const page = PAGE_BLOCKS.has(node.type.name) ? pageOf(node.attrs.pageStart) : null;
      if (page !== null) {
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, {
            "data-page-start": String(page),
            "data-page-label": pageStartLabel(editor, page),
          }),
        );
      }
      return !node.isTextblock && !node.isAtom;
    });
    return decorations.length > 0 ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
  };
  return new Plugin<DecorationSet>({
    key,
    state: {
      init: (_, { doc }) => build(doc),
      apply: (tr, set, _old, { doc }) => (!tr.docChanged ? set : touchesPageStarts(tr) ? build(doc) : set.map(tr.mapping, doc)),
    },
    props: {
      decorations: (state) => key.getState(state),
    },
  });
}

/** Pasted and dropped content never brings a page start: a page begins
    where the PDF's page began, once. */
function pastedWithoutPageStarts(): Plugin {
  const strip = (fragment: Fragment): Fragment => {
    const out: PMNode[] = [];
    fragment.forEach((node) => {
      if (node.type.name === "pageStart") return;
      const attrs = PAGE_BLOCKS.has(node.type.name) && node.attrs.pageStart != null ? { ...node.attrs, pageStart: null } : node.attrs;
      if (node.isText || (node.isLeaf && attrs === node.attrs)) out.push(node);
      else out.push(node.type.create(attrs, node.isLeaf ? null : strip(node.content), node.marks));
    });
    return Fragment.fromArray(out);
  };
  return new Plugin({
    key: new PluginKey("docsPageStartPaste"),
    props: {
      transformPasted(slice) {
        if (!fragmentHolds(slice.content)) return slice;
        const content = strip(slice.content);
        const open = Slice.maxOpen(content);
        return new Slice(content, Math.min(slice.openStart, open.openStart), Math.min(slice.openEnd, open.openEnd));
      },
    },
  });
}

export const PageStart = Node.create({
  name: "pageStart",
  group: "inline",
  inline: true,
  atom: true,
  // Never selected by a click or an arrow: it has no words to select.
  selectable: false,
  draggable: false,

  addAttributes() {
    return { page: { default: null, rendered: false } };
  },

  // No parse rule: a page start never comes in from the clipboard.

  renderHTML({ node }) {
    const page = pageOf(node.attrs.page);
    return [
      "span",
      {
        class: "docs-page-start",
        "data-page-start": page === null ? "" : String(page),
        "data-page-label": page === null ? "" : pageStartLabel(this.editor, page),
        "data-anchor-skip": "",
      },
    ];
  },

  // No words: a copy, the word count, and plain text leave it out.
  renderText() {
    return "";
  },

  // A page that begins at a code block or an equation (a figure declares its own).
  addGlobalAttributes() {
    return [
      {
        types: ["codeBlock", "blockMath"],
        attributes: { pageStart: { default: null, rendered: false, parseHTML: () => null } },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [keepPageStarts(), blockPageLabels(this.editor), pastedWithoutPageStarts()];
  },
});

/** The arrow keys, Backspace, and Delete step over a page start first, so
    no press is spent on it: the caret moves, or the letter beyond it goes.
    Enter and Shift+Enter right after a page start break the line before it,
    so the page start stays with the words of its page. A selection is
    deleted as it is, and the page start goes back (keepPageStarts). Before
    every other key handler: the typing area's keys (ext/typing.ts, 1001)
    then act from past it. */
export const PageStartKeys = Extension.create({
  name: "pageStartKeys",
  priority: 1002,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("docsPageStartKeys"),
        props: {
          handleKeyDown(view, event) {
            // The "@" menu's arrows move in the menu.
            if (event.isComposing || atMenuState(view.state).active) return false;
            const forward = event.key === "ArrowRight" || event.key === "Delete";
            const backward = event.key === "ArrowLeft" || event.key === "Backspace" || event.key === "Enter";
            if (!forward && !backward) return false;
            const { selection, doc } = view.state;
            if (!(selection instanceof TextSelection)) return false;
            // Keys that change the text act from past the page start; Shift
            // with an arrow grows the selection over it.
            const edits = event.key === "Delete" || event.key === "Backspace" || event.key === "Enter";
            const extending = event.shiftKey && !edits;
            if (!selection.empty && !extending) return false;
            const $head = selection.$head;
            let pos = $head.pos;
            if (forward) {
              while (pos < $head.end() && doc.nodeAt(pos)?.type.name === "pageStart") pos += 1;
            } else {
              while (pos > $head.start() && doc.resolve(pos).nodeBefore?.type.name === "pageStart") pos -= 1;
            }
            if (pos === $head.pos) return false;
            view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, extending ? selection.anchor : pos, pos)));
            // The key goes on from past the page start.
            return false;
          },
        },
      }),
    ];
  },
});

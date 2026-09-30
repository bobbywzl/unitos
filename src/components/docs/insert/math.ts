import type { Editor } from "@tiptap/core";
import type { Mark, Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type NodeView } from "@tiptap/pm/view";
import { BlockMath, InlineMath } from "@tiptap/extension-mathematics";
import katex from "katex";
import "katex/dist/katex.min.css";
import { emitInsert, insertT } from "@/components/docs/insert/context";
import { KATEX_MACROS } from "@/lib/katex";

// Equations (SPEC.md §29), drawn with KaTeX: in a line of words the
// equation sits in the line (inlineMath); on a line of its own it is a
// block (blockMath, an EQUATION row). A press opens the equation box.

class MathView implements NodeView {
  dom: HTMLElement;
  /** What the view last drew: the TeX, and for an equation on its own line
      the side of its number. */
  private drawn = "";

  constructor(
    private node: PMNode,
    private editor: Editor,
    private getPos: () => number | undefined,
    private display: boolean,
  ) {
    this.dom = document.createElement(display ? "div" : "span");
    this.dom.className = display ? "docs-math docs-math-block" : "docs-math";
    this.dom.contentEditable = "false";
    this.dom.setAttribute("data-anchor-skip", "");
    if (display) this.dom.setAttribute("data-math-block", "");
    this.dom.addEventListener("click", () => {
      if (!this.editor.isEditable) return;
      const pos = this.getPos();
      if (typeof pos === "number") emitInsert(this.editor, { type: "equation", pos });
    });
    this.render();
  }

  private render() {
    const latex = String(this.node.attrs.latex ?? "");
    const blockId = this.node.attrs.blockId as string | null | undefined;
    if (blockId) this.dom.setAttribute("data-block-id", blockId);
    // An import's display keeps the space its page leaves under it, drawn
    // as a paragraph's space after is.
    const after: unknown = this.display ? this.node.attrs.spaceAfter : null;
    this.dom.style.paddingBottom = typeof after === "number" && after > 0 ? `${after}pt` : "";
    // An import's equation numbered at the left margin, as the page sets it
    // (amsmath's leqno).
    const leqno = this.display && this.node.attrs.leqno === true;
    const drawn = `${leqno ? "left" : "right"} ${latex}`;
    if (drawn === this.drawn && this.dom.childNodes.length > 0) return;
    this.drawn = drawn;
    if (!latex.trim()) {
      this.dom.classList.add("is-empty");
      this.dom.textContent = insertT(this.editor)("docsInsert.newEquation");
      return;
    }
    this.dom.classList.remove("is-empty");
    try {
      katex.render(latex, this.dom, {
        displayMode: this.display,
        leqno,
        throwOnError: false,
        strict: "ignore",
        trust: false,
        macros: { ...KATEX_MACROS },
      });
    } catch {
      this.dom.textContent = latex;
    }
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  selectNode() {
    this.dom.classList.add("is-selected");
  }

  deselectNode() {
    this.dom.classList.remove("is-selected");
  }

  ignoreMutation(): boolean {
    return true;
  }
}

// A formula's closing mark stays on the formula's line. A browser may break
// a line right after an inline block, even before a period, and a math
// PDF's import opened lines with a lone "." or ")." (one line ending "μ",
// the next starting "."). The formula takes the mark's room as its margin,
// and the mark gives the room back as a negative margin: both draw where
// they did, and a line with room for the formula has room for its mark.
// The page keeps its spaces (white-space: break-spaces), so a space after
// the mark takes room at a line's end too, and the formula takes that room
// as well; so does a space right after a formula, which opened the next
// line a space in. A character's room is its width in the widest of the
// page editor's text fonts, in em, rounded up.
const ROOM: ReadonlyMap<string, number> = new Map([
  [".", 0.35], [",", 0.35], [";", 0.35], [":", 0.35], ["!", 0.4], ["?", 0.6],
  [")", 0.4], ["]", 0.4], ["}", 0.65], ["’", 0.35], ["'", 0.3], ["”", 0.55], ['"', 0.5], ["»", 0.65],
  ["%", 1], ["…", 1], ["-", 0.4], ["‐", 0.4], ["–", 0.6],
]);
const SPACE_ROOM = 0.35;

/** The most closing marks one formula keeps on its line: ").", "?”". */
const MOST_MARKS = 3;

/** The marks that set a run's font size. One em is one width on the
    formula and on its mark only where the two agree on these. */
const SIZING: ReadonlySet<string> = new Set(["subscript", "superscript", "code"]);

function sizing(marks: readonly Mark[]): string {
  return marks
    .map((m) => (m.type.name === "textStyle" ? (m.attrs.fontSize ? `size ${String(m.attrs.fontSize)}` : "") : SIZING.has(m.type.name) ? m.type.name : ""))
    .filter(Boolean)
    .sort()
    .join(",");
}

/** A formula followed right away by closing marks: its offset in the
    textblock, its size, how many marks follow, and their room in em. */
type Tail = { at: number; size: number; marks: number; room: number };

const tailsOf = new WeakMap<PMNode, Tail[]>();

/** A textblock's tails, kept per node: typing redoes one textblock. */
function blockTails(block: PMNode): Tail[] {
  const kept = tailsOf.get(block);
  if (kept) return kept;
  const tails: Tail[] = [];
  block.forEach((child, offset, index) => {
    if (child.type.name !== "inlineMath" || index + 1 >= block.childCount) return;
    const next = block.child(index + 1);
    if (!next.isText || sizing(next.marks) !== sizing(child.marks)) return;
    const text = next.text ?? "";
    let marks = 0;
    let room = 0;
    for (const ch of text) {
      const width = ROOM.get(ch);
      if (width === undefined || marks === MOST_MARKS) break;
      marks += 1;
      room += width;
    }
    // The space may open the next run ("." in italics, then " Hint").
    const after = marks < text.length ? text[marks] : block.maybeChild(index + 2)?.text?.[0];
    if (after === " ") room += SPACE_ROOM;
    // A space right after the formula is its tail's one mark.
    if (marks === 0 && text[0] === " ") marks = 1;
    if (marks > 0) tails.push({ at: offset, size: child.nodeSize, marks, room: Math.round(room * 100) / 100 });
  });
  tailsOf.set(block, tails);
  return tails;
}

/** The margins of a textblock's tails; `pos` is where the block starts. */
function blockDecorations(block: PMNode, pos: number): Decoration[] {
  return blockTails(block).flatMap((t) => {
    const end = pos + 1 + t.at + t.size;
    return [
      Decoration.node(end - t.size, end, { style: `margin-inline-end: ${t.room}em` }),
      Decoration.inline(end, end + t.marks, { style: `margin-inline-start: -${t.room}em` }),
    ];
  });
}

function tailDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    decorations.push(...blockDecorations(node, pos));
    return false;
  });
  return decorations.length ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
}

/** A change redoes the margins of the textblocks it touched; the rest map. */
function changedTails(tr: Transaction, set: DecorationSet): DecorationSet {
  let next = set.map(tr.mapping, tr.doc);
  tr.mapping.maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1);
    map.forEach((_from, _to, start, end) => {
      tr.doc.nodesBetween(rest.map(start, -1), rest.map(end, 1), (node, pos) => {
        if (!node.isTextblock) return true;
        const inside = next.find(pos + 1, pos + node.nodeSize - 1).filter((d) => d.from > pos && d.to < pos + node.nodeSize);
        next = next.remove(inside).add(tr.doc, blockDecorations(node, pos));
        return false;
      });
    });
  });
  return next;
}

const tailKey = new PluginKey<DecorationSet>("docsMathTail");

function mathTailPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: tailKey,
    state: {
      init: (_config, state) => tailDecorations(state.doc),
      apply: (tr, set) => (tr.docChanged ? changedTails(tr, set) : set),
    },
    props: { decorations: (state) => tailKey.getState(state) },
  });
}

const DocsInlineMath = InlineMath.extend({
  addNodeView() {
    return ({ node, editor, getPos }) => new MathView(node, editor, getPos, false);
  },
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), mathTailPlugin()];
  },
});

const DocsBlockMath = BlockMath.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // The equation's number at the left margin (KaTeX's leqno); null, at
      // the right.
      leqno: {
        default: null,
        parseHTML: (el) => (el.hasAttribute("data-leqno") ? true : null),
        renderHTML: (attrs) => (attrs.leqno === true ? { "data-leqno": "" } : {}),
      },
      // The space under an import's display, in points: the page's
      // (lib/docs/import.ts); null, none.
      spaceAfter: {
        default: null,
        parseHTML: (el) => {
          const v = Number(el.getAttribute("data-space-after"));
          return el.hasAttribute("data-space-after") && Number.isFinite(v) && v > 0 ? v : null;
        },
        renderHTML: (attrs) =>
          typeof attrs.spaceAfter === "number" ? { "data-space-after": String(attrs.spaceAfter), style: `padding-bottom: ${attrs.spaceAfter}pt` } : {},
      },
    };
  },
  addNodeView() {
    return ({ node, editor, getPos }) => new MathView(node, editor, getPos, true);
  },
});

export const MATH_EXTENSIONS = [DocsInlineMath, DocsBlockMath];

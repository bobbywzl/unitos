import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { NodeView } from "@tiptap/pm/view";
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
  private latex = "";

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
    if (latex === this.latex && this.dom.childNodes.length > 0) return;
    this.latex = latex;
    if (!latex.trim()) {
      this.dom.classList.add("is-empty");
      this.dom.textContent = insertT(this.editor)("docsInsert.newEquation");
      return;
    }
    this.dom.classList.remove("is-empty");
    try {
      katex.render(latex, this.dom, {
        displayMode: this.display,
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

const DocsInlineMath = InlineMath.extend({
  addInputRules() {
    return [];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => new MathView(node, editor, getPos, false);
  },
});

const DocsBlockMath = BlockMath.extend({
  addInputRules() {
    return [];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => new MathView(node, editor, getPos, true);
  },
});

export const MATH_EXTENSIONS = [DocsInlineMath, DocsBlockMath];

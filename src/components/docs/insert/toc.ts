import { Extension, Node, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import type { EditorView, NodeView } from "@tiptap/pm/view";
import { emitInsert, insertContext, insertT } from "@/components/docs/insert/context";
import { jumpTo } from "@/components/docs/insert/links";

// The table of contents (SPEC.md §29) in Google Docs' three styles: plain
// text with page numbers, dotted leaders to the page numbers, and blue
// links. It draws the document's headings and holds no words of its own.

export type TocStyle = "plain" | "dotted" | "links";
export const TOC_STYLES: TocStyle[] = ["plain", "dotted", "links"];
const DEFAULT_LEVELS = [1, 2, 3];
const PX_PER_PT = 96 / 72;

type TocEntry = { level: number; text: string; blockId: string | null; pos: number };

/** The headings the table lists, in order: levels 1–3 unless it says others. */
function tocEntries(doc: PMNode, levels: number[] = DEFAULT_LEVELS): TocEntry[] {
  const out: TocEntry[] = [];
  doc.descendants((node, pos) => {
    const name = node.type.name;
    if (name === "table" || name === "footnotes" || name === "tableOfContents") return false;
    if (name === "heading") {
      const level = Number(node.attrs.level) || 1;
      if (levels.includes(level) && node.textContent.trim()) {
        out.push({ level, text: node.textContent, blockId: (node.attrs.blockId as string | null) ?? null, pos });
      }
      return false;
    }
    return !node.isTextblock;
  });
  return out;
}

export function levelsOf(node: PMNode): number[] {
  const raw = node.attrs.levels as unknown;
  return Array.isArray(raw) && raw.length > 0 ? raw.filter((n): n is number => typeof n === "number") : DEFAULT_LEVELS;
}

export function styleOf(node: PMNode): TocStyle {
  const s = node.attrs.tocStyle as string;
  return TOC_STYLES.includes(s as TocStyle) ? (s as TocStyle) : "links";
}

const views = new WeakMap<EditorView, Set<TocView>>();

class TocView implements NodeView {
  dom: HTMLElement;
  private list: HTMLElement;
  private pill: HTMLElement;
  private signature = "";

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    private editor: Editor,
  ) {
    this.dom = document.createElement("div");
    this.dom.className = "docs-toc";
    this.dom.setAttribute("data-toc", "");
    this.dom.setAttribute("data-anchor-skip", "");
    this.list = document.createElement("div");
    this.list.className = "docs-toc-list";
    this.pill = document.createElement("div");
    this.pill.className = "docs-toc-pill";
    this.dom.append(this.pill, this.list);
    let set = views.get(view);
    if (!set) {
      set = new Set();
      views.set(view, set);
    }
    set.add(this);
    this.render(true);
  }

  /** Google Docs' pill over a selected table: Update, and More options. */
  private buildPill() {
    const t = insertT(this.editor);
    const button = (label: string, path: string, onPress: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "docs-toc-pill-btn";
      b.setAttribute("aria-label", label);
      b.setAttribute("data-tip", label);
      b.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="${path}"/></svg>`;
      b.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onPress();
      });
      return b;
    };
    this.pill.replaceChildren(
      button(
        t("docsInsert.updateToc"),
        "M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
        () => this.render(true),
      ),
      button(
        t("docsInsert.tocMoreOptions"),
        "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
        () => {
          const pos = this.getPos();
          if (typeof pos === "number") emitInsert(this.editor, { type: "toc-options", pos });
        },
      ),
    );
  }

  /** Draw the entries; `force` redraws even when the headings are the same. */
  render(force = false) {
    const style = styleOf(this.node);
    const levels = levelsOf(this.node);
    const entries = tocEntries(this.view.state.doc, levels);
    const t = insertT(this.editor);
    const signature = JSON.stringify([style, t("docsInsert.tocEmpty"), entries.map((e) => [e.level, e.text, e.blockId])]);
    if (!force && signature === this.signature) return;
    this.signature = signature;
    this.dom.setAttribute("data-toc-style", style);
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "docs-toc-empty";
      empty.textContent = t("docsInsert.tocEmpty");
      this.list.replaceChildren(empty);
      return;
    }
    const rows = entries.map((entry, index) => {
      const row = document.createElement("div");
      row.className = "docs-toc-entry";
      row.setAttribute("data-level", String(entry.level));
      const link = document.createElement("a");
      link.className = "docs-toc-link";
      link.textContent = entry.text;
      if (entry.blockId) link.href = `#heading=${entry.blockId}`;
      link.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      link.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        // The heading as the document holds it now.
        const heading = tocEntries(this.view.state.doc, levels)[index];
        if (heading) jumpTo(this.editor, heading.pos + 1);
      });
      row.append(link);
      if (style !== "links") {
        const leader = document.createElement("span");
        leader.className = "docs-toc-leader";
        const page = document.createElement("span");
        page.className = "docs-toc-page";
        page.dataset.blockId = entry.blockId ?? "";
        row.append(leader, page);
      }
      return row;
    });
    this.list.replaceChildren(...rows);
    if (style !== "links") requestAnimationFrame(() => this.numberPages());
  }

  /** Each entry's page: where its heading sits on the page, a page's height
      at a time. */
  private numberPages() {
    const page = this.view.dom.closest<HTMLElement>("[data-docs-page]");
    const setup = insertContext(this.editor)?.pageSetup;
    if (!page || !setup) return;
    const pageHeight = setup.height * PX_PER_PT;
    const top = page.getBoundingClientRect().top;
    const scale = page.getBoundingClientRect().height / Math.max(1, page.offsetHeight);
    for (const cell of this.list.querySelectorAll<HTMLElement>(".docs-toc-page")) {
      const id = cell.dataset.blockId;
      const heading = id ? this.view.dom.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(id)}"]`) : null;
      if (!heading) continue;
      const offset = (heading.getBoundingClientRect().top - top) / (scale || 1);
      cell.textContent = setup.pageless ? "" : String(Math.floor(offset / pageHeight) + 1);
    }
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    const restyled = node.attrs.tocStyle !== this.node.attrs.tocStyle || JSON.stringify(node.attrs.levels) !== JSON.stringify(this.node.attrs.levels);
    this.node = node;
    if (restyled) this.render(true);
    return true;
  }

  selectNode() {
    this.buildPill();
    this.dom.classList.add("is-selected");
  }

  deselectNode() {
    this.dom.classList.remove("is-selected");
  }

  stopEvent(event: Event): boolean {
    const target = event.target as Element | null;
    return Boolean(target?.closest(".docs-toc-pill, .docs-toc-link"));
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy() {
    views.get(this.view)?.delete(this);
  }
}

const TableOfContents = Node.create({
  name: "tableOfContents",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      tocStyle: { default: "links", parseHTML: (el) => el.getAttribute("data-toc-style") ?? "links", rendered: false },
      levels: { default: null, rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-toc]" }];
  },
  renderHTML({ node }) {
    return ["div", { "data-toc": "", "data-toc-style": styleOf(node) }];
  },
  addNodeView() {
    return ({ node, view, getPos, editor }) => new TocView(node, view, getPos, editor);
  },
});

/** Every table of contents redraws when its headings (or the language) change. */
const TocKeeper = Extension.create({
  name: "docsTocKeeper",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        view: () => ({
          update(view) {
            for (const toc of views.get(view) ?? []) toc.render();
          },
        }),
      }),
    ];
  },
});

/** Redraw the tables of contents of a view now (Update table of contents). */
export function refreshTocs(view: EditorView): void {
  for (const toc of views.get(view) ?? []) toc.render(true);
}

export const TOC_EXTENSIONS = [TableOfContents, TocKeeper];

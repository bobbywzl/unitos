import { Extension, type AnyExtension, type Editor } from "@tiptap/core";
import { DOMSerializer, type Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import {
  paginate,
  type FootnotePlan,
  type PaginationConfig,
  type SpacerKind,
  type SpacerPlan,
} from "@/components/docs/page/paginate";
import { tabSizes } from "@/components/docs/page/tabs";

// The page editor's page extensions (SPEC.md §29): pagination, tab stops,
// the pageless headings that fold, Docs' caret, and the selection while the
// page has no focus.
//
// Pagination: a spacer at each page's end — a widget decoration, never
// content — pushes what follows to the next page's text top, and each
// footnote stands at its page's foot (page/paginate.ts works out where). A
// pass runs one frame after a change, never during a composition or a mouse
// selection; it moves spacers and footnotes with a meta-only transaction and
// resizes spacers in place (ProseMirror ignores mutations inside a widget),
// so the document, the selection, and undo never change.

type Host = {
  config: PaginationConfig;
  onPages: (pages: number) => void;
  /** The heading arrow's tips (pageless). */
  labels: { fold: string; unfold: string };
};

const hosts = new WeakMap<Editor, Host>();
const controllers = new WeakMap<Editor, Paginator>();

/** The canvas hands the pagination its page and hears the page count; a
    new page (a setup, a zoom, a header's height) runs a pass. */
export function hostPagination(editor: Editor, host: Host): () => void {
  hosts.set(editor, host);
  controllers.get(editor)?.refresh();
  // The heading arrows take the host's labels.
  editor.view.dispatch(editor.state.tr.setMeta(foldKey, "").setMeta("addToHistory", false));
  return () => {
    if (hosts.get(editor) === host) hosts.delete(editor);
  };
}

/** A full pass on the next frame. */
export function repaginate(editor: Editor): void {
  controllers.get(editor)?.refresh();
}

/** A full pass now: printing lays the pages out before the next frame. */
export function paginateNow(editor: Editor): void {
  controllers.get(editor)?.runNow();
}

const paginationKey = new PluginKey<DecorationSet>("docsPagination");
/** Each tab of a paragraph with its own stops, as wide as its stop needs. */
const tabsKey = new PluginKey<DecorationSet>("docsTabs");

type Spacer = SpacerPlan & { id: string };
type SpacerSpec = { key: string; kind: SpacerKind; id: string; side: number; marks: []; ignoreSelection: true };
type Plan = { spacers: Spacer[]; footnotes: FootnotePlan[] };

let nextId = 0;

/** The events that end a press: a drag and drop never sends pointerup. */
const RELEASE = ["pointerup", "pointercancel", "dragend", "drop"] as const;

/** A row spacer is a row of one cell spanning the table's columns: more
    columns would shrink a fixed-layout table's own. */
function spacerDOM(kind: SpacerKind, id: string, height: number, columns: number): HTMLElement {
  const el = document.createElement(kind === "row" ? "tr" : kind === "line" ? "span" : "div");
  el.className = `docs-spacer docs-spacer-${kind}`;
  el.setAttribute("data-docs-spacer", id);
  el.setAttribute("aria-hidden", "true");
  el.contentEditable = "false";
  el.style.setProperty("--docs-spacer-h", `${height}px`);
  if (kind === "row") {
    const td = document.createElement("td");
    td.colSpan = Math.max(1, columns);
    el.appendChild(td);
  }
  return el;
}

/** A table's pinned header rows, drawn again at the foot of a row spacer:
    rows written from the document (no decorations), in a copy of the
    table's columns. */
function headerRows(view: EditorView, tablePos: number): HTMLElement | null {
  const node = view.state.doc.nodeAt(tablePos);
  const wrapper = view.nodeDOM(tablePos);
  const table = wrapper instanceof HTMLElement ? wrapper.querySelector("table") : null;
  if (!node || !table) return null;
  const copy = document.createElement("table");
  const columns = table.querySelector(":scope > colgroup");
  if (columns) copy.append(columns.cloneNode(true));
  const body = copy.createTBody();
  const serializer = DOMSerializer.fromSchema(view.state.schema);
  for (let i = 0; i < node.childCount && node.child(i).attrs.pinned === true; i++) {
    body.append(serializer.serializeNode(node.child(i)));
  }
  copy.querySelectorAll("[data-block-id]").forEach((el) => el.removeAttribute("data-block-id"));
  const head = document.createElement("div");
  head.className = "docs-spacer-head";
  head.append(copy);
  return head;
}

function buildDecorations(doc: PMNode, plan: Plan, heights: Map<string, number>): DecorationSet {
  const spacers = plan.spacers.map((s) => {
    let columns = 0;
    if (s.kind === "row") {
      doc.resolve(s.pos).parent.firstChild?.forEach((cell) => {
        const span: unknown = cell.attrs.colspan;
        columns += typeof span === "number" && span > 0 ? span : 1;
      });
    }
    const spec: SpacerSpec = { key: `docs-spacer-${s.id}`, kind: s.kind, id: s.id, side: -1, marks: [], ignoreSelection: true };
    return Decoration.widget(s.pos, () => spacerDOM(s.kind, s.id, heights.get(s.id) ?? 0, columns), spec);
  });
  const footnotes = plan.footnotes.flatMap((f) => {
    const node = doc.nodeAt(f.pos);
    if (!node) return [];
    const attrs = {
      class: f.first ? "docs-footnote-placed docs-footnote-first" : "docs-footnote-placed",
      style: `--docs-footnote-top: ${f.top}px; --docs-footnote-page: ${f.page}`,
    };
    return [Decoration.node(f.pos, f.pos + node.nodeSize, attrs, { footnote: f })];
  });
  return DecorationSet.create(doc, [...spacers, ...footnotes]);
}

const sameFootnote = (a: FootnotePlan | undefined, b: FootnotePlan | undefined) =>
  !!a && !!b && a.pos === b.pos && a.page === b.page && a.first === b.first && Math.abs(a.top - b.top) < 0.5;

class Paginator {
  private frame = 0;
  private lastHeight = -1;
  /** Each textblock's natural height at the last pass. */
  private heightsAtPass = new WeakMap<Element, number>();
  /** Since the last pass: the one textblock edited, or "all". */
  private touched: Element | "all" | null = "all";
  private pointerDown = false;
  private readonly ro = new ResizeObserver((entries) => {
    const h = entries[entries.length - 1]?.contentRect.height ?? -1;
    if (Math.abs(h - this.lastHeight) > 0.5) this.refresh();
  });

  constructor(
    private view: EditorView,
    private readonly editor: Editor,
    private readonly heights: Map<string, number>,
  ) {
    this.ro.observe(view.dom);
    view.dom.addEventListener("compositionend", this.refresh);
    document.addEventListener("pointerdown", this.onPointerDown, true);
    for (const type of RELEASE) document.addEventListener(type, this.onPointerUp, true);
    document.fonts.addEventListener("loadingdone", this.refresh);
    this.schedule();
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button === 0 && e.target instanceof Node && this.view.dom.contains(e.target)) this.pointerDown = true;
  };
  private onPointerUp = () => {
    if (!this.pointerDown) return;
    this.pointerDown = false;
    this.refresh();
  };

  update(view: EditorView, prev: EditorState) {
    this.view = view;
    if (view.state.doc === prev.doc) return;
    const edited = this.editedTextblock(prev.doc, view.state.doc);
    this.touched = this.touched === null || this.touched === edited ? edited : "all";
    this.schedule();
  }

  /** The textblock an edit stayed inside, or "all". */
  private editedTextblock(before: PMNode, after: PMNode): Element | "all" {
    const start = before.content.findDiffStart(after.content);
    const end = before.content.findDiffEnd(after.content);
    if (start == null || !end) return "all";
    const $from = after.resolve(Math.min(start, end.b));
    const $to = after.resolve(Math.max(start, end.b));
    if (!$from.parent.isTextblock || !$from.sameParent($to)) return "all";
    const el = this.view.nodeDOM($from.before());
    return el instanceof Element ? el : "all";
  }

  /** Nothing on the pages moved: the one edited paragraph has no spacer in
      it and is as tall as it was. */
  private unchanged(): boolean {
    const el = this.touched;
    if (!(el instanceof HTMLElement) || !el.isConnected || el.querySelector("[data-docs-spacer]")) return false;
    const before = this.heightsAtPass.get(el);
    return before !== undefined && Math.abs(el.getBoundingClientRect().height / this.scale() - before) < 0.5;
  }

  private scale(): number {
    const width = this.view.dom.offsetWidth;
    return width > 0 ? this.view.dom.getBoundingClientRect().width / width || 1 : 1;
  }

  runNow() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.touched = "all";
    this.run();
  }

  refresh = () => {
    this.touched = "all";
    this.schedule();
  };

  schedule() {
    if (this.frame || this.view.isDestroyed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.run();
    });
  }

  private run() {
    const host = hosts.get(this.editor);
    if (!host || this.view.isDestroyed || this.view.composing || this.pointerDown) return;
    this.alignTabs();
    const config = host.config;
    if (config.enabled && this.touched !== "all" && this.touched !== null && this.unchanged()) {
      this.touched = null;
      return;
    }
    this.touched = null;
    const found = paginationKey.getState(this.view.state)?.find() ?? [];
    const current = found.filter((d) => "kind" in d.spec).map((d) => ({ pos: d.from, ...(d.spec as SpacerSpec) }));
    const placed = found.flatMap((d) => ("footnote" in d.spec ? [{ ...(d.spec.footnote as FootnotePlan), pos: d.from }] : []));
    if (!config.enabled) {
      if (found.length > 0) this.dispatch({ spacers: [], footnotes: [] });
      this.lastHeight = this.view.dom.offsetHeight;
      host.onPages(1);
      return;
    }

    // Read the natural layout, every spacer hidden for the length of it.
    const hidden = Array.from(this.view.dom.querySelectorAll<HTMLElement>("[data-docs-spacer]"));
    for (const el of hidden) el.style.display = "none";
    let plan;
    try {
      plan = paginate(this.view, config);
    } finally {
      for (const el of hidden) el.style.display = "";
    }

    // Spacers that stay where they are keep their ids, and their DOM.
    const byPlace = new Map(current.map((s) => [`${s.kind}@${s.pos}`, s.id]));
    const next = plan.spacers.map((s) => ({ ...s, id: byPlace.get(`${s.kind}@${s.pos}`) ?? `s${(nextId += 1)}` }));
    const moved =
      next.length !== current.length ||
      next.some((s, i) => s.id !== current[i].id || s.pos !== current[i].pos) ||
      plan.footnotes.length !== placed.length ||
      plan.footnotes.some((f, i) => !sameFootnote(f, placed[i]));
    // The caret in a footnote that came to another page (a new footnote
    // starts at the document's end) follows it into view.
    const { $head } = this.view.state.selection;
    let caretFootnote = -1;
    for (let d = $head.depth; d > 0; d--) if ($head.node(d).type.name === "footnote") caretFootnote = $head.before(d);
    const page = (list: FootnotePlan[]) => list.find((f) => f.pos === caretFootnote)?.page;
    const follow = caretFootnote >= 0 && page(plan.footnotes) !== page(placed);
    if (moved) this.dispatch({ spacers: next, footnotes: plan.footnotes }, follow);

    // Each spacer's bottom on its page's text top: read every top once, then
    // set the heights top to bottom (a change moves every spacer below it).
    const targets = new Map(next.map((s) => [s.id, s.target]));
    const headers = new Map(next.map((s) => [s.id, s.header]));
    const nodes = Array.from(this.view.dom.querySelectorAll<HTMLElement>("[data-docs-spacer]"));
    const origin = this.view.dom.getBoundingClientRect().top;
    const scale = this.scale();
    const tops = nodes.map((el) => (el.getBoundingClientRect().top - origin) / scale);
    let shift = 0;
    nodes.forEach((el, i) => {
      const id = el.getAttribute("data-docs-spacer") ?? "";
      const target = targets.get(id);
      if (target === undefined) return;
      const old = this.heights.get(id) ?? 0;
      const height = Math.max(0, target - (tops[i] + shift));
      shift += height - old;
      this.heights.set(id, height);
      el.style.setProperty("--docs-spacer-h", `${height}px`);
      const table = headers.get(id);
      const cell = el.firstElementChild;
      if (cell) cell.replaceChildren(...(table === undefined ? [] : [headerRows(this.view, table) ?? ""]));
    });
    for (const id of [...this.heights.keys()]) if (!targets.has(id)) this.heights.delete(id);
    this.heightsAtPass = new WeakMap(plan.heights);
    this.lastHeight = this.view.dom.offsetHeight;
    caretViews.get(this.view)?.place();
    host.onPages(plan.pages);
  }

  /** Tabs to their stops, before the pages read the layout. */
  private alignTabs() {
    const sizes = tabSizes(this.view);
    const current = tabsKey.getState(this.view.state)?.find() ?? [];
    const same = current.length === sizes.size && current.every((d) => Math.abs((sizes.get(d.from) ?? -1) - Number(d.spec.size)) < 0.5);
    if (!same) this.view.dispatch(this.view.state.tr.setMeta(tabsKey, sizes).setMeta("addToHistory", false));
  }

  private dispatch(plan: Plan, scroll = false) {
    const tr = this.view.state.tr.setMeta(paginationKey, plan).setMeta("addToHistory", false);
    this.view.dispatch(scroll ? tr.scrollIntoView() : tr);
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.ro.disconnect();
    this.view.dom.removeEventListener("compositionend", this.refresh);
    document.removeEventListener("pointerdown", this.onPointerDown, true);
    for (const type of RELEASE) document.removeEventListener(type, this.onPointerUp, true);
    document.fonts.removeEventListener("loadingdone", this.refresh);
  }
}

const Pagination = Extension.create({
  name: "docsPagination",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          tabStops: {
            default: null,
            parseHTML: (el) => el.getAttribute("data-tab-stops"),
            renderHTML: (attrs) => (attrs.tabStops ? { "data-tab-stops": attrs.tabStops } : {}),
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    const heights = new Map<string, number>();
    return [
      new Plugin<DecorationSet>({
        key: paginationKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => {
            const plan = tr.getMeta(paginationKey) as Plan | undefined;
            if (plan) return buildDecorations(tr.doc, plan, heights);
            return tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
          },
        },
        props: { decorations: (state) => paginationKey.getState(state) },
        view: (view) => {
          const controller = new Paginator(view, editor, heights);
          controllers.set(editor, controller);
          return {
            update: (v, prev) => controller.update(v, prev),
            destroy: () => {
              controller.destroy();
              if (controllers.get(editor) === controller) controllers.delete(editor);
            },
          };
        },
      }),
      new Plugin<DecorationSet>({
        key: tabsKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => {
            const sizes = tr.getMeta(tabsKey) as Map<number, number> | undefined;
            if (!sizes) return tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
            const tabs = [...sizes].map(([pos, size]) => Decoration.inline(pos, pos + 1, { style: `tab-size: ${size}px` }, { size }));
            return DecorationSet.create(tr.doc, tabs);
          },
        },
        props: { decorations: (state) => tabsKey.getState(state) },
      }),
    ];
  },
});

/** Pageless, as in Google Docs: a heading's arrow (shown under the pointer)
    folds the words under it, down to the next heading of its level or
    above. The folds are the reader's, kept for the page's life. */
const foldKey = new PluginKey<{ folded: string[]; set: DecorationSet }>("docsFold");

function foldDecorations(editor: Editor, doc: PMNode, folded: string[]): DecorationSet {
  const labels = hosts.get(editor)?.labels;
  const out: Decoration[] = [];
  let hiding: number | null = null;
  doc.forEach((node, pos) => {
    const level = node.type.name === "heading" ? Number(node.attrs.level) : null;
    if (hiding !== null && level !== null && level <= hiding) hiding = null;
    if (hiding !== null && node.type.name !== "footnotes") {
      out.push(Decoration.node(pos, pos + node.nodeSize, { class: "docs-folded" }));
      return;
    }
    const id = typeof node.attrs.blockId === "string" ? node.attrs.blockId : null;
    if (level === null || !id) return;
    const isFolded = folded.includes(id);
    const label = (isFolded ? labels?.unfold : labels?.fold) ?? "";
    const arrow = (view: EditorView) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "docs-fold";
      button.contentEditable = "false";
      button.setAttribute("aria-expanded", String(!isFolded));
      button.setAttribute("aria-label", label);
      button.dataset.tip = label;
      button.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5z" fill="currentColor"/></svg>';
      button.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const tr = view.state.tr.setMeta(foldKey, id);
        // The caret in the words that fold goes to the heading's end.
        let start = -1;
        let end = tr.doc.content.size;
        tr.doc.forEach((n, p) => {
          if (n.attrs.blockId === id) start = p + n.nodeSize;
          else if (start >= 0 && end === tr.doc.content.size && n.type.name === "heading" && Number(n.attrs.level) <= level) end = p;
        });
        const { from } = tr.selection;
        if (!isFolded && start >= 0 && from >= start && from < end) tr.setSelection(TextSelection.create(tr.doc, start - 1));
        view.dispatch(tr);
      });
      return button;
    };
    out.push(Decoration.widget(pos + 1, arrow, { side: -1, key: `fold-${id}-${level}-${isFolded}-${label}`, ignoreSelection: true }));
    if (isFolded) hiding = level;
  });
  return DecorationSet.create(doc, out);
}

const FoldHeadings = Extension.create({
  name: "docsFoldHeadings",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<{ folded: string[]; set: DecorationSet }>({
        key: foldKey,
        state: {
          init: (_, state) => ({ folded: [], set: foldDecorations(editor, state.doc, []) }),
          apply: (tr, value) => {
            // A heading's id folds or unfolds it; "" redraws the arrows.
            const id = tr.getMeta(foldKey) as string | undefined;
            if (id === undefined && !tr.docChanged) return value;
            const folded = !id ? value.folded : value.folded.includes(id) ? value.folded.filter((f) => f !== id) : [...value.folded, id];
            return { folded, set: foldDecorations(editor, tr.doc, folded) };
          },
        },
        props: { decorations: (state) => foldKey.getState(state)?.set },
      }),
    ];
  },
});

/** Docs' caret: a 2 px bar as tall as the text, 500 ms on and 500 ms off,
    solid again after every move. The browser's caret cannot be widened, so
    this one is drawn over the page's text for an empty selection while the
    page has the focus. Where a line wraps, one position both ends a line and
    starts the next and only the browser knows which it drew: there its own
    caret shows. */
class DocsCaretView {
  private el: HTMLDivElement | null = null;
  private phase = false;
  private frame = 0;
  constructor(private view: EditorView) {
    view.dom.addEventListener("focus", this.schedule);
    view.dom.addEventListener("blur", this.schedule);
    window.addEventListener("resize", this.schedule);
  }
  schedule = () => {
    if (!this.frame) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.place();
      });
    }
  };
  update(view: EditorView) {
    this.view = view;
    this.schedule();
  }
  /** The browser's caret shows instead of this one. */
  private native() {
    this.view.dom.style.setProperty("--docs-native-caret", "var(--docs-ink)");
    if (this.el) this.el.style.display = "none";
  }
  place() {
    const { view } = this;
    const host = view.dom.closest<HTMLElement>("[data-docs-page]");
    const sel = view.state.selection;
    if (!host || !view.editable || !view.hasFocus() || view.composing || !(sel instanceof TextSelection) || !sel.empty) {
      return this.native();
    }
    let coords;
    try {
      // A line's start: after a line break, or the paragraph's start (where
      // a heading's fold arrow sits before the caret).
      const lineStart = sel.$head.nodeBefore?.type.name === "hardBreak" || sel.$head.parentOffset === 0;
      const before = view.coordsAtPos(sel.head, -1);
      const after = view.coordsAtPos(sel.head, 1);
      if (!lineStart && Math.abs(before.top - after.top) > 1) return this.native();
      coords = lineStart ? after : before;
    } catch {
      return this.native();
    }
    view.dom.style.removeProperty("--docs-native-caret");
    if (!this.el || this.el.parentElement !== host) {
      this.el?.remove();
      this.el = document.createElement("div");
      this.el.className = "docs-caret";
      host.appendChild(this.el);
    }
    const r = host.getBoundingClientRect();
    const scale = host.offsetWidth > 0 ? r.width / host.offsetWidth : 1;
    const el = this.el;
    el.style.display = "";
    el.style.left = `${(coords.left - r.left) / scale - 1}px`;
    el.style.top = `${(coords.top - r.top) / scale}px`;
    el.style.height = `${Math.max(1, (coords.bottom - coords.top) / scale)}px`;
    // Restart the blink: solid for the first 500 ms.
    this.phase = !this.phase;
    el.className = `docs-caret docs-caret-${this.phase ? "a" : "b"}`;
  }
  destroy() {
    cancelAnimationFrame(this.frame);
    this.view.dom.removeEventListener("focus", this.schedule);
    this.view.dom.removeEventListener("blur", this.schedule);
    window.removeEventListener("resize", this.schedule);
    this.el?.remove();
  }
}

const caretViews = new WeakMap<EditorView, DocsCaretView>();

/** The page has no focus (a dialog, the title field): the selection stays in
    view, gray, as Google Docs keeps it. A blur turns it gray; the gray goes
    with the next change of the selection or the text, never on the focus
    itself: a redraw then would put the old selection back over the click
    that brought the focus. */
const blurredKey = new PluginKey<boolean>("docsBlurred");

const DocsCaret = Extension.create({
  name: "docsCaret",
  addProseMirrorPlugins() {
    return [
      new Plugin<boolean>({
        key: blurredKey,
        state: {
          init: () => false,
          apply: (tr, blurred) =>
            (tr.getMeta(blurredKey) as boolean | undefined) ?? (blurred && !tr.selectionSet && !tr.docChanged),
        },
        props: {
          attributes: { class: "docs-own-caret" },
          decorations: (state) =>
            blurredKey.getState(state) && !state.selection.empty
              ? DecorationSet.create(
                  state.doc,
                  state.selection.ranges.map((r) => Decoration.inline(r.$from.pos, r.$to.pos, { class: "docs-blurred-selection" })),
                )
              : null,
          handleDOMEvents: {
            blur: (view) => {
              view.dispatch(view.state.tr.setMeta(blurredKey, true));
              return false;
            },
          },
        },
        view: (view) => {
          const caret = new DocsCaretView(view);
          caretViews.set(view, caret);
          return { update: (v) => caret.update(v), destroy: () => caret.destroy() };
        },
      }),
    ];
  },
});

export const pageExtensions: AnyExtension[] = [Pagination, FoldHeadings, DocsCaret];

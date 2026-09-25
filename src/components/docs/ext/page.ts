import { Extension, type AnyExtension, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { paginate, type PageArea, type SpacerKind, type SpacerPlan } from "@/components/docs/page/paginate";

// The page editor's page extensions (SPEC.md §29). extensions.ts spreads
// this list into the editor.
//
// Pagination: the text is one flow, and a spacer at each page's end — a
// widget decoration, never content — pushes what follows to the next page's
// top margin (page/paginate.ts works out where). Spacers change neither the
// document nor the selection nor the undo history: a pass that moves one
// dispatches a transaction with only this plugin's meta, and a pass that
// only resizes one sets its height in place (ProseMirror ignores mutations
// inside a widget). A pass runs one frame after a change, never while a
// composition or a mouse selection is under way.

export type PaginationConfig = {
  enabled: boolean;
  /** From one page's top to the next page's top, CSS px at 100%. */
  pitch: number;
  /** Page i's text area in px from the page's top. */
  area: (page: number) => PageArea;
};

export type PaginationLayout = {
  pages: number;
  /** Where page i's text starts in the editor's own px (page 0 is 0). */
  pageTops: number[];
};

type Host = {
  config: () => PaginationConfig | null;
  onLayout: (layout: PaginationLayout) => void;
};

const hosts = new WeakMap<Editor, Host>();
const controllers = new WeakMap<Editor, Paginator>();

/** The page canvas hands the pagination its page and hears back how many
    pages the text takes. */
export function hostPagination(editor: Editor, host: Host): () => void {
  hosts.set(editor, host);
  controllers.get(editor)?.refresh();
  return () => {
    if (hosts.get(editor) === host) hosts.delete(editor);
  };
}

/** Run a pass on the next frame (the page changed size, a font loaded). */
export function repaginate(editor: Editor): void {
  controllers.get(editor)?.refresh();
}

export const paginationKey = new PluginKey<DecorationSet>("docsPagination");

type Meta = { spacers: (SpacerPlan & { id: string })[] };

type SpacerSpec = { key: string; kind: SpacerKind; id: string; side: number; marks: []; ignoreSelection: true };

let nextId = 0;

/** The events that end a press: a drag and drop never sends pointerup. */
const RELEASE = ["pointerup", "pointercancel", "dragend", "drop"] as const;

function spacerDOM(kind: SpacerKind, id: string, heights: Map<string, number>): HTMLElement {
  const height = `${heights.get(id) ?? 0}px`;
  if (kind === "row") {
    const tr = document.createElement("tr");
    tr.className = "docs-spacer docs-spacer-row";
    tr.setAttribute("data-docs-spacer", id);
    tr.setAttribute("aria-hidden", "true");
    tr.contentEditable = "false";
    tr.style.setProperty("--docs-spacer-h", height);
    const td = document.createElement("td");
    td.colSpan = 100;
    tr.appendChild(td);
    return tr;
  }
  const el = document.createElement(kind === "line" ? "span" : "div");
  el.className = `docs-spacer docs-spacer-${kind}`;
  el.setAttribute("data-docs-spacer", id);
  el.setAttribute("aria-hidden", "true");
  el.contentEditable = "false";
  el.style.setProperty("--docs-spacer-h", height);
  return el;
}

function buildDecorations(doc: PMNode, spacers: Meta["spacers"], heights: Map<string, number>): DecorationSet {
  if (spacers.length === 0) return DecorationSet.empty;
  const decos = spacers.map((s) => {
    const spec: SpacerSpec = { key: `docs-spacer-${s.id}`, kind: s.kind, id: s.id, side: -1, marks: [], ignoreSelection: true };
    return Decoration.widget(s.pos, () => spacerDOM(s.kind, s.id, heights), spec);
  });
  return DecorationSet.create(doc, decos);
}

class Paginator {
  private frame = 0;
  private lastHeight = -1;
  /** Each textblock's natural height at the last pass. */
  private heightsAtPass = new WeakMap<Element, number>();
  /** Since the last pass: the one textblock edited, or "all". */
  private touched: Element | "all" | null = "all";
  private pointerDown = false;
  private readonly ro: ResizeObserver | null;
  private destroyed = false;

  constructor(
    private view: EditorView,
    private readonly editor: Editor,
    private readonly heights: Map<string, number>,
  ) {
    this.ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            const h = entries[entries.length - 1]?.contentRect.height ?? -1;
            if (Math.abs(h - this.lastHeight) > 0.5) this.refresh();
          });
    this.ro?.observe(view.dom);
    view.dom.addEventListener("compositionend", this.onResume);
    document.addEventListener("pointerdown", this.onPointerDown, true);
    for (const type of RELEASE) document.addEventListener(type, this.onPointerUp, true);
    document.fonts?.addEventListener?.("loadingdone", this.onResume);
    this.schedule();
  }

  private onResume = () => this.refresh();
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

  /** Nothing on the pages can have moved: one paragraph was edited, it has
      no spacer in it, and it is as tall as it was. */
  private unchanged(): boolean {
    const el = this.touched;
    if (!(el instanceof HTMLElement) || !el.isConnected || el.querySelector("[data-docs-spacer]")) return false;
    const before = this.heightsAtPass.get(el);
    if (before === undefined) return false;
    const width = this.view.dom.offsetWidth;
    const rect = this.view.dom.getBoundingClientRect();
    const scale = width > 0 && rect.width > 0 ? rect.width / width : 1;
    return Math.abs(el.getBoundingClientRect().height / scale - before) < 0.5;
  }

  /** A full pass on the next frame. */
  refresh() {
    this.touched = "all";
    this.schedule();
  }

  schedule() {
    if (this.frame || this.destroyed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.run();
    });
  }

  private current(): Meta["spacers"] {
    const set = paginationKey.getState(this.view.state);
    if (!set) return [];
    return set.find().map((d) => {
      const spec = d.spec as SpacerSpec;
      return { id: spec.id, kind: spec.kind, pos: d.from, page: 0, target: 0 };
    });
  }

  private run() {
    if (this.destroyed || this.view.isDestroyed) return;
    const started = performance.now();
    try {
      this.pass();
    } finally {
      // The QA scripts read how long a pass takes, in development.
      if (process.env.NODE_ENV !== "production") {
        (window as unknown as { __docsPaginationMs?: number[] }).__docsPaginationMs = [
          ...((window as unknown as { __docsPaginationMs?: number[] }).__docsPaginationMs ?? []).slice(-49),
          performance.now() - started,
        ];
      }
    }
  }

  private pass() {
    const host = hosts.get(this.editor);
    const config = host?.config() ?? null;
    if (!host || !config) return;
    if (this.view.composing || this.pointerDown) return; // compositionend and pointerup schedule again
    if (config.enabled && this.touched !== "all" && this.touched !== null && this.unchanged()) {
      this.touched = null;
      return;
    }
    this.touched = null;
    const current = this.current();
    if (!config.enabled) {
      if (current.length > 0) this.dispatch([]);
      this.lastHeight = this.view.dom.offsetHeight;
      host.onLayout({ pages: 1, pageTops: [0] });
      return;
    }

    // Read the natural layout: every spacer hidden for the length of the read.
    const els = Array.from(this.view.dom.querySelectorAll<HTMLElement>("[data-docs-spacer]"));
    for (const el of els) el.style.display = "none";
    let plan;
    try {
      plan = paginate(this.view, { pitch: config.pitch, area: config.area });
    } finally {
      for (const el of els) el.style.display = "";
    }

    // Keep the ids of the spacers that stay where they are.
    const byPlace = new Map(current.map((s) => [`${s.kind}@${s.pos}`, s.id]));
    const next = plan.spacers.map((s) => ({ ...s, id: byPlace.get(`${s.kind}@${s.pos}`) ?? `s${(nextId += 1)}` }));
    const same = next.length === current.length && next.every((s, i) => s.id === current[i].id && s.pos === current[i].pos);
    if (!same) this.dispatch(next);

    // Each spacer's bottom on its target: read every spacer's top once, then
    // set the heights top to bottom (a change moves every spacer below it).
    const targets = new Map(next.map((s) => [s.id, s.target]));
    const nodes = Array.from(this.view.dom.querySelectorAll<HTMLElement>("[data-docs-spacer]"));
    const origin = this.view.dom.getBoundingClientRect();
    const scale = this.view.dom.offsetWidth > 0 && origin.width > 0 ? origin.width / this.view.dom.offsetWidth : 1;
    const tops = nodes.map((el) => (el.getBoundingClientRect().top - origin.top) / scale);
    let shift = 0;
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      const id = el.getAttribute("data-docs-spacer") ?? "";
      const target = targets.get(id);
      if (target === undefined) continue;
      const old = this.heights.get(id) ?? 0;
      const height = Math.max(0, target - (tops[i] + shift));
      shift += height - old;
      this.heights.set(id, height);
      if (Math.abs(height - old) > 0.01 || el.style.getPropertyValue("--docs-spacer-h") === "") {
        el.style.setProperty("--docs-spacer-h", `${height}px`);
      }
    }
    for (const id of [...this.heights.keys()]) if (!targets.has(id)) this.heights.delete(id);
    this.heightsAtPass = new WeakMap(plan.heights);

    this.lastHeight = this.view.dom.offsetHeight;
    const pageTops = [0];
    for (const s of plan.spacers) pageTops[s.page] = s.target;
    for (let i = 1; i < plan.pages; i++) {
      if (pageTops[i] === undefined) pageTops[i] = i * config.pitch + config.area(i).top - config.area(0).top;
    }
    host.onLayout({ pages: plan.pages, pageTops });
  }

  private dispatch(spacers: Meta["spacers"]) {
    const tr = this.view.state.tr.setMeta(paginationKey, { spacers } satisfies Meta).setMeta("addToHistory", false);
    this.view.dispatch(tr);
  }

  destroy() {
    this.destroyed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.ro?.disconnect();
    this.view.dom.removeEventListener("compositionend", this.onResume);
    document.removeEventListener("pointerdown", this.onPointerDown, true);
    for (const type of RELEASE) document.removeEventListener(type, this.onPointerUp, true);
    document.fonts?.removeEventListener?.("loadingdone", this.onResume);
  }
}

/** Google Docs' pages: the spacers, and the controller that places them. */
const Pagination = Extension.create({
  name: "docsPagination",
  addProseMirrorPlugins() {
    const editor = this.editor;
    const heights = new Map<string, number>();
    return [
      new Plugin<DecorationSet>({
        key: paginationKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => {
            const meta = tr.getMeta(paginationKey) as Meta | undefined;
            if (meta) return buildDecorations(tr.doc, meta.spacers, heights);
            return tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
          },
        },
        props: {
          decorations: (state) => paginationKey.getState(state),
        },
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
    ];
  },
});

export const pageExtensions: AnyExtension[] = [Pagination];

import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import { Fragment, Slice, type DOMOutputSpec, type Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { createElement as h, useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { useT } from "@/components/lang-provider";
import { insertContext, insertT, toast } from "@/components/docs/insert/context";
import { DOCS_EVENT, fireDocs } from "@/components/docs/typing/events";
import { MediaHtml } from "@/components/reader/figure-media";

// A figure object (SPEC.md §29): an import's figure, one block atom in the
// page. It draws the figure as the block reader does (.reader-figure): a
// web page's figure from its html, a PDF's figure as the crop of its page
// under its caption. The media is the document's FigureMedia row, which the
// page sends; the rich text holds only its id, so no save and no paste can
// put markup in the page. A click opens the figure's tools
// (DOCS_EVENT.figureTools); the caption is the figure's, never typed into.

/** A figure object's media, as the page sends it (FigureMedia). */
export type FigureMediaView = { html: string | null; caption: string; page: number | null; region: unknown | null };

/** What the page editor knows of an import: its figures' media by mediaId,
    the PDF's page labels, and its page count. */
export type ImportedEditor = {
  documentId: string;
  figures: Record<string, FigureMediaView>;
  /** The PDF's own page names (xii, 1043); a page start draws
      pageLabels[page - 1], else the number. */
  pageLabels: string[] | null;
  /** The PDF's page count, for the scroll tip ("p. 7 of 30"). */
  pages?: number | null;
};

type FigureOptions = { imported: ImportedEditor | null };

type Store = { imported: ImportedEditor | null; listeners: Set<() => void> };
const stores = new WeakMap<Editor, Store>();

function storeOf(editor: Editor): Store {
  let store = stores.get(editor);
  if (!store) {
    const figure = editor.extensionManager.extensions.find((e) => e.name === "figure");
    store = { imported: (figure?.options as FigureOptions | undefined)?.imported ?? null, listeners: new Set() };
    stores.set(editor, store);
  }
  return store;
}

/** The import the editor draws, or null (a blank document). */
export function importedOf(editor: Editor): ImportedEditor | null {
  return storeOf(editor).imported;
}

/** Newer media from the page (a refresh): the figures draw again. */
export function setImported(editor: Editor, imported: ImportedEditor | null): void {
  const store = storeOf(editor);
  if (store.imported === imported) return;
  store.imported = imported;
  for (const listener of store.listeners) listener();
}

function useImported(editor: Editor): ImportedEditor | null {
  const subscribe = useCallback(
    (listener: () => void) => {
      const store = storeOf(editor);
      store.listeners.add(listener);
      return () => {
        store.listeners.delete(listener);
      };
    },
    [editor],
  );
  const read = () => importedOf(editor);
  return useSyncExternalStore(subscribe, read, read);
}

/** A figure's image: a PDF figure's crop of its page (the figure route). */
export function figureImageUrl(documentId: string, mediaId: string): string {
  return `/api/documents/${encodeURIComponent(documentId)}/figure/${encodeURIComponent(mediaId)}`;
}

/** A figure object as the editor holds it, its media read from the page. */
function figureOf(node: PMNode, imported: ImportedEditor | null, editor: Editor | undefined) {
  const mediaId = typeof node.attrs.mediaId === "string" ? node.attrs.mediaId : "";
  const media = mediaId && imported && Object.hasOwn(imported.figures, mediaId) ? imported.figures[mediaId] : null;
  const page = media ? media.page : typeof node.attrs.page === "number" ? node.attrs.page : null;
  const documentId = imported?.documentId ?? (editor ? insertContext(editor)?.documentId : undefined) ?? null;
  return {
    mediaId,
    blockId: typeof node.attrs.blockId === "string" ? node.attrs.blockId : "",
    html: media?.html ?? null,
    caption: media ? media.caption : typeof node.attrs.caption === "string" ? node.attrs.caption : "",
    src: page !== null && documentId && mediaId ? figureImageUrl(documentId, mediaId) : null,
  };
}

/** What a press inside a figure leaves to the figure's own parts: a video's
    controls, an embed, the video place's Try again, a mark's chip. */
const OWN_PRESS = "video, audio, iframe, button, [data-anchor-skip]";
/** A press that moves farther than this is a drag or a circle, not a click. */
const CLICK_SLOP = 6;

/** A click opens the figure's tools where it was clicked; a link in the
    figure opens with Ctrl+click (⌘+click), as a link in the page does. The
    figure object stays in place: no drag starts on it. */
function useFigureClicks(ref: RefObject<HTMLElement | null>, editor: Editor, blockId: string) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let down: { x: number; y: number } | null = null;
    const own = (target: EventTarget | null) => target instanceof Element && target.closest(OWN_PRESS) !== null;
    const link = (target: EventTarget | null) => (target instanceof Element ? target.closest("a[href]") : null);
    const onDown = (e: MouseEvent) => {
      down = e.button === 0 && !own(e.target) ? { x: e.clientX, y: e.clientY } : null;
    };
    const onUp = (e: MouseEvent) => {
      const start = down;
      down = null;
      if (!start || e.button !== 0 || !blockId || own(e.target)) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_SLOP) return;
      if ((e.ctrlKey || e.metaKey) && link(e.target)) return;
      // At the release, before the reader's own mouseup: the tools it opens
      // stay open.
      fireDocs(editor, DOCS_EVENT.figureTools, { blockId, x: e.clientX, y: e.clientY });
    };
    const onClick = (e: MouseEvent) => {
      if (link(e.target) && !(e.ctrlKey || e.metaKey)) e.preventDefault();
    };
    const onDragStart = (e: DragEvent) => e.preventDefault();
    el.addEventListener("mousedown", onDown);
    el.addEventListener("mouseup", onUp);
    el.addEventListener("click", onClick);
    el.addEventListener("dragstart", onDragStart);
    return () => {
      el.removeEventListener("mousedown", onDown);
      el.removeEventListener("mouseup", onUp);
      el.removeEventListener("click", onClick);
      el.removeEventListener("dragstart", onDragStart);
    };
  }, [ref, editor, blockId]);
}

/** A PDF figure: its crop over its caption, as the block reader draws it. A
    crop that does not load leaves the caption. */
function CropFigure({ blockId, src, caption }: { blockId: string; src: string | null; caption: string }) {
  const t = useT();
  const [failed, setFailed] = useState<string | null>(null);
  const shown = src && failed !== src ? src : null;
  return h(
    "div",
    { className: "reader-figure docs-figure-crop", "data-block-id": blockId || undefined },
    shown
      ? h("img", { key: shown, src: shown, alt: "", loading: "lazy", decoding: "async", draggable: false, onError: () => setFailed(shown) })
      : null,
    caption ? h("p", { className: "docs-figure-caption" }, caption) : null,
    // Nothing to draw: the object still shows where it stands.
    !shown && !caption ? h("p", { className: "docs-figure-empty" }, t("docsInsert.figure")) : null,
  );
}

function FigureView({ node, editor }: NodeViewProps) {
  const imported = useImported(editor);
  const ref = useRef<HTMLDivElement>(null);
  const figure = figureOf(node, imported, editor);
  useFigureClicks(ref, editor, figure.blockId);
  return h(
    NodeViewWrapper,
    { ref, className: "docs-figure-body" },
    figure.html
      ? h(MediaHtml, { blockId: figure.blockId, className: "reader-figure", html: figure.html })
      : h(CropFigure, { blockId: figure.blockId, src: figure.src, caption: figure.caption }),
  );
}

/** A figure of another document never lands here: a paste or a drop keeps
    only the figures whose media is this document's, each with its media's
    caption and page, and a toast says when one stayed out. The save checks
    the same (lib/docs/schema.ts withDocumentFigures). */
function figurePaste(editor: Editor): Plugin {
  return new Plugin({
    key: new PluginKey("docsFigurePaste"),
    props: {
      transformPasted(slice) {
        let found = false;
        slice.content.descendants((node) => {
          if (node.type.name === "figure") found = true;
          return !found && !node.isTextblock;
        });
        if (!found) return slice;
        const figures = importedOf(editor)?.figures ?? {};
        let dropped = false;
        const keep = (fragment: Fragment): Fragment => {
          const out: PMNode[] = [];
          fragment.forEach((node) => {
            if (node.type.name === "figure") {
              const mediaId = String(node.attrs.mediaId ?? "");
              const media = Object.hasOwn(figures, mediaId) ? figures[mediaId] : null;
              if (!media) {
                dropped = true;
                return;
              }
              out.push(node.type.create({ ...node.attrs, caption: media.caption, page: media.page }, null, node.marks));
              return;
            }
            if (node.isLeaf || node.isTextblock) {
              out.push(node);
              return;
            }
            const content = keep(node.content);
            out.push(node.type.createAndFill(node.attrs, content, node.marks) ?? node.copy(content));
          });
          return Fragment.fromArray(out);
        };
        const content = keep(slice.content);
        if (dropped) toast(insertT(editor)("docsInsert.figureNotPasted"), editor);
        const open = Slice.maxOpen(content);
        return new Slice(content, Math.min(slice.openStart, open.openStart), Math.min(slice.openEnd, open.openEnd));
      },
    },
  });
}

export const Figure = Node.create<FigureOptions>({
  name: "figure",
  group: "block",
  atom: true,
  selectable: true,
  // Round 1 moves a figure by cut and paste (the reader's drag guard).
  draggable: false,

  addOptions() {
    return { imported: null };
  },

  // The blockId is the paragraph index's (extensions.ts BlockIds). The save
  // sets the caption, page, and region from the figure's media.
  addAttributes() {
    return {
      mediaId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-media-id"),
        renderHTML: (attrs) => (attrs.mediaId ? { "data-media-id": String(attrs.mediaId) } : {}),
      },
      caption: { default: "", rendered: false },
      page: { default: null, rendered: false },
      region: { default: null, rendered: false },
      // A PDF page that begins at the figure (insert/page-start.ts).
      pageStart: { default: null, rendered: false },
    };
  },

  // A figure copied in this editor pastes back by its media id; figurePaste
  // keeps it only when the media is this document's.
  parseHTML() {
    return [{ tag: "div[data-docs-figure]" }];
  },

  // The copy a clipboard, a download, and Version history take: the figure
  // as the page draws it, without its video places.
  renderHTML({ node, HTMLAttributes }) {
    const editor = this.editor;
    const figure = figureOf(node, editor ? importedOf(editor) : null, editor);
    const attrs = mergeAttributes(HTMLAttributes, { "data-docs-figure": "", class: "docs-figure" });
    if (figure.html && typeof document !== "undefined") {
      const dom = document.createElement("div");
      for (const [name, value] of Object.entries(attrs)) dom.setAttribute(name, String(value));
      const body = document.createElement("div");
      body.className = "reader-figure";
      body.innerHTML = figure.html;
      dom.append(body);
      return dom;
    }
    const parts: DOMOutputSpec[] = [];
    if (figure.src) parts.push(["img", { src: figure.src, alt: "" }]);
    if (figure.caption) parts.push(["p", { class: "docs-figure-caption" }, figure.caption]);
    return ["div", attrs, ["div", { class: "reader-figure docs-figure-crop" }, ...parts]];
  },

  // Plain text holds the caption: the figure's words.
  renderText({ node }) {
    return typeof node.attrs.caption === "string" ? node.attrs.caption : "";
  },

  addNodeView() {
    return ReactNodeViewRenderer(FigureView, {
      className: "docs-figure",
      attrs: ({ node }) => ({ "data-docs-figure": "", "data-media-id": String(node.attrs.mediaId ?? "") }),
    });
  },

  addProseMirrorPlugins() {
    return [figurePaste(this.editor)];
  },
});

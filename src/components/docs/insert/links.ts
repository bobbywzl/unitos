import { Extension, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { insertContext, type InsertContext } from "@/components/docs/insert/context";

// Links in the page editor (SPEC.md §29), the parts that are not the link
// box: a link to a place in the document (#heading=<blockId>, #bookmark=
// <id>, as Google Docs writes them), a link to a document of the project
// (/n/<project>?doc=<id>, opened in this tab), and opening one — Alt+Enter
// at the caret, Ctrl/⌘+click, or the bubble's address.

export type Place = { kind: "heading" | "bookmark"; id: string };

/** The place in this document a link points to, if it points to one. */
export function placeOf(href: string): Place | null {
  const hash = href.slice(href.indexOf("#"));
  if (href.indexOf("#") < 0) return null;
  if (!href.startsWith("#")) {
    // A full address of this same document with a place after it.
    try {
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) return null;
      const doc = url.searchParams.get("doc");
      const here = new URLSearchParams(window.location.search).get("doc");
      if (doc && here && doc !== here) return null;
    } catch {
      return null;
    }
  }
  const m = /^#(heading|bookmark)=([\w.-]{1,80})$/.exec(hash);
  return m ? { kind: m[1] as Place["kind"], id: m[2] } : null;
}

/** The project document a link opens, if it is one: its id. */
export function projectDocOf(href: string, notebookId: string): string | null {
  const m = /^\/n\/([\w-]+)\?doc=([\w-]+)/.exec(href);
  return m && m[1] === notebookId ? m[2] : null;
}

/** Where a place is in the document: a heading's or a bookmark's position. */
export function placePos(doc: PMNode, place: Place): number | null {
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (place.kind === "heading" && node.isTextblock && node.attrs.blockId === place.id) {
      found = pos + 1;
      return false;
    }
    if (place.kind === "bookmark" && node.type.name === "bookmark" && node.attrs.bookmarkId === place.id) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

/** Scroll the page to a place and put the caret there; false when it is gone. */
export function goToPlace(editor: Editor, place: Place): boolean {
  const pos = placePos(editor.state.doc, place);
  if (pos === null) return false;
  const view = editor.view;
  const target = view.nodeDOM(place.kind === "heading" ? pos - 1 : pos);
  if (target instanceof HTMLElement) target.scrollIntoView({ block: "center", behavior: "smooth" });
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))));
  view.focus();
  return true;
}

/** Open a link the way its kind opens. */
export function openLinkHref(editor: Editor, href: string, ctx: InsertContext | null = insertContext(editor)): void {
  const place = placeOf(href);
  if (place) {
    goToPlace(editor, place);
    return;
  }
  if (ctx && projectDocOf(href, ctx.notebookId)) {
    ctx.navigate(href);
    return;
  }
  window.open(href, "_blank", "noopener,noreferrer");
}

/** The link under the caret, if the caret is in one. */
function caretLink(editor: Editor): string | null {
  if (!editor.isActive("link")) return null;
  const href = editor.getAttributes("link").href;
  return typeof href === "string" ? href : null;
}

export const DocsLinks = Extension.create({
  name: "docsLinks",
  addKeyboardShortcuts() {
    return {
      "Alt-Enter": () => {
        const href = caretLink(this.editor);
        if (!href) return false;
        openLinkHref(this.editor, href);
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("docsLinkOpen"),
        props: {
          handleClick(view, pos, event) {
            // Ctrl/⌘+click opens the link; a plain click places the caret
            // and the bubble shows.
            if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false;
            const link = view.state.schema.marks.link;
            const marks = view.state.doc.resolve(pos).marks();
            const mark = marks.find((m) => m.type === link);
            const href = mark?.attrs.href;
            if (typeof href !== "string") return false;
            openLinkHref(editor, href);
            return true;
          },
        },
      }),
    ];
  },
});

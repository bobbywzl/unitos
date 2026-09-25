import { Extension, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import { insertContext, type InsertContext } from "@/components/docs/insert/context";

// Links (SPEC.md §29) past the link box: a place in this document
// (#heading=<blockId>, #bookmark=<id>, as Google Docs writes them), a
// document of the project (/n/<project>?doc=<id>, opened in this tab), and
// opening one: Alt+Enter at the caret, Ctrl/⌘+click, or the bubble's title.

export type Place = { kind: "heading" | "bookmark"; id: string };

/** The place in this document a link points to, if it points to one. */
export function placeOf(href: string): Place | null {
  const at = href.indexOf("#");
  if (at < 0) return null;
  if (at > 0) {
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
  const m = /^#(heading|bookmark)=([\w.-]{1,80})$/.exec(href.slice(at));
  return m ? { kind: m[1] as Place["kind"], id: m[2] } : null;
}

/** The project document a link opens, if it is one: its id. */
export function projectDocOf(href: string, notebookId: string): string | null {
  const m = /^\/n\/([\w-]+)\?doc=([\w-]+)/.exec(href);
  return m && m[1] === notebookId ? m[2] : null;
}

/** Where a place is: inside its heading, or at its bookmark. */
export function placePos(doc: PMNode, place: Place): number | null {
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (place.kind === "heading" && node.isTextblock && node.attrs.blockId === place.id) found = pos + 1;
    else if (place.kind === "bookmark" && node.type.name === "bookmark" && node.attrs.bookmarkId === place.id) found = pos;
    return found === null;
  });
  return found;
}

/** Put the caret at `pos` and scroll it to the middle of the window. */
export function jumpTo(editor: Editor, pos: number): void {
  const view = editor.view;
  const $pos = view.state.doc.resolve(Math.min(pos, view.state.doc.content.size));
  view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)));
  view.focus();
  const { node } = view.domAtPos(view.state.selection.from);
  (node instanceof Element ? node : node.parentElement)?.scrollIntoView({ block: "center", behavior: "smooth" });
}

/** Go to a place; false when it is gone. */
export function goToPlace(editor: Editor, place: Place): boolean {
  const pos = placePos(editor.state.doc, place);
  if (pos !== null) jumpTo(editor, pos);
  return pos !== null;
}

/** Open a link the way its kind opens. */
export function openLinkHref(editor: Editor, href: string, ctx: InsertContext | null = insertContext(editor)): void {
  const place = placeOf(href);
  if (place) goToPlace(editor, place);
  else if (ctx && projectDocOf(href, ctx.notebookId)) ctx.navigate(href);
  else window.open(href, "_blank", "noopener,noreferrer");
}

export const DocsLinks = Extension.create({
  name: "docsLinks",
  addKeyboardShortcuts() {
    return {
      "Alt-Enter": () => {
        const href: unknown = this.editor.isActive("link") ? this.editor.getAttributes("link").href : null;
        if (typeof href !== "string") return false;
        openLinkHref(this.editor, href);
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          // Ctrl/⌘+click opens the link; a plain click places the caret.
          handleClick(view, pos, event) {
            if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false;
            const href: unknown = view.state.doc.resolve(pos).marks().find((m) => m.type.name === "link")?.attrs.href;
            if (typeof href !== "string") return false;
            openLinkHref(editor, href);
            return true;
          },
        },
      }),
    ];
  },
});

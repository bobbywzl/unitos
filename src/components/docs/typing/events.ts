import type { Editor } from "@tiptap/core";

// The page editor's events (SPEC.md §29), raised on its text by keys,
// commands, and other areas, so two page editors side by side never answer
// each other. The areas listen on their editor's text; the reader's pane
// hears the ones that bubble up to it (Add comment, the Unitos tools).

/** Insert link, Add comment, and a Unitos tool on the selection ({tool}). */
export const DOCS_EVENT = {
  link: "docs:link",
  comment: "docs:comment",
  tool: "docs:unitos-tool",
  mode: "docs:mode",
} as const;

/** The typing area's windows (areas/typing.tsx, word-count.tsx). */
export const TYPING_EVENT = {
  findReplace: "docs:find-replace",
  preferences: "docs:preferences",
  shortcuts: "docs:shortcuts",
  voice: "docs:voice",
  spelling: "docs:spelling",
  wordCount: "docs:word-count",
} as const;

export function fireDocs(editor: Editor, name: string, detail?: unknown): void {
  editor.view.dom.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
}

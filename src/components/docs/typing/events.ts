import type { Editor } from "@tiptap/core";
import type { DocsMode } from "@/components/docs/toolbar/mode";

// The page editor's events (SPEC.md §29), raised on its text by keys,
// commands, and other areas, so two page editors side by side never answer
// each other. The areas listen on their editor's text; the reader's pane
// hears the ones that bubble up to it (Add comment, the Unitos tools).

/** Insert link, Add comment, a Unitos tool on the selection ({tool}), and
    a click on a figure object ({blockId, x, y}: its tools open there). */
export const DOCS_EVENT = {
  link: "docs:link",
  comment: "docs:comment",
  tool: "docs:unitos-tool",
  mode: "docs:mode",
  figureTools: "docs:figure-tools",
} as const;

/** What DOCS_EVENT.mode asks for: a mode the reader chose, a mode the
    page passes into for the reader (the assistant's suggestions landing in
    Viewing), which the document does not keep and which leaves the keys
    where they are, or Viewing for Collapse (SPEC.md §28), which Collapse off
    leaves for the mode it came from. */
export type ModeRequest = DocsMode | { mode: DocsMode; passing: true } | { mode: "viewing"; collapse: true };

/** The typing area's windows (areas/typing.tsx, word-count.tsx). */
export const TYPING_EVENT = {
  findReplace: "docs:find-replace",
  preferences: "docs:preferences",
  shortcuts: "docs:shortcuts",
  voice: "docs:voice",
  spelling: "docs:spelling",
  grammar: "docs:grammar",
  personalDictionary: "docs:personal-dictionary",
  wordCount: "docs:word-count",
} as const;

export function fireDocs(editor: Editor, name: string, detail?: unknown): void {
  editor.view.dom.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
}

/** Asks the reader's pane to close its selection toolbar: the link box
    (Ctrl+K) takes its place, so one box stands at the selection. The
    reader's pane hears it as it bubbles (reader-interactions.tsx). */
export const CLOSE_TOOLBAR_EVENT = "dissect:close-toolbar";

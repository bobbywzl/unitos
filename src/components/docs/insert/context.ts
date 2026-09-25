import type { Editor } from "@tiptap/core";
import { useSyncExternalStore } from "react";
import type { PageSetup } from "@/lib/docs/schema";
import type { Lang } from "@/lib/i18n/config";
import type { TFunc } from "@/lib/i18n/dictionaries";

// What the insert area's parts share for one page editor (SPEC.md §29): the
// document, its project, the project's documents, the page, the language.
// The InsertLayer sets it; the link box, the node views, and the plugins read
// it. And the bus the plugins and the commands use to open the area's
// windows (the image options, the special characters, the @ menu) — one per
// editor, so two page editors on screen never answer each other.

export type InsertContext = {
  documentId: string;
  notebookId: string;
  documents: { id: string; title: string }[];
  pageSetup: PageSetup;
  lang: Lang;
  t: TFunc;
  /** The page takes typing now. */
  editing: boolean;
  /** Open an address of the app in this tab (a project document). */
  navigate: (href: string) => void;
};

const contexts = new WeakMap<Editor, InsertContext>();
const watchers = new WeakMap<Editor, Set<() => void>>();

export function setInsertContext(editor: Editor, context: InsertContext): void {
  contexts.set(editor, context);
  for (const watch of watchers.get(editor) ?? []) watch();
}

export function clearInsertContext(editor: Editor): void {
  contexts.delete(editor);
  for (const watch of watchers.get(editor) ?? []) watch();
}

export function insertContext(editor: Editor): InsertContext | null {
  return contexts.get(editor) ?? null;
}

/** The context, re-read when the InsertLayer sets a new one. */
export function useInsertContext(editor: Editor): InsertContext | null {
  return useSyncExternalStore(
    (onChange) => {
      let set = watchers.get(editor);
      if (!set) {
        set = new Set();
        watchers.set(editor, set);
      }
      set.add(onChange);
      return () => set.delete(onChange);
    },
    () => contexts.get(editor) ?? null,
    () => null,
  );
}

/** A window of the insert area, opened from a key, a command, or a menu. */
export type InsertEvent =
  | { type: "at-menu" }
  | { type: "context-menu"; x?: number; y?: number }
  | { type: "image-options"; section?: "size" | "wrap" | "recolor" | "adjust" | "alt" }
  | { type: "image-replace"; source: "upload" | "url" }
  | { type: "image-insert"; source: "upload" | "url" }
  | { type: "crop" }
  | { type: "table-options" }
  | { type: "table-grid" }
  | { type: "split-cell" }
  | { type: "special-characters" }
  | { type: "emoji-picker" }
  | { type: "equation"; pos: number }
  | { type: "dropdown-dialog"; dropdownId: string | null; chipPos: number | null }
  | { type: "toc-options"; pos: number }
  | { type: "clipboard-blocked" }
  | { type: "toast"; text: string };

type Handler = (event: InsertEvent) => void;
const buses = new WeakMap<Editor, Set<Handler>>();

export function emitInsert(editor: Editor, event: InsertEvent): void {
  for (const handler of buses.get(editor) ?? []) handler(event);
}

export function onInsert(editor: Editor, handler: Handler): () => void {
  let set = buses.get(editor);
  if (!set) {
    set = new Set();
    buses.set(editor, set);
  }
  set.add(handler);
  return () => set.delete(handler);
}

/** The InsertLayer of this editor is on screen: the "@" menu may open. */
export function insertLayerOn(editor: Editor): boolean {
  return (buses.get(editor)?.size ?? 0) > 0;
}

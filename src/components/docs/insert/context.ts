import type { Editor } from "@tiptap/core";
import type { PageSetup } from "@/lib/docs/schema";
import { DEFAULT_LANG, type Lang } from "@/lib/i18n/config";
import { translatorFor, type TFunc } from "@/lib/i18n/dictionaries";

// What the insert area's plugins and node views read for one page editor
// (SPEC.md §29), set by the InsertLayer, and the per-editor bus that opens
// the area's windows, so two page editors never answer each other.

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

export function setInsertContext(editor: Editor, context: InsertContext | null): void {
  if (context) contexts.set(editor, context);
  else contexts.delete(editor);
}

export function insertContext(editor: Editor): InsertContext | null {
  return contexts.get(editor) ?? null;
}

/** The page's translator; before the InsertLayer sets it, the default language's. */
export function insertT(editor: Editor): TFunc {
  return contexts.get(editor)?.t ?? translatorFor(DEFAULT_LANG);
}

/** The pickers the "@" menu opens in place of the "@query". */
export type PickerKind = "date" | "dropdown" | "table" | "emoji" | "image" | "toc" | "code";

/** A window of the insert area, opened from a key, a command, or a menu. */
type InsertEvent =
  | { type: "picker"; kind: PickerKind }
  | { type: "image-options"; section?: "alt" }
  | { type: "image-replace" }
  | { type: "table-options" }
  | { type: "split-cell" }
  | { type: "special-characters" }
  | { type: "equation"; pos: number }
  | { type: "dropdown-dialog"; dropdownId: string | null }
  | { type: "toc-options"; pos: number }
  | { type: "clipboard-blocked" };

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

/** Show a short message the way the app shows its toasts, in the pane of
    `editor`; without one, in every page editor's pane. */
export function toast(text: string, editor?: Editor): void {
  if (text) (editor?.view.dom ?? window).dispatchEvent(new CustomEvent("dissect:toast", { bubbles: true, detail: { text } }));
}

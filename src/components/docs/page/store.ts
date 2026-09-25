"use client";

import type { Editor } from "@tiptap/core";
import { useSyncExternalStore } from "react";
import type { PageSetup } from "@/lib/docs/schema";
import type { TextWidth } from "@/components/docs/page/geometry";

// The page area's state (SPEC.md §29), one store per editor: the ruler
// under the toolbar, the canvas, the dialogs, and the commands Search the
// menus runs all read and change it. The page setup is the document's (saved
// with PATCH /api/documents/[documentId]/rich-text); the ruler, the outline,
// and the text width are the reader's own, kept per browser.

export type PageDialog = "setup" | "pageNumbers" | "headerFormat" | null;
export type HeaderArea = "header" | "footer";

export type PageState = {
  documentId: string;
  setup: PageSetup;
  /** The page's zoom as a factor, Fit worked out. */
  scale: number;
  /** The pages the pagination drew. */
  pages: number;
  showRuler: boolean;
  /** Show print layout: off, the pages sit edge to edge without their top
      and bottom margins (Docs' compact view). */
  printLayout: boolean;
  /** The tabs & outlines panel: open, and its width in px. */
  outlineOpen: boolean;
  outlineWidth: number;
  textWidth: TextWidth;
  dialog: PageDialog;
  /** The header or footer being edited, and on which page. */
  editing: { area: HeaderArea; page: number } | null;
  /** The setup failed to save: the next change tries again. */
  saveError: boolean;
};

type Listener = () => void;

export type PageStore = {
  /** The reader chose to open or close the outline on this document before. */
  outlineChosen: boolean;
  get: () => PageState;
  set: (patch: Partial<PageState>) => void;
  subscribe: (listener: Listener) => () => void;
  /** Change the page setup and save it. */
  saveSetup: (next: PageSetup) => Promise<void>;
  /** Change DocsEditor's zoom. */
  zoomTo: (zoom: number | "fit") => void;
  /** The canvas hands in DocsEditor's zoom setter. */
  bindZoom: (zoomTo: (zoom: number | "fit") => void) => void;
  /** While printing, layout changes are not the reader's choice. */
  setPrinting: (on: boolean) => void;
};

const RULER_KEY = "unitos-docs-ruler";
const PRINT_LAYOUT_KEY = "unitos-docs-print-layout";
const OUTLINE_KEY = "unitos-docs-outline";
const OUTLINE_WIDTH_KEY = "unitos-docs-outline-width";
const TEXT_WIDTH_KEY = "unitos-docs-text-width";

/** The panel's width bounds, Docs': 163 to 280 px. */
export const OUTLINE_MIN = 163;
export const OUTLINE_MAX = 280;

export function readPref(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The choice holds for this page only.
  }
}

const stores = new WeakMap<Editor, PageStore>();

function createStore(editor: Editor, documentId: string, setup: PageSetup): PageStore {
  const width = readPref(TEXT_WIDTH_KEY);
  const outlineWidth = Number(readPref(OUTLINE_WIDTH_KEY));
  // The outline's open state is kept per document; a new document opens it
  // (the canvas decides, it knows whether the document is new).
  const outlinePref = readPref(`${OUTLINE_KEY}:${documentId}`);
  let state: PageState = {
    documentId,
    setup,
    scale: 1,
    pages: 1,
    showRuler: readPref(RULER_KEY) !== "0",
    printLayout: readPref(PRINT_LAYOUT_KEY) !== "0",
    outlineOpen: outlinePref === "1",
    outlineWidth: Number.isFinite(outlineWidth) && outlineWidth >= OUTLINE_MIN && outlineWidth <= OUTLINE_MAX ? outlineWidth : 240,
    textWidth: width === "medium" || width === "wide" || width === "full" ? width : "narrow",
    dialog: null,
    editing: null,
    saveError: false,
  };
  const listeners = new Set<Listener>();
  let saving: Promise<void> = Promise.resolve();
  let zoomSetter: (zoom: number | "fit") => void = () => {};
  // Printing turns the print layout on for the length of the print.
  let printing = false;
  const store: PageStore = {
    outlineChosen: outlinePref !== null,
    get: () => state,
    set: (patch) => {
      const next = { ...state, ...patch };
      if (patch.showRuler !== undefined && patch.showRuler !== state.showRuler) writePref(RULER_KEY, patch.showRuler ? "1" : "0");
      if (patch.printLayout !== undefined && patch.printLayout !== state.printLayout && !printing) {
        writePref(PRINT_LAYOUT_KEY, patch.printLayout ? "1" : "0");
      }
      if (patch.outlineOpen !== undefined && patch.outlineOpen !== state.outlineOpen) {
        writePref(`${OUTLINE_KEY}:${state.documentId}`, patch.outlineOpen ? "1" : "0");
      }
      if (patch.outlineWidth !== undefined && patch.outlineWidth !== state.outlineWidth) writePref(OUTLINE_WIDTH_KEY, String(patch.outlineWidth));
      if (patch.textWidth !== undefined && patch.textWidth !== state.textWidth) writePref(TEXT_WIDTH_KEY, patch.textWidth);
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    saveSetup: async (next) => {
      store.set({ setup: next });
      // Saves run one after another, so the last change is the one stored.
      saving = saving.then(async () => {
        try {
          const res = await fetch(`/api/documents/${state.documentId}/rich-text`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ pageSetup: next }),
          });
          store.set({ saveError: !res.ok });
        } catch {
          store.set({ saveError: true });
        }
      });
      await saving;
    },
    zoomTo: (zoom) => zoomSetter(zoom),
    bindZoom: (fn) => {
      zoomSetter = fn;
    },
    setPrinting: (on) => {
      printing = on;
    },
  };
  void editor;
  return store;
}

/** The page store of an editor, made on first use. */
export function pageStore(editor: Editor, documentId?: string, setup?: PageSetup): PageStore {
  let store = stores.get(editor);
  if (!store) {
    if (!documentId || !setup) throw new Error("page store used before the page mounted");
    store = createStore(editor, documentId, setup);
    stores.set(editor, store);
  }
  return store;
}

/** The page store, when the page has mounted. */
export function findPageStore(editor: Editor): PageStore | null {
  return stores.get(editor) ?? null;
}

/** Read one value of the page state and follow it. */
export function usePageState<T>(store: PageStore, select: (state: PageState) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.get()),
    () => select(store.get()),
  );
}

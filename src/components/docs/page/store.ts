"use client";

import type { Editor } from "@tiptap/core";
import { useSyncExternalStore } from "react";
import type { PageSetup } from "@/lib/docs/schema";
import type { TextWidth } from "@/components/docs/page/geometry";
import type { SaveState } from "@/components/docs/use-docs-save";

// The page area's state (SPEC.md §29), one store per editor: the ruler
// under the toolbar, the canvas, the dialogs, and the commands Search the
// menus runs all read and change it. The page setup is the document's (saved
// with PATCH /api/documents/[documentId]/rich-text); the ruler, the outline,
// and the text width are the reader's own, kept per browser.

/** A header or footer saves as the text does (use-docs-save.ts): after a
    pause of SAVE_DELAY_MS, or MAX_WAIT_MS of steady typing. */
const SAVE_DELAY_MS = 700;
const MAX_WAIT_MS = 3_000;

export type HeaderArea = "header" | "footer";

/** The commands reach the page's parts through these window events. */
export const PAGE_EVENT = {
  /** Enter the header or the footer of the page that holds the caret. */
  editHeader: "docs:page-edit-header",
  /** Put the page count at the caret of the header or footer being edited. */
  pageCount: "docs:page-count",
} as const;

export type EditHeaderDetail = { area: HeaderArea };

type PageState = {
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
  dialog: "setup" | "pageNumbers" | "headerFormat" | null;
  /** The header or footer being edited, and on which page. */
  editing: { area: HeaderArea; page: number } | null;
  /** The page setup's save, for the title row's status. */
  setupSave: SaveState;
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
  /** Change the page setup and save it after a pause (header typing). */
  editSetup: (next: PageSetup) => void;
  /** Change DocsEditor's zoom. */
  zoomTo: (zoom: number | "fit") => void;
  /** The canvas hands in DocsEditor's zoom setter. */
  bindZoom: (zoomTo: (zoom: number | "fit") => void) => void;
  /** While printing, layout changes are not the reader's choice. */
  setPrinting: (on: boolean) => void;
  /** The canvas hands in what runs after a setup is saved: the page's
      props refresh, so every area reads the new setup. */
  bindSaved: (fn: () => void) => void;
  /** Saves waiting or not answered yet. */
  pendingSaves: () => number;
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

function createStore(documentId: string, setup: PageSetup): PageStore {
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
    setupSave: "saved",
  };
  const listeners = new Set<Listener>();
  let saving: Promise<void> = Promise.resolve();
  let zoomSetter: (zoom: number | "fit") => void = () => {};
  let savedHook: () => void = () => {};
  let pending = 0;
  // The save a change waits for, since when changes wait, and the failed
  // saves in a row.
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstChangeAt: number | null = null;
  let retries = 0;
  const saveLater = (wait: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void store.saveSetup(state.setup), wait);
  };
  const url = `/api/documents/${documentId}/rich-text`;
  // Leaving with a change not saved: one last save, and the browser's warning.
  const onLeave = (e: BeforeUnloadEvent) => {
    const body = JSON.stringify({ pageSetup: state.setup });
    void fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body, keepalive: true });
    e.preventDefault();
  };
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
      // This save carries every change made so far.
      if (timer) clearTimeout(timer);
      timer = null;
      firstChangeAt = null;
      store.set({ setup: next, setupSave: "saving" });
      window.addEventListener("beforeunload", onLeave);
      pending += 1;
      // Saves run one after another, so the last change is the one stored.
      saving = saving.then(async () => {
        let result: SaveState = "offline";
        try {
          const res = await fetch(url, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ pageSetup: next }),
          });
          result = res.ok ? "saved" : res.status >= 500 ? "offline" : "error";
          if (res.ok) savedHook();
        } catch {
          // No connection: tried again below.
        }
        pending -= 1;
        if (pending > 0 || timer) return;
        if (result === "saved") {
          retries = 0;
          window.removeEventListener("beforeunload", onLeave);
        } else {
          // A failed save tries again, waiting longer each time.
          retries = Math.min(retries + 1, 5);
          saveLater(1000 * 2 ** retries);
        }
        store.set({ setupSave: result });
      });
      await saving;
    },
    editSetup: (next) => {
      store.set({ setup: next, setupSave: "saving" });
      window.addEventListener("beforeunload", onLeave);
      firstChangeAt ??= Date.now();
      saveLater(Date.now() - firstChangeAt >= MAX_WAIT_MS ? 0 : SAVE_DELAY_MS);
    },
    pendingSaves: () => pending + (timer ? 1 : 0),
    zoomTo: (zoom) => zoomSetter(zoom),
    bindZoom: (fn) => {
      zoomSetter = fn;
    },
    setPrinting: (on) => {
      printing = on;
    },
    bindSaved: (fn) => {
      savedHook = fn;
    },
  };
  return store;
}

/** The page store of an editor, made on first use. */
export function pageStore(editor: Editor, documentId: string, setup: PageSetup): PageStore {
  let store = stores.get(editor);
  if (!store) {
    store = createStore(documentId, setup);
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

const noStore = () => () => {};

/** The title row's save state: the text's (use-docs-save.ts) until the text
    is saved, then the page setup's. */
export function useSaveState(editor: Editor | null, documentId: string, setup: PageSetup, text: SaveState): SaveState {
  const store = editor ? pageStore(editor, documentId, setup) : null;
  const page = useSyncExternalStore<SaveState>(
    store?.subscribe ?? noStore,
    () => store?.get().setupSave ?? "saved",
    () => "saved",
  );
  return text === "saved" ? page : text;
}

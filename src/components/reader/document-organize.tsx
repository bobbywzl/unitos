"use client";

import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { CheckIcon, ChevronDownIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Collapse } from "@/components/presence";
import { useEscapeLayer } from "@/lib/escape-layers";
import { focusMenuIfKey, menuButtonKeys, menuKeys } from "@/lib/menu-keys";
import type { TFunc, TKey } from "@/lib/i18n/dictionaries";
import { DOCUMENT_SORTS, type DocumentSort, type RowKind } from "@/lib/document-order";

// Sort by, at the top of the document list (SPEC.md §6; lib/document-order.ts),
// and the row a category draws in each list. One choice per project in this
// browser, so a drag that turns one list to Custom order leaves the others
// alone; a project with no choice of its own takes the browser's last
// choice from before. Which categories are folded is kept too.

const SORT_STORE = "unitos-documents-sort";
const FOLDED_STORE = "unitos-documents-folded";
const CHANGE_EVENT = "unitos:documents-organize";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice lasts this page alone.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The list's sort: Last edited unless the reader picked another. Week
    added and Month added, two sorts until 2026-10-07, list by Added, which
    draws the weeks. */
export function useDocumentSort(projectId: string): [DocumentSort, (s: DocumentSort) => void] {
  const own = `${SORT_STORE}:${projectId}`;
  const stored = useSyncExternalStore(subscribe, () => read(own) ?? read(SORT_STORE), () => null);
  const sort =
    stored === "week" || stored === "month"
      ? "added"
      : DOCUMENT_SORTS.includes(stored as DocumentSort)
        ? (stored as DocumentSort)
        : "edited";
  return [sort, useCallback((s: DocumentSort) => write(own, s), [own])];
}

/** The folded categories, by key, and the toggle. */
export function useFoldedCategories(): [ReadonlySet<string>, (key: string) => void] {
  const stored = useSyncExternalStore(subscribe, () => read(FOLDED_STORE), () => null);
  const folded = useMemo<ReadonlySet<string>>(() => {
    try {
      const list = stored ? (JSON.parse(stored) as unknown) : [];
      return new Set(Array.isArray(list) ? list.filter((k): k is string => typeof k === "string") : []);
    } catch {
      // A stored value that is not a list: nothing is folded.
      return new Set();
    }
  }, [stored]);
  const toggle = useCallback(
    (key: string) => {
      const next = new Set(folded);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      write(FOLDED_STORE, JSON.stringify([...next]));
    },
    [folded],
  );
  return [folded, toggle];
}

const SORT_KEY: Record<DocumentSort, TKey> = {
  edited: "panes.documentsSortEdited",
  custom: "panes.documentsSortCustom",
  added: "panes.documentsSortAdded",
  title: "panes.documentsSortTitle",
  kind: "panes.documentsSortKind",
};

const KIND_KEY: Record<RowKind, TKey> = {
  folder: "panes.documentKindFolder",
  pdf: "panes.uploadItemPdf",
  page: "panes.uploadItemPage",
  word: "panes.uploadItemWord",
  // The import line's name for a Markdown or text file (docs-editor.tsx).
  markdown: "docsPage.importTextFile",
  slides: "panes.uploadItemSlides",
  sheets: "panes.uploadItemSheets",
  media: "panes.uploadItemMediaFile",
  handwritten: "panes.documentKindHandwritten",
  blank: "panes.blankDocument",
  generated: "panes.documentKindGenerated",
  text: "panes.documentKindText",
};

/** The category labels in the reader's language. */
export function categoryLabels(t: TFunc) {
  return {
    kind: (kind: RowKind) => t(KIND_KEY[kind]),
    untitled: t("panes.documentsCategoryUntitled"),
    weekOf: (date: string) => t("panes.documentsCategoryWeekOf", { date }),
  };
}

/** Sort by, at the top of the document list: a pill that opens the sorts
    under it, the current one checked. */
export function DocumentsSort({ sort, onSort }: { sort: DocumentSort; onSort: (s: DocumentSort) => void }) {
  const t = useT();
  const [picking, setPicking] = useState(false);
  // The sorts are a layer of their own: Escape closes them, not the list.
  useEscapeLayer(picking, () => setPicking(false));
  return (
    <div className="flex flex-col">
      <div className="flex items-center px-3 pt-0.5 pb-1.5">
        <button
          onClick={(e) => {
            if (!picking) focusMenuIfKey(e, "[data-sort-menu]");
            setPicking(!picking);
          }}
          onKeyDown={(e) => menuButtonKeys(e, picking, "[data-sort-menu]")}
          data-track="documents-sort"
          aria-expanded={picking}
          data-tip={t("panes.documentsSortTip")}
          // A finger gets a 36 px target (NAV13-12).
          className={`flex min-w-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] pointer-coarse:py-2.5 ${
            picking ? "border-clay bg-clay-100 text-clay-800" : "border-line text-sand-600 hover:bg-clay-100 hover:text-clay-800"
          }`}
        >
          <span className="shrink-0">{t("panes.documentsSortBy")}</span>
          <span className="truncate font-semibold">{t(SORT_KEY[sort])}</span>
          <ChevronDownIcon
            size={11}
            className={`shrink-0 text-sand-400 transition-transform duration-150 ${picking ? "rotate-180" : ""}`}
          />
        </button>
      </div>
      <Collapse open={picking}>
        {picking && (
          <div
            className="flex flex-col border-y border-line bg-sand-50/60 py-1"
            role="listbox"
            data-sort-menu
            onKeyDown={menuKeys}
          >
            {DOCUMENT_SORTS.map((s) => (
              <button
                key={s}
                role="option"
                aria-selected={s === sort}
                onClick={() => {
                  onSort(s);
                  setPicking(false);
                }}
                data-track={`documents-sort:${s}`}
                className={`flex items-center gap-2 px-4 py-1.5 text-left text-[12.5px] ${
                  s === sort ? "text-ink" : "text-sand-600 hover:bg-clay-100 hover:text-clay-800"
                }`}
              >
                <span className="flex-1">{t(SORT_KEY[s])}</span>
                {s === sort && <CheckIcon size={12} className="shrink-0 text-sand-500" />}
              </button>
            ))}
          </div>
        )}
      </Collapse>
      <div className="mx-3 mt-1 mb-1 border-t border-line" />
    </div>
  );
}

/** One category of a list: its row — the chevron, the name, the count —
    folds the rows under it. */
export function CategoryRow({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <button
        onClick={onToggle}
        data-track="documents-category-fold"
        aria-expanded={open}
        className="flex min-w-0 items-center gap-1.5 overflow-hidden px-4 pt-2 pb-1 text-left text-[11px] font-bold tracking-[0.08em] whitespace-nowrap text-sand-600 uppercase hover:text-clay-700"
        data-tip={title}
      >
        <ChevronDownIcon
          size={11}
          className={`shrink-0 text-sand-400 transition-transform duration-150 ${open ? "" : "-rotate-90"}`}
        />
        <span className="min-w-0 overflow-hidden text-ellipsis">{title}</span>
        <span className="shrink-0 font-normal tracking-normal text-sand-500 normal-case tabular-nums">{count}</span>
      </button>
      <Collapse open={open}>{open && <div className="ml-4 border-l border-line pl-1">{children}</div>}</Collapse>
    </div>
  );
}

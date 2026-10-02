"use client";

import { useCallback, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { CheckIcon, ChevronDownIcon, FolderIcon } from "@/components/icons";
import { useLang, useT } from "@/components/lang-provider";
import { Collapse } from "@/components/presence";
import type { TKey } from "@/lib/i18n/dictionaries";
import {
  DOCUMENT_GROUPINGS,
  DOCUMENT_SORTS,
  groupDocuments,
  type DocumentGrouping,
  type DocumentKind,
  type DocumentSort,
  type OrderedDocument,
} from "@/lib/document-order";

// The document list's Sort and Group by (SPEC.md §6; lib/document-order.ts):
// the two choices at the top of the list, and the list in groups for every
// grouping but Folder. One choice per browser, the same in every project,
// as the notes tray keeps its grouping; which groups are folded is kept too.

const SORT_STORE = "unitos-documents-sort";
const GROUPING_STORE = "unitos-documents-grouping";
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

/** The list's sort: Added, oldest first — the order it has always had —
    unless the reader picked another. */
export function useDocumentSort(): [DocumentSort, (s: DocumentSort) => void] {
  const stored = useSyncExternalStore(subscribe, () => read(SORT_STORE), () => null);
  const sort = DOCUMENT_SORTS.includes(stored as DocumentSort) ? (stored as DocumentSort) : "added";
  return [sort, useCallback((s: DocumentSort) => write(SORT_STORE, s), [])];
}

/** The list's grouping: Folder — the reader's own folders — unless the
    reader picked another. */
export function useDocumentGrouping(): [DocumentGrouping, (g: DocumentGrouping) => void] {
  const stored = useSyncExternalStore(subscribe, () => read(GROUPING_STORE), () => null);
  const grouping = DOCUMENT_GROUPINGS.includes(stored as DocumentGrouping) ? (stored as DocumentGrouping) : "folder";
  return [grouping, useCallback((g: DocumentGrouping) => write(GROUPING_STORE, g), [])];
}

// The folded groups, as "grouping:key".
function useFoldedGroups(): [ReadonlySet<string>, (key: string) => void] {
  const stored = useSyncExternalStore(subscribe, () => read(FOLDED_STORE), () => null);
  let folded: ReadonlySet<string> = new Set();
  try {
    const list = stored ? (JSON.parse(stored) as unknown) : [];
    if (Array.isArray(list)) folded = new Set(list.filter((k): k is string => typeof k === "string"));
  } catch {
    // A stored value that is not a list: nothing is folded.
  }
  const toggle = (key: string) => {
    const next = new Set(folded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    write(FOLDED_STORE, JSON.stringify([...next]));
  };
  return [folded, toggle];
}

const SORT_KEY: Record<DocumentSort, TKey> = {
  added: "panes.documentsSortAdded",
  "added-newest": "panes.documentsSortAddedNewest",
  title: "panes.documentsSortTitle",
  read: "panes.documentsSortRead",
};

const GROUPING_KEY: Record<DocumentGrouping, TKey> = {
  folder: "panes.documentsGroupByFolder",
  kind: "panes.documentsGroupByKind",
  week: "panes.documentsGroupByWeek",
  month: "panes.documentsGroupByMonth",
  title: "panes.documentsGroupByTitle",
};

const KIND_KEY: Record<DocumentKind, TKey> = {
  pdf: "panes.uploadItemPdf",
  page: "panes.uploadItemPage",
  word: "panes.uploadItemWord",
  markdown: "panes.uploadItemMarkdown",
  slides: "panes.uploadItemSlides",
  sheets: "panes.uploadItemSheets",
  media: "panes.uploadItemMediaFile",
  handwritten: "panes.documentKindHandwritten",
  blank: "panes.blankDocument",
  generated: "panes.documentKindGenerated",
  text: "panes.documentKindText",
};

/** Sort and Group by, at the top of the document list: each a pill that
    opens its choices under the pills, the current one checked. */
export function DocumentsOrganize({
  sort,
  onSort,
  grouping,
  onGrouping,
}: {
  sort: DocumentSort;
  onSort: (s: DocumentSort) => void;
  grouping: DocumentGrouping;
  onGrouping: (g: DocumentGrouping) => void;
}) {
  const t = useT();
  const [picking, setPicking] = useState<"sort" | "group" | null>(null);
  const pill = (which: "sort" | "group", label: string, value: string, tip: string) => (
    <button
      onClick={() => setPicking(picking === which ? null : which)}
      data-track={which === "sort" ? "documents-sort" : "documents-grouping"}
      aria-expanded={picking === which}
      data-tip={tip}
      className={`flex min-w-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] ${
        picking === which ? "border-clay bg-clay-100 text-clay-800" : "border-line text-sand-600 hover:bg-clay-100 hover:text-clay-800"
      }`}
    >
      <span className="shrink-0">{label}</span>
      <span className="truncate font-semibold">{value}</span>
      <ChevronDownIcon
        size={11}
        className={`shrink-0 text-sand-400 transition-transform duration-150 ${picking === which ? "rotate-180" : ""}`}
      />
    </button>
  );
  const choices =
    picking === "sort"
      ? DOCUMENT_SORTS.map((s) => ({ id: s, label: t(SORT_KEY[s]), current: s === sort, pick: () => onSort(s) }))
      : picking === "group"
        ? DOCUMENT_GROUPINGS.map((g) => ({ id: g, label: t(GROUPING_KEY[g]), current: g === grouping, pick: () => onGrouping(g) }))
        : [];
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-1.5 px-3 pt-0.5 pb-1.5">
        {pill("sort", t("panes.documentsSort"), t(SORT_KEY[sort]), t("panes.documentsSortTip"))}
        {pill("group", t("panes.documentsGroupBy"), t(GROUPING_KEY[grouping]), t("panes.documentsGroupByTip"))}
      </div>
      <Collapse open={picking !== null}>
        {picking !== null && (
          <div className="flex flex-col border-y border-line bg-sand-50/60 py-1" role="listbox">
            {choices.map((choice) => (
              <button
                key={choice.id}
                role="option"
                aria-selected={choice.current}
                onClick={() => {
                  choice.pick();
                  setPicking(null);
                }}
                data-track={`documents-${picking}:${choice.id}`}
                className={`flex items-center gap-2 px-4 py-1.5 text-left text-[12.5px] ${
                  choice.current ? "text-ink" : "text-sand-600 hover:bg-clay-100 hover:text-clay-800"
                }`}
              >
                <span className="flex-1">{choice.label}</span>
                {choice.current && <CheckIcon size={12} className="shrink-0 text-sand-500" />}
              </button>
            ))}
          </div>
        )}
      </Collapse>
      <div className="mx-3 mt-1 mb-1 border-t border-line" />
    </div>
  );
}

// A row's place in its list, for the falling-in delay (tree-row-in).
const rowStyle = (index: number): CSSProperties => ({ ["--row" as string]: index }) as CSSProperties;

/** The documents in groups (groupDocuments): a row per group, drawn like a
    folder, that folds and opens its documents under it, and each
    document's own row. A view: no drag, and no document moves. */
export function DocumentGroups<T extends OrderedDocument>({
  documents,
  grouping,
  sort,
  renderDocument,
}: {
  documents: T[];
  grouping: Exclude<DocumentGrouping, "folder">;
  sort: DocumentSort;
  renderDocument: (document: T) => ReactNode;
}) {
  const t = useT();
  const lang = useLang();
  const [folded, toggle] = useFoldedGroups();
  const groups = groupDocuments(documents, grouping, sort, lang, {
    kind: (kind) => t(KIND_KEY[kind]),
    untitled: t("panes.documentsGroupUntitled"),
    weekOf: (date) => t("panes.documentsGroupWeekOf", { date }),
  });
  return (
    <>
      {groups.map((group, index) => {
        const key = `${grouping}:${group.key}`;
        const open = !folded.has(key);
        return (
          <div key={key} className="tree-row-in flex flex-col" style={rowStyle(index)}>
            <button
              onClick={() => toggle(key)}
              data-track="documents-group-fold"
              aria-expanded={open}
              className="flex min-w-0 items-center gap-2 overflow-hidden px-4 py-2 text-left text-[13px] whitespace-nowrap text-sand-700 hover:bg-clay-100 hover:text-clay-800"
              data-tip={group.title}
            >
              <FolderIcon size={14} className="shrink-0 text-sand-500" />
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis">{group.title}</span>
              <span className="shrink-0 rounded-full bg-sand-200 px-1.5 text-[11px] font-normal text-sand-600 tabular-nums">
                {group.documents.length}
              </span>
              <ChevronDownIcon
                size={12}
                className={`shrink-0 text-sand-400 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
              />
            </button>
            <Collapse open={open}>
              {open && (
                <div className="ml-4 border-l border-line pl-1">
                  {group.documents.map((document, i) => (
                    <div key={document.id} className="tree-row-in" style={rowStyle(i)}>
                      {renderDocument(document)}
                    </div>
                  ))}
                </div>
              )}
            </Collapse>
          </div>
        );
      })}
    </>
  );
}

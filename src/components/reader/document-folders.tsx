"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, FolderIcon, MoreIcon, PlusIcon } from "@/components/icons";
import { useLang, useT } from "@/components/lang-provider";
import { CategoryRow, categoryLabels, useFoldedCategories } from "@/components/reader/document-organize";
import { categorizeRows, type DocumentKind, type DocumentSort, type SortRow } from "@/lib/document-order";
import { Collapse } from "@/components/presence";
import { isImeKey, useImeGuard } from "@/lib/ime";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { clipWords } from "@/lib/markdown-preview";

// Folders in the document list (SPEC.md §6). A folder is a named group of a
// project's documents; a folder can hold folders. The list draws a folder as
// a row: on a wide screen, hovering the row opens the folder's own list
// beside it (a fly-out, one per level, so the tree reads as a menu); on a
// narrow screen, a press opens the folder's list under the row. The rows of
// the documents themselves are the document bar's: it renders each one
// (renderDocument) and this file places them. A folder's list ends with New
// file here, whose + adds a document straight into the folder. A document or
// a folder drags onto a folder to move into it, or onto Move to the project
// at the top of the list; held over a folder, the drag opens its list. The
// rows of a list fall in one after another as it opens (tree-row-in).

// One folder of a project (DocumentFolder). createdAt: when it was made, for
// Sort by Week added and Month added.
export type DocumentFolderView = { id: string; title: string; parentId: string | null; createdAt: string };

// Titles sort as a reader expects: "Chapter 2" before "Chapter 10", case
// aside, in the reader's language.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

// The folders directly in `parentId` (null = the project itself), by title.
export function childFolders(folders: DocumentFolderView[], parentId: string | null): DocumentFolderView[] {
  return folders
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => collator.compare(a.title, b.title));
}

// The folder ids from the project itself down to `folderId`, `folderId`
// last; empty for null. A folder whose parent is gone reads as a root folder.
export function folderPath(folders: DocumentFolderView[], folderId: string | null): string[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: string[] = [];
  const seen = new Set<string>();
  let cursor = folderId;
  while (cursor && byId.has(cursor) && !seen.has(cursor)) {
    seen.add(cursor);
    path.unshift(cursor);
    cursor = byId.get(cursor)!.parentId;
  }
  return path;
}

// The folder and every folder under it: where a folder cannot move.
export function folderSubtree(folders: DocumentFolderView[], folderId: string): Set<string> {
  const subtree = new Set<string>([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && subtree.has(f.parentId) && !subtree.has(f.id)) {
        subtree.add(f.id);
        grew = true;
      }
    }
  }
  return subtree;
}

// The folders in tree order, each with its depth: the picker's rows.
function flattenFolders(
  folders: DocumentFolderView[],
  parentId: string | null,
  depth: number,
  skip: Set<string>,
  out: { folder: DocumentFolderView; depth: number }[],
): { folder: DocumentFolderView; depth: number }[] {
  for (const folder of childFolders(folders, parentId)) {
    if (skip.has(folder.id)) continue;
    out.push({ folder, depth });
    flattenFolders(folders, folder.id, depth + 1, skip, out);
  }
  return out;
}

// Where a document or a folder goes: the project itself, then every folder
// in tree order, indented by depth. The place it sits now is marked and
// takes no press; a moving folder's own subtree is left out.
export function FolderPicker({
  folders,
  current,
  exclude,
  disabled,
  onPick,
}: {
  folders: DocumentFolderView[];
  current: string | null;
  exclude?: Set<string>;
  disabled?: boolean;
  onPick: (folderId: string | null) => void;
}) {
  const t = useT();
  const rows: { id: string | null; title: string; depth: number }[] = [
    { id: null, title: t("panes.folderRoot"), depth: 0 },
    ...flattenFolders(folders, null, 0, exclude ?? new Set(), []).map(({ folder, depth }) => ({
      id: folder.id,
      title: folder.title,
      depth: depth + 1,
    })),
  ];
  return (
    <div className="flex flex-col border-y border-line bg-sand-50/60 py-1">
      <p className="px-4 pb-0.5 text-[11px] text-sand-500">{t("panes.moveToFolderChoose")}</p>
      {rows.map((row) => {
        const here = row.id === current;
        return (
          <button
            key={row.id ?? "root"}
            onClick={() => onPick(row.id)}
            data-track={row.id ? "folder-pick" : "folder-pick-root"}
            disabled={disabled || here}
            aria-current={here || undefined}
            style={{ paddingLeft: `${16 + row.depth * 12}px` }}
            className={`flex items-center gap-2 py-1.5 pr-4 text-left text-[12.5px] whitespace-nowrap disabled:opacity-40 ${
              here ? "text-ink" : "text-sand-600 hover:bg-clay-100 hover:text-clay-800"
            }`}
            data-tip={row.title}
          >
            {row.id !== null && <FolderIcon size={13} className="shrink-0 text-sand-400" />}
            <span className="overflow-hidden">{clipWords(row.title, 40)}</span>
            {here && <CheckIcon size={12} className="shrink-0 text-sand-500" />}
          </button>
        );
      })}
    </div>
  );
}

// Wide screens open a folder's list beside its row; narrow ones under it.
const FLYOUT_QUERY = "(min-width: 768px)";
function subscribeFlyout(onChange: () => void) {
  const media = window.matchMedia(FLYOUT_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
function readFlyout() {
  return typeof window !== "undefined" && window.matchMedia(FLYOUT_QUERY).matches;
}

// The panel a level renders in — the root list or a fly-out — so a fly-out
// knows which edge to open from.
const PanelContext = createContext<HTMLElement | null>(null);

const FLYOUT_WIDTH = 320; // w-80
// The id a new folder's row carries until the route answers.
const NEW_FOLDER_PREFIX = "new-folder:";
const FLYOUT_MAX_HEIGHT = 480;
// The wrapper's transparent margin: the card sits inside it, and the wrapper
// touches the panel, so the pointer never leaves the list on its way over.
const FLYOUT_EDGE = 6;

// A folder's list beside its row: a fixed panel in a portal (the root list
// scrolls and would clip it), placed off the row's top and the panel's right
// edge, or its left edge when the right has no room. It follows the panel's
// scroll and the window's size.
function Flyout({ rowEl, children }: { rowEl: HTMLElement; children: ReactNode }) {
  const panelEl = useContext(PanelContext);
  const [place, setPlace] = useState<{ wrapper: CSSProperties; maxHeight: number } | null>(null);
  useLayoutEffect(() => {
    if (!panelEl) return;
    const measure = () => {
      const row = rowEl.getBoundingClientRect();
      const panel = panelEl.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const fitsRight = panel.right + FLYOUT_WIDTH + 8 <= vw;
      const side: CSSProperties = fitsRight
        ? { left: panel.right, paddingLeft: FLYOUT_EDGE }
        : { right: Math.max(0, vw - panel.left), paddingRight: FLYOUT_EDGE };
      // Off the row's top, the first entry level with the row. A row near
      // the bottom of the window hangs its list up from the row's bottom.
      const top = Math.max(8, row.top - FLYOUT_EDGE);
      const roomBelow = vh - 8 - top;
      if (roomBelow >= 200 || row.bottom < vh / 2) {
        setPlace({ wrapper: { ...side, top }, maxHeight: Math.min(FLYOUT_MAX_HEIGHT, roomBelow) });
      } else {
        const bottom = Math.max(8, vh - row.bottom - FLYOUT_EDGE);
        setPlace({
          wrapper: { ...side, bottom },
          maxHeight: Math.min(FLYOUT_MAX_HEIGHT, vh - 8 - bottom),
        });
      }
    };
    measure();
    panelEl.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      panelEl.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [rowEl, panelEl]);
  const [card, setCard] = useState<HTMLElement | null>(null);
  if (!place) return null;
  return createPortal(
    <div data-document-flyout className="fixed z-40 flex" style={place.wrapper}>
      <div
        ref={setCard}
        className="menu-in flex w-80 max-w-[calc(100vw-96px)] flex-col overflow-y-auto overscroll-contain rounded-2xl bg-card py-1.5 shadow-float"
        style={{ maxHeight: place.maxHeight }}
      >
        <PanelContext.Provider value={card}>{children}</PanelContext.Provider>
      </div>
    </div>,
    document.body,
  );
}

/** Whether a fly-out fits beside the panel, on its right or its left. */
function roomBeside(panelEl: HTMLElement): boolean {
  const panel = panelEl.getBoundingClientRect();
  return panel.right + FLYOUT_WIDTH + 8 <= window.innerWidth || panel.left - FLYOUT_WIDTH - 8 >= 0;
}

// The name box for a new folder or a rename. Enter keeps it, Escape drops
// it, and a blur keeps a name that was typed — a tap elsewhere on a phone
// is how the box closes there.
function FolderNameInput({
  initial,
  placeholder,
  onKeep,
  onDrop,
}: {
  initial: string;
  placeholder: string;
  onKeep: (title: string) => void;
  onDrop: () => void;
}) {
  const ime = useImeGuard();
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const keep = () => {
    if (done.current) return;
    done.current = true;
    const title = value.trim();
    if (title && title !== initial) onKeep(title);
    else onDrop();
  };
  const drop = () => {
    if (done.current) return;
    done.current = true;
    onDrop();
  };
  return (
    <input
      autoFocus
      value={value}
      placeholder={placeholder}
      maxLength={80}
      onChange={(e) => setValue(e.target.value)}
      onBlur={keep}
      onKeyDown={(e) => {
        if (ime.isImeEnter(e) || isImeKey(e)) return;
        if (e.key === "Enter") {
          e.preventDefault();
          keep();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          drop();
        }
      }}
      {...ime.props}
      className="mx-2 my-1 min-w-0 rounded-lg border border-line bg-paper px-3 py-1.5 text-[13px] text-ink outline-none focus:border-clay"
    />
  );
}

type TreeRow = { id: string; folderId: string | null; title: string; kind: DocumentKind; addedAt: string; node: ReactNode };
type TreeError = { at: string; message: string } | null;
// What is being dragged: a document from its folder, or a folder from its
// parent (null = the project itself).
type TreeDrag = { kind: "document" | "folder"; id: string; from: string | null };
// The drop target under the pointer: a folder's id, or ROOT_TARGET.
const ROOT_TARGET = "root";
// How long a drag held over a folder waits before its list opens.
const DRAG_OPEN_MS = 450;

// A row's place in its level, for the falling-in delay (tree-row-in).
const rowStyle = (index: number): CSSProperties => ({ ["--row" as string]: index }) as CSSProperties;

// Everything a row needs, shared down the tree so the row components stay
// module-level (a component made inside another remounts on every render).
type Tree = {
  t: TFunc;
  // The list's header row (Sort by): the root drop zone draws over it.
  header: boolean;
  // Sort by (SPEC.md §6): every list's order, and its categories.
  sort: DocumentSort;
  lang: string;
  folded: ReadonlySet<string>;
  toggleFolded: (key: string) => void;
  flyout: boolean;
  canEdit: boolean;
  pending: boolean;
  folders: DocumentFolderView[];
  rows: TreeRow[];
  counts: Map<string, number>;
  activePath: string[];
  openPath: string[];
  menu: string | null;
  renaming: string | null;
  moving: string | null;
  creatingIn: string | null;
  error: TreeError;
  openFolder: (folder: DocumentFolderView) => void;
  toggleFolder: (folder: DocumentFolderView) => void;
  setMenu: Dispatch<SetStateAction<string | null>>;
  setRenaming: Dispatch<SetStateAction<string | null>>;
  setMoving: Dispatch<SetStateAction<string | null>>;
  setCreatingIn: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<TreeError>>;
  createFolder: (parentId: string | null, title: string) => void;
  renameFolder: (folder: DocumentFolderView, title: string) => void;
  moveFolder: (folder: DocumentFolderView, parentId: string | null) => void;
  deleteFolder: (folder: DocumentFolderView) => void;
  // The + of New file here: the document bar's add dialog, set to this
  // folder. null: the tree offers no New file here.
  addIn: ((folderId: string) => void) | null;
  drag: TreeDrag | null;
  dragOver: string | null;
  startDrag: (drag: TreeDrag) => void;
  endDrag: () => void;
  setDragOver: Dispatch<SetStateAction<string | null>>;
  // The drag may land on this target (a folder id, or null = the project):
  // never where it sits now, and a folder never into itself.
  canDropOn: (target: string | null) => boolean;
  dropOn: (target: string | null) => void;
};
const TreeContext = createContext<Tree | null>(null);
function useTree(): Tree {
  const tree = useContext(TreeContext);
  if (!tree) throw new Error("DocumentTree rows render inside DocumentTree");
  return tree;
}

const ROW_ACTION =
  "px-4 py-1.5 text-left text-[12.5px] text-sand-600 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40";

function ErrorLine({ at }: { at: string }) {
  const { error } = useTree();
  if (error?.at !== at) return null;
  return <p className="px-4 py-1 text-[11.5px] text-red-600">{error.message}</p>;
}

// The New folder row at the foot of a level: a press opens the name box.
function NewFolderRow({ parentId }: { parentId: string | null }) {
  const { t, pending, creatingIn, setCreatingIn, setError, createFolder } = useTree();
  const key = `new:${parentId ?? ""}`;
  return (
    <div className="flex flex-col">
      {creatingIn === key ? (
        <FolderNameInput
          initial=""
          placeholder={t("panes.folderNamePlaceholder")}
          onKeep={(title) => {
            setCreatingIn(null);
            createFolder(parentId, title);
          }}
          onDrop={() => setCreatingIn(null)}
        />
      ) : (
        <button
          onClick={() => {
            setError(null);
            setCreatingIn(key);
          }}
          data-track="folder-new"
          disabled={pending}
          className="flex items-center gap-2 px-4 py-2 text-left text-[12.5px] text-sand-500 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
          data-tip={t("panes.newFolderTitle")}
        >
          <FolderIcon size={13} className="shrink-0" />
          <span>{t("panes.newFolder")}</span>
        </button>
      )}
      <ErrorLine at={key} />
    </div>
  );
}

// New document here, at the foot of a folder's list: the + bubble opens the add
// dialog, and what it adds lands in this folder (SPEC.md §6).
function NewDocumentRow({ folderId }: { folderId: string }) {
  const { t, pending, addIn } = useTree();
  if (!addIn) return null;
  return (
    <button
      onClick={() => addIn(folderId)}
      data-track="folder-new-file"
      disabled={pending}
      className="group/new flex items-center gap-2 px-4 py-2 text-left text-[12.5px] text-sand-600 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
      data-tip={t("panes.newFileHereTitle")}
    >
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-clay-100 text-clay-700 shadow-soft transition-transform group-hover/new:scale-110 group-hover/new:bg-clay group-hover/new:text-clay-fg">
        <PlusIcon size={12} />
      </span>
      <span>{t("panes.newFileHere")}</span>
    </button>
  );
}

// Move to the project, at the top of the root list while something in a
// folder is dragged: the drop target for the project itself. `overlay`:
// drawn over the list's header row, so no row moves under the pointer
// mid-drag; without a header it takes its own line.
function RootDropRow({ overlay = false }: { overlay?: boolean }) {
  const tree = useTree();
  if (!tree.drag || !tree.canDropOn(null)) return null;
  const over = tree.dragOver === ROOT_TARGET;
  return (
    <div
      data-track="folder-root-drop"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) tree.setDragOver(ROOT_TARGET);
      }}
      onDragLeave={() => over && tree.setDragOver(null)}
      onDrop={(e) => {
        e.preventDefault();
        tree.dropOn(null);
      }}
      className={`rounded-lg border border-dashed px-3 text-[12.5px] ${
        overlay ? "absolute inset-x-2 inset-y-0.5 z-10 flex items-center bg-card" : "mx-2 my-1 py-2"
      } ${over ? "border-clay bg-clay-100 text-clay-800" : "border-line text-sand-600"}`}
    >
      {tree.t("panes.moveToProject")}
    </div>
  );
}

// A folder's row: its name and count, the chevron that says how its list
// opens, and its actions. The open list follows: beside the row on a wide
// screen, under it on a narrow one.
function FolderRow({ folder, depth }: { folder: DocumentFolderView; depth: number }) {
  const tree = useTree();
  const { t, pending, folders, counts, activePath, openPath } = tree;
  const [rowEl, setRowEl] = useState<HTMLElement | null>(null);
  // Beside the row when a side of the panel has room for the list (a wide
  // screen); else under the row, as on a phone: at 820 px neither side of
  // the list holds another list, and one opened to the left was cut off.
  const panelEl = useContext(PanelContext);
  const flyout = tree.flyout && (!panelEl || roomBeside(panelEl));
  // A folder just made shows at once (SPEC.md §6); until the route answers
  // with its id it takes no action.
  const placeholder = folder.id.startsWith(NEW_FOLDER_PREFIX);
  const canEdit = tree.canEdit && !placeholder;
  const [deleteAsk, setDeleteAsk] = useState(false);
  const open = openPath[depth] === folder.id;
  const onActivePath = activePath[depth] === folder.id;
  const count = counts.get(folder.id) ?? 0;
  const menuOpen = tree.menu === folder.id;
  const level = <Level parentId={folder.id} depth={depth + 1} />;
  // A name box open anywhere holds the fly-outs still: a hover that swapped
  // the list would take the box, and the typed name, with it.
  const typing = tree.creatingIn !== null || tree.renaming !== null;
  // A drag held over the row opens its list, so a document can go deeper.
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearOpenTimer = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = null;
  };
  const droppable = tree.drag !== null && tree.canDropOn(folder.id);
  const over = tree.dragOver === folder.id && droppable;
  return (
    <div ref={setRowEl} className="flex flex-col">
      <div
        className={`flex items-center ${over ? "bg-clay-200 ring-1 ring-clay ring-inset" : ""}`}
        onMouseEnter={flyout && !typing ? () => tree.openFolder(folder) : undefined}
        draggable={canEdit && tree.renaming !== folder.id && !pending}
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.setData("text/plain", folder.title);
          e.dataTransfer.effectAllowed = "move";
          tree.startDrag({ kind: "folder", id: folder.id, from: folder.parentId });
        }}
        onDragEnd={tree.endDrag}
        onDragOver={(e) => {
          if (!droppable) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (tree.dragOver !== folder.id) tree.setDragOver(folder.id);
          if (!openTimer.current && !open) openTimer.current = setTimeout(() => tree.openFolder(folder), DRAG_OPEN_MS);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          clearOpenTimer();
          if (tree.dragOver === folder.id) tree.setDragOver(null);
        }}
        onDrop={(e) => {
          clearOpenTimer();
          if (!droppable) return;
          e.preventDefault();
          tree.dropOn(folder.id);
        }}
      >
        {tree.renaming === folder.id ? (
          <div className="flex min-w-0 flex-1 flex-col">
            <FolderNameInput
              initial={folder.title}
              placeholder={t("panes.folderNamePlaceholder")}
              onKeep={(title) => {
                tree.setRenaming(null);
                tree.renameFolder(folder, title);
              }}
              onDrop={() => tree.setRenaming(null)}
            />
          </div>
        ) : (
          <button
            onClick={() => tree.toggleFolder(folder)}
            data-track="folder-open"
            aria-expanded={open}
            className={`flex min-w-0 flex-1 items-center gap-2 overflow-hidden px-4 py-2 text-left text-[13px] whitespace-nowrap ${
              onActivePath ? "font-semibold text-ink" : "text-sand-700"
            } ${open ? "bg-clay-100 text-clay-800" : "hover:bg-clay-100 hover:text-clay-800"}`}
            data-tip={folder.title}
          >
            <FolderIcon size={14} className="shrink-0 text-sand-500" />
            <span className="min-w-0 flex-1 overflow-hidden">{clipWords(folder.title, 40)}</span>
            {count > 0 && (
              <span className="shrink-0 rounded-full bg-sand-200 px-1.5 text-[11px] font-normal text-sand-600 tabular-nums">
                {count}
              </span>
            )}
            {flyout ? (
              <ChevronRightIcon size={12} className="shrink-0 text-sand-400" />
            ) : (
              <ChevronDownIcon
                size={12}
                className={`shrink-0 text-sand-400 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
              />
            )}
          </button>
        )}
        {canEdit && tree.renaming !== folder.id && (
          <button
            onClick={() => {
              tree.setError(null);
              tree.setMoving(null);
              tree.setMenu(menuOpen ? null : folder.id);
            }}
            data-track="folder-actions"
            aria-label={t("panes.folderActionsFor", { title: folder.title })}
            aria-expanded={menuOpen}
            data-tip={t("panes.folderActions")}
            className="mr-2 flex size-6 shrink-0 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-800"
          >
            <MoreIcon size={13} className="rotate-90" />
          </button>
        )}
      </div>
      <Collapse open={menuOpen}>
        {menuOpen && (
          <div className="mx-2 mb-1.5 flex flex-col rounded-xl bg-sand-100 py-1">
            <button
              onClick={() => {
                tree.setMenu(null);
                tree.openFolder(folder);
                tree.setCreatingIn(`new:${folder.id}`);
              }}
              data-track="folder-new-inside"
              disabled={pending}
              className={ROW_ACTION}
              data-tip={t("panes.newFolderInsideTitle")}
            >
              {t("panes.newFolderInside")}
            </button>
            <button
              onClick={() => {
                tree.setMenu(null);
                tree.setRenaming(folder.id);
              }}
              data-track="folder-rename"
              disabled={pending}
              className={ROW_ACTION}
            >
              {t("panes.renameFolder")}
            </button>
            <button
              onClick={() => tree.setMoving(tree.moving === folder.id ? null : folder.id)}
              data-track="folder-move"
              disabled={pending}
              aria-expanded={tree.moving === folder.id}
              className={ROW_ACTION}
              data-tip={t("panes.moveFolderTitle")}
            >
              {t("panes.moveToFolder")}
            </button>
            {tree.moving === folder.id && (
              <FolderPicker
                folders={folders}
                current={folder.parentId}
                exclude={folderSubtree(folders, folder.id)}
                disabled={pending}
                onPick={(parentId) => tree.moveFolder(folder, parentId)}
              />
            )}
            <button
              onClick={() => setDeleteAsk(!deleteAsk)}
              data-track="folder-delete"
              disabled={pending}
              aria-expanded={deleteAsk}
              className="px-4 py-1.5 text-left text-[12.5px] text-red-600 hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-950"
              data-tip={t("panes.deleteFolderTitle")}
            >
              {t("panes.deleteFolder")}
            </button>
            {/* The confirm under the row, in the app's own look, as for a
                document: what the folder holds moves up one level. */}
            {deleteAsk && (
              <div className="mx-2 mb-1 flex flex-col gap-2 rounded-lg bg-card px-3 py-2">
                <p className="text-[12px] leading-snug text-sand-700">{t("panes.confirmDeleteFolder")}</p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setDeleteAsk(false);
                      tree.deleteFolder(folder);
                    }}
                    data-track="folder-delete-confirm"
                    disabled={pending}
                    className="rounded-full bg-red-600 px-3 py-1 text-[12px] font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {t("panes.deleteFolder")}
                  </button>
                  <button
                    onClick={() => setDeleteAsk(false)}
                    className="rounded-full px-3 py-1 text-[12px] text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            )}
            <ErrorLine at={`folder:${folder.id}`} />
          </div>
        )}
      </Collapse>
      {flyout ? (
        open && rowEl && <Flyout rowEl={rowEl}>{level}</Flyout>
      ) : (
        <Collapse open={open}>
          {open && <div className="ml-4 border-l border-line pl-1">{level}</div>}
        </Collapse>
      )}
    </div>
  );
}

// One level of the tree: its folders, then its documents, then New file
// here (a folder's list) and New folder. Each row falls in after the one
// above it (tree-row-in), and a document's row drags. A sort other than
// Added puts the folders and the documents in categories (SPEC.md §6): a
// folder is a row like a document there, sorted by its own title and the
// day it was made, and under Kind a kind of its own.
function Level({ parentId, depth }: { parentId: string | null; depth: number }) {
  const tree = useTree();
  const { t, canEdit, folders, rows, pending, sort } = tree;
  const subfolders = childFolders(folders, parentId);
  const own = rows.filter((row) => row.folderId === parentId);
  const empty = subfolders.length === 0 && own.length === 0;
  let index = 0;
  const folderNode = (folder: DocumentFolderView, i: number) => (
    <div key={folder.id} className="tree-row-in" style={rowStyle(i)}>
      <FolderRow folder={folder} depth={depth} />
    </div>
  );
  const documentNode = (row: TreeRow, i: number) => (
    <div
      key={row.id}
      className={`tree-row-in ${tree.drag?.id === row.id ? "opacity-50" : ""}`}
      style={rowStyle(i)}
      draggable={canEdit && !pending}
      aria-roledescription={canEdit ? t("panes.dragDocumentTitle") : undefined}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", row.id);
        e.dataTransfer.effectAllowed = "move";
        tree.startDrag({ kind: "document", id: row.id, from: row.folderId });
      }}
      onDragEnd={tree.endDrag}
    >
      {row.node}
    </div>
  );
  let list: ReactNode;
  if (sort === "added") {
    list = (
      <>
        {subfolders.map((folder) => folderNode(folder, index++))}
        {own.map((row) => documentNode(row, index++))}
      </>
    );
  } else {
    type LevelRow = SortRow & { render: (i: number) => ReactNode };
    const levelRows: LevelRow[] = [
      ...subfolders.map((folder) => ({
        id: folder.id,
        title: folder.title,
        kind: "folder" as const,
        addedAt: folder.createdAt,
        render: (i: number) => folderNode(folder, i),
      })),
      ...own.map((row) => ({
        id: row.id,
        title: row.title,
        kind: row.kind,
        addedAt: row.addedAt,
        render: (i: number) => documentNode(row, i),
      })),
    ];
    list = categorizeRows(levelRows, sort, tree.lang, categoryLabels(t)).map((category) => {
      const key = `${sort}:${parentId ?? ""}:${category.key}`;
      return (
        <div key={key} className="tree-row-in" style={rowStyle(index++)}>
          <CategoryRow
            title={category.title}
            count={category.rows.length}
            open={!tree.folded.has(key)}
            onToggle={() => tree.toggleFolded(key)}
          >
            {category.rows.map((row, i) => row.render(i))}
          </CategoryRow>
        </div>
      );
    });
  }
  return (
    <>
      {parentId === null && !tree.header && <RootDropRow />}
      {parentId === null && <ErrorLine at="drag" />}
      {list}
      {parentId !== null && empty && (
        <p className="tree-row-in px-4 py-2 text-[12.5px] text-sand-500" style={rowStyle(index++)}>
          {t("panes.folderEmpty")}
        </p>
      )}
      {canEdit && !empty && <div className="mx-3 my-1 border-t border-line" />}
      {canEdit && parentId !== null && (
        <div className="tree-row-in" style={rowStyle(index++)}>
          <NewDocumentRow folderId={parentId} />
        </div>
      )}
      {canEdit && (
        <div className="tree-row-in" style={rowStyle(index++)}>
          <NewFolderRow parentId={parentId} />
        </div>
      )}
    </>
  );
}

// The project's folders and documents as one tree of rows. `documents` are
// the document bar's rows in the order it keeps; this places each under its
// folder, or in the project itself when it has none. `panelEl` is the root
// list's element: the fly-outs open from its edge.
export function DocumentTree<
  T extends { id: string; folderId: string | null; title: string; kind: DocumentKind; addedAt: string },
>({
  notebookId,
  folders: storedFolders,
  documents,
  sort,
  activeId,
  canEdit,
  panelEl,
  renderDocument,
  onAddIn,
  header,
}: {
  notebookId: string;
  folders: DocumentFolderView[];
  documents: T[];
  /** Sort by (SPEC.md §6): every list's order and categories. */
  sort: DocumentSort;
  activeId: string | null;
  canEdit: boolean;
  panelEl: HTMLElement | null;
  renderDocument: (document: T) => ReactNode;
  /** New document here: open the add dialog set to this folder. */
  onAddIn?: (folderId: string) => void;
  /** The row over the root list (Sort by): it stays at the top as the list
      scrolls, and a drag draws the move-out drop zone over it. */
  header?: ReactNode;
}) {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const flyout = useSyncExternalStore(subscribeFlyout, readFlyout, () => false);
  const [folded, toggleFolded] = useFoldedCategories();
  // A move shows at once (SPEC.md §6): the dropped document or folder sits
  // in its new place while the route runs, and goes back, with the error
  // under the list, when the route refuses. An entry leaves once the page's
  // own data says the same.
  const [docMoves, setDocMoves] = useState<ReadonlyMap<string, string | null>>(() => new Map());
  const [folderMoves, setFolderMoves] = useState<ReadonlyMap<string, string | null>>(() => new Map());
  const [seen, setSeen] = useState({ documents, storedFolders });
  if (seen.documents !== documents || seen.storedFolders !== storedFolders) {
    setSeen({ documents, storedFolders });
    const pendingDocs = [...docMoves].filter(([id, to]) => documents.find((d) => d.id === id)?.folderId !== to);
    if (pendingDocs.length !== docMoves.size) setDocMoves(new Map(pendingDocs));
    const pendingFolders = [...folderMoves].filter(([id, to]) => storedFolders.find((f) => f.id === id)?.parentId !== to);
    if (pendingFolders.length !== folderMoves.size) setFolderMoves(new Map(pendingFolders));
  }
  // Folders made here that the page's data does not hold yet.
  const [newFolders, setNewFolders] = useState<DocumentFolderView[]>([]);
  const [seenFolders, setSeenFolders] = useState(storedFolders);
  if (seenFolders !== storedFolders) {
    setSeenFolders(storedFolders);
    const left = newFolders.filter((f) => !storedFolders.some((g) => g.id === f.id));
    if (left.length !== newFolders.length) setNewFolders(left);
  }
  const folders = useMemo(() => {
    const moved =
      folderMoves.size === 0
        ? storedFolders
        : storedFolders.map((f) => (folderMoves.has(f.id) ? { ...f, parentId: folderMoves.get(f.id) ?? null } : f));
    return newFolders.length === 0 ? moved : [...moved, ...newFolders.filter((f) => !moved.some((g) => g.id === f.id))];
  }, [storedFolders, folderMoves, newFolders]);
  const known = new Set(folders.map((f) => f.id));
  const rows: TreeRow[] = documents.map((d) => {
    const folderId = docMoves.has(d.id) ? (docMoves.get(d.id) ?? null) : d.folderId;
    return {
    id: d.id,
    folderId: folderId && known.has(folderId) ? folderId : null,
    title: d.title,
    kind: d.kind,
    addedAt: d.addedAt,
    node: renderDocument(d),
    };
  });
  // The open folders, one per level, from the project itself down. A wide
  // screen opens on hover; a narrow one opens on the open document's path,
  // so the reader sees where they are.
  const activePath = folderPath(folders, rows.find((row) => row.id === activeId)?.folderId ?? null);
  const [openPath, setOpenPath] = useState<string[]>(() => (readFlyout() ? [] : activePath));
  // Documents in each folder, the folders under it counted in: the number
  // on the row.
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const id of folderPath(folders, row.folderId)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  // One folder's actions open at a time; its rename box; its move picker;
  // the level whose New folder box is open.
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  // The last failure, under the row it came from: a folder's actions, or a
  // level's New folder row.
  const [error, setError] = useState<TreeError>(null);
  const [drag, setDrag] = useState<TreeDrag | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  // The screen crossed the width: the fly-outs close, or the open
  // document's path opens under its rows. Adjust-during-render, the same
  // pattern as presence.tsx.
  const [wasFlyout, setWasFlyout] = useState(flyout);
  if (wasFlyout !== flyout) {
    setWasFlyout(flyout);
    setOpenPath(flyout ? [] : activePath);
  }

  async function run(at: string, call: () => Promise<unknown>, after?: () => void, undo?: () => void) {
    if (busy.current) {
      undo?.();
      return;
    }
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await call();
      after?.();
      router.refresh();
    } catch (err) {
      undo?.();
      setError({ at, message: err instanceof Error ? err.message : t("common.requestFailed") });
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const tree: Tree = {
    t,
    header: header !== undefined,
    sort,
    lang,
    folded,
    toggleFolded,
    flyout,
    canEdit,
    pending,
    folders,
    rows,
    counts,
    activePath,
    openPath,
    menu,
    renaming,
    moving,
    creatingIn,
    error,
    // Open a folder's list: the path down to it, nothing deeper.
    openFolder: (folder) => setOpenPath([...folderPath(folders, folder.parentId), folder.id]),
    toggleFolder: (folder) => {
      const depth = folderPath(folders, folder.parentId).length;
      if (openPath[depth] === folder.id) setOpenPath(openPath.slice(0, depth));
      else setOpenPath([...folderPath(folders, folder.parentId), folder.id]);
    },
    setMenu,
    setRenaming,
    setMoving,
    setCreatingIn,
    setError,
    // The new folder's row shows at once, then takes the route's id; a
    // refused create takes it off, with the error under the level.
    createFolder: (parentId, title) => {
      const tempId = `${NEW_FOLDER_PREFIX}${Date.now()}`;
      const temp: DocumentFolderView = { id: tempId, title, parentId, createdAt: new Date().toISOString() };
      setNewFolders((list) => [...list, temp]);
      let madeId: string | null = null;
      void run(
        `new:${parentId ?? ""}`,
        async () => {
          const made = await api<{ id?: unknown }>(`/api/notebooks/${notebookId}/folders`, "POST", { title, parentId });
          if (typeof made?.id === "string") madeId = made.id;
        },
        () => {
          const id = madeId;
          setNewFolders((list) => (id ? list.map((f) => (f.id === tempId ? { ...f, id } : f)) : list.filter((f) => f.id !== tempId)));
        },
        () => setNewFolders((list) => list.filter((f) => f.id !== tempId)),
      );
    },
    renameFolder: (folder, title) => {
      void run(`folder:${folder.id}`, () =>
        api(`/api/notebooks/${notebookId}/folders/${folder.id}`, "PATCH", { title }),
      );
    },
    moveFolder: (folder, parentId) => {
      void run(
        `folder:${folder.id}`,
        () => api(`/api/notebooks/${notebookId}/folders/${folder.id}`, "PATCH", { parentId }),
        () => {
          setMoving(null);
          setMenu(null);
        },
      );
    },
    addIn: canEdit && onAddIn ? onAddIn : null,
    drag,
    dragOver,
    startDrag: (next) => {
      setError(null);
      setMenu(null);
      setDrag(next);
    },
    endDrag: () => {
      setDrag(null);
      setDragOver(null);
    },
    setDragOver,
    canDropOn: (target) => {
      if (!drag) return false;
      if (drag.from === target) return false;
      if (drag.kind === "folder" && target !== null && folderSubtree(folders, drag.id).has(target)) return false;
      return true;
    },
    // A document moves with the document route, a folder with the folder
    // route (which refuses a folder into itself as well).
    dropOn: (target) => {
      const moving = drag;
      setDrag(null);
      setDragOver(null);
      if (!moving || moving.from === target) return;
      const place = <V,>(set: (update: (m: ReadonlyMap<string, V>) => ReadonlyMap<string, V>) => void, value: V | undefined) =>
        set((m) => {
          const next = new Map(m);
          if (value === undefined) next.delete(moving.id);
          else next.set(moving.id, value);
          return next;
        });
      if (moving.kind === "document") {
        place(setDocMoves, target);
        void run(
          "drag",
          () => api(`/api/notebooks/${notebookId}/documents/${moving.id}`, "PATCH", { folderId: target }),
          undefined,
          () => place<string | null>(setDocMoves, undefined),
        );
      } else {
        if (target !== null && folderSubtree(folders, moving.id).has(target)) return;
        place(setFolderMoves, target);
        void run(
          "drag",
          () => api(`/api/notebooks/${notebookId}/folders/${moving.id}`, "PATCH", { parentId: target }),
          undefined,
          () => place<string | null>(setFolderMoves, undefined),
        );
      }
    },
    // What the folder holds moves up one level; the route does it.
    deleteFolder: (folder) => {
      void run(
        `folder:${folder.id}`,
        () => api(`/api/notebooks/${notebookId}/folders/${folder.id}`, "DELETE"),
        () => {
          setMenu(null);
          setOpenPath((path) =>
            path.includes(folder.id) ? path.slice(0, path.indexOf(folder.id)) : path,
          );
        },
      );
    },
  };

  return (
    <TreeContext.Provider value={tree}>
      <PanelContext.Provider value={panelEl}>
        {header && (
          // Sticks at the list's very top, over its 6px padding (py-1.5 in
          // document-bar.tsx), so no row shows above it as the list scrolls.
          <div className="sticky -top-1.5 z-10 bg-card">
            {header}
            <RootDropRow overlay />
          </div>
        )}
        <Level parentId={null} depth={0} />
      </PanelContext.Provider>
    </TreeContext.Provider>
  );
}

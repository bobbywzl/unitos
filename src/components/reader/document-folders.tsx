"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { ACCOUNT_HEADER } from "@/lib/constants";
import { postUndoPill } from "@/lib/notes/undo-pill";
import { tabAccount } from "@/lib/tab-account";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, FolderIcon, MoreIcon, PlusIcon } from "@/components/icons";
import { useLang, useT } from "@/components/lang-provider";
import { CategoryRow, categoryLabels, useFoldedCategories } from "@/components/reader/document-organize";
import {
  categorizeRows,
  sortByEdited,
  sortByPosition,
  spansWeeks,
  type CategorySort,
  type DocumentKind,
  type DocumentSort,
  type RowCategory,
  type SortRow,
} from "@/lib/document-order";
import { edgeScrollStep, pressToDrag, scrollBoxOf } from "@/components/reader/tree-drag";
import { Collapse } from "@/components/presence";
import { isImeKey, useImeGuard } from "@/lib/ime";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { clipWords } from "@/lib/markdown-preview";
import { focusWhenDrawn, useEscapeLayer } from "@/lib/escape-layers";

// Folders in the document list (SPEC.md §6). A folder is a named group of a
// project's documents; a folder can hold folders. The list draws a folder as
// a row: on a wide screen, hovering the row opens the folder's own list
// beside it (a fly-out, one per level, so the tree reads as a menu); on a
// narrow screen, a press opens the folder's list under the row. The rows of
// the documents themselves are the document bar's: it renders each one
// (renderDocument) and this file places them. A folder's list ends with New
// file here, whose + adds a document straight into the folder. A hold picks a
// document or a folder up (tree-drag.ts). Over the upper or lower part of a
// row, a drop line says where it lands in that list: the drop puts the list
// in Custom order. Over the middle of a folder's row, the row lights up and
// the drop moves it into the folder; Move to the project, at the top of the
// list, takes it out of every folder. Held over a folder, the drag opens its
// list. The rows of a list fall in one after another as it opens
// (tree-row-in).

// One folder of a project (DocumentFolder). createdAt: when it was made, for
// Sort by Added. position: its place in its parent's
// list under Custom order; null = never placed by a drag.
export type DocumentFolderView = {
  id: string;
  title: string;
  parentId: string | null;
  position: number | null;
  createdAt: string;
};

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

// A folder's last edit, for Last edited (SPEC.md §6): the newest of the
// documents in it, the folders under it counted in; the day it was made
// when it holds none.
function folderEditedAt(
  folder: DocumentFolderView,
  folders: DocumentFolderView[],
  rows: { folderId: string | null; editedAt: string }[],
): string {
  let newest = folder.createdAt;
  for (const row of rows) {
    if (Date.parse(row.editedAt) > Date.parse(newest) && folderPath(folders, row.folderId).includes(folder.id)) {
      newest = row.editedAt;
    }
  }
  return newest;
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

// The rows the keys move between, in a list or a fly-out.
export const LIST_ROWS = '[data-track="document-open"], [data-track="folder-open"]';
// The controls at a folder's list's foot.
const FLYOUT_FOOT = '[data-track="folder-new-file"], [data-track="folder-new"]';


// A folder's list beside its row: a fixed panel in a portal (the root list
// scrolls and would clip it), placed off the row's top and the panel's right
// edge, or its left edge when the right has no room. It follows the panel's
// scroll and the window's size.
// By keys: ← or Escape in a fly-out closes it and puts the focus back on
// its folder's row, one level at a time.
function Flyout({
  rowEl,
  folderId,
  onBack,
  children,
}: {
  rowEl: HTMLElement;
  folderId: string;
  onBack: () => void;
  children: ReactNode;
}) {
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
    <div
      data-document-flyout
      data-flyout-for={folderId}
      className="fixed z-40 flex"
      style={place.wrapper}
      onKeyDown={(e) => {
        if (e.key !== "Escape" && e.key !== "ArrowLeft") return;
        // Only from a row or the list's foot (New document here, in an
        // empty folder the only control): a folder's open actions take
        // their own Escape.
        if (!(e.target instanceof Element) || !e.target.matches(`${LIST_ROWS}, ${FLYOUT_FOOT}`)) return;
        // The innermost fly-out takes it; the list and the fly-outs under
        // it stay.
        e.preventDefault();
        e.stopPropagation();
        onBack();
      }}
    >
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
// it and gives the focus to `escapeTo` (New folder, or the folder's row),
// and a blur keeps a name that was typed — a tap elsewhere on a phone is
// how the box closes there.
function FolderNameInput({
  initial,
  placeholder,
  onKeep,
  onDrop,
  escapeTo,
}: {
  initial: string;
  placeholder: string;
  onKeep: (title: string) => void;
  onDrop: () => void;
  escapeTo: string;
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
          focusWhenDrawn(escapeTo);
        }
      }}
      {...ime.props}
      className="mx-2 my-1 min-w-0 rounded-lg border border-line bg-paper px-3 py-1.5 text-[13px] text-ink outline-none focus:border-clay"
    />
  );
}

type TreeRow = {
  id: string;
  folderId: string | null;
  position: number | null;
  title: string;
  kind: DocumentKind;
  addedAt: string;
  editedAt: string;
  node: ReactNode;
};
type TreeError = { at: string; message: string } | null;
// What is being dragged: a document from its folder, or a folder from its
// parent (null = the project itself).
type TreeDrag = { kind: "document" | "folder"; id: string; from: string | null };
type TreeItem = { kind: "document" | "folder"; id: string };
// Where a drop lands, read from the row under the pointer:
// - line: in the list of `parentId` (null = the project itself), before or
//   after the row `target` (null = the list's end); `at` is where the drop
//   line draws.
// - into: inside the folder `folderId` (null = the project itself, Move to
//   the project).
type TreeHint =
  | {
      kind: "line";
      parentId: string | null;
      target: TreeItem | null;
      before: boolean;
      at: { top: number; left: number; width: number };
    }
  | { kind: "into"; folderId: string | null };
// The drop target under the pointer: a folder's id, or ROOT_TARGET.
const ROOT_TARGET = "root";
// How long a drag held over a folder waits before its list opens.
const DRAG_OPEN_MS = 450;
// The share of a folder's row, at its top and at its bottom, where a drop
// lands beside the folder; the middle drops into it.
const FOLDER_EDGE = 0.3;

// One row of a level, folder or document, with what Sort by reads.
type LevelEntry = SortRow & { position: number | null } & (
    | { entry: "folder"; folder: DocumentFolderView }
    | { entry: "document"; row: TreeRow }
  );
// A level as Sort by draws it: one run of rows, or rows in categories
// (`by`: what makes the categories).
type LevelLayout = { flat: LevelEntry[] } | { categories: RowCategory<LevelEntry>[]; by: CategorySort };
const itemOf = (e: LevelEntry): TreeItem => ({ kind: e.entry, id: e.id });

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
  // Close a folder's list and the lists under it.
  closeFolder: (folder: DocumentFolderView) => void;
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
  // A level's rows in the order Sort by draws them.
  layout: (parentId: string | null) => LevelLayout;
  drag: TreeDrag | null;
  // The row a hold picked up, before it moves.
  held: string | null;
  // The folder (or ROOT_TARGET) a drop would move the drag into.
  dragOver: string | null;
  // A press on a row: a hold picks it up.
  press: (e: ReactPointerEvent<HTMLElement>, drag: TreeDrag) => void;
  // Alt+↑ or Alt+↓ on a row: the row moves one place in its list, as a drag
  // to the line above the row before it, or below the row after it, does.
  nudge: (e: ReactKeyboardEvent<HTMLElement>, item: TreeDrag) => void;
  // The drag may land on this target (a folder id, or null = the project):
  // never where it sits now, and a folder never into itself.
  canDropOn: (target: string | null) => boolean;
};
const TreeContext = createContext<Tree | null>(null);
function useTree(): Tree {
  const tree = useContext(TreeContext);
  if (!tree) throw new Error("DocumentTree rows render inside DocumentTree");
  return tree;
}

const ROW_ACTION =
  "px-4 py-1.5 text-left text-[12.5px] text-sand-600 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40";

/** A row's title is its tooltip only when the row cuts it: by words
    (clipWords at `max`) or by the row's width. Read as the pointer comes in,
    before the tooltip shows (tooltip.tsx reads data-tip then). */
export function tipWhenCut(el: HTMLElement, title: string, max: number) {
  const cut = clipWords(title, max) !== title || el.scrollWidth > el.clientWidth + 1;
  el.setAttribute("data-tip", cut ? title : "");
}

function ErrorLine({ at }: { at: string }) {
  const { error } = useTree();
  if (error?.at !== at) return null;
  return <p className="px-4 py-1 text-[11.5px] text-red-600">{error.message}</p>;
}

// The New folder row at the foot of the root list: a press opens the name
// box. In a folder's list the row is the name box alone, while the folder's
// ⋮ New folder inside has it open: a folder's list keeps one row that
// creates (New document here).
function NewFolderRow({ parentId }: { parentId: string | null }) {
  const { t, pending, creatingIn, setCreatingIn, setError, createFolder } = useTree();
  const key = `new:${parentId ?? ""}`;
  if (parentId !== null && creatingIn !== key) return <ErrorLine at={key} />;
  return (
    // The foot of the level: a drag over it lands at the list's end.
    <div className="flex flex-col" data-tree-end={parentId ?? ""}>
      {creatingIn === key ? (
        <FolderNameInput
          initial=""
          placeholder={t("panes.folderNamePlaceholder")}
          onKeep={(title) => {
            setCreatingIn(null);
            createFolder(parentId, title);
          }}
          onDrop={() => setCreatingIn(null)}
          escapeTo={parentId === null ? '[data-track="folder-new"]' : `[data-folder-row="${parentId}"]`}
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
      data-tree-root
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
function FolderRow({
  folder,
  depth,
  parentId,
}: {
  folder: DocumentFolderView;
  depth: number;
  parentId: string | null;
}) {
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
  const open = openPath[depth] === folder.id;
  const onActivePath = activePath[depth] === folder.id;
  const count = counts.get(folder.id) ?? 0;
  const menuOpen = tree.menu === folder.id;
  const level = <Level parentId={folder.id} depth={depth + 1} />;
  // A name box open anywhere holds the fly-outs still: a hover that swapped
  // the list would take the box, and the typed name, with it.
  const typing = tree.creatingIn !== null || tree.renaming !== null;
  const over = tree.dragOver === folder.id && tree.drag !== null && tree.canDropOn(folder.id);
  const dragged = tree.drag?.kind === "folder" && tree.drag.id === folder.id;
  // The folder's actions are a layer of their own: Escape closes them, not
  // the list, and the focus goes back to ⋮.
  useEscapeLayer(menuOpen, () => tree.setMenu(null));
  // Into the list: its first row, else (an empty folder) New document here.
  const focusFlyout = () => focusWhenDrawn(`[data-flyout-for="${folder.id}"] :is(${LIST_ROWS}, ${FLYOUT_FOOT})`);
  return (
    <div ref={setRowEl} className="flex flex-col">
      <div
        data-tree-row="folder"
        data-tree-id={folder.id}
        data-tree-parent={parentId ?? ""}
        // Its list open under the row: a drop at the row's lower edge lands
        // at that list's start.
        data-tree-open-under={open && !flyout ? "" : undefined}
        data-held={tree.held === folder.id || dragged ? "" : undefined}
        className={`flex items-center transition-[transform,opacity,background-color] duration-150 [-webkit-touch-callout:none] ${
          over ? "bg-clay-200 ring-1 ring-clay ring-inset" : ""
        } ${dragged ? "opacity-40" : ""} ${tree.held === folder.id ? "scale-[0.98] bg-clay-100" : ""}`}
        onMouseEnter={flyout && !typing && !dragged ? () => tree.openFolder(folder) : undefined}
        onPointerDown={
          canEdit && tree.renaming !== folder.id && !pending
            ? (e) => tree.press(e, { kind: "folder", id: folder.id, from: parentId })
            : undefined
        }
        onKeyDown={
          canEdit && tree.renaming !== folder.id && !pending
            ? (e) => tree.nudge(e, { kind: "folder", id: folder.id, from: parentId })
            : undefined
        }
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
              escapeTo={`[data-folder-row="${folder.id}"]`}
            />
          </div>
        ) : (
          <button
            // A fly-out opens on the pointer's hover: a click there opens
            // it and never closes it (another row, Escape or ← close it).
            // Under the row (a phone, a narrow panel) a click toggles.
            onClick={() => (flyout ? tree.openFolder(folder) : tree.toggleFolder(folder))}
            // By keys, a fly-out is a submenu: Enter, Space or → opens the
            // folder's list and moves into it.
            onKeyDown={(e) => {
              if (!flyout || (e.key !== "Enter" && e.key !== " " && e.key !== "ArrowRight")) return;
              e.preventDefault();
              e.stopPropagation();
              if (!open) tree.openFolder(folder);
              focusFlyout();
            }}
            data-track="folder-open"
            data-folder-row={folder.id}
            aria-expanded={open}
            className={`flex min-w-0 flex-1 items-center gap-2 overflow-hidden px-4 py-2 text-left text-[13px] whitespace-nowrap ${
              onActivePath ? "font-semibold text-ink" : "text-sand-700"
            } ${open ? "bg-clay-100 text-clay-800" : "hover:bg-clay-100 hover:text-clay-800"}`}
            // The name as a tooltip only when the row cuts it.
            data-tip={folder.title}
            onPointerEnter={(e) => tipWhenCut(e.currentTarget, folder.title, 40)}
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
            className="mr-2 flex size-6 shrink-0 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-800 pointer-coarse:size-9"
          >
            <MoreIcon size={13} />
          </button>
        )}
      </div>
      <Collapse open={menuOpen}>
        {menuOpen && (
          <div data-no-drag className="mx-2 mb-1.5 flex flex-col rounded-xl bg-sand-100 py-1">
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
            {/* Delete folder asks nothing: the folder goes at once, what it
                held moves up one level, and the notes' Undo pill offers
                Undo; the server's delete waits for the pill. */}
            <button
              onClick={() => tree.deleteFolder(folder)}
              data-track="folder-delete"
              disabled={pending}
              className="px-4 py-1.5 text-left text-[12.5px] text-red-600 hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-950"
              data-tip={t("panes.deleteFolderTitle")}
            >
              {t("panes.deleteFolder")}
            </button>
            <ErrorLine at={`folder:${folder.id}`} />
          </div>
        )}
      </Collapse>
      {flyout ? (
        open &&
        rowEl && (
          <Flyout
            rowEl={rowEl}
            folderId={folder.id}
            onBack={() => {
              tree.closeFolder(folder);
              rowEl.querySelector<HTMLElement>(`[data-folder-row="${folder.id}"]`)?.focus();
            }}
          >
            {level}
          </Flyout>
        )
      ) : (
        <Collapse open={open}>
          {open && <div className="ml-4 border-l border-line pl-1">{level}</div>}
        </Collapse>
      )}
    </div>
  );
}

// One level of the tree: its rows in the order Sort by draws them (layout),
// then New file here (a folder's list) and New folder. Each row falls in
// after the one above it (tree-row-in), and a hold picks a row up. Last
// edited lists the folders among the documents, newest edit first: a
// folder's last edit is the newest of the documents in it. Custom order
// lists them in the order a drag left them. Added lists them as they were
// before sorts existed; added over more than one week, a category per week.
// Title and Kind put the folders and the documents in categories (SPEC.md
// §6): a folder is a row like a document there, sorted by its own title and
// the day it was made, and under Kind a kind of its own.
function Level({ parentId, depth }: { parentId: string | null; depth: number }) {
  const tree = useTree();
  const { t, canEdit, pending } = tree;
  const layout = tree.layout(parentId);
  const entries = "flat" in layout ? layout.flat : layout.categories.flatMap((c) => c.rows);
  const empty = entries.length === 0;
  let index = 0;
  const render = (entry: LevelEntry, i: number) =>
    entry.entry === "folder" ? (
      <div key={entry.id} className="tree-row-in" style={rowStyle(i)}>
        <FolderRow folder={entry.folder} depth={depth} parentId={parentId} />
      </div>
    ) : (
      <div
        key={entry.id}
        data-tree-row="document"
        data-tree-id={entry.id}
        data-tree-parent={parentId ?? ""}
        className={`tree-row-in transition-[transform,opacity,background-color] duration-150 [-webkit-touch-callout:none] ${
          // The row's fall-in animation holds its own opacity: the dim goes on
          // what it holds.
          tree.drag?.kind === "document" && tree.drag.id === entry.id ? "[&>*]:opacity-40" : ""
        } ${tree.held === entry.id ? "scale-[0.98] bg-clay-100" : ""}`}
        style={rowStyle(i)}
        // Held or carried: no long-press name over it (tooltip.tsx).
        data-held={tree.held === entry.id || (tree.drag?.kind === "document" && tree.drag.id === entry.id) ? "" : undefined}
        aria-roledescription={canEdit ? t("panes.dragDocumentTitle") : undefined}
        onPointerDown={
          canEdit && !pending ? (e) => tree.press(e, { kind: "document", id: entry.id, from: parentId }) : undefined
        }
        onKeyDown={canEdit && !pending ? (e) => tree.nudge(e, { kind: "document", id: entry.id, from: parentId }) : undefined}
      >
        {entry.row.node}
      </div>
    );
  const list =
    "flat" in layout
      ? layout.flat.map((entry) => render(entry, index++))
      : layout.categories.map((category) => {
          const key = `${layout.by}:${parentId ?? ""}:${category.key}`;
          return (
            <div key={key} className="tree-row-in" style={rowStyle(index++)}>
              <CategoryRow
                title={category.title}
                count={category.rows.length}
                open={!tree.folded.has(key)}
                onToggle={() => tree.toggleFolded(key)}
              >
                {category.rows.map((entry, i) => render(entry, i))}
              </CategoryRow>
            </div>
          );
        });
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

// A row's place in its list as a drag left it, before the server's copy
// lands: `${kind}:${id}` → its list and its position.
type Placement = { parentId: string | null; position: number | null };

// The drop line, drawn over the picked-up row so the row never hides it.
function DragOverlay({ line }: { line: { top: number; left: number; width: number } | null }) {
  if (!line) return null;
  return createPortal(
    <div
      aria-hidden
      className="pointer-events-none fixed z-[70] flex items-center"
      style={{ top: line.top - 4, left: line.left - 4, width: line.width + 4, height: 8 }}
    >
      <span className="size-2 shrink-0 rounded-full border-2 border-clay bg-card" />
      <span className="h-0.5 flex-1 rounded-full bg-clay" />
    </div>,
    document.body,
  );
}

// The picked-up row: a copy of the row that follows the pointer, lifted and
// tilted like a held note card. Made by hand, outside React: it is a picture
// of the row, never the row.
function liftGhost(source: HTMLElement, at: { x: number; y: number }) {
  const rect = source.getBoundingClientRect();
  const offset = { x: Math.min(at.x - rect.left, 120), y: at.y - rect.top };
  const ghost = document.createElement("div");
  ghost.setAttribute("aria-hidden", "true");
  ghost.className = "pointer-events-none fixed z-[60] overflow-hidden rounded-xl bg-card shadow-float";
  // Narrower than the row and see-through, so the drop line and the folder
  // it would land in stay in view around it.
  ghost.style.cssText = `left:0;top:0;width:${Math.min(rect.width, 240)}px;opacity:0.85;transition:none;`;
  const copy = source.cloneNode(true) as HTMLElement;
  copy.classList.remove("opacity-40", "[&>*]:opacity-40", "tree-row-in");
  // A row's open menu is not part of the picture.
  copy.querySelectorAll("[data-no-drag]").forEach((el) => el.remove());
  ghost.appendChild(copy);
  document.body.appendChild(ghost);
  const place = (p: { x: number; y: number }) => {
    ghost.style.transform = `translate(${p.x - offset.x}px, ${p.y - offset.y}px) rotate(1.5deg) scale(1.02)`;
  };
  place(at);
  return { place, remove: () => ghost.remove() };
}

// The project's folders and documents as one tree of rows. `documents` are
// the document bar's rows in the order it keeps; this places each under its
// folder, or in the project itself when it has none. `panelEl` is the root
// list's element: the fly-outs open from its edge.
export function DocumentTree<
  T extends {
    id: string;
    folderId: string | null;
    position: number | null;
    title: string;
    kind: DocumentKind;
    addedAt: string;
    editedAt: string;
  },
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
  revealRef,
  onSort,
  onDragging,
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
  /** Set to a call that opens a document's folders and focuses its row
      (the list's type-ahead finds a document in a folder). */
  revealRef?: { current: ((id: string) => void) | null };
  /** A drop line reorders a list: the sort becomes Custom order. */
  onSort?: (sort: DocumentSort) => void;
  /** A row is picked up (true) or let go (false): the list stays open. */
  onDragging?: (dragging: boolean) => void;
}) {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const flyout = useSyncExternalStore(subscribeFlyout, readFlyout, () => false);
  const [folded, toggleFolded] = useFoldedCategories();

  // A drop shows its new order at once: the placements it made stand over
  // the server's rows until the server's rows change (the refresh after the
  // drop, or another person's edit), and go back, with the error under the
  // list, when the route refuses. Adjust-during-render, the same pattern as
  // presence.tsx.
  const basis = JSON.stringify([
    storedFolders.map((f) => [f.id, f.parentId, f.position]),
    documents.map((d) => [d.id, d.folderId, d.position]),
  ]);
  const [placed, setPlaced] = useState<{ basis: string; map: Map<string, Placement> } | null>(null);
  if (placed && placed.basis !== basis) setPlaced(null);
  const placement = (kind: "document" | "folder", id: string) =>
    placed?.basis === basis ? placed.map.get(`${kind}:${id}`) : undefined;
  // Folders made here that the page's data does not hold yet.
  const [newFolders, setNewFolders] = useState<DocumentFolderView[]>([]);
  const [seenFolders, setSeenFolders] = useState(storedFolders);
  if (seenFolders !== storedFolders) {
    setSeenFolders(storedFolders);
    const left = newFolders.filter((f) => !storedFolders.some((g) => g.id === f.id));
    if (left.length !== newFolders.length) setNewFolders(left);
  }
  // Folders deleted while their Undo pill shows: gone from the tree, what
  // they held one level up (folder id → the parent it goes to), until the
  // pill commits and the server's rows drop them, or Undo brings them back.
  const [gone, setGone] = useState<ReadonlyMap<string, string | null>>(new Map());
  const lift = (id: string | null): string | null => {
    let at = id;
    for (let i = 0; at && gone.has(at) && i < 64; i++) at = gone.get(at) ?? null;
    return at;
  };
  const placedFolders = storedFolders
    .filter((f) => !gone.has(f.id))
    .map((f) => {
      const p = placement("folder", f.id);
      const parentId = p ? p.parentId : f.parentId;
      const lifted = lift(parentId);
      if (lifted !== parentId) return { ...f, parentId: lifted, position: null };
      return p ? { ...f, parentId: p.parentId, position: p.position } : f;
    });
  const folders =
    newFolders.length === 0
      ? placedFolders
      : [...placedFolders, ...newFolders.filter((f) => !placedFolders.some((g) => g.id === f.id))];

  const known = new Set(folders.map((f) => f.id));
  const rows: TreeRow[] = documents.map((d) => {
    const p = placement("document", d.id);
    const placedIn = p ? p.parentId : d.folderId;
    const folderId = lift(placedIn);
    return {
      id: d.id,
      folderId: folderId && known.has(folderId) ? folderId : null,
      position: folderId !== placedIn ? null : p ? p.position : d.position,
      title: d.title,
      kind: d.kind,
      addedAt: d.addedAt,
      editedAt: d.editedAt,
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
  const [held, setHeld] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [line, setLine] = useState<{ top: number; left: number; width: number } | null>(null);

  // Type-ahead found a document in a folder: the folder's path opens (a
  // fly-out per level, or the rows under each other) and its row takes the
  // focus once drawn.
  useEffect(() => {
    if (!revealRef) return;
    revealRef.current = (id) => {
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      setOpenPath(folderPath(folders, row.folderId));
      focusWhenDrawn(`[data-doc-row="${id}"]`);
    };
  });

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

  // A level's rows, and the order Sort by draws them in.
  const entriesOf = (parentId: string | null): LevelEntry[] => [
      ...childFolders(folders, parentId).map((folder) => ({
        entry: "folder" as const,
        folder,
        id: folder.id,
        title: folder.title,
        kind: "folder" as const,
        position: folder.position,
        addedAt: folder.createdAt,
        editedAt: folderEditedAt(folder, folders, rows),
      })),
      ...rows
        .filter((row) => row.folderId === parentId)
        .map((row) => ({
          entry: "document" as const,
          row,
          id: row.id,
          title: row.title,
          kind: row.kind,
          position: row.position,
          addedAt: row.addedAt,
          editedAt: row.editedAt,
        })),
  ];
  const layout = (parentId: string | null): LevelLayout => {
    const entries = entriesOf(parentId);
    // Added: the list as it was before sorts existed; added over more than
    // one week, a category per week (what Week added drew).
    if (sort === "added") {
      if (!spansWeeks(entries)) return { flat: entries };
      return { categories: categorizeRows(entries, "week", lang, categoryLabels(t)), by: "week" };
    }
    if (sort === "edited") return { flat: sortByEdited(entries) };
    if (sort === "custom") return { flat: sortByPosition(entries) };
    return { categories: categorizeRows(entries, sort, lang, categoryLabels(t)), by: sort };
  };
  const levelOrder = (parentId: string | null): TreeItem[] => {
    const l = layout(parentId);
    return ("flat" in l ? l.flat : l.categories.flatMap((c) => c.rows)).map(itemOf);
  };

  const canDropOn = (target: string | null) => {
    if (!drag) return false;
    if (drag.from === target) return false;
    if (drag.kind === "folder" && target !== null && folderSubtree(folders, drag.id).has(target)) return false;
    return true;
  };

  // Where a drop at (x, y) lands, from the row under the pointer.
  const hintAt = (moving: TreeDrag, x: number, y: number): TreeHint | null => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    // A folder never moves into itself: no list inside it takes the drop.
    const inside = moving.kind === "folder" ? folderSubtree(folders, moving.id) : new Set<string>();
    const listOk = (parentId: string | null) => parentId === null || !inside.has(parentId);
    if (el.closest("[data-tree-root]")) return moving.from === null ? null : { kind: "into", folderId: null };
    const rowEl = el.closest<HTMLElement>("[data-tree-row]");
    if (rowEl) {
      const kind = rowEl.dataset.treeRow === "folder" ? "folder" : "document";
      const id = rowEl.dataset.treeId ?? "";
      const parentId = rowEl.dataset.treeParent || null;
      if (kind === moving.kind && id === moving.id) return null;
      if (!listOk(parentId)) return null;
      const rect = rowEl.getBoundingClientRect();
      const share = (y - rect.top) / Math.max(1, rect.height);
      const lineAt = (top: number, indent = 0) => ({
        top,
        left: rect.left + 12 + indent,
        width: Math.max(24, rect.width - 24 - indent),
      });
      if (kind === "folder") {
        const intoOk = !inside.has(id);
        if (share >= FOLDER_EDGE && share <= 1 - FOLDER_EDGE) {
          return intoOk && moving.from !== id ? { kind: "into", folderId: id } : null;
        }
        // Under an open folder's row, when its list opens under the row (a
        // narrow screen, or no room beside the panel), its own list follows:
        // the lower edge is that list's start.
        if (share > 1 - FOLDER_EDGE && rowEl.hasAttribute("data-tree-open-under")) {
          if (!intoOk) return null;
          const first = levelOrder(id).find((e) => !(e.kind === moving.kind && e.id === moving.id)) ?? null;
          return { kind: "line", parentId: id, target: first, before: true, at: lineAt(rect.bottom, 16) };
        }
      }
      const before = share < 0.5;
      return {
        kind: "line",
        parentId,
        target: { kind, id },
        before,
        at: lineAt(before ? rect.top : rect.bottom),
      };
    }
    const endEl = el.closest<HTMLElement>("[data-tree-end]");
    if (endEl) {
      const parentId = endEl.dataset.treeEnd || null;
      if (!listOk(parentId)) return null;
      const rect = endEl.getBoundingClientRect();
      return {
        kind: "line",
        parentId,
        target: null,
        before: false,
        at: { top: rect.top, left: rect.left + 12, width: Math.max(24, rect.width - 24) },
      };
    }
    return null;
  };

  // A drop offers Undo on the notes' pill (SPEC.md §6): the lists it
  // changed go back to the Custom order they had, the row back into the
  // list it came from, and Sort by back to what it was.
  const undoDrop = (lists: (string | null)[]) => {
    const wasSort = sort;
    const was = [...new Set(lists)]
      .map((parentId) => ({ parentId, items: sortByPosition(entriesOf(parentId)).map(itemOf) }))
      .filter((list) => list.items.length > 0);
    return () => {
      window.dispatchEvent(
        new CustomEvent("dissect:undo-pill", {
          cancelable: true,
          detail: {
            message: t("panes.rowMoved"),
            undo: () =>
              run("drag", async () => {
                for (const list of was) await api(`/api/notebooks/${notebookId}/order`, "PUT", list);
                if (wasSort !== "custom") onSort?.(wasSort);
              }),
          },
        }),
      );
    };
  };

  // Reorder a list: the drag lands at the line, and the list's whole order
  // is saved, so it stays as the reader sees it.
  const reorder = (moving: TreeDrag, hint: Extract<TreeHint, { kind: "line" }>) => {
    const before = levelOrder(hint.parentId);
    const order = before.filter((e) => !(e.kind === moving.kind && e.id === moving.id));
    let index = hint.target ? order.findIndex((e) => e.kind === hint.target!.kind && e.id === hint.target!.id) : -1;
    index = index < 0 ? order.length : hint.before ? index : index + 1;
    order.splice(index, 0, { kind: moving.kind, id: moving.id });
    const unchanged =
      moving.from === hint.parentId &&
      sort === "custom" &&
      order.length === before.length &&
      order.every((e, i) => e.kind === before[i].kind && e.id === before[i].id);
    if (unchanged) return;
    setPlaced({
      basis,
      map: new Map(order.map((e, position) => [`${e.kind}:${e.id}`, { parentId: hint.parentId, position }])),
    });
    const offerUndo = undoDrop([moving.from, hint.parentId]);
    if (sort !== "custom") onSort?.("custom");
    void run(
      "drag",
      () => api(`/api/notebooks/${notebookId}/order`, "PUT", { parentId: hint.parentId, items: order }),
      offerUndo,
      () => setPlaced(null),
    );
  };

  // A document moves with the document route, a folder with the folder
  // route (which refuses a folder into itself as well). Either lists first
  // in its new list under Custom order.
  const moveInto = (moving: TreeDrag, target: string | null) => {
    if (moving.from === target) return;
    if (moving.kind === "folder" && target !== null && folderSubtree(folders, moving.id).has(target)) return;
    const offerUndo = undoDrop([moving.from]);
    setPlaced({ basis, map: new Map([[`${moving.kind}:${moving.id}`, { parentId: target, position: null }]]) });
    void run(
      "drag",
      () =>
        moving.kind === "document"
          ? api(`/api/notebooks/${notebookId}/documents/${moving.id}`, "PATCH", { folderId: target })
          : api(`/api/notebooks/${notebookId}/folders/${moving.id}`, "PATCH", { parentId: target }),
      offerUndo,
      () => setPlaced(null),
    );
  };

  // The drag's handlers read this render's tree: a drag outlives renders
  // (a fly-out opens, a list scrolls), and its listeners were made at the
  // press.
  const live = useRef({ hintAt, reorder, moveInto, levelOrder });
  useLayoutEffect(() => {
    live.current = { hintAt, reorder, moveInto, levelOrder };
  });
  const hintRef = useRef<TreeHint | null>(null);
  const openTimer = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const openFolderRef = useRef<(id: string) => void>(() => {});
  useLayoutEffect(() => {
    openFolderRef.current = (id) => {
      const folder = folders.find((f) => f.id === id);
      if (folder) setOpenPath([...folderPath(folders, folder.parentId), folder.id]);
    };
  });
  const scrollFrame = useRef<number | null>(null);
  const stopTimers = () => {
    if (openTimer.current) clearTimeout(openTimer.current.timer);
    openTimer.current = null;
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = null;
  };
  useEffect(() => stopTimers, []);

  const showHint = (hint: TreeHint | null) => {
    hintRef.current = hint;
    // A move that leaves the line where it is renders nothing: the list
    // draws again only when the line moves.
    const at = hint?.kind === "line" ? hint.at : null;
    setLine((was) =>
      was && at && was.top === at.top && was.left === at.left && was.width === at.width ? was : at,
    );
    setDragOver(hint?.kind === "into" ? (hint.folderId ?? ROOT_TARGET) : null);
    // Held over a folder, the drag opens its list, so it can go deeper.
    const over = hint?.kind === "into" ? hint.folderId : null;
    if (openTimer.current?.id !== over) {
      if (openTimer.current) clearTimeout(openTimer.current.timer);
      openTimer.current = over
        ? { id: over, timer: setTimeout(() => openFolderRef.current(over), DRAG_OPEN_MS) }
        : null;
    }
  };

  const press = (e: ReactPointerEvent<HTMLElement>, item: TreeDrag) => {
    if (busy.current || drag) return;
    const source = e.currentTarget;
    let ghost: ReturnType<typeof liftGhost> | null = null;
    let pointer = { x: e.clientX, y: e.clientY };
    const end = () => {
      stopTimers();
      ghost?.remove();
      ghost = null;
      hintRef.current = null;
      setLine(null);
      setDragOver(null);
      setDrag(null);
      setHeld(null);
      onDragging?.(false);
    };
    // Near a list's top or bottom edge, the list scrolls under the drag.
    const scroll = () => {
      const box = scrollBoxOf(document.elementFromPoint(pointer.x, pointer.y));
      const step = box ? edgeScrollStep(box.getBoundingClientRect(), pointer.y) : 0;
      if (box && step) {
        box.scrollTop += step;
        showHint(live.current.hintAt(item, pointer.x, pointer.y));
      }
      scrollFrame.current = requestAnimationFrame(scroll);
    };
    pressToDrag(e.nativeEvent, {
      hold: () => setHeld(item.id),
      start: (at) => {
        setHeld(null);
        setError(null);
        setMenu(null);
        setDrag(item);
        onDragging?.(true);
        ghost = liftGhost(source, at);
        scrollFrame.current = requestAnimationFrame(scroll);
      },
      move: (at) => {
        pointer = at;
        ghost?.place(at);
        showHint(live.current.hintAt(item, at.x, at.y));
      },
      drop: (at) => {
        const hint = live.current.hintAt(item, at.x, at.y) ?? hintRef.current;
        end();
        if (hint?.kind === "line") live.current.reorder(item, hint);
        else if (hint?.kind === "into") live.current.moveInto(item, hint.folderId);
      },
      cancel: end,
    });
  };

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
    closeFolder: (folder) => setOpenPath(folderPath(folders, folder.parentId)),
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
      const temp: DocumentFolderView = {
        id: tempId,
        title,
        parentId,
        position: null,
        createdAt: new Date().toISOString(),
      };
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
    layout,
    drag,
    held,
    dragOver,
    press,
    nudge: (e, item) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      e.preventDefault();
      e.stopPropagation();
      if (busy.current || drag) return;
      const order = levelOrder(item.from).filter((row) => !(row.kind === item.kind && row.id === item.id));
      const at = levelOrder(item.from).findIndex((row) => row.kind === item.kind && row.id === item.id);
      const up = e.key === "ArrowUp";
      const target = order[up ? at - 1 : at];
      if (at < 0 || !target) return;
      reorder(item, { kind: "line", parentId: item.from, target, before: up, at: { top: 0, left: 0, width: 0 } });
      // The row keeps the focus where it lands.
      focusWhenDrawn(item.kind === "document" ? `[data-doc-row="${item.id}"]` : `[data-folder-row="${item.id}"]`);
    },
    canDropOn,
    // What the folder holds moves up one level; the route does it. The
    // folder goes from the tree at once and the notes' Undo pill offers
    // Undo; the route runs once the pill goes without Undo (its 12 s, ✕,
    // the next post, the page closing: keepalive). A refused delete puts
    // the folder back, with the error under the list.
    deleteFolder: (folder) => {
      setMenu(null);
      setMoving(null);
      setError(null);
      setOpenPath((path) => (path.includes(folder.id) ? path.slice(0, path.indexOf(folder.id)) : path));
      setGone((map) => new Map(map).set(folder.id, folder.parentId));
      const back = () =>
        setGone((map) => {
          const next = new Map(map);
          next.delete(folder.id);
          return next;
        });
      postUndoPill({
        message: t("panes.folderDeleted"),
        undo: back,
        commit: async () => {
          const account = tabAccount();
          try {
            const res = await fetch(`/api/notebooks/${notebookId}/folders/${folder.id}`, {
              method: "DELETE",
              keepalive: true,
              headers: account ? { [ACCOUNT_HEADER]: account } : undefined,
            });
            if (res.ok || res.status === 404) {
              router.refresh();
              return;
            }
            const json = (await res.json().catch(() => null)) as { error?: string } | null;
            console.warn("Not saved: DELETE folder", res.status, json?.error ?? "");
          } catch (err) {
            console.warn("Not saved: DELETE folder", err);
          }
          back();
          setError({ at: "drag", message: t("common.notSaved") });
        },
      });
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
      <DragOverlay line={line} />
    </TreeContext.Provider>
  );
}

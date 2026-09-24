"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useLayoutEffect,
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
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, FolderIcon, MoreIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
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
// (renderDocument) and this file places them.

// One folder of a project (DocumentFolder).
export type DocumentFolderView = { id: string; title: string; parentId: string | null };

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

type TreeRow = { id: string; folderId: string | null; node: ReactNode };
type TreeError = { at: string; message: string } | null;

// Everything a row needs, shared down the tree so the row components stay
// module-level (a component made inside another remounts on every render).
type Tree = {
  t: TFunc;
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

// A folder's row: its name and count, the chevron that says how its list
// opens, and its actions. The open list follows: beside the row on a wide
// screen, under it on a narrow one.
function FolderRow({ folder, depth }: { folder: DocumentFolderView; depth: number }) {
  const tree = useTree();
  const { t, flyout, canEdit, pending, folders, counts, activePath, openPath } = tree;
  const [rowEl, setRowEl] = useState<HTMLElement | null>(null);
  const open = openPath[depth] === folder.id;
  const onActivePath = activePath[depth] === folder.id;
  const count = counts.get(folder.id) ?? 0;
  const menuOpen = tree.menu === folder.id;
  const level = <Level parentId={folder.id} depth={depth + 1} />;
  // A name box open anywhere holds the fly-outs still: a hover that swapped
  // the list would take the box, and the typed name, with it.
  const typing = tree.creatingIn !== null || tree.renaming !== null;
  return (
    <div ref={setRowEl} className="flex flex-col">
      <div
        className="flex items-center"
        onMouseEnter={flyout && !typing ? () => tree.openFolder(folder) : undefined}
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
        open && rowEl && <Flyout rowEl={rowEl}>{level}</Flyout>
      ) : (
        <Collapse open={open}>
          {open && <div className="ml-4 border-l border-line pl-1">{level}</div>}
        </Collapse>
      )}
    </div>
  );
}

// One level of the tree: its folders, then its documents, then New folder.
function Level({ parentId, depth }: { parentId: string | null; depth: number }) {
  const { t, canEdit, folders, rows } = useTree();
  const subfolders = childFolders(folders, parentId);
  const own = rows.filter((row) => row.folderId === parentId);
  const empty = subfolders.length === 0 && own.length === 0;
  return (
    <>
      {subfolders.map((folder) => (
        <FolderRow key={folder.id} folder={folder} depth={depth} />
      ))}
      {own.map((row) => (
        <div key={row.id}>{row.node}</div>
      ))}
      {parentId !== null && empty && (
        <p className="px-4 py-2 text-[12.5px] text-sand-500">{t("panes.folderEmpty")}</p>
      )}
      {canEdit && !empty && <div className="mx-3 my-1 border-t border-line" />}
      {canEdit && <NewFolderRow parentId={parentId} />}
    </>
  );
}

// The project's folders and documents as one tree of rows. `documents` are
// the document bar's rows in the order it keeps; this places each under its
// folder, or in the project itself when it has none. `panelEl` is the root
// list's element: the fly-outs open from its edge.
export function DocumentTree<T extends { id: string; folderId: string | null }>({
  notebookId,
  folders,
  documents,
  activeId,
  canEdit,
  panelEl,
  renderDocument,
}: {
  notebookId: string;
  folders: DocumentFolderView[];
  documents: T[];
  activeId: string | null;
  canEdit: boolean;
  panelEl: HTMLElement | null;
  renderDocument: (document: T) => ReactNode;
}) {
  const t = useT();
  const router = useRouter();
  const flyout = useSyncExternalStore(subscribeFlyout, readFlyout, () => false);
  const known = new Set(folders.map((f) => f.id));
  const rows: TreeRow[] = documents.map((d) => ({
    id: d.id,
    folderId: d.folderId && known.has(d.folderId) ? d.folderId : null,
    node: renderDocument(d),
  }));
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

  // The screen crossed the width: the fly-outs close, or the open
  // document's path opens under its rows. Adjust-during-render, the same
  // pattern as presence.tsx.
  const [wasFlyout, setWasFlyout] = useState(flyout);
  if (wasFlyout !== flyout) {
    setWasFlyout(flyout);
    setOpenPath(flyout ? [] : activePath);
  }

  async function run(at: string, call: () => Promise<unknown>, after?: () => void) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await call();
      after?.();
      router.refresh();
    } catch (err) {
      setError({ at, message: err instanceof Error ? err.message : t("common.requestFailed") });
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const tree: Tree = {
    t,
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
    createFolder: (parentId, title) => {
      void run(`new:${parentId ?? ""}`, () =>
        api(`/api/notebooks/${notebookId}/folders`, "POST", { title, parentId }),
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
    // What the folder holds moves up one level; the route does it.
    deleteFolder: (folder) => {
      if (!confirm(t("panes.confirmDeleteFolder"))) return;
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
        <Level parentId={null} depth={0} />
      </PanelContext.Provider>
    </TreeContext.Provider>
  );
}

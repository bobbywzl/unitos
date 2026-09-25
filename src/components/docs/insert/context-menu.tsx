"use client";

import type { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { CellSelection, mergeCells, splitCell } from "@tiptap/pm/tables";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/lang-provider";
import { NotesIcon, QuestionIcon, SparkleIcon } from "@/components/icons";
import { AddCommentIcon, AddIcon, ClearFormattingIcon, EditIcon, LinkIcon, OutlineIcon } from "@/components/docs/icons";
import { DOCS_EVENT } from "@/components/docs/extensions";
import { keys } from "@/components/docs/keys";
import { emitInsert, onInsert, type InsertContext } from "@/components/docs/insert/context";
import { selectAllMatching } from "@/components/docs/insert/format-match";
import { blockStyle, updateStyleToMatch } from "@/components/docs/toolbar/styles";
import {
  AltTextIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  CopyIcon,
  CropIcon,
  CutIcon,
  DeleteIcon,
  DistributeColumnsIcon,
  DistributeRowsIcon,
  ImageOptionsIcon,
  LinkOffIcon,
  MergeIcon,
  OpenInNewIcon,
  PasteIcon,
  PastePlainIcon,
  PinIcon,
  RefreshIcon,
  ResetIcon,
  SortIcon,
  SplitIcon,
  TextFormatIcon,
  UnpinIcon,
  UploadIcon,
} from "@/components/docs/insert/icons";
import { imageViewAt, resetImage, selectedImage, uploadImagesAt } from "@/components/docs/insert/image";
import { distributeRows, pinnedCount, tableRectOf } from "@/components/docs/insert/table";
import { refreshTocs } from "@/components/docs/insert/toc";
import { openLinkHref } from "@/components/docs/insert/links";
import { keepSelection, toast } from "@/components/docs/insert/ui";
import type { TKey } from "@/lib/i18n/dictionaries";

// The right-click menus (SPEC.md §29), Google Docs' own in place of the
// browser's: rows with an icon, a label, and the shortcut at the right,
// groups between separators, gray rows that do not apply, ▸ submenus. The
// menu reads what was pressed: text (Cut, Copy, Paste, Paste without
// formatting, Delete; Comment; the Unitos tools — Add to notes, Explain, Ask
// the assistant; Insert link or Edit and Remove link; Copy heading link on a
// heading; Format options; Clear formatting), an image, a table, a table of
// contents. Shift+right-click keeps the browser's menu; Shift+F10,
// Ctrl+Shift+X, and Ctrl+Shift+\ open it from the keys.

type Entry =
  | {
      key: string;
      label: string;
      icon?: ReactNode;
      shortcut?: string;
      disabled?: boolean;
      run?: () => void;
      submenu?: Entry[];
    }
  | "sep";

/** The Unitos tools the reader layer answers (reader-interactions.tsx). */
export type UnitosTool = "add-to-notes" | "explain" | "assistant";

export const UNITOS_TOOL_EVENT = "docs:unitos-tool";

function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

async function pasteFromClipboard(editor: Editor, plain: boolean): Promise<boolean> {
  try {
    if (plain) {
      const text = await navigator.clipboard.readText();
      editor.view.focus();
      editor.view.pasteText(text);
      return true;
    }
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const image = item.types.find((type) => type.startsWith("image/"));
      if (item.types.includes("text/html")) {
        const html = await (await item.getType("text/html")).text();
        editor.view.focus();
        editor.view.pasteHTML(html);
        return true;
      }
      if (image) {
        const blob = await item.getType(image);
        await uploadImagesAt(editor, [new File([blob], "image", { type: image })], editor.state.selection.from);
        return true;
      }
      if (item.types.includes("text/plain")) {
        const text = await (await item.getType("text/plain")).text();
        editor.view.focus();
        editor.view.pasteText(text);
        return true;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function execClipboard(editor: Editor, command: "copy" | "cut"): boolean {
  editor.view.focus();
  try {
    return document.execCommand(command);
  } catch {
    return false;
  }
}

/** A paragraph style's name, as the Styles menu names it. */
export function styleName(style: string, t: (k: TKey) => string): string {
  const key: Record<string, TKey> = {
    normal: "docs.styleNormal",
    title: "docs.styleTitle",
    subtitle: "docs.styleSubtitle",
    h1: "docs.styleHeading1",
    h2: "docs.styleHeading2",
    h3: "docs.styleHeading3",
    h4: "docs.styleHeading4",
    h5: "docs.styleHeading5",
    h6: "docs.styleHeading6",
  };
  return t(key[style] ?? "docs.styleNormal");
}

type Place = { x: number; y: number };

export function ContextMenuHost({ editor, ctx }: { editor: Editor; ctx: InsertContext }) {
  const [place, setPlace] = useState<Place | null>(null);

  // Right-click: the menu opens at the pointer; outside the selection the
  // caret moves there first; on an image the image is selected.
  useEffect(() => {
    const dom = editor.view.dom;
    const onContext = (e: MouseEvent) => {
      if (e.shiftKey) return;
      e.preventDefault();
      const view = editor.view;
      const target = e.target as Element | null;
      const figure = target?.closest<HTMLElement>("figure.docs-img");
      const toc = target?.closest<HTMLElement>("[data-toc]");
      const atom = figure ?? toc;
      if (atom) {
        const pos = view.posAtDOM(atom, 0);
        const $pos = view.state.doc.resolve(pos);
        const nodePos = $pos.nodeAfter ? pos : Math.max(0, pos - 1);
        try {
          view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos)));
        } catch {
          // Not a node to select: the caret stays.
        }
      } else {
        const hit = view.posAtCoords({ left: e.clientX, top: e.clientY });
        const sel = view.state.selection;
        const inside =
          hit && !sel.empty && (sel instanceof CellSelection ? cellSelectionHas(editor, hit.pos) : hit.pos >= sel.from && hit.pos <= sel.to);
        if (hit && !inside) {
          view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(hit.pos))));
        }
      }
      view.focus();
      setPlace({ x: e.clientX, y: e.clientY });
    };
    // A right-click is not the end of a selection for the reader's toolbar.
    const onUp = (e: MouseEvent) => {
      if (e.button === 2) e.stopPropagation();
    };
    const onKey = (e: KeyboardEvent) => {
      const mac = isMacPlatform();
      const byKeys =
        (e.key === "F10" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) ||
        (!mac && e.ctrlKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === "x") ||
        ((mac ? e.metaKey : e.ctrlKey) && e.shiftKey && (e.key === "\\" || e.key === "|"));
      if (!byKeys) return;
      e.preventDefault();
      e.stopPropagation();
      const c = editor.view.coordsAtPos(editor.state.selection.head);
      setPlace({ x: c.left, y: c.bottom });
    };
    dom.addEventListener("contextmenu", onContext);
    dom.addEventListener("mouseup", onUp);
    dom.addEventListener("keydown", onKey, true);
    const off = onInsert(editor, (event) => {
      if (event.type !== "context-menu") return;
      const c = editor.view.coordsAtPos(editor.state.selection.head);
      setPlace({ x: event.x ?? c.left, y: event.y ?? c.bottom });
    });
    return () => {
      dom.removeEventListener("contextmenu", onContext);
      dom.removeEventListener("mouseup", onUp);
      dom.removeEventListener("keydown", onKey, true);
      off();
    };
  }, [editor]);

  const close = useCallback(() => {
    setPlace(null);
    editor.view.focus();
  }, [editor]);

  if (!place) return null;
  return <ContextMenu editor={editor} ctx={ctx} place={place} onClose={close} />;
}

function cellSelectionHas(editor: Editor, pos: number): boolean {
  const sel = editor.state.selection;
  if (!(sel instanceof CellSelection)) return false;
  let hit = false;
  sel.forEachCell((cell, cellPos) => {
    if (pos > cellPos && pos < cellPos + cell.nodeSize) hit = true;
  });
  return hit;
}

function buildEntries(editor: Editor, ctx: InsertContext, t: ReturnType<typeof useT>): Entry[] {
  const { state } = editor;
  const sel = state.selection;
  const editing = ctx.editing;
  const hasSelection = !sel.empty;
  const image = selectedImage(state);
  const toc = sel instanceof NodeSelection && sel.node.type.name === "tableOfContents" ? sel : null;
  const rect = tableRectOf(state);
  const textSelected = hasSelection && !image && !toc && state.doc.textBetween(sel.from, sel.to, " ", " ").trim().length > 0;
  const out: Entry[] = [
    {
      key: "cut",
      label: t("docsInsert.cut"),
      icon: <CutIcon size={20} />,
      shortcut: keys("Mod+X"),
      disabled: !hasSelection || !editing,
      run: () => {
        if (!execClipboard(editor, "cut")) emitInsert(editor, { type: "clipboard-blocked" });
      },
    },
    {
      key: "copy",
      label: t("docsInsert.copy"),
      icon: <CopyIcon size={20} />,
      shortcut: keys("Mod+C"),
      disabled: !hasSelection,
      run: () => {
        if (!execClipboard(editor, "copy")) emitInsert(editor, { type: "clipboard-blocked" });
      },
    },
    {
      key: "paste",
      label: t("docsInsert.paste"),
      icon: <PasteIcon size={20} />,
      shortcut: keys("Mod+V"),
      disabled: !editing,
      run: () => {
        void pasteFromClipboard(editor, false).then((ok) => ok || emitInsert(editor, { type: "clipboard-blocked" }));
      },
    },
    {
      key: "paste-plain",
      label: t("docsInsert.pastePlain"),
      icon: <PastePlainIcon size={20} />,
      shortcut: keys("Mod+Shift+V"),
      disabled: !editing,
      run: () => {
        void pasteFromClipboard(editor, true).then((ok) => ok || emitInsert(editor, { type: "clipboard-blocked" }));
      },
    },
    {
      key: "delete",
      label: t("docsInsert.delete"),
      icon: <DeleteIcon size={20} />,
      disabled: !hasSelection || !editing,
      run: () => editor.chain().focus().deleteSelection().run(),
    },
    "sep",
  ];

  if (image && editing) {
    const pos = image.pos;
    out.push(
      {
        key: "crop",
        label: t("docsInsert.cropImage"),
        icon: <CropIcon size={20} />,
        run: () => imageViewAt(editor.view, pos)?.startCrop(),
      },
      {
        key: "replace",
        label: t("docsInsert.replaceImage"),
        icon: <ResetIcon size={20} />,
        submenu: [
          {
            key: "replace-upload",
            label: t("docs.uploadFromComputer"),
            icon: <UploadIcon size={20} />,
            run: () => emitInsert(editor, { type: "image-replace", source: "upload" }),
          },
          {
            key: "replace-url",
            label: t("docs.imageByUrl"),
            icon: <LinkIcon size={20} />,
            run: () => emitInsert(editor, { type: "image-replace", source: "url" }),
          },
        ],
      },
      {
        key: "image-options",
        label: t("docsInsert.imageOptions"),
        icon: <ImageOptionsIcon size={20} />,
        run: () => emitInsert(editor, { type: "image-options" }),
      },
      {
        key: "alt",
        label: t("docsInsert.altText"),
        icon: <AltTextIcon size={20} />,
        shortcut: keys("Mod+Alt+Y"),
        run: () => emitInsert(editor, { type: "image-options", section: "alt" }),
      },
      {
        key: "reset",
        label: t("docsInsert.resetImage"),
        icon: <RefreshIcon size={20} />,
        run: () => void resetImage(editor, pos),
      },
    );
    return out;
  }

  if (toc && editing) {
    out.push(
      {
        key: "toc-update",
        label: t("docsInsert.updateToc"),
        icon: <RefreshIcon size={20} />,
        run: () => refreshTocs(editor.view),
      },
      {
        key: "toc-delete",
        label: t("docsInsert.deleteToc"),
        icon: <DeleteIcon size={20} />,
        run: () => editor.chain().focus().deleteSelection().run(),
      },
      {
        key: "toc-options",
        label: t("docsInsert.tocOptions"),
        icon: <OutlineIcon size={20} />,
        run: () => emitInsert(editor, { type: "toc-options", pos: toc.from }),
      },
    );
    return out;
  }

  if (rect && editing) {
    const rows = rect.bottom - rect.top;
    const cols = rect.right - rect.left;
    const pinned = pinnedCount(rect.table);
    const plural = (n: number, one: TKey, many: TKey) => (n > 1 ? t(many, { n }) : t(one));
    const merged = (() => {
      const cell = rect.table.nodeAt(rect.map.map[rect.top * rect.map.width + rect.left]);
      return Boolean(cell && ((Number(cell.attrs.colspan) || 1) > 1 || (Number(cell.attrs.rowspan) || 1) > 1));
    })();
    const several = sel instanceof CellSelection && (rows > 1 || cols > 1);
    out.push(
      {
        key: "row-above",
        label: plural(rows, "docsInsert.insertRowAbove", "docsInsert.insertRowsAbove"),
        icon: <AddIcon size={20} />,
        run: () => editor.chain().focus().insertRows("before", rows).run(),
      },
      {
        key: "row-below",
        label: plural(rows, "docsInsert.insertRowBelow", "docsInsert.insertRowsBelow"),
        icon: <AddIcon size={20} />,
        run: () => editor.chain().focus().insertRows("after", rows).run(),
      },
      {
        key: "col-left",
        label: plural(cols, "docsInsert.insertColumnLeft", "docsInsert.insertColumnsLeft"),
        icon: <AddIcon size={20} />,
        run: () => editor.chain().focus().insertColumns("before", cols).run(),
      },
      {
        key: "col-right",
        label: plural(cols, "docsInsert.insertColumnRight", "docsInsert.insertColumnsRight"),
        icon: <AddIcon size={20} />,
        run: () => editor.chain().focus().insertColumns("after", cols).run(),
      },
      "sep",
      {
        key: "delete-row",
        label: plural(rows, "docsInsert.deleteRow", "docsInsert.deleteRows"),
        icon: <DeleteIcon size={20} />,
        run: () => editor.chain().focus().deleteRow().run(),
      },
      {
        key: "delete-col",
        label: plural(cols, "docsInsert.deleteColumn", "docsInsert.deleteColumns"),
        icon: <DeleteIcon size={20} />,
        run: () => editor.chain().focus().deleteColumn().run(),
      },
      {
        key: "delete-table",
        label: t("docsInsert.deleteTable"),
        icon: <DeleteIcon size={20} />,
        run: () => editor.chain().focus().deleteTable().run(),
      },
      "sep",
      pinned > 0 && rect.top < pinned
        ? {
            key: "unpin",
            label: t(pinned > 1 ? "docsInsert.unpinHeaderRows" : "docsInsert.unpinHeaderRow"),
            icon: <UnpinIcon size={20} />,
            run: () => editor.chain().focus().pinHeaderRows(0).run(),
          }
        : {
            key: "pin",
            label: t("docsInsert.pinHeaderUpToRow"),
            icon: <PinIcon size={20} />,
            run: () => editor.chain().focus().pinHeaderRows(rect.bottom).run(),
          },
      several
        ? {
            key: "merge",
            label: t("docsInsert.mergeCells"),
            icon: <MergeIcon size={20} />,
            disabled: !mergeCells(state),
            run: () => {
              mergeCells(editor.state, editor.view.dispatch);
              editor.view.focus();
            },
          }
        : merged
          ? {
              key: "unmerge",
              label: t("docsInsert.unmergeCells"),
              icon: <SplitIcon size={20} />,
              run: () => {
                splitCell(editor.state, editor.view.dispatch);
                editor.view.focus();
              },
            }
          : {
              key: "split",
              label: t("docsInsert.splitCell"),
              icon: <SplitIcon size={20} />,
              run: () => emitInsert(editor, { type: "split-cell" }),
            },
      {
        key: "sort",
        label: t("docsInsert.sortTable"),
        icon: <SortIcon size={20} />,
        disabled: !editor.can().sortTable(1),
        submenu: [
          {
            key: "sort-asc",
            label: t("docsInsert.sortAscending"),
            icon: <ArrowUpIcon size={20} />,
            run: () => editor.chain().focus().sortTable(1).run(),
          },
          {
            key: "sort-desc",
            label: t("docsInsert.sortDescending"),
            icon: <ArrowDownIcon size={20} />,
            run: () => editor.chain().focus().sortTable(-1).run(),
          },
        ],
      },
      {
        key: "dist-rows",
        label: t("docsInsert.distributeRows"),
        icon: <DistributeRowsIcon size={20} />,
        run: () => distributeRows(editor),
      },
      {
        key: "dist-cols",
        label: t("docsInsert.distributeColumns"),
        icon: <DistributeColumnsIcon size={20} />,
        run: () => editor.chain().focus().distributeColumns().run(),
      },
      {
        key: "table-options",
        label: t("docsInsert.tableOptions"),
        icon: <ImageOptionsIcon size={20} />,
        run: () => emitInsert(editor, { type: "table-options" }),
      },
      "sep",
    );
  }

  const tool = (name: UnitosTool) => () =>
    window.dispatchEvent(new CustomEvent(UNITOS_TOOL_EVENT, { detail: { documentId: ctx.documentId, tool: name } }));
  out.push(
    {
      key: "comment",
      label: t("docsInsert.comment"),
      icon: <AddCommentIcon size={20} />,
      shortcut: keys("Mod+Alt+M"),
      run: () => window.dispatchEvent(new CustomEvent(DOCS_EVENT.comment)),
    },
    {
      key: "add-to-notes",
      label: t("docsInsert.addToNotes"),
      icon: <NotesIcon size={18} />,
      disabled: !textSelected,
      run: tool("add-to-notes"),
    },
    {
      key: "explain",
      label: t("docsInsert.explain"),
      icon: <QuestionIcon size={18} />,
      disabled: !textSelected,
      run: tool("explain"),
    },
    {
      key: "assistant",
      label: t("docsInsert.askAssistant"),
      icon: <SparkleIcon size={18} />,
      disabled: !textSelected,
      run: tool("assistant"),
    },
    "sep",
  );

  const href = editor.isActive("link") ? (editor.getAttributes("link").href as string | undefined) : undefined;
  if (href) {
    out.push(
      {
        key: "open-link",
        label: t("docsInsert.openLink"),
        icon: <OpenInNewIcon size={20} />,
        shortcut: keys("Alt+Enter"),
        run: () => openLinkHref(editor, href, ctx),
      },
      {
        key: "edit-link",
        label: t("docs.editLink"),
        icon: <EditIcon size={20} />,
        shortcut: keys("Mod+K"),
        disabled: !editing,
        run: () => window.dispatchEvent(new CustomEvent(DOCS_EVENT.link)),
      },
      {
        key: "remove-link",
        label: t("docs.removeLink"),
        icon: <LinkOffIcon size={20} />,
        disabled: !editing,
        run: () => editor.chain().focus().extendMarkRange("link").unsetLink().run(),
      },
    );
  } else {
    out.push({
      key: "insert-link",
      label: t("docs.insertLink"),
      icon: <LinkIcon size={20} />,
      shortcut: keys("Mod+K"),
      disabled: !editing,
      run: () => window.dispatchEvent(new CustomEvent(DOCS_EVENT.link)),
    });
  }
  const parent = sel.$from.parent;
  if (parent.type.name === "heading" && typeof parent.attrs.blockId === "string") {
    const blockId = parent.attrs.blockId;
    out.push({
      key: "heading-link",
      label: t("docsInsert.copyHeadingLink"),
      icon: <LinkIcon size={20} />,
      run: () => {
        const url = `${window.location.origin}${window.location.pathname}${window.location.search}#heading=${blockId}`;
        void navigator.clipboard.writeText(url).then(
          () => toast(t("docsInsert.headingLinkCopied")),
          () => emitInsert(editor, { type: "clipboard-blocked" }),
        );
      },
    });
  }
  out.push("sep", {
    key: "format-options",
    label: t("docsInsert.formatOptions"),
    icon: <TextFormatIcon size={20} />,
    disabled: !editing || !parent.isTextblock,
    submenu: [
      {
        key: "select-matching",
        label: t("docsInsert.selectAllMatching"),
        run: () => selectAllMatching(editor),
      },
      {
        key: "update-style",
        label: t("docsInsert.updateStyleToMatch", { style: styleName(blockStyle(parent), t) }),
        run: () => updateStyleToMatch(editor, blockStyle(editor.state.selection.$from.parent)),
      },
    ],
  });
  out.push({
    key: "clear-formatting",
    label: t("docs.clearFormatting"),
    icon: <ClearFormattingIcon size={20} />,
    shortcut: keys("Mod+\\"),
    disabled: !editing,
    run: () => clearFormatting(editor),
  });
  return out;
}

/** Clear formatting: the character formatting goes, links and the
    paragraph style stay. */
export function clearFormatting(editor: Editor) {
  const { state, view } = editor;
  const tr = state.tr;
  for (const range of state.selection.ranges) {
    for (const type of Object.values(state.schema.marks)) {
      if (type.name !== "link") tr.removeMark(range.$from.pos, range.$to.pos, type);
    }
  }
  if (state.selection.empty) tr.setStoredMarks((state.selection.$from.marks() ?? []).filter((m) => m.type.name === "link"));
  view.dispatch(tr);
  view.focus();
}

function ContextMenu({ editor, ctx, place, onClose }: { editor: Editor; ctx: InsertContext; place: Place; onClose: () => void }) {
  const t = useT();
  const [entries] = useState(() => buildEntries(editor, ctx, t));
  return <MenuPanel entries={entries} x={place.x} y={place.y} onClose={onClose} root />;
}

function MenuPanel({
  entries,
  x,
  y,
  onClose,
  root,
  flipX,
}: {
  entries: Entry[];
  x: number;
  y: number;
  onClose: () => void;
  root?: boolean;
  /** A submenu opens to the left when the right has no room. */
  flipX?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState<{ index: number; x: number; y: number; flipX: number } | null>(null);
  const items = entries.map((e, i) => ({ e, i })).filter((x): x is { e: Exclude<Entry, "sep">; i: number } => x.e !== "sep");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = x;
    if (left + w > window.innerWidth - 8) left = flipX !== undefined ? flipX - w : Math.max(8, x - w);
    let top = y;
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
    setPos({ left, top });
    if (root) el.focus();
  }, [x, y, flipX, root]);

  useEffect(() => {
    if (!root) return;
    const onDown = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest("[data-docs-context-menu]")) return;
      onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("wheel", onScroll, { passive: true });
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("wheel", onScroll);
      window.removeEventListener("resize", onClose);
    };
  }, [root, onClose]);

  const openSub = (index: number) => {
    const row = ref.current?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (!row) return;
    const r = row.getBoundingClientRect();
    setOpen({ index, x: r.right - 4, y: r.top - 8, flipX: r.left + 4 });
  };

  const run = (entry: Exclude<Entry, "sep">, index: number) => {
    if (entry.disabled) return;
    if (entry.submenu) {
      openSub(index);
      return;
    }
    onClose();
    entry.run?.();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const enabled = items.filter((x) => !x.e.disabled);
    const at = enabled.findIndex((x) => x.i === active);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      if (enabled.length === 0) return;
      const d = e.key === "ArrowDown" ? 1 : -1;
      const next = enabled[(at + d + enabled.length) % enabled.length] ?? enabled[0];
      setActive(next.i);
      setOpen(null);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      const current = items.find((x) => x.i === active);
      if (current?.e.submenu && !current.e.disabled) openSub(current.i);
    } else if (e.key === "ArrowLeft" && !root) {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      const current = items.find((x) => x.i === active);
      if (current) run(current.e, current.i);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  if (typeof document === "undefined") return null;
  const openEntry = open ? entries[open.index] : null;
  return createPortal(
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      className="docs-context-menu"
      data-docs-context-menu
      data-docs-insert-popover
      data-edit-control
      data-selection-popover
      onMouseDown={keepSelection}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={onKeyDown}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0, visibility: "hidden" }}
    >
      {entries.map((entry, i) =>
        entry === "sep" ? (
          i > 0 && entries[i - 1] !== "sep" && i < entries.length - 1 ? <div key={`sep${i}`} role="separator" className="docs-context-sep" /> : null
        ) : (
          <button
            key={entry.key}
            type="button"
            role="menuitem"
            data-index={i}
            aria-disabled={entry.disabled}
            aria-haspopup={entry.submenu ? "menu" : undefined}
            aria-expanded={entry.submenu ? open?.index === i : undefined}
            className={`docs-context-row${active === i ? " is-active" : ""}${entry.disabled ? " is-disabled" : ""}`}
            onMouseEnter={() => {
              setActive(i);
              if (entry.submenu && !entry.disabled) openSub(i);
              else setOpen(null);
            }}
            onClick={() => run(entry, i)}
          >
            <span className="docs-context-icon">{entry.icon}</span>
            <span className="docs-context-label">{entry.label}</span>
            {entry.shortcut && <span className="docs-context-keys">{entry.shortcut}</span>}
            {entry.submenu && (
              <span className="docs-context-sub">
                <ChevronRightIcon size={20} />
              </span>
            )}
          </button>
        ),
      )}
      {open && openEntry && openEntry !== "sep" && openEntry.submenu && (
        <MenuPanel
          entries={openEntry.submenu}
          x={open.x}
          y={open.y}
          flipX={open.flipX}
          onClose={() => {
            setOpen(null);
            ref.current?.focus();
          }}
        />
      )}
    </div>,
    document.body,
  );
}

/** The dialog that names the keys when the browser keeps the clipboard
    from the menu. */
export function ClipboardDialogHost({ editor }: { editor: Editor }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  useEffect(() => onInsert(editor, (e) => e.type === "clipboard-blocked" && setOpen(true)), [editor]);
  if (!open || typeof document === "undefined") return null;
  const close = () => {
    setOpen(false);
    editor.view.focus();
  };
  return createPortal(
    <div className="docs-insert-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal aria-label={t("docsInsert.clipboardTitle")} className="docs-insert-dialog docs-clipboard-dialog" data-docs-insert-popover>
        <div className="docs-insert-dialog-head">
          <h2>{t("docsInsert.clipboardTitle")}</h2>
        </div>
        <p>{t("docsInsert.clipboardBody")}</p>
        <ul className="docs-clipboard-keys">
          <li>{t("docsInsert.clipboardCopy", { keys: keys("Mod+C") })}</li>
          <li>{t("docsInsert.clipboardCut", { keys: keys("Mod+X") })}</li>
          <li>{t("docsInsert.clipboardPaste", { keys: keys("Mod+V") })}</li>
        </ul>
        <div className="docs-insert-dialog-actions">
          <button type="button" className="docs-button-primary" onClick={close} autoFocus>
            {t("docsInsert.gotIt")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

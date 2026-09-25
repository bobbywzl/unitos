"use client";

import type { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { CellSelection, mergeCells, splitCell } from "@tiptap/pm/tables";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/lang-provider";
import { NotesIcon, QuestionIcon, SparkleIcon } from "@/components/icons";
import { AddCommentIcon, AddIcon, ClearFormattingIcon, EditIcon, LinkIcon, OutlineIcon } from "@/components/docs/icons";
import { DOCS_EVENT } from "@/components/docs/extensions";
import { keys, matchesCombo, isMac } from "@/components/docs/keys";
import { DropdownPanel, MenuItem, MenuSeparator } from "@/components/docs/menu";
import { DialogButton, ToolbarDialog } from "@/components/docs/toolbar/dialog";
import { STYLE_LABEL } from "@/components/docs/toolbar/styles-menu";
import { blockStyle, updateStyleToMatch } from "@/components/docs/toolbar/styles";
import { copyMarkdown, insertImageFiles, pasteMarkdown } from "@/components/docs/typing/paste";
import { typingPrefs } from "@/components/docs/typing/prefs";
import { emitInsert, onInsert, toast, type InsertContext } from "@/components/docs/insert/context";
import { selectAllMatching } from "@/components/docs/insert/format-match";
import {
  AltTextIcon,
  ArrowDownIcon,
  ArrowUpIcon,
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
} from "@/components/docs/insert/icons";
import { imageViewAt, resetImage, selectedImage } from "@/components/docs/insert/image";
import { openLinkHref } from "@/components/docs/insert/links";
import { distributeRows, pinnedCount, tableRectOf } from "@/components/docs/insert/table";
import { refreshTocs } from "@/components/docs/insert/toc";
import type { TKey } from "@/lib/i18n/dictionaries";

// The right-click menu (SPEC.md §29), Google Docs' own in place of the
// browser's, for text, an image, a table, and a table of contents.
// Shift+right-click keeps the browser's menu; Shift+F10, Ctrl+Shift+X, and
// Ctrl+Shift+\ open it from the keys.

type Entry = { key: string; label: string; icon?: ReactNode; shortcut?: string; disabled?: boolean; run?: () => void; submenu?: Entry[] } | "sep";

type Place = { x: number; y: number; byKeys: boolean };

async function pasteFromClipboard(editor: Editor, plain: boolean): Promise<boolean> {
  try {
    if (plain) {
      const text = await navigator.clipboard.readText();
      editor.view.focus();
      editor.view.pasteText(text);
      return true;
    }
    for (const item of await navigator.clipboard.read()) {
      const image = item.types.find((type) => type.startsWith("image/"));
      if (item.types.includes("text/html")) {
        const html = await (await item.getType("text/html")).text();
        editor.view.focus();
        editor.view.pasteHTML(html);
      } else if (image) {
        const blob = await item.getType(image);
        await insertImageFiles(editor, [new File([blob], "image", { type: image })]);
      } else if (item.types.includes("text/plain")) {
        const text = await (await item.getType("text/plain")).text();
        editor.view.focus();
        editor.view.pasteText(text);
      } else continue;
      return true;
    }
    return true;
  } catch {
    return false;
  }
}

function execClipboard(editor: Editor, command: "copy" | "cut"): void {
  editor.view.focus();
  let done = false;
  try {
    done = document.execCommand(command);
  } catch {
    done = false;
  }
  if (!done) emitInsert(editor, { type: "clipboard-blocked" });
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

export function ContextMenuHost({ editor, ctx }: { editor: Editor; ctx: InsertContext }) {
  const [place, setPlace] = useState<Place | null>(null);

  // Right-click opens the menu at the pointer; outside the selection the
  // caret moves there first; an image or a table of contents is selected.
  useEffect(() => {
    const dom = editor.view.dom;
    const onContext = (e: MouseEvent) => {
      if (e.shiftKey) return;
      e.preventDefault();
      const view = editor.view;
      const atom = (e.target as Element | null)?.closest<HTMLElement>("figure.docs-img, [data-toc]");
      if (atom) {
        const pos = view.posAtDOM(atom, 0);
        const nodePos = view.state.doc.resolve(pos).nodeAfter ? pos : Math.max(0, pos - 1);
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
        if (hit && !inside) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(hit.pos))));
      }
      view.focus();
      setPlace({ x: e.clientX, y: e.clientY, byKeys: false });
    };
    // A right-click is not the end of a selection for the reader's toolbar.
    const onUp = (e: MouseEvent) => {
      if (e.button === 2) e.stopPropagation();
    };
    const onKey = (e: KeyboardEvent) => {
      const byKeys = matchesCombo(e, "Shift+F10") || matchesCombo(e, "Mod+Shift+\\") || (!isMac() && matchesCombo(e, "Ctrl+Shift+X"));
      if (!byKeys) return;
      e.preventDefault();
      e.stopPropagation();
      const c = editor.view.coordsAtPos(editor.state.selection.head);
      setPlace({ x: c.left, y: c.bottom, byKeys: true });
    };
    dom.addEventListener("contextmenu", onContext);
    dom.addEventListener("mouseup", onUp);
    dom.addEventListener("keydown", onKey, true);
    return () => {
      dom.removeEventListener("contextmenu", onContext);
      dom.removeEventListener("mouseup", onUp);
      dom.removeEventListener("keydown", onKey, true);
    };
  }, [editor]);

  if (!place) return null;
  return (
    <ContextMenu
      key={`${place.x},${place.y}`}
      editor={editor}
      ctx={ctx}
      place={place}
      onClose={() => {
        setPlace(null);
        editor.view.focus();
      }}
    />
  );
}

function ContextMenu({ editor, ctx, place, onClose }: { editor: Editor; ctx: InsertContext; place: Place; onClose: () => void }) {
  const t = useT();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [entries] = useState(() => buildEntries(editor, ctx, t));
  const items = (list: Entry[]): ReactNode =>
    list.map((entry, i) => {
      if (entry === "sep") {
        // No separator at an end or after another.
        const shown = i > 0 && list[i - 1] !== "sep" && i < list.length - 1;
        return shown ? <MenuSeparator key={`sep${i}`} /> : null;
      }
      return (
        <MenuItem
          key={entry.key}
          icon={entry.icon}
          shortcut={entry.shortcut}
          disabled={entry.disabled}
          submenu={entry.submenu ? items(entry.submenu) : undefined}
          onSelect={
            entry.run &&
            (() => {
              onClose();
              entry.run?.();
            })
          }
        >
          {entry.label}
        </MenuItem>
      );
    });
  if (typeof document === "undefined") return null;
  return (
    <>
      {createPortal(<span ref={anchorRef} className="docs-context-anchor" style={{ left: place.x, top: place.y }} />, document.body)}
      <DropdownPanel open anchorRef={anchorRef} onClose={onClose} className="docs-context-menu" highlightFirst={place.byKeys}>
        {items(entries)}
      </DropdownPanel>
    </>
  );
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
  const paste = (plain: boolean) => () =>
    void pasteFromClipboard(editor, plain).then((ok) => ok || emitInsert(editor, { type: "clipboard-blocked" }));
  // With Enable Markdown on (Tools > Preferences), the Markdown copy and paste.
  const markdown = typingPrefs().markdown;
  const out: Entry[] = [
    { key: "cut", label: t("docsInsert.cut"), icon: <CutIcon />, shortcut: keys("Mod+X"), disabled: !hasSelection || !editing, run: () => execClipboard(editor, "cut") },
    { key: "copy", label: t("docsInsert.copy"), icon: <CopyIcon />, shortcut: keys("Mod+C"), disabled: !hasSelection, run: () => execClipboard(editor, "copy") },
    ...(markdown
      ? [{ key: "copy-markdown", label: t("docsTyping.copyAsMarkdown"), icon: <CopyIcon />, disabled: !hasSelection, run: () => void copyMarkdown(editor) }]
      : []),
    { key: "paste", label: t("docsInsert.paste"), icon: <PasteIcon />, shortcut: keys("Mod+V"), disabled: !editing, run: paste(false) },
    {
      key: "paste-plain",
      label: t("docsInsert.pastePlain"),
      icon: <PastePlainIcon />,
      shortcut: keys("Mod+Shift+V"),
      disabled: !editing,
      run: paste(true),
    },
    ...(markdown
      ? [{ key: "paste-markdown", label: t("docsTyping.pasteFromMarkdown"), icon: <PasteIcon />, disabled: !editing, run: () => void pasteMarkdown(editor) }]
      : []),
    {
      key: "delete",
      label: t("docsInsert.delete"),
      icon: <DeleteIcon />,
      disabled: !hasSelection || !editing,
      run: () => editor.chain().focus().deleteSelection().run(),
    },
    "sep",
  ];

  if (image && editing) {
    const pos = image.pos;
    out.push(
      { key: "crop", label: t("docsInsert.cropImage"), icon: <CropIcon />, run: () => imageViewAt(editor.view, pos)?.startCrop() },
      { key: "replace", label: t("docsInsert.replaceImage"), icon: <ResetIcon />, run: () => emitInsert(editor, { type: "image-replace" }) },
      { key: "image-options", label: t("docsInsert.imageOptions"), icon: <ImageOptionsIcon />, run: () => emitInsert(editor, { type: "image-options" }) },
      {
        key: "alt",
        label: t("docsInsert.altText"),
        icon: <AltTextIcon />,
        shortcut: keys("Mod+Alt+Y"),
        run: () => emitInsert(editor, { type: "image-options", section: "alt" }),
      },
      { key: "reset", label: t("docsInsert.resetImage"), icon: <RefreshIcon />, run: () => resetImage(editor, pos) },
    );
    return out;
  }

  if (toc && editing) {
    out.push(
      { key: "toc-update", label: t("docsInsert.updateToc"), icon: <RefreshIcon />, run: () => refreshTocs(editor.view) },
      { key: "toc-delete", label: t("docsInsert.deleteToc"), icon: <DeleteIcon />, run: () => editor.chain().focus().deleteSelection().run() },
      { key: "toc-options", label: t("docsInsert.tocOptions"), icon: <OutlineIcon />, run: () => emitInsert(editor, { type: "toc-options", pos: toc.from }) },
    );
    return out;
  }

  if (rect && editing) {
    const rows = rect.bottom - rect.top;
    const cols = rect.right - rect.left;
    const pinned = pinnedCount(rect.table);
    const plural = (n: number, one: TKey, many: TKey) => (n > 1 ? t(many, { n }) : t(one));
    const cell = rect.table.nodeAt(rect.map.map[rect.top * rect.map.width + rect.left]);
    const merged = Boolean(cell && ((Number(cell.attrs.colspan) || 1) > 1 || (Number(cell.attrs.rowspan) || 1) > 1));
    const several = sel instanceof CellSelection && (rows > 1 || cols > 1);
    const table = (fn: () => void) => () => {
      fn();
      editor.view.focus();
    };
    out.push(
      {
        key: "row-above",
        label: plural(rows, "docsInsert.insertRowAbove", "docsInsert.insertRowsAbove"),
        icon: <AddIcon />,
        run: () => editor.chain().focus().insertRows("before", rows).run(),
      },
      {
        key: "row-below",
        label: plural(rows, "docsInsert.insertRowBelow", "docsInsert.insertRowsBelow"),
        icon: <AddIcon />,
        run: () => editor.chain().focus().insertRows("after", rows).run(),
      },
      {
        key: "col-left",
        label: plural(cols, "docsInsert.insertColumnLeft", "docsInsert.insertColumnsLeft"),
        icon: <AddIcon />,
        run: () => editor.chain().focus().insertColumns("before", cols).run(),
      },
      {
        key: "col-right",
        label: plural(cols, "docsInsert.insertColumnRight", "docsInsert.insertColumnsRight"),
        icon: <AddIcon />,
        run: () => editor.chain().focus().insertColumns("after", cols).run(),
      },
      "sep",
      {
        key: "delete-row",
        label: plural(rows, "docsInsert.deleteRow", "docsInsert.deleteRows"),
        icon: <DeleteIcon />,
        run: () => editor.chain().focus().deleteRow().run(),
      },
      {
        key: "delete-col",
        label: plural(cols, "docsInsert.deleteColumn", "docsInsert.deleteColumns"),
        icon: <DeleteIcon />,
        run: () => editor.chain().focus().deleteColumn().run(),
      },
      { key: "delete-table", label: t("docsInsert.deleteTable"), icon: <DeleteIcon />, run: () => editor.chain().focus().deleteTable().run() },
      "sep",
      pinned > 0 && rect.top < pinned
        ? {
            key: "unpin",
            label: t(pinned > 1 ? "docsInsert.unpinHeaderRows" : "docsInsert.unpinHeaderRow"),
            icon: <UnpinIcon />,
            run: () => editor.chain().focus().pinHeaderRows(0).run(),
          }
        : {
            key: "pin",
            label: t("docsInsert.pinHeaderUpToRow"),
            icon: <PinIcon />,
            run: () => editor.chain().focus().pinHeaderRows(rect.bottom).run(),
          },
      several
        ? {
            key: "merge",
            label: t("docsInsert.mergeCells"),
            icon: <MergeIcon />,
            disabled: !mergeCells(state),
            run: table(() => mergeCells(editor.state, editor.view.dispatch)),
          }
        : merged
          ? {
              key: "unmerge",
              label: t("docsInsert.unmergeCells"),
              icon: <SplitIcon />,
              run: table(() => splitCell(editor.state, editor.view.dispatch)),
            }
          : { key: "split", label: t("docsInsert.splitCell"), icon: <SplitIcon />, run: () => emitInsert(editor, { type: "split-cell" }) },
      {
        key: "sort",
        label: t("docsInsert.sortTable"),
        icon: <SortIcon />,
        disabled: !editor.can().sortTable(1),
        submenu: [
          { key: "sort-asc", label: t("docsInsert.sortAscending"), icon: <ArrowUpIcon />, run: () => editor.chain().focus().sortTable(1).run() },
          { key: "sort-desc", label: t("docsInsert.sortDescending"), icon: <ArrowDownIcon />, run: () => editor.chain().focus().sortTable(-1).run() },
        ],
      },
      { key: "dist-rows", label: t("docsInsert.distributeRows"), icon: <DistributeRowsIcon />, run: () => distributeRows(editor) },
      {
        key: "dist-cols",
        label: t("docsInsert.distributeColumns"),
        icon: <DistributeColumnsIcon />,
        run: () => editor.chain().focus().distributeColumns().run(),
      },
      { key: "table-options", label: t("docsInsert.tableOptions"), icon: <ImageOptionsIcon />, run: () => emitInsert(editor, { type: "table-options" }) },
      "sep",
    );
  }

  // The Unitos tools on the selected words; the reader layer answers.
  const tool = (name: "add-to-notes" | "explain" | "assistant") => () =>
    window.dispatchEvent(new CustomEvent("docs:unitos-tool", { detail: { documentId: ctx.documentId, tool: name } }));
  out.push(
    {
      key: "comment",
      label: t("docsInsert.comment"),
      icon: <AddCommentIcon />,
      shortcut: keys("Mod+Alt+M"),
      run: () => window.dispatchEvent(new CustomEvent(DOCS_EVENT.comment)),
    },
    { key: "add-to-notes", label: t("docsInsert.addToNotes"), icon: <NotesIcon size={18} />, disabled: !textSelected, run: tool("add-to-notes") },
    { key: "explain", label: t("docsInsert.explain"), icon: <QuestionIcon size={18} />, disabled: !textSelected, run: tool("explain") },
    { key: "assistant", label: t("docsInsert.askAssistant"), icon: <SparkleIcon size={18} />, disabled: !textSelected, run: tool("assistant") },
    "sep",
  );

  const openLinkBox = () => window.dispatchEvent(new CustomEvent(DOCS_EVENT.link));
  const href = editor.isActive("link") ? (editor.getAttributes("link").href as string | undefined) : undefined;
  if (href) {
    out.push(
      { key: "open-link", label: t("docsInsert.openLink"), icon: <OpenInNewIcon />, shortcut: keys("Alt+Enter"), run: () => openLinkHref(editor, href, ctx) },
      { key: "edit-link", label: t("docs.editLink"), icon: <EditIcon />, shortcut: keys("Mod+K"), disabled: !editing, run: openLinkBox },
      {
        key: "remove-link",
        label: t("docs.removeLink"),
        icon: <LinkOffIcon />,
        disabled: !editing,
        run: () => editor.chain().focus().extendMarkRange("link").unsetLink().run(),
      },
    );
  } else {
    out.push({ key: "insert-link", label: t("docs.insertLink"), icon: <LinkIcon />, shortcut: keys("Mod+K"), disabled: !editing, run: openLinkBox });
  }
  const parent = sel.$from.parent;
  if (parent.type.name === "heading" && typeof parent.attrs.blockId === "string") {
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}#heading=${parent.attrs.blockId}`;
    out.push({
      key: "heading-link",
      label: t("docsInsert.copyHeadingLink"),
      icon: <LinkIcon />,
      run: () =>
        void navigator.clipboard.writeText(url).then(
          () => toast(t("docs.linkCopied")),
          () => emitInsert(editor, { type: "clipboard-blocked" }),
        ),
    });
  }
  const style = blockStyle(parent);
  out.push(
    "sep",
    {
      key: "format-options",
      label: t("docsInsert.formatOptions"),
      icon: <TextFormatIcon />,
      disabled: !editing || !parent.isTextblock,
      submenu: [
        { key: "select-matching", label: t("docsInsert.selectAllMatching"), run: () => selectAllMatching(editor) },
        {
          key: "update-style",
          label: t("docsInsert.updateStyleToMatch", { style: t(STYLE_LABEL[style]) }),
          run: () => updateStyleToMatch(editor, style),
        },
      ],
    },
    {
      key: "clear-formatting",
      label: t("docs.clearFormatting"),
      icon: <ClearFormattingIcon />,
      shortcut: keys("Mod+\\"),
      disabled: !editing,
      run: () => editor.chain().focus().clearFormatting().run(),
    },
  );
  return out;
}

/** The dialog that names the keys when the browser keeps the clipboard
    from the menu. */
export function ClipboardDialogHost({ editor }: { editor: Editor }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  useEffect(() => onInsert(editor, (e) => e.type === "clipboard-blocked" && setOpen(true)), [editor]);
  if (!open) return null;
  const close = () => {
    setOpen(false);
    editor.view.focus();
  };
  return (
    <ToolbarDialog
      title={t("docsInsert.clipboardTitle")}
      onClose={close}
      className="docs-clipboard-dialog"
      actions={
        <DialogButton primary onClick={close}>
          {t("docsInsert.gotIt")}
        </DialogButton>
      }
    >
      <p>{t("docsInsert.clipboardBody")}</p>
      <ul className="docs-clipboard-keys">
        <li>{t("docsInsert.clipboardCopy", { keys: keys("Mod+C") })}</li>
        <li>{t("docsInsert.clipboardCut", { keys: keys("Mod+X") })}</li>
        <li>{t("docsInsert.clipboardPaste", { keys: keys("Mod+V") })}</li>
      </ul>
    </ToolbarDialog>
  );
}

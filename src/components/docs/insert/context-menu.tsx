"use client";

import type { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { CellSelection, mergeCells, splitCell } from "@tiptap/pm/tables";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/lang-provider";
import { NotesIcon, QuestionIcon, SparkleIcon } from "@/components/icons";
import { AddCommentIcon, AddIcon, ClearFormattingIcon, EditIcon, LinkIcon, OutlineIcon, SuggestIcon } from "@/components/docs/icons";
import { isSuggesting } from "@/components/docs/ext/suggest";
import { keys, matchesCombo, isMac } from "@/components/docs/keys";
import { DropdownPanel, MenuItem, MenuSeparator } from "@/components/docs/menu";
import { DialogButton, ToolbarDialog } from "@/components/docs/toolbar/dialog";
import { continueNumbering, restartNumbering } from "@/components/docs/toolbar/lists";
import { STYLE_LABEL } from "@/components/docs/toolbar/styles-menu";
import { blockStyle, updateStyleToMatch } from "@/components/docs/toolbar/styles";
import { DOCS_EVENT, fireDocs } from "@/components/docs/typing/events";
import { copyMarkdown, insertImageFiles, pasteMarkdown } from "@/components/docs/typing/paste";
import { typingPrefs } from "@/components/docs/typing/prefs";
import { misspellingAt, replaceWord, type Misspelling } from "@/components/docs/typing/spelling";
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

type Entry = { label: string; icon?: ReactNode; shortcut?: string; disabled?: boolean; run?: () => void; submenu?: Entry[] } | "sep";

type Place = { x: number; y: number; byKeys: boolean; spelling?: Misspelling };

/** Paste, or paste without formatting, from the clipboard (Edit > Paste
    too). When the browser keeps the clipboard, a dialog names the keys. */
export async function pasteFromClipboard(editor: Editor, plain: boolean): Promise<void> {
  try {
    if (plain) {
      const text = await navigator.clipboard.readText();
      editor.view.focus();
      editor.view.pasteText(text);
      return;
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
      return;
    }
  } catch {
    emitInsert(editor, { type: "clipboard-blocked" });
  }
}

/** Cut or copy the selection (Edit > Cut and Copy too). */
export function execClipboard(editor: Editor, command: "copy" | "cut"): void {
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
      let spelling: Promise<Misspelling | null> | null = null;
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
        // A misspelled English word's spelling suggestions head the menu.
        spelling = hit && misspellingAt(editor, hit.pos);
      }
      view.focus();
      // The menu opens at once; the spelling suggestions join it when the
      // dictionary is ready, unless the page changed meanwhile.
      const opened: Place = { x: e.clientX, y: e.clientY, byKeys: false };
      setPlace(opened);
      const before = view.state;
      void spelling?.then((found) => {
        if (!found || view.state.doc !== before.doc || !view.state.selection.eq(before.selection)) return;
        setPlace((p) => (p === opened ? { ...p, spelling: found } : p));
      });
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
  const { spelling } = place;
  const suggestions: Entry[] = spelling
    ? [...spelling.suggestions.map((word): Entry => ({ label: word, run: () => replaceWord(editor, spelling, word) })), "sep"]
    : [];
  // While the menu is open the text's keys stay in it: letting go of the
  // keys that opened it never opens the Unitos toolbar beside it.
  useEffect(() => {
    const dom = editor.view.dom;
    const stop = (e: KeyboardEvent) => e.stopPropagation();
    dom.addEventListener("keyup", stop);
    return () => dom.removeEventListener("keyup", stop);
  }, [editor]);
  const items = (list: Entry[]): ReactNode =>
    list.map((entry, i) => {
      if (entry === "sep") {
        // No separator at an end or after another.
        const shown = i > 0 && list[i - 1] !== "sep" && i < list.length - 1;
        return shown ? <MenuSeparator key={`sep${i}`} /> : null;
      }
      const { run } = entry;
      return (
        <MenuItem
          key={entry.label}
          icon={entry.icon}
          shortcut={entry.shortcut}
          disabled={entry.disabled}
          submenu={entry.submenu ? items(entry.submenu) : undefined}
          onSelect={
            run &&
            (() => {
              onClose();
              run();
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
        {items([...suggestions, ...entries])}
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
  const item = (label: TKey, icon: ReactNode, run: () => void, extra?: Omit<Exclude<Entry, "sep">, "label">): Entry => ({ label: t(label), icon, run, ...extra });
  const chain = () => editor.chain().focus();
  const paste = (plain: boolean) => () => void pasteFromClipboard(editor, plain);
  const copyLink = (url: string) => () =>
    void navigator.clipboard.writeText(url).then(
      () => toast(t("docs.linkCopied"), editor),
      () => emitInsert(editor, { type: "clipboard-blocked" }),
    );
  // With Enable Markdown on (Tools > Preferences), the Markdown copy and paste.
  const markdown = typingPrefs().markdown;
  const out: Entry[] = [
    item("docsInsert.cut", <CutIcon />, () => execClipboard(editor, "cut"), { shortcut: keys("Mod+X"), disabled: !hasSelection || !editing }),
    item("docsInsert.copy", <CopyIcon />, () => execClipboard(editor, "copy"), { shortcut: keys("Mod+C"), disabled: !hasSelection }),
    ...(markdown ? [item("docsTyping.copyAsMarkdown", <CopyIcon />, () => void copyMarkdown(editor), { disabled: !hasSelection })] : []),
    item("docsInsert.paste", <PasteIcon />, paste(false), { shortcut: keys("Mod+V"), disabled: !editing }),
    item("docsInsert.pastePlain", <PastePlainIcon />, paste(true), { shortcut: keys("Mod+Shift+V"), disabled: !editing }),
    ...(markdown ? [item("docsTyping.pasteFromMarkdown", <PasteIcon />, () => void pasteMarkdown(editor), { disabled: !editing })] : []),
    item("common.delete", <DeleteIcon />, () => chain().deleteSelection().run(), { disabled: !hasSelection || !editing }),
    "sep",
  ];

  if (image && editing) {
    const pos = image.pos;
    return [
      ...out,
      item("docsInsert.cropImage", <CropIcon />, () => imageViewAt(editor.view, pos)?.startCrop()),
      item("docsInsert.replaceImage", <ResetIcon />, () => emitInsert(editor, { type: "image-replace" })),
      item("docsInsert.imageOptions", <ImageOptionsIcon />, () => emitInsert(editor, { type: "image-options" })),
      item("docsInsert.altText", <AltTextIcon />, () => emitInsert(editor, { type: "image-options", section: "alt" }), { shortcut: keys("Mod+Alt+Y") }),
      item("docsInsert.resetImage", <RefreshIcon />, () => resetImage(editor, pos)),
    ];
  }

  if (toc && editing) {
    return [
      ...out,
      item("docsInsert.updateToc", <RefreshIcon />, () => refreshTocs(editor.view)),
      item("docsInsert.deleteToc", <DeleteIcon />, () => chain().deleteSelection().run()),
      item("docsInsert.tocOptions", <OutlineIcon />, () => emitInsert(editor, { type: "toc-options", pos: toc.from })),
    ];
  }

  if (rect && editing) {
    const rows = rect.bottom - rect.top;
    const cols = rect.right - rect.left;
    const pinned = pinnedCount(rect.table);
    // "Insert row above", or "Insert 3 rows above" for three selected rows.
    const counted = (n: number, one: TKey, many: TKey, icon: ReactNode, run: () => void): Entry => ({
      label: n > 1 ? t(many, { n }) : t(one),
      icon,
      run,
    });
    const cell = rect.table.nodeAt(rect.map.map[rect.top * rect.map.width + rect.left]);
    const merged = Boolean(cell && ((Number(cell.attrs.colspan) || 1) > 1 || (Number(cell.attrs.rowspan) || 1) > 1));
    const several = sel instanceof CellSelection && (rows > 1 || cols > 1);
    out.push(
      counted(rows, "docsInsert.insertRowAbove", "docsInsert.insertRowsAbove", <AddIcon />, () => chain().insertRows("before", rows).run()),
      counted(rows, "docsInsert.insertRowBelow", "docsInsert.insertRowsBelow", <AddIcon />, () => chain().insertRows("after", rows).run()),
      counted(cols, "docsInsert.insertColumnLeft", "docsInsert.insertColumnsLeft", <AddIcon />, () => chain().insertColumns("before", cols).run()),
      counted(cols, "docsInsert.insertColumnRight", "docsInsert.insertColumnsRight", <AddIcon />, () => chain().insertColumns("after", cols).run()),
      "sep",
      counted(rows, "docsInsert.deleteRow", "docsInsert.deleteRows", <DeleteIcon />, () => chain().deleteRow().run()),
      counted(cols, "docsInsert.deleteColumn", "docsInsert.deleteColumns", <DeleteIcon />, () => chain().deleteColumn().run()),
      item("docsInsert.deleteTable", <DeleteIcon />, () => chain().deleteTable().run()),
      "sep",
      pinned > 0 && rect.top < pinned
        ? item(pinned > 1 ? "docsInsert.unpinHeaderRows" : "docsInsert.unpinHeaderRow", <UnpinIcon />, () => chain().pinHeaderRows(0).run())
        : item("docsInsert.pinHeaderUpToRow", <PinIcon />, () => chain().pinHeaderRows(rect.bottom).run()),
      several
        ? item("docsInsert.mergeCells", <MergeIcon />, () => mergeCells(editor.state, editor.view.dispatch), { disabled: !mergeCells(state) })
        : merged
          ? item("docsInsert.unmergeCells", <SplitIcon />, () => splitCell(editor.state, editor.view.dispatch))
          : item("docsInsert.splitCell", <SplitIcon />, () => emitInsert(editor, { type: "split-cell" })),
      {
        label: t("docsInsert.sortTable"),
        icon: <SortIcon />,
        disabled: !editor.can().sortTable(1),
        submenu: [
          item("docsInsert.sortAscending", <ArrowUpIcon />, () => chain().sortTable(1).run()),
          item("docsInsert.sortDescending", <ArrowDownIcon />, () => chain().sortTable(-1).run()),
        ],
      },
      item("docsInsert.distributeRows", <DistributeRowsIcon />, () => distributeRows(editor)),
      item("docsInsert.distributeColumns", <DistributeColumnsIcon />, () => chain().distributeColumns().run()),
      item("docsInsert.tableOptions", <ImageOptionsIcon />, () => emitInsert(editor, { type: "table-options" })),
      "sep",
    );
  }

  // The Unitos tools on the selected words; the reader layer answers.
  const tool = (name: "add-to-notes" | "explain" | "assistant") => () =>
    fireDocs(editor, DOCS_EVENT.tool, { tool: name });
  const openLinkBox = () => fireDocs(editor, DOCS_EVENT.link);
  const href = editor.isActive("link") ? (editor.getAttributes("link").href as string | undefined) : undefined;
  const parent = sel.$from.parent;
  const style = blockStyle(parent);
  out.push(
    item("docsInsert.comment", <AddCommentIcon />, () => fireDocs(editor, DOCS_EVENT.comment), { shortcut: keys("Mod+Alt+M") }),
    // Suggest edits: the page switches to Suggesting mode (toolbar.tsx).
    ...(editing && !isSuggesting(editor) ? [item("docsInsert.suggestEdits", <SuggestIcon />, () => fireDocs(editor, "docs:mode", "suggesting"))] : []),
    item("docsInsert.addToNotes", <NotesIcon size={18} />, tool("add-to-notes"), { disabled: !textSelected }),
    item("docsInsert.explain", <QuestionIcon size={18} />, tool("explain"), { disabled: !textSelected }),
    item("docsInsert.askAssistant", <SparkleIcon size={18} />, tool("assistant"), { disabled: !textSelected }),
    "sep",
    ...(href
      ? [
          item("docsInsert.openLink", <OpenInNewIcon />, () => openLinkHref(editor, href, ctx), { shortcut: keys("Alt+Enter") }),
          item("docs.editLink", <EditIcon />, openLinkBox, { shortcut: keys("Mod+K"), disabled: !editing }),
          item("docs.removeLink", <LinkOffIcon />, () => chain().extendMarkRange("link").unsetLink().run(), { disabled: !editing }),
        ]
      : [item("docs.insertLink", <LinkIcon />, openLinkBox, { shortcut: keys("Mod+K"), disabled: !editing })]),
    ...(parent.type.name === "heading" && typeof parent.attrs.blockId === "string"
      ? [item("docsInsert.copyHeadingLink", <LinkIcon />, copyLink(`${window.location.origin}${window.location.pathname}${window.location.search}#heading=${parent.attrs.blockId}`))]
      : []),
    "sep",
    // On a numbered line; Restart numbering starts the list again at 1.
    ...(editing && restartNumbering(1)(state) ? [item("docs.restartNumbering", null, () => restartNumbering(1)(editor.state, editor.view.dispatch))] : []),
    ...(editing && continueNumbering(state) ? [item("docs.continueNumbering", null, () => continueNumbering(editor.state, editor.view.dispatch))] : []),
    "sep",
    {
      label: t("docsInsert.formatOptions"),
      icon: <TextFormatIcon />,
      disabled: !editing || !parent.isTextblock,
      submenu: [
        { label: t("docsInsert.selectAllMatching"), run: () => selectAllMatching(editor) },
        { label: t("docsInsert.updateStyleToMatch", { style: t(STYLE_LABEL[style]) }), run: () => updateStyleToMatch(editor, style) },
      ],
    },
    item("docs.clearFormatting", <ClearFormattingIcon />, () => chain().clearFormatting().run(), { shortcut: keys("Mod+\\"), disabled: !editing }),
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
      <ul>
        <li>{t("docsInsert.clipboardCopy", { keys: keys("Mod+C") })}</li>
        <li>{t("docsInsert.clipboardCut", { keys: keys("Mod+X") })}</li>
        <li>{t("docsInsert.clipboardPaste", { keys: keys("Mod+V") })}</li>
      </ul>
    </ToolbarDialog>
  );
}

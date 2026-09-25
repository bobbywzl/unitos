import type { Editor } from "@tiptap/react";
import { mergeCells, splitCell } from "@tiptap/pm/tables";
import { registerDocsCommands, type DocsCommand } from "@/components/docs/commands";
import { insertBookmark, insertEquation, insertHorizontalLine } from "@/components/docs/insert/actions";
import { openAtMenuHere } from "@/components/docs/insert/at-plugin";
import { buildingBlock, type BuildingBlock } from "@/components/docs/insert/building-blocks";
import { emitInsert, insertContext, type PickerKind } from "@/components/docs/insert/context";
import { insertFootnote } from "@/components/docs/insert/footnotes";
import { selectAllMatching } from "@/components/docs/insert/format-match";
import { imageViewAt, resetImage, selectedImage } from "@/components/docs/insert/image";
import { distributeRows, tableRectOf } from "@/components/docs/insert/table";
import type { TKey } from "@/lib/i18n/dictionaries";

// This area's items of Google Docs' Insert and Format menus (SPEC.md §29),
// registered for Search the menus.

type Run = (editor: Editor) => void;

const insert = (id: string, label: TKey, keywords: string[], run: Run, shortcut?: string): DocsCommand => ({
  id: `insert:${id}`,
  label,
  menu: "insert",
  keywords,
  shortcut,
  enabled: (editor) => editor.isEditable,
  run,
});

const picker = (kind: PickerKind): Run => (editor) => emitInsert(editor, { type: "picker", kind });

const block = (kind: BuildingBlock, label: TKey, keywords: string[]) =>
  insert(`block-${kind}`, label, ["building block", "template", ...keywords], (editor) => {
    const ctx = insertContext(editor);
    if (ctx) editor.chain().focus().insertContent(buildingBlock(kind, ctx.t, ctx.lang)).run();
  });

const image = (id: string, label: TKey, keywords: string[], run: (editor: Editor, pos: number) => void, shortcut?: string): DocsCommand => ({
  id: `format:${id}`,
  label,
  menu: "format",
  keywords,
  shortcut,
  enabled: (editor) => selectedImage(editor.state) !== null,
  run: (editor) => {
    const hit = selectedImage(editor.state);
    if (hit) run(editor, hit.pos);
  },
});

const table = (id: string, label: TKey, keywords: string[], run: Run, enabled?: (editor: Editor) => boolean): DocsCommand => ({
  id: `format:${id}`,
  label,
  menu: "format",
  keywords: [...keywords, "table"],
  enabled: (editor) => tableRectOf(editor.state) !== null && (enabled?.(editor) ?? true),
  run,
});

registerDocsCommands([
  insert("table", "docsInsert.itemTable", ["table", "grid", "表格"], picker("table")),
  insert("special-characters", "docsInsert.itemSpecialCharacters", ["symbol", "character", "omega", "arrow", "符号"], (editor) =>
    emitInsert(editor, { type: "special-characters" }),
  ),
  insert("emoji", "docsInsert.itemEmoji", ["emoji", "smiley", "表情"], picker("emoji")),
  insert("equation", "docsInsert.itemEquation", ["equation", "math", "formula", "latex", "公式"], (editor) => {
    const pos = insertEquation(editor, null);
    if (pos !== null) emitInsert(editor, { type: "equation", pos });
  }),
  insert("horizontal-line", "docsInsert.itemHorizontalLine", ["horizontal line", "rule", "divider", "hr", "分隔线"], (editor) => insertHorizontalLine(editor, null)),
  {
    ...insert("page-break", "docsInsert.itemPageBreak", ["page break", "break", "分页"], (editor) => editor.chain().focus().setPageBreak().run(), "Mod+Enter"),
    enabled: (editor) => editor.isEditable && !insertContext(editor)?.pageSetup.pageless,
  },
  insert("footnote", "docsInsert.itemFootnote", ["footnote", "note", "脚注"], (editor) => insertFootnote(editor), "Mod+Alt+F"),
  insert("table-of-contents", "docsInsert.itemTableOfContents", ["table of contents", "toc", "目录"], picker("toc")),
  insert("bookmark", "docsInsert.itemBookmark", ["bookmark", "anchor", "add a bookmark", "add an anchor", "书签"], (editor) => insertBookmark(editor)),
  insert("smart-chips", "docsInsert.sectionSmartChips", ["smart chip", "chip", "person", "file", "@", "mention"], (editor) => openAtMenuHere(editor.view)),
  insert("date", "docsInsert.itemDate", ["date", "calendar", "smart chip", "日期"], picker("date")),
  insert("dropdown", "docsInsert.itemDropdown", ["dropdown", "status", "smart chip", "下拉"], picker("dropdown")),
  insert("code-block", "docsInsert.itemCodeBlock", ["code", "snippet", "building block", "代码"], picker("code")),
  block("meetingNotes", "docsInsert.itemMeetingNotes", ["meeting", "notes", "agenda"]),
  block("emailDraft", "docsInsert.itemEmailDraft", ["email", "mail", "draft"]),
  block("productRoadmap", "docsInsert.itemProductRoadmap", ["roadmap", "table"]),
  block("reviewTracker", "docsInsert.itemReviewTracker", ["review", "tracker", "table"]),
  block("taskTracker", "docsInsert.itemTaskTracker", ["task", "tracker", "table"]),
  image("alt-text", "docsInsert.altText", ["alt text", "image description", "accessibility"], (editor) => emitInsert(editor, { type: "image-options", section: "alt" }), "Mod+Alt+Y"),
  image("image-options", "docsInsert.imageOptions", ["image", "size", "rotation", "wrap", "recolor", "transparency"], (editor) =>
    emitInsert(editor, { type: "image-options" }),
  ),
  image("crop-image", "docsInsert.cropImage", ["crop", "image"], (editor, pos) => imageViewAt(editor.view, pos)?.startCrop()),
  image("reset-image", "docsInsert.resetImage", ["reset", "image"], resetImage),
  image("replace-image", "docsInsert.replaceImage", ["replace", "image"], (editor) => emitInsert(editor, { type: "image-replace" })),
  table("table-options", "docsInsert.tableOptions", ["table properties", "border", "cell", "column width", "row height"], (editor) =>
    emitInsert(editor, { type: "table-options" }),
  ),
  table("insert-row-above", "docsInsert.insertRowAbove", ["add row above"], (editor) => editor.chain().focus().insertRows("before", 1).run()),
  table("insert-row-below", "docsInsert.insertRowBelow", ["insert new row below", "add row"], (editor) => editor.chain().focus().insertRows("after", 1).run()),
  table("insert-column-left", "docsInsert.insertColumnLeft", ["add column"], (editor) => editor.chain().focus().insertColumns("before", 1).run()),
  table("insert-column-right", "docsInsert.insertColumnRight", ["add column"], (editor) => editor.chain().focus().insertColumns("after", 1).run()),
  table("delete-row", "docsInsert.deleteRow", ["remove row"], (editor) => editor.chain().focus().deleteRow().run()),
  table("delete-column", "docsInsert.deleteColumn", ["remove column"], (editor) => editor.chain().focus().deleteColumn().run()),
  table("delete-table", "docsInsert.deleteTable", ["remove table"], (editor) => editor.chain().focus().deleteTable().run()),
  table("merge-cells", "docsInsert.mergeCells", ["combine", "merge"], (editor) => mergeCells(editor.state, editor.view.dispatch), (editor) => mergeCells(editor.state)),
  table("unmerge-cells", "docsInsert.unmergeCells", ["unmerge"], (editor) => splitCell(editor.state, editor.view.dispatch), (editor) => splitCell(editor.state)),
  table("split-cell", "docsInsert.splitCell", ["split", "cell"], (editor) => emitInsert(editor, { type: "split-cell" })),
  table("sort-ascending", "docsInsert.sortAscending", ["sort table", "a to z"], (editor) => editor.chain().focus().sortTable(1).run(), (editor) =>
    editor.can().sortTable(1),
  ),
  table("sort-descending", "docsInsert.sortDescending", ["sort table", "z to a"], (editor) => editor.chain().focus().sortTable(-1).run(), (editor) =>
    editor.can().sortTable(-1),
  ),
  table("distribute-rows", "docsInsert.distributeRows", ["even", "equal", "same size", "height"], (editor) => distributeRows(editor)),
  table("distribute-columns", "docsInsert.distributeColumns", ["even", "equal", "same size", "width"], (editor) => editor.chain().focus().distributeColumns().run()),
  table("pin-header", "docsInsert.pinHeaderUpToRow", ["pin", "header row"], (editor) => {
    const rect = tableRectOf(editor.state);
    if (rect) editor.chain().focus().pinHeaderRows(rect.bottom).run();
  }),
  {
    id: "edit:select-all-matching",
    label: "docsInsert.selectAllMatching",
    menu: "format",
    keywords: ["select matching", "same formatting", "format options"],
    enabled: (editor) => editor.isEditable,
    run: (editor) => selectAllMatching(editor),
  },
]);

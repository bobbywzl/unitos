import type { Editor } from "@tiptap/react";
import { mergeCells, splitCell } from "@tiptap/pm/tables";
import { registerDocsCommands, type DocsCommand } from "@/components/docs/commands";
import { insertBookmark, insertEquation, insertHorizontalLine } from "@/components/docs/insert/actions";
import { openAtMenuHere } from "@/components/docs/insert/at-plugin";
import { buildingBlock, type BuildingBlock } from "@/components/docs/insert/building-blocks";
import { emitInsert, insertContext } from "@/components/docs/insert/context";
import { insertFootnote } from "@/components/docs/insert/footnotes";
import { selectAllMatching } from "@/components/docs/insert/format-match";
import { imageViewAt, resetImage, selectedImage } from "@/components/docs/insert/image";
import { distributeRows, tableRectOf } from "@/components/docs/insert/table";
import type { TKey } from "@/lib/i18n/dictionaries";

// This area's items of Google Docs' Insert and Format menus (SPEC.md §29),
// registered for Search the menus.

const hasImage = (editor: Editor) => selectedImage(editor.state) !== null;
const inTable = (editor: Editor) => tableRectOf(editor.state) !== null;
const editable = (editor: Editor) => editor.isEditable;

function block(kind: BuildingBlock, label: TKey, keywords: string[]): DocsCommand {
  return {
    id: `insert:block-${kind}`,
    label,
    menu: "insert",
    keywords: ["building block", "template", ...keywords],
    enabled: editable,
    run: (editor) => {
      const ctx = insertContext(editor);
      if (!ctx) return;
      editor.chain().focus().insertContent(buildingBlock(kind, ctx.t, ctx.lang)).run();
    },
  };
}

registerDocsCommands([
  {
    id: "insert:table",
    label: "docsInsert.itemTable",
    menu: "insert",
    keywords: ["table", "grid", "表格"],
    enabled: editable,
    run: (editor) => emitInsert(editor, { type: "picker", kind: "table" }),
  },
  {
    id: "insert:special-characters",
    label: "docsInsert.itemSpecialCharacters",
    menu: "insert",
    keywords: ["symbol", "character", "omega", "arrow", "符号"],
    enabled: editable,
    run: (editor) => emitInsert(editor, { type: "special-characters" }),
  },
  {
    id: "insert:emoji",
    label: "docsInsert.itemEmoji",
    menu: "insert",
    keywords: ["emoji", "smiley", "表情"],
    enabled: editable,
    run: (editor) => emitInsert(editor, { type: "picker", kind: "emoji" }),
  },
  {
    id: "insert:equation",
    label: "docsInsert.itemEquation",
    menu: "insert",
    keywords: ["equation", "math", "formula", "latex", "公式"],
    enabled: editable,
    run: (editor) => {
      const pos = insertEquation(editor, null);
      if (pos !== null) emitInsert(editor, { type: "equation", pos });
    },
  },
  {
    id: "insert:horizontal-line",
    label: "docsInsert.itemHorizontalLine",
    menu: "insert",
    keywords: ["horizontal line", "rule", "divider", "hr", "分隔线"],
    enabled: editable,
    run: (editor) => insertHorizontalLine(editor, null),
  },
  {
    id: "insert:page-break",
    label: "docsInsert.itemPageBreak",
    menu: "insert",
    keywords: ["page break", "break", "分页"],
    shortcut: "Mod+Enter",
    enabled: (editor) => editor.isEditable && !insertContext(editor)?.pageSetup.pageless,
    run: (editor) => editor.chain().focus().setPageBreak().run(),
  },
  {
    id: "insert:footnote",
    label: "docsInsert.itemFootnote",
    menu: "insert",
    keywords: ["footnote", "note", "脚注"],
    shortcut: "Mod+Alt+F",
    enabled: editable,
    run: (editor) => insertFootnote(editor),
  },
  {
    id: "insert:table-of-contents",
    label: "docsInsert.itemTableOfContents",
    menu: "insert",
    keywords: ["table of contents", "toc", "目录"],
    enabled: editable,
    run: (editor) => emitInsert(editor, { type: "picker", kind: "toc" }),
  },
  {
    id: "insert:bookmark",
    label: "docsInsert.itemBookmark",
    menu: "insert",
    keywords: ["bookmark", "anchor", "add a bookmark", "add an anchor", "书签"],
    enabled: editable,
    run: (editor) => insertBookmark(editor),
  },
  {
    id: "insert:smart-chips",
    label: "docsInsert.sectionSmartChips",
    menu: "insert",
    keywords: ["smart chip", "chip", "person", "file", "@", "mention"],
    enabled: editable,
    run: (editor) => openAtMenuHere(editor.view),
  },
  {
    id: "insert:date",
    label: "docsInsert.itemDate",
    menu: "insert",
    keywords: ["date", "calendar", "smart chip", "日期"],
    enabled: editable,
    run: (editor) => emitInsert(editor, { type: "picker", kind: "date" }),
  },
  {
    id: "insert:dropdown",
    label: "docsInsert.itemDropdown",
    menu: "insert",
    keywords: ["dropdown", "status", "smart chip", "下拉"],
    enabled: editable,
    run: (editor) => emitInsert(editor, { type: "picker", kind: "dropdown" }),
  },
  {
    id: "insert:code-block",
    label: "docsInsert.itemCodeBlock",
    menu: "insert",
    keywords: ["code", "snippet", "building block", "代码"],
    enabled: editable,
    run: (editor) => emitInsert(editor, { type: "picker", kind: "code" }),
  },
  block("meetingNotes", "docsInsert.itemMeetingNotes", ["meeting", "notes", "agenda"]),
  block("emailDraft", "docsInsert.itemEmailDraft", ["email", "mail", "draft"]),
  block("productRoadmap", "docsInsert.itemProductRoadmap", ["roadmap", "table"]),
  block("reviewTracker", "docsInsert.itemReviewTracker", ["review", "tracker", "table"]),
  block("taskTracker", "docsInsert.itemTaskTracker", ["task", "tracker", "table"]),
  {
    id: "format:alt-text",
    label: "docsInsert.altText",
    menu: "format",
    keywords: ["alt text", "image description", "accessibility"],
    shortcut: "Mod+Alt+Y",
    enabled: hasImage,
    run: (editor) => emitInsert(editor, { type: "image-options", section: "alt" }),
  },
  {
    id: "format:image-options",
    label: "docsInsert.imageOptions",
    menu: "format",
    keywords: ["image", "size", "rotation", "wrap", "recolor", "transparency"],
    enabled: hasImage,
    run: (editor) => emitInsert(editor, { type: "image-options" }),
  },
  {
    id: "format:crop-image",
    label: "docsInsert.cropImage",
    menu: "format",
    keywords: ["crop", "image"],
    enabled: hasImage,
    run: (editor) => {
      const hit = selectedImage(editor.state);
      if (hit) imageViewAt(editor.view, hit.pos)?.startCrop();
    },
  },
  {
    id: "format:reset-image",
    label: "docsInsert.resetImage",
    menu: "format",
    keywords: ["reset", "image"],
    enabled: hasImage,
    run: (editor) => {
      const hit = selectedImage(editor.state);
      if (hit) resetImage(editor, hit.pos);
    },
  },
  {
    id: "format:replace-image",
    label: "docsInsert.replaceImage",
    menu: "format",
    keywords: ["replace", "image"],
    enabled: hasImage,
    run: (editor) => emitInsert(editor, { type: "image-replace" }),
  },
  {
    id: "format:table-options",
    label: "docsInsert.tableOptions",
    menu: "format",
    keywords: ["table properties", "table", "border", "cell", "column width", "row height"],
    enabled: inTable,
    run: (editor) => emitInsert(editor, { type: "table-options" }),
  },
  {
    id: "format:insert-row-above",
    label: "docsInsert.insertRowAbove",
    menu: "format",
    keywords: ["add row above", "table"],
    enabled: inTable,
    run: (editor) => editor.chain().focus().insertRows("before", 1).run(),
  },
  {
    id: "format:insert-row-below",
    label: "docsInsert.insertRowBelow",
    menu: "format",
    keywords: ["insert new row below", "add row", "table"],
    enabled: inTable,
    run: (editor) => editor.chain().focus().insertRows("after", 1).run(),
  },
  {
    id: "format:insert-column-left",
    label: "docsInsert.insertColumnLeft",
    menu: "format",
    keywords: ["add column", "table"],
    enabled: inTable,
    run: (editor) => editor.chain().focus().insertColumns("before", 1).run(),
  },
  {
    id: "format:insert-column-right",
    label: "docsInsert.insertColumnRight",
    menu: "format",
    keywords: ["add column", "table"],
    enabled: inTable,
    run: (editor) => editor.chain().focus().insertColumns("after", 1).run(),
  },
  {
    id: "format:delete-row",
    label: "docsInsert.deleteRow",
    menu: "format",
    keywords: ["remove row", "table"],
    enabled: inTable,
    run: (editor) => editor.chain().focus().deleteRow().run(),
  },
  {
    id: "format:delete-column",
    label: "docsInsert.deleteColumn",
    menu: "format",
    keywords: ["remove column", "table"],
    enabled: inTable,
    run: (editor) => editor.chain().focus().deleteColumn().run(),
  },
  {
    id: "format:delete-table",
    label: "docsInsert.deleteTable",
    menu: "format",
    keywords: ["remove table"],
    enabled: inTable,
    run: (editor) => editor.chain().focus().deleteTable().run(),
  },
  {
    id: "format:merge-cells",
    label: "docsInsert.mergeCells",
    menu: "format",
    keywords: ["combine", "merge", "table"],
    enabled: (editor) => mergeCells(editor.state),
    run: (editor) => mergeCells(editor.state, editor.view.dispatch),
  },
  {
    id: "format:unmerge-cells",
    label: "docsInsert.unmergeCells",
    menu: "format",
    keywords: ["unmerge", "table"],
    enabled: (editor) => splitCell(editor.state),
    run: (editor) => splitCell(editor.state, editor.view.dispatch),
  },
  {
    id: "format:split-cell",
    label: "docsInsert.splitCell",
    menu: "format",
    keywords: ["split", "table", "cell"],
    enabled: inTable,
    run: (editor) => emitInsert(editor, { type: "split-cell" }),
  },
  {
    id: "format:sort-ascending",
    label: "docsInsert.sortAscending",
    menu: "format",
    keywords: ["sort table", "a to z"],
    enabled: (editor) => inTable(editor) && editor.can().sortTable(1),
    run: (editor) => editor.chain().focus().sortTable(1).run(),
  },
  {
    id: "format:sort-descending",
    label: "docsInsert.sortDescending",
    menu: "format",
    keywords: ["sort table", "z to a"],
    enabled: (editor) => inTable(editor) && editor.can().sortTable(-1),
    run: (editor) => editor.chain().focus().sortTable(-1).run(),
  },
  {
    id: "format:distribute-rows",
    label: "docsInsert.distributeRows",
    menu: "format",
    keywords: ["even", "equal", "same size", "height", "table"],
    enabled: inTable,
    run: (editor) => distributeRows(editor),
  },
  {
    id: "format:distribute-columns",
    label: "docsInsert.distributeColumns",
    menu: "format",
    keywords: ["even", "equal", "same size", "width", "table"],
    enabled: inTable,
    run: (editor) => editor.chain().focus().distributeColumns().run(),
  },
  {
    id: "format:pin-header",
    label: "docsInsert.pinHeaderUpToRow",
    menu: "format",
    keywords: ["pin", "header row", "table"],
    enabled: inTable,
    run: (editor) => {
      const rect = tableRectOf(editor.state);
      if (rect) editor.chain().focus().pinHeaderRows(rect.bottom).run();
    },
  },
  {
    id: "edit:select-all-matching",
    label: "docsInsert.selectAllMatching",
    menu: "format",
    keywords: ["select matching", "same formatting", "format options"],
    enabled: editable,
    run: (editor) => selectAllMatching(editor),
  },
]);

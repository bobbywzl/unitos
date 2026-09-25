import type { Editor } from "@tiptap/core";
import { registerDocsCommands } from "@/components/docs/commands";
import { ZOOMS } from "@/components/docs/toolbar";
import { addPageNumbers } from "@/components/docs/page/header-footer";
import { downloadDocument, type DownloadFormat } from "@/components/docs/page/download";
import { PAGE_EVENT, findPageStore as store, type EditHeaderDetail, type HeaderArea } from "@/components/docs/page/store";
import type { TKey } from "@/lib/i18n/dictionaries";

// The page area's commands (SPEC.md §29): what Google Docs keeps in its File,
// View, Insert, and Format menus for the page. Search the menus lists them.

/** The next zoom step up or down Docs' list, from any zoom; Fit counts as
    the zoom it works out to. */
export function stepZoom(current: number, direction: 1 | -1): number {
  const pct = Math.round(current * 100);
  if (direction === 1) return ZOOMS.find((z) => z > pct) ?? ZOOMS[ZOOMS.length - 1];
  return [...ZOOMS].reverse().find((z) => z < pct) ?? ZOOMS[0];
}

/** The document can be edited and is in pages format. */
const paged = (editor: Editor) => editor.isEditable && store(editor)?.get().setup.pageless === false;
const pageless = (editor: Editor) => store(editor)?.get().setup.pageless === true;

const editHeader = (area: HeaderArea) => () =>
  window.dispatchEvent(new CustomEvent<EditHeaderDetail>(PAGE_EVENT.editHeader, { detail: { area } }));

const TEXT_WIDTH_LABELS = {
  narrow: "docsPage.textWidthNarrow",
  medium: "docsPage.textWidthMedium",
  wide: "docsPage.textWidthWide",
  full: "docsPage.textWidthFull",
} as const;

// The page number presets: in the header or the footer, on every page or
// from the second.
const NUMBER_PRESETS: [HeaderArea, boolean, TKey][] = [
  ["header", true, "docsPage.numbersHeader"],
  ["header", false, "docsPage.numbersHeaderNotFirst"],
  ["footer", true, "docsPage.numbersFooter"],
  ["footer", false, "docsPage.numbersFooterNotFirst"],
];

// File > Download: each format with the words Google Docs finds it by.
const DOWNLOADS: [DownloadFormat, TKey, string[]][] = [
  ["docx", "docsPage.downloadDocx", ["docx", "word", "microsoft word"]],
  ["pdf", "docsPage.downloadPdf", ["pdf", "adobe"]],
  ["txt", "docsPage.downloadTxt", ["txt", "plain text"]],
  ["html", "docsPage.downloadHtml", ["html", "web page", "website"]],
  ["md", "docsPage.downloadMarkdown", ["md", "markdown", "markup"]],
];

registerDocsCommands([
  {
    id: "page:setup",
    label: "docsPage.pageSetup",
    menu: "file",
    keywords: ["margins", "paper", "orientation", "landscape", "portrait", "page color", "A4", "letter"],
    run: (editor) => store(editor)?.set({ dialog: "setup" }),
    enabled: (editor) => editor.isEditable,
  },
  {
    id: "page:ruler",
    label: "docsPage.showRuler",
    menu: "view",
    keywords: ["ruler", "indent", "margins"],
    run: (editor) => {
      const s = store(editor);
      if (s) s.set({ showRuler: !s.get().showRuler });
    },
  },
  {
    id: "page:print-layout",
    label: "docsPage.showPrintLayout",
    menu: "view",
    keywords: ["print layout", "page breaks", "pages", "pagination"],
    run: (editor) => {
      const s = store(editor);
      if (s) s.set({ printLayout: !s.get().printLayout });
    },
    enabled: (editor) => !pageless(editor),
  },
  {
    id: "page:outline",
    label: "docsPage.showOutline",
    menu: "view",
    keywords: ["outline", "headings", "tabs", "navigation"],
    run: (editor) => {
      const s = store(editor);
      if (s) s.set({ outlineOpen: !s.get().outlineOpen });
    },
  },
  {
    id: "page:pageless",
    label: "docsPage.switchToPageless",
    menu: "format",
    keywords: ["pageless", "pages", "format"],
    run: (editor) => {
      const s = store(editor);
      if (s) void s.saveSetup({ ...s.get().setup, pageless: true });
    },
    enabled: paged,
  },
  {
    id: "page:pages",
    label: "docsPage.switchToPages",
    menu: "format",
    keywords: ["pageless", "pages", "format"],
    run: (editor) => {
      const s = store(editor);
      if (s) void s.saveSetup({ ...s.get().setup, pageless: false });
    },
    enabled: (editor) => editor.isEditable && pageless(editor),
  },
  ...(["narrow", "medium", "wide", "full"] as const).map((width) => ({
    id: `page:text-width-${width}`,
    label: TEXT_WIDTH_LABELS[width],
    menu: "view" as const,
    keywords: ["pageless", "text width"],
    run: (editor: Editor) => store(editor)?.set({ textWidth: width }),
    enabled: pageless,
  })),
  {
    id: "page:header",
    label: "docsPage.header",
    menu: "insert",
    keywords: ["header", "headers & footers", "add a header", "page elements"],
    shortcut: "Mod+Alt+O H",
    run: editHeader("header"),
    enabled: paged,
  },
  {
    id: "page:footer",
    label: "docsPage.footer",
    menu: "insert",
    keywords: ["footer", "headers & footers", "add a footer", "page elements"],
    shortcut: "Mod+Alt+O F",
    run: editHeader("footer"),
    enabled: paged,
  },
  {
    id: "page:page-numbers",
    label: "docsPage.pageNumbers",
    menu: "insert",
    keywords: ["page number", "numbering", "page elements"],
    run: (editor) => store(editor)?.set({ dialog: "pageNumbers" }),
    enabled: paged,
  },
  {
    id: "page:page-count",
    label: "docsPage.pageCount",
    menu: "insert",
    keywords: ["page count", "total pages", "page elements"],
    run: () => window.dispatchEvent(new Event(PAGE_EVENT.pageCount)),
    enabled: (editor) => store(editor)?.get().editing != null,
  },
  ...NUMBER_PRESETS.map(([area, onFirst, label]) => ({
    id: `page:numbers-${area}-${onFirst ? "all" : "not-first"}`,
    label,
    menu: "insert" as const,
    keywords: ["page number", "page elements", "numbering"],
    run: (editor: Editor) => {
      const s = store(editor);
      if (s) void s.saveSetup(addPageNumbers(s.get().setup, area, onFirst));
    },
    enabled: paged,
  })),
  {
    id: "page:zoom-in",
    label: "docsPage.zoomIn",
    menu: "view",
    shortcut: "Mod+=",
    run: (editor) => {
      const s = store(editor);
      if (s) s.zoomTo(stepZoom(s.get().scale, 1));
    },
  },
  {
    id: "page:zoom-out",
    label: "docsPage.zoomOut",
    menu: "view",
    shortcut: "Mod+-",
    run: (editor) => {
      const s = store(editor);
      if (s) s.zoomTo(stepZoom(s.get().scale, -1));
    },
  },
  ...DOWNLOADS.map(([format, label, words]) => ({
    id: `page:download-${format}`,
    label,
    menu: "file" as const,
    keywords: ["download", "export", ...words],
    run: (editor: Editor) => void downloadDocument(editor, format),
  })),
  {
    id: "page:make-copy",
    label: "docsPage.makeCopy",
    menu: "file",
    keywords: ["copy", "duplicate"],
    run: (editor) => store(editor)?.set({ dialog: "copy" }),
    enabled: (editor) => editor.isEditable,
  },
]);

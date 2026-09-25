import type { Editor } from "@tiptap/core";
import { registerDocsCommands } from "@/components/docs/commands";
import { ZOOMS } from "@/components/docs/toolbar";
import { togglePageFlag, type PageFlag } from "@/components/docs/ext/page";
import { addPageNumbers } from "@/components/docs/page/header-footer";
import { findPageStore, type HeaderArea } from "@/components/docs/page/store";
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

export const PAGE_EVENT = {
  /** Enter the header or the footer of the page that holds the caret. */
  editHeader: "docs:page-edit-header",
} as const;

export type EditHeaderDetail = { area: HeaderArea };

function store(editor: Editor) {
  return findPageStore(editor);
}

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
    id: "page:print",
    label: "docsPage.print",
    menu: "file",
    shortcut: "Mod+P",
    run: () => window.print(),
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
    keywords: ["print layout", "compact", "pages"],
    run: (editor) => {
      const s = store(editor);
      if (s) s.set({ printLayout: !s.get().printLayout });
    },
    enabled: (editor) => store(editor)?.get().setup.pageless === false,
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
    enabled: (editor) => editor.isEditable && store(editor)?.get().setup.pageless === false,
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
    enabled: (editor) => editor.isEditable && store(editor)?.get().setup.pageless === true,
  },
  ...(["narrow", "medium", "wide", "full"] as const).map((width) => ({
    id: `page:text-width-${width}`,
    label: (
      {
        narrow: "docsPage.textWidthNarrow",
        medium: "docsPage.textWidthMedium",
        wide: "docsPage.textWidthWide",
        full: "docsPage.textWidthFull",
      } as const
    )[width],
    menu: "view" as const,
    keywords: ["pageless", "text width"],
    run: (editor: Editor) => store(editor)?.set({ textWidth: width }),
    enabled: (editor: Editor) => store(editor)?.get().setup.pageless === true,
  })),
  {
    id: "page:header",
    label: "docsPage.header",
    menu: "insert",
    keywords: ["header", "page elements"],
    shortcut: "Mod+Alt+O H",
    run: () => window.dispatchEvent(new CustomEvent<EditHeaderDetail>(PAGE_EVENT.editHeader, { detail: { area: "header" } })),
    enabled: (editor) => editor.isEditable && store(editor)?.get().setup.pageless === false,
  },
  {
    id: "page:footer",
    label: "docsPage.footer",
    menu: "insert",
    keywords: ["footer", "page elements"],
    shortcut: "Mod+Alt+O F",
    run: () => window.dispatchEvent(new CustomEvent<EditHeaderDetail>(PAGE_EVENT.editHeader, { detail: { area: "footer" } })),
    enabled: (editor) => editor.isEditable && store(editor)?.get().setup.pageless === false,
  },
  {
    id: "page:page-numbers",
    label: "docsPage.pageNumbers",
    menu: "insert",
    keywords: ["page number", "numbering", "page elements"],
    run: (editor) => store(editor)?.set({ dialog: "pageNumbers" }),
    enabled: (editor) => editor.isEditable && store(editor)?.get().setup.pageless === false,
  },
  ...(
    [
      ["keepWithNext", "docsPage.keepWithNext"],
      ["keepLinesTogether", "docsPage.keepLinesTogether"],
      ["avoidWidowAndOrphan", "docsPage.preventSingleLines"],
      ["pageBreakBefore", "docsPage.pageBreakBefore"],
    ] as [PageFlag, TKey][]
  ).map(([flag, label]) => ({
    id: `page:${flag}`,
    label,
    menu: "format" as const,
    keywords: ["pagination", "line & paragraph spacing", "page break"],
    run: (editor: Editor) => togglePageFlag(editor, flag),
    enabled: (editor: Editor) => editor.isEditable && store(editor)?.get().setup.pageless === false,
  })),
  // The page number presets: in the header or the footer, on every page or
  // from the second.
  ...(
    [
      ["header", true, "docsPage.numbersHeader"],
      ["header", false, "docsPage.numbersHeaderNotFirst"],
      ["footer", true, "docsPage.numbersFooter"],
      ["footer", false, "docsPage.numbersFooterNotFirst"],
    ] as [HeaderArea, boolean, TKey][]
  ).map(([area, onFirst, label]) => ({
    id: `page:numbers-${area}-${onFirst ? "all" : "not-first"}`,
    label,
    menu: "insert" as const,
    keywords: ["page number", "page elements", "numbering"],
    run: (editor: Editor) => {
      const s = store(editor);
      if (s) void s.saveSetup(addPageNumbers(s.get().setup, area, onFirst));
    },
    enabled: (editor: Editor) => editor.isEditable && store(editor)?.get().setup.pageless === false,
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
  {
    id: "page:zoom-100",
    label: "docsPage.zoom100",
    menu: "view",
    shortcut: "Mod+0",
    run: (editor) => store(editor)?.zoomTo(100),
  },
  {
    id: "page:zoom-fit",
    label: "docsPage.zoomFit",
    menu: "view",
    shortcut: "Mod+Alt+[",
    run: (editor) => store(editor)?.zoomTo("fit"),
  },
]);

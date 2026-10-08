import type { Imported } from "@/components/docs/docs-editor";
import type { useT } from "@/components/lang-provider";
import { pageRangesLabel } from "@/lib/pdf-pages";

// The import line's words (SPEC.md §29), apart from the page editor so a
// light component (the split pane's document select) can read them without
// loading the editor.

/** The site of an address, without "www.". */
function siteOf(address: string): string {
  try {
    return new URL(address).hostname.replace(/^www\./, "");
  } catch {
    return address;
  }
}

/** Where an import came from, as words: "Imported from" the site (with the
    page's address when it is one); a PDF and its page count, or the pages
    the reader chose of it ("PDF · pages 45–60 of 409"); a text file; or a
    Word file. The import line, and the split pane's document select's
    tooltip (reader-panes.tsx). */
export function importLineParts(imported: Imported, t: ReturnType<typeof useT>): { text: string; href?: string }[] {
  const parts: { text: string; href?: string }[] = [];
  if (imported.origin) {
    const text = t("docsPage.importedFrom", { site: siteOf(imported.origin) });
    parts.push(/^https?:\/\//i.test(imported.origin) ? { text, href: imported.origin } : { text });
  }
  if (imported.kind === "pdf") {
    const n = imported.pages;
    const chosen = imported.pdfPages;
    parts.push({
      text:
        n && chosen
          ? t(chosen.length === 1 && chosen[0][0] === chosen[0][1] ? "docsPage.importPdfPage" : "docsPage.importPdfPages", {
              pages: pageRangesLabel(chosen),
              n,
            })
          : n
            ? t("docsPage.importPdf", { n, s: n === 1 ? "" : "s" })
            : "PDF",
    });
  } else if (imported.kind === "markdown" && !imported.origin) {
    parts.push({ text: t("docsPage.importTextFile") });
  } else if (imported.kind === "docx" && !imported.origin) {
    parts.push({ text: t("docsPage.importWordFile") });
  }
  return parts;
}


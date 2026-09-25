import { DocIcon } from "@/components/docs/icons";
import { pageFrame } from "@/components/docs/page/geometry";
import type { PageSetup } from "@/lib/docs/schema";
import { LANGS } from "@/lib/i18n/config";
import { translatorFor } from "@/lib/i18n/dictionaries";

/** A new blank document's title, in every language: drawn gray. */
export const UNTITLED = new Set(LANGS.flatMap((lang) => (["docsPage.untitled", "panes.untitledDocument"] as const).map((key) => translatorFor(lang)(key))));

/** The page editor's frame (SPEC.md §29) until the editor stands: the title
    row, the toolbar's row, the ruler's row, and an empty page. It keeps
    nothing of the editor's code, so the reader draws it while that loads. */
export function DocsFrame({ title, pageSetup }: { title: string; pageSetup: PageSetup }) {
  const page = pageSetup.pageless ? null : pageFrame(pageSetup);
  return (
    <div className="docs-shell">
      <div className="docs-header">
        <div className="docs-title-row">
          <DocIcon size={26} className="docs-title-icon" />
          <span className={`docs-title-input${UNTITLED.has(title) ? " docs-title-untitled" : ""}`}>{title}</span>
        </div>
        <div className="docs-toolbar" />
        <div className="docs-ruler-row" />
      </div>
      <div className="docs-canvas">
        {page && (
          <div className="docs-page" style={{ width: page.width, height: page.height }}>
            <div className="docs-sheet" style={{ top: 0, height: page.height }} />
          </div>
        )}
      </div>
    </div>
  );
}

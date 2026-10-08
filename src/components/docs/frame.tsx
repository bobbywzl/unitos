import "./frame.css";
import { DocIcon } from "@/components/docs/icons";
import { pageFrame } from "@/components/docs/page/geometry";
import type { PageSetup } from "@/lib/docs/schema";
import { LANGS } from "@/lib/i18n/config";
import { translatorFor } from "@/lib/i18n/dictionaries";

/** A new blank document's title, in every language: drawn gray. */
export const UNTITLED = new Set(LANGS.flatMap((lang) => (["docsPage.untitled", "panes.untitledDocument"] as const).map((key) => translatorFor(lang)(key))));

/** Gray lines where the words will stand, pulsing while the editor loads:
    the pane says it is opening the document, not that it is empty. */
const SKELETON = [96, 100, 92, 100, 64, null, 100, 88, 100, 96, 72];

function Skeleton() {
  return (
    <div className="docs-frame-lines" aria-hidden>
      {/* null: the gap between two paragraphs. */}
      {SKELETON.map((width, i) => (width === null ? <i key={i} /> : <span key={i} style={{ width: `${width}%` }} />))}
    </div>
  );
}

/** The page editor's frame (SPEC.md §29) until the editor stands: the title
    row, the toolbar's row, the ruler's row, and a page with gray lines where
    the words will stand. It keeps nothing of the editor's code, so the
    reader draws it while that loads. A pane of a split view keeps the title
    row's slot empty, as the editor does: its pane header stands there. */
export function DocsFrame({ title, pageSetup, split = false }: { title: string; pageSetup: PageSetup; split?: boolean }) {
  const page = pageSetup.pageless ? null : pageFrame(pageSetup);
  return (
    <div className="docs-shell" aria-busy="true">
      <div className="docs-header">
        {split ? (
          <div className="docs-title-row" data-pane-header-slot aria-hidden="true" />
        ) : (
          <div className="docs-title-row">
            <DocIcon size={26} className="docs-title-icon" />
            <span className={`docs-title-input${UNTITLED.has(title) ? " docs-title-untitled" : ""}`}>{title}</span>
          </div>
        )}
        <div className="docs-toolbar" />
        <div className="docs-ruler-row" />
      </div>
      <div className="docs-canvas">
        {page ? (
          <div className="docs-page" style={{ width: page.width, height: page.height }}>
            <div className="docs-sheet" style={{ top: 0, height: page.height }} />
            <div className="docs-frame-text" style={{ top: page.top, left: page.left, right: page.right }}>
              <Skeleton />
            </div>
          </div>
        ) : (
          <div className="docs-frame-pageless">
            <Skeleton />
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import type { Editor } from "@tiptap/core";
import { useEffect } from "react";
import { useT } from "@/components/lang-provider";
import { OutlineIcon } from "@/components/docs/icons";
import { onInsert } from "@/components/docs/insert/context";
import { goToPlace, placeOf } from "@/components/docs/insert/links";
import { levelsOf, styleOf, TOC_STYLES, type TocStyle } from "@/components/docs/insert/toc";
import { PanelSection, SidePanel, useDocPos, useEditorTick } from "@/components/docs/insert/ui";
import type { TKey } from "@/lib/i18n/dictionaries";

// The table of contents' styles and its options panel, and the page's
// address: a #heading= or #bookmark= in it goes to that place when the
// document opens.

const TOC_STYLE_LABEL: Record<TocStyle, TKey> = {
  plain: "docsInsert.tocPlain",
  dotted: "docsInsert.tocDotted",
  links: "docsInsert.tocLinks",
};

/** The three styles, each drawn small: lines, dots, or blue links. */
export function TocStyles({ current, onPick }: { current?: TocStyle; onPick: (style: TocStyle) => void }) {
  const t = useT();
  return (
    <div className="docs-toc-styles">
      {TOC_STYLES.map((style) => (
        <button
          key={style}
          type="button"
          className="docs-toc-style"
          aria-pressed={current === undefined ? undefined : current === style}
          aria-label={t(TOC_STYLE_LABEL[style])}
          data-tip={t(TOC_STYLE_LABEL[style])}
          onClick={() => onPick(style)}
        >
          <span className={`docs-toc-thumb docs-toc-thumb-${style}`} aria-hidden>
            {[0, 1, 1, 0, 1].map((level, i) => (
              <span key={i} className="docs-toc-thumb-line" data-level={level}>
                <span className="docs-toc-thumb-text" />
                {style !== "links" && <span className="docs-toc-thumb-leader" />}
                {style !== "links" && <span className="docs-toc-thumb-num" />}
              </span>
            ))}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Table of contents options: its style, and which heading levels it lists. */
export function TocOptionsHost({ editor }: { editor: Editor }) {
  const t = useT();
  useEditorTick(editor);
  const [pos, setPos] = useDocPos(editor);
  useEffect(() => onInsert(editor, (e) => e.type === "toc-options" && setPos(e.pos)), [editor, setPos]);
  if (pos === null) return null;
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "tableOfContents") return null;
  const levels = levelsOf(node);
  const set = (attrs: Record<string, unknown>) => editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }));
  return (
    <SidePanel title={t("docsInsert.tocOptions")} icon={<OutlineIcon />} onClose={() => setPos(null)}>
      <PanelSection title={t("docsInsert.formatting")}>
        <TocStyles current={styleOf(node)} onPick={(tocStyle) => set({ tocStyle })} />
      </PanelSection>
      <PanelSection title={t("docsInsert.headingLevels")}>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <label key={n} className="docs-side-check">
            <input
              type="checkbox"
              checked={levels.includes(n)}
              onChange={(e) => {
                const next = e.target.checked ? [...levels, n].sort() : levels.filter((l) => l !== n);
                if (next.length > 0) set({ levels: next });
              }}
            />
            {t("docsInsert.headingN", { n })}
          </label>
        ))}
      </PanelSection>
    </SidePanel>
  );
}

/** #heading=<id> or #bookmark=<id> in the page's address: go there once the
    document is drawn, and again when the address changes. */
export function PlaceFromAddress({ editor }: { editor: Editor }) {
  useEffect(() => {
    const go = () => {
      const place = placeOf(window.location.hash);
      if (place) requestAnimationFrame(() => goToPlace(editor, place));
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [editor]);
  return null;
}

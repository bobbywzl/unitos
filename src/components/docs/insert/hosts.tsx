"use client";

import type { Editor } from "@tiptap/core";
import { useEffect, useState } from "react";
import { useT } from "@/components/lang-provider";
import { OutlineIcon } from "@/components/docs/icons";
import { TOC_STYLE_LABEL, TocThumb } from "@/components/docs/insert/at-menu";
import { onInsert } from "@/components/docs/insert/context";
import { goToPlace, placeOf } from "@/components/docs/insert/links";
import { levelsOf, styleOf, TOC_STYLES } from "@/components/docs/insert/toc";
import { PanelSection, SidePanel, useDocPos, useEditorTick } from "@/components/docs/insert/ui";

// The table of contents' options panel, and the page's address: a
// #heading= or #bookmark= in it goes to that place when the document opens.

/** Table of contents options: its style, and which heading levels it lists. */
export function TocOptionsHost({ editor }: { editor: Editor }) {
  const t = useT();
  useEditorTick(editor);
  const [pos, setPos] = useDocPos(editor);
  const [open, setOpen] = useState({ formatting: true, levels: true });
  useEffect(() => onInsert(editor, (e) => e.type === "toc-options" && setPos(e.pos)), [editor, setPos]);
  if (pos === null) return null;
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "tableOfContents") return null;
  const style = styleOf(node);
  const levels = levelsOf(node);
  const set = (attrs: Record<string, unknown>) => {
    const current = editor.state.doc.nodeAt(pos);
    if (!current) return;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...attrs }));
  };
  return (
    <SidePanel title={t("docsInsert.tocOptions")} icon={<OutlineIcon size={20} />} onClose={() => setPos(null)}>
      <PanelSection title={t("docsInsert.formatting")} open={open.formatting} onToggle={() => setOpen((o) => ({ ...o, formatting: !o.formatting }))}>
        <div className="docs-toc-styles">
          {TOC_STYLES.map((s) => (
            <button
              key={s}
              type="button"
              className="docs-toc-style"
              aria-pressed={style === s}
              aria-label={t(TOC_STYLE_LABEL[s])}
              data-tip={t(TOC_STYLE_LABEL[s])}
              onClick={() => set({ tocStyle: s })}
            >
              <TocThumb style={s} />
            </button>
          ))}
        </div>
      </PanelSection>
      <PanelSection title={t("docsInsert.headingLevels")} open={open.levels} onToggle={() => setOpen((o) => ({ ...o, levels: !o.levels }))}>
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

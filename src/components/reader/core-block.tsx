"use client";

import { CollapseIcon, ExpandIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import type { TKey } from "@/lib/i18n/dictionaries";
import { coreKey } from "@/lib/anchors/core-key";
import { markedText, type Highlight } from "@/components/reader/block-view";

// Collapse (SPEC.md §28): a block shown as its core — what it really says,
// in plain words — in the block's place. The core carries the block's id,
// so a jump from the contents or a flash still finds the block, and
// data-collapsed, which marks its words as the core's, not the block's: a
// selection in them anchors in the collapsed view's layer, and the core
// paints that layer's marks.
// The button beside the block reads it whole or collapses it again. A
// figure, a table, an equation, code, a slide, or a sheet names its kind
// before its core, so the reader knows what was collapsed; a paragraph, a
// list, or a transcript line reads as text.

const KIND_KEY: Partial<Record<string, TKey>> = {
  FIGURE: "reader.coreFigure",
  TABLE: "reader.coreTable",
  EQUATION: "reader.coreEquation",
  CODE: "reader.coreCode",
  SLIDE: "reader.coreSlide",
  SHEET: "reader.coreSheet",
};

export function CoreBlock({
  block,
  core,
  highlights,
  annotated,
}: {
  block: { id: string; type: string };
  core: string;
  /** The collapsed view's marks on this core, under its core key (SPEC.md §28). */
  highlights: Highlight[];
  /** The block's whole text has annotations, which paint on the whole text alone. */
  annotated: boolean;
}) {
  const t = useT();
  const kind = KIND_KEY[block.type];
  return (
    <p data-block-id={block.id} data-collapsed="" className="reader-block reader-core my-4">
      {kind && (
        <span className="reader-core-kind" data-anchor-skip>
          {t(kind)}
        </span>
      )}
      {markedText(coreKey(block.id), core, highlights, t)}
      {annotated && (
        <span className="core-chip core-chip-annotated" data-tip={t("reader.coreAnnotatedTitle")} aria-hidden />
      )}
    </p>
  );
}

/** The button beside every block that has a core: collapses the block to its
    core, or reads it whole, whatever the rest of the article shows. */
export function CoreToggle({ showsCore, onToggle }: { showsCore: boolean; onToggle: () => void }) {
  const t = useT();
  const label = t(showsCore ? "reader.coreExpandTitle" : "reader.coreFoldTitle");
  return (
    <button
      type="button"
      onClick={onToggle}
      data-anchor-skip
      data-track={showsCore ? "collapse-expand" : "collapse-fold"}
      aria-label={label}
      data-tip={label}
      className="absolute top-0.5 -right-8 flex size-6 items-center justify-center rounded-full text-sage-700 opacity-40 transition-opacity group-hover/block:opacity-100 hover:bg-sage-100 hover:opacity-100 focus-visible:opacity-100 print:hidden"
    >
      {showsCore ? <ExpandIcon size={11} /> : <CollapseIcon size={11} />}
    </button>
  );
}

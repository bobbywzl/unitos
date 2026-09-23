"use client";

import { CollapseIcon, ExpandIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import type { TKey } from "@/lib/i18n/dictionaries";

// Collapse (SPEC.md §28): a block shown as its core — what it really says,
// in plain words — in the block's place. The core carries the block's id,
// so a jump from the contents or a flash still finds the block, and
// data-collapsed, so a selection in it opens no tools: no anchor can point
// at words the document does not hold. A click anywhere on the core, or on
// the chip at its end, reads the block whole; the fold chip under a block
// read whole collapses it again. A figure, a table, an equation, code, a
// slide, or a sheet names its kind before its core, so the reader knows
// what was collapsed; a paragraph, a list, or a transcript line reads as
// text.

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
  annotated,
  onToggle,
}: {
  block: { id: string; type: string };
  core: string;
  /** The block has annotations, which paint on its whole text alone. */
  annotated: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const kind = KIND_KEY[block.type];
  // A click that ends a selection of the core's own words belongs to the
  // selection: the reader is copying the core, not opening the block.
  const onClick = (e: React.MouseEvent<HTMLElement>) => {
    const selection = window.getSelection();
    if (
      selection &&
      !selection.isCollapsed &&
      selection.toString().trim() !== "" &&
      e.currentTarget.contains(selection.anchorNode)
    )
      return;
    onToggle();
  };
  return (
    <p
      data-block-id={block.id}
      data-collapsed=""
      onClick={onClick}
      data-track="collapse-expand"
      data-tip={t("reader.coreExpandTitle")}
      className="reader-block reader-core my-4 cursor-pointer"
    >
      {kind && <span className="reader-core-kind">{t(kind)}</span>}
      {core}
      {annotated && (
        <span className="core-chip core-chip-annotated" data-tip={t("reader.coreAnnotatedTitle")} aria-hidden />
      )}
      <span className="core-chip" aria-hidden>
        <ExpandIcon size={9} />
      </span>
    </p>
  );
}

/** The chip under a block read whole in the collapsed article: folds it again. */
export function CoreFold({ onToggle }: { onToggle: () => void }) {
  const t = useT();
  return (
    <div className="reader-core-fold">
      <button
        type="button"
        onClick={onToggle}
        data-track="collapse-fold"
        aria-label={t("reader.coreFoldTitle")}
        data-tip={t("reader.coreFoldTitle")}
        className="flex items-center gap-1 rounded-full bg-sand-100 px-2.5 py-0.5 text-[11px] font-semibold text-sand-600 shadow-soft hover:text-clay-800"
      >
        <CollapseIcon size={11} />
        {t("reader.collapse")}
      </button>
    </div>
  );
}

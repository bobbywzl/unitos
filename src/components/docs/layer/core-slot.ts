// The collapsed view's place in the page (SPEC.md §28, layer/collapse.tsx):
// a unit shown as its core is not drawn (CORE_HIDDEN), and its core stands
// right before it, a widget (.docs-core-slot[data-docs-core="core"]). What
// looks for a node on the page — the pages, a jump — finds its core there.
// No editor library here: the pages, the panels, and the reader load this.

export const CORE_HIDDEN = "docs-core-hidden";

/** The core the collapsed view draws in place of an element's unit, when
    the unit is not drawn; else null. */
export function coreSlotOf(el: Element | null): HTMLElement | null {
  const hidden = el?.closest(`.${CORE_HIDDEN}`) ?? null;
  for (let before = hidden?.previousElementSibling; before?.classList.contains("ProseMirror-widget"); before = before.previousElementSibling) {
    if (before instanceof HTMLElement && before.dataset.docsCore === "core") return before;
  }
  return null;
}

/** The core drawn in place of a block's words, when a collapsed unit hides
    them; else null. Its data-block-id is the unit's id. In the page the
    words stay in the text, not drawn, after their unit's core; in the block
    reader a block shown as its core draws its core alone. */
export function coreHiding(pane: Element, blockId: string): HTMLElement | null {
  const id = CSS.escape(blockId);
  const words = pane.querySelector(`[data-block-id="${id}"]:not([data-collapsed])`);
  if (words) return coreSlotOf(words)?.querySelector<HTMLElement>("[data-collapsed]") ?? null;
  return pane.querySelector<HTMLElement>(`[data-collapsed][data-block-id="${id}"]`);
}

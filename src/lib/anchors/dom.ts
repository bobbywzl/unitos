// DOM-side anchor capture (SPEC.md §5). The reader renders block text verbatim
// except for inline controls — extract chips, comment dots, link chains —
// marked [data-anchor-skip]: their DOM text is not in the stored block text.
// These helpers count offsets over the anchorable text only, so a captured
// anchor is exactly the text the reader selected.

const SKIP = "[data-anchor-skip]";

/** The block's anchorable text: every text node except those inside skipped
    inline controls. In reading mode this equals the stored block text. */
export function anchorableText(block: HTMLElement): string {
  let out = "";
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n as Text;
    if (text.parentElement?.closest(SKIP)) continue;
    out += text.data;
  }
  return out;
}

/** Anchorable text length strictly before the boundary (container, offset).
    A boundary inside a skipped control clamps to the text before it. */
export function anchorableOffset(block: HTMLElement, container: Node, offset: number): number {
  const boundary = document.createRange();
  boundary.selectNodeContents(block);
  try {
    boundary.setEnd(container, offset);
  } catch {
    return 0;
  }
  let total = 0;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n as Text;
    if (text.parentElement?.closest(SKIP)) continue;
    if (text === container) return total + Math.min(offset, text.length);
    // Node ends at or before the boundary → count it whole; past it → done.
    if (boundary.comparePoint(text, text.length) <= 0) total += text.length;
    else break;
  }
  return total;
}

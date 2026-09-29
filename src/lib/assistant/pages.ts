// A handwritten document's pages, for the assistant (SPEC.md §16). A PAGE
// block is its page's picture, and its text "Page N" is the name its page
// anchors find the page by, so it stays; the page's words are the blocks the
// conversion wrote from it, each stamped with its page (Block.page). The
// prompt names them, so "page 2's words" are the blocks listed under page 2.

/** A line per page of a handwritten document: its PAGE block, then the
    blocks that hold its words. None for a document without pages. */
export function pageLines(blocks: { id: string; type: string; page: number | null }[]): string[] {
  const pages = blocks.filter((b) => b.type === "PAGE" && b.page !== null);
  if (pages.length === 0) return [];
  const words = new Map<number, string[]>();
  for (const b of blocks) {
    if (b.type === "PAGE" || b.page === null) continue;
    words.set(b.page, [...(words.get(b.page) ?? []), `[block ${b.id}]`]);
  }
  return pages.map((p) => `Page ${p.page} [block ${p.id}]: ${words.get(p.page!)?.join(", ") ?? "no words converted"}`);
}

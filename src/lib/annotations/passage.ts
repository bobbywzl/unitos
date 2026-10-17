// The quote of an annotation over a passage across blocks (SPEC.md §6): one
// note with one source per block. Its quote is every source's quote in the
// document, one paragraph per block in the document's order, as the create
// route stores a highlight's content (cut at 5000). A highlight whose
// content is that quote, its cut, or one source's quote holds no comment:
// its quote is then its content, so every comparison of the two reads it as
// a pure highlight.

type PassageSource = { blockId: string; startOffset: number; quotedText: string };

/** The passage's quote, or null for an annotation with one source in the
    document (its source's quote says it). `order` gives a block's place in
    the document. */
export function passageQuote(
  content: string,
  sources: readonly PassageSource[],
  order: (blockId: string) => number | undefined,
): string | null {
  if (sources.length < 2) return null;
  const rank = (src: PassageSource) => order(src.blockId) ?? sources.indexOf(src);
  const joined = [...sources]
    .sort((a, b) => rank(a) - rank(b) || a.startOffset - b.startOffset)
    .map((src) => src.quotedText)
    .join("\n\n");
  const pure = content === joined.slice(0, 5000) || sources.some((src) => src.quotedText === content);
  return pure ? content : joined;
}

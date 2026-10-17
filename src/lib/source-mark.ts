// A mark in the text names one source in data-source-id: the smallest anchor
// over its words. Every other anchor over the same words rides along in
// data-source-ids, so a jump to any of them finds the words (a note made with
// Note on this link quotes the link's own words; SPEC.md §5).

/** The space-separated ids of every anchor over a stretch of words. */
export function sourceIdsAttr(anchors: { sourceId?: string | null }[]): string | undefined {
  const ids = [...new Set(anchors.flatMap((h) => (h.sourceId ? [h.sourceId] : [])))];
  return ids.length > 1 ? ids.join(" ") : undefined;
}

/** The selector for the marks that carry a source, as their named source or one riding along. */
export function sourceMarkSelector(sourceId: string): string {
  const id = CSS.escape(sourceId);
  return `[data-source-id="${id}"], [data-source-ids~="${id}"]`;
}

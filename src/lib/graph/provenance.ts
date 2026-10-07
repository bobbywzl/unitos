// A generated document's provenance link (SPEC.md §22): the link Stitch
// stores from each generated block, whole, to the passage it came from. It is
// a stored, accepted DocLink like any other, so every paragraph of the page
// clicks back to its source; the graph and the source document tell it
// apart from the reader's own links (SPEC.md §13): no curve, no count, and no
// underline in the source's text unless the reader asks for them.

export type ProvenanceShape = {
  recommended: boolean;
  reason: string | null;
  startOffset: number;
  prefix: string;
  suffix: string;
};

/** True for the link Stitch wrote from a block of a generated document: the
    whole block as the anchor (offset 0, no prefix or suffix), no reason, and
    accepted. A link the reader draws from a generated page keeps a reason
    or a range inside a block, and stays a reader link. */
export function isProvenanceLink(link: ProvenanceShape, fromGenerated: boolean): boolean {
  return fromGenerated && !link.recommended && link.reason === null && link.startOffset === 0 && link.prefix === "" && link.suffix === "";
}

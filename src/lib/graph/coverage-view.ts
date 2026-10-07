// What the reader's notes cover (SPEC.md §13, VIEW4-01): the shape GET
// .../graph/coverage answers (lib/graph/coverage.ts reads it), and the share a
// node's ring draws. Pure: the browser imports it.

/** Whether an annotation (a note of the hidden Annotations section: a
    highlight, a comment, a tool's output) counts as covering its part. Off:
    a part is noted when the reader's own note quotes it; annotations count
    apart, in `annotated`. */
export const COVERAGE_COUNTS_ANNOTATIONS = false;

export type PartCoverage = { blockId: string; noted: number; annotated: number };
export type DocumentCoverage = {
  parts: PartCoverage[];
  /** Distinct notes with a source in the document, wherever it lies. */
  notes: number;
  /** The account has a reading position in the document, or wrote a note
      in it or quoting it. */
  opened: boolean;
};
export type ProjectCoverage = { documents: Record<string, DocumentCoverage> };

/** A document's share of parts noted, 0..1; for a document with no parts,
    1 when a note quotes it, else 0. */
export function notedShare(c: DocumentCoverage): number {
  if (c.parts.length === 0) return c.notes > 0 ? 1 : 0;
  return c.parts.filter((p) => p.noted > 0).length / c.parts.length;
}

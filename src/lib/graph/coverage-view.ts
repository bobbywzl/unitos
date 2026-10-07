// What the reader's notes cover (SPEC.md §13, VIEW4-01): the shape GET
// .../graph/coverage answers (lib/graph/coverage.ts reads it), and the share a
// node's ring draws, [layer5] and the pure rules of the reader's layer:
// gapReasons, waitsForReply. Pure: the browser imports it.

/** Whether an annotation (a note of the hidden Annotations section: a
    highlight, a comment, a tool's output) counts as covering its part. Off:
    a part is noted when the reader's own note quotes it; annotations count
    apart, in `annotated`. */
export const COVERAGE_COUNTS_ANNOTATIONS = false;

/** [layer5] Whether a comment (an annotation of the reader's own words: no
    tool, no highlight color) covers its part like a note (VIEW5-01). SPEC §7
    calls a comment a note. Pending with Linda; on until she answers. Off:
    comments count apart, in `annotated`, as highlights and tool outputs do. */
export const COVERAGE_COUNTS_COMMENTS = true;

/** [layer5] One comment on a document, for the graph (VIEW5-01): its words
    (the first 280 characters), where it sits, whether it is open (not
    resolved), its replies, and whether its words end in a question mark. */
export type GraphComment = {
  id: string;
  sourceId: string;
  blockId: string;
  text: string;
  open: boolean;
  replies: number;
  /** The words end with "?" or "？": the node's chip and the row draw a "?". */
  asks: boolean;
};

/** blockId: the part's start block. whole: the document has no parts, and
    this one part is the whole document (WALK5-06; blockId is ""). */
export type PartCoverage = { blockId: string; noted: number; annotated: number; whole?: true };
export type DocumentCoverage = {
  parts: PartCoverage[];
  /** Distinct notes with a source in the document, wherever it lies. */
  notes: number;
  /** The account has a reading position in the document, or wrote a note
      in it or quoting it. */
  opened: boolean;
  /** [layer5] The comments on the document: open first, then in reading
      order. Absent in an answer from before the field existed. */
  comments?: GraphComment[];
};
export type ProjectCoverage = { documents: Record<string, DocumentCoverage> };

/** A reply as waitsForReply reads it. */
type ReplyLike = { userId: string; resolvedById: string | null; createdAt: string };


/** A document's share of parts noted, 0..1; for a document with no parts
    (an answer from before the whole-document part), 1 when a note quotes
    it, else 0. */
export function notedShare(c: DocumentCoverage): number {
  if (c.parts.length === 0) return c.notes > 0 ? 1 : 0;
  return c.parts.filter((p) => p.noted > 0).length / c.parts.length;
}

/** [layer5] The open comments of a document. */
export function openComments(c: DocumentCoverage | null | undefined): GraphComment[] {
  return (c?.comments ?? []).filter((x) => x.open);
}

/** [layer5] Whether a comment's words end with a question mark (en or zh). */
export function commentAsks(text: string): boolean {
  return /[?？]\s*$/.test(text);
}

/** [layer5] A link waiting for this account's reply (WALK5-07): no reply
    at all, or its last open reply is another person's (a thread whose
    replies are all resolved is closed). The Links list's No
    reply and the head's count keep these; a reader alone never waits on
    her own words. */
export function waitsForReply(link: { replies?: ReplyLike[] }, myId: string): boolean {
  const all = link.replies ?? [];
  const open = all.filter((r) => r.resolvedById === null);
  if (open.length === 0) return all.length === 0;
  const last = open.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
  return myId !== "" && last.userId !== myId;
}

/** [layer5] Why Gaps only keeps a document (WALK5-06), in this order: Not
    opened, then the parts no note quotes (a document with no parts is one
    part, the whole document). Empty: no gap. */
export type GapReason = { kind: "notOpened" } | { kind: "parts"; n: number; m: number } | { kind: "whole" };
export function gapReasons(c: DocumentCoverage | null): GapReason[] {
  if (!c) return [];
  const out: GapReason[] = [];
  if (!c.opened) out.push({ kind: "notOpened" });
  const empty = c.parts.filter((p) => p.noted === 0).length;
  if (c.parts.length === 1 && c.parts[0].whole) {
    if (empty > 0) out.push({ kind: "whole" });
  } else if (empty > 0) out.push({ kind: "parts", n: empty, m: c.parts.length });
  return out;
}


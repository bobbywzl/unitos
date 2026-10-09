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
    resolved), its replies, [lists8] who wrote it and who wrote its last
    open words (WALK8-01). */
export type GraphComment = {
  id: string;
  sourceId: string;
  blockId: string;
  text: string;
  open: boolean;
  replies: number;
  /** [lists8] The account that wrote the comment; null for a row from
      before authors were kept. */
  authorId: string | null;
  /** [lists8] Who wrote the thread's last open words: its last open reply's
      author, else the comment's (WALK8-01). commentWaits reads it. */
  lastById: string | null;
  /** [lists9] The newest reply of the thread, resolved or not (WALK9-01,
      WALK9-04): its author, its first 140 characters, when it was written,
      whether it is resolved. null when the comment has no reply; absent in
      an answer from before the field existed. */
  newest?: { userId: string | null; text: string; createdAt: string; resolved: boolean } | null;
  /** [lists9] Open replies (not resolved), so a row says open and resolved
      apart (WALK9-04). Absent in an answer from before the field existed. */
  openReplies?: number;
  /** [lists9] When the comment was written (WALK9-06). Absent in an answer
      from before the field existed. */
  createdAt?: string;
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

/** [lists8] WALK8-01: a comment waits on this account when it is open and
    its last open words (its last open reply, else the comment) are another
    person's: the rule waitingReply keeps for a link. The node's chip, the
    row and the card draw a "?" on these; the Documents head counts them. */
export function commentWaits(c: Pick<GraphComment, "open" | "lastById">, myId: string): boolean {
  return c.open && myId !== "" && c.lastById !== null && c.lastById !== myId;
}

/** [layer5] A link waiting for this account's reply. [lists7] WALK7-04: only
    a link whose last open reply is another person's (waitingReply); a link
    with no reply waits on no one, and a thread whose replies are all
    resolved is closed. The Links list's Waiting on you and the Documents
    head's count keep these; a reader alone never waits on her own words. */
export function waitsForReply(link: { replies?: ReplyLike[] }, myId: string): boolean {
  return waitingReply(link, myId) !== null;
}

/** [panel6] The reply a link waits on (WALK6-06): its last open reply when
    another person wrote it; null when the link waits on no one's question
    (no reply, or the last open one is this account's). */
export function waitingReply<R extends ReplyLike>(link: { replies?: R[] }, myId: string): R | null {
  const open = (link.replies ?? []).filter((r) => r.resolvedById === null);
  if (open.length === 0 || myId === "") return null;
  const last = open.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
  return last.userId !== myId ? last : null;
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


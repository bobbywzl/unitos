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
    resolved), its replies, [lists8] who wrote it and whose words its thread
    waits on (WALK8-01), [lists9] its newest reply (WALK9-01, WALK9-04). */
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
  /** [lists8] Whose words the thread waits on others to answer (WALK8-01;
      [lists9] WALK9-01, WALK9-09): the newest reply's author when that
      reply is not resolved, the comment's author when it has no reply;
      null when the newest reply is resolved, or when those words are by an
      account that is neither the owner nor a collaborator. commentWaits
      reads it. */
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
export type ProjectCoverage = {
  documents: Record<string, DocumentCoverage>;
  /** [lists9] The accounts a thread can wait on: the owner and the
      collaborators that have an account (WALK9-09). Absent in an answer
      from before the field existed: then every author counts. */
  members?: string[];
};

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

/** [lists8] WALK8-01, [lists9] WALK9-01/02/09: one waiting rule for comments
    and links. The thread's newest reply decides, resolved or not: resolved,
    nobody waits; else the thread waits on everyone but its author. A comment
    with no reply waits on everyone but its author. Nobody waits on words by
    an account outside the project (members, when the answer carries them),
    and nothing waits on an account that cannot reply (the hooks in
    coverage.tsx answer false for a viewer). Reads `newest` when the answer
    carries it, else `lastById`. The node's chip, the row and the card draw
    a "?" on these; the Documents head counts them. */
export function commentWaits(
  c: Pick<GraphComment, "open" | "lastById"> & Partial<Pick<GraphComment, "authorId" | "newest">>,
  myId: string,
  members?: ReadonlySet<string>,
): boolean {
  if (!c.open || myId === "") return false;
  const by =
    c.newest === undefined ? c.lastById : c.newest === null ? (c.authorId ?? null) : c.newest.resolved ? null : c.newest.userId;
  return by !== null && by !== myId && (members === undefined || members.has(by));
}

/** [layer5] A link waiting for this account's reply (waitingReply). The
    Links list's Waiting on you and the Documents head's count keep these; a
    reader alone never waits on her own words. */
export function waitsForReply(link: { replies?: ReplyLike[] }, myId: string, members?: ReadonlySet<string>): boolean {
  return waitingReply(link, myId, members) !== null;
}

/** [panel6] The reply a link waits on (WALK6-06; [lists9] WALK9-01/09: the
    newest reply decides, resolved or not, the rule commentWaits keeps for a
    comment): the newest reply when it is not resolved and another person's
    (one of the project's, when members are known); null when the link waits
    on no one (no reply; the newest reply resolved, this account's, or by an
    account outside the project). */
export function waitingReply<R extends ReplyLike>(link: { replies?: R[] }, myId: string, members?: ReadonlySet<string>): R | null {
  const replies = link.replies ?? [];
  if (replies.length === 0 || myId === "") return null;
  const newest = replies.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
  if (newest.resolvedById !== null || newest.userId === myId) return null;
  return members === undefined || members.has(newest.userId) ? newest : null;
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


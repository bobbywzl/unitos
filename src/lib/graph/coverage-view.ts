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

/** [cost10] A document's coverage as GET …/graph/coverage?parts=counts
    answers it (COST10-03): the counts in the part titles' order and the
    hash of the parts' block ids, no ids — the titles answer carries them
    in the same order. `parts` as before for a document with no parts (one
    part, the whole document) and when the titles' order is not known. */
export type DocumentCoverageWire = Omit<DocumentCoverage, "parts"> & {
  parts?: PartCoverage[];
  /** [noted, annotated] per part, in the titles' order. */
  p?: [number, number][];
  /** partIdsHash of the parts' block ids, in the same order. */
  h?: string;
  /** [noted, annotated] of a document with no parts: its one part, the
      whole document. */
  w?: [number, number];
};
export type ProjectCoverageWire = Omit<ProjectCoverage, "documents"> & { documents: Record<string, DocumentCoverageWire> };

/** A reply as waitsForReply reads it. */
type ReplyLike = { userId: string; resolvedById: string | null; createdAt: string };

/** [cost10] The key that says two lists of part ids are one list
    (COST10-03): their count and FNV-1a (32 bits) of the ids joined, base
    36. The server writes it (compactCoverage), the browser checks it
    against the titles' ids (expandCoverage). */
export function partIdsHash(ids: readonly string[]): string {
  let h = 0x811c9dc5;
  const s = ids.join("\n");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${ids.length}.${h.toString(36)}`;
}

/** [cost10] The compact form of a coverage answer (COST10-03). idsOf: a
    document's part ids in the titles' order. A document with no parts
    carries its one part's counts (`w`); a document keeps today's `parts`
    when its titles' ids and its parts' ids are not one list. */
export function compactCoverage(full: ProjectCoverage, idsOf: (documentId: string) => readonly string[] | undefined): ProjectCoverageWire {
  const documents: Record<string, DocumentCoverageWire> = {};
  for (const [id, d] of Object.entries(full.documents)) {
    const { parts, ...rest } = d;
    if (parts.length === 1 && parts[0].whole) {
      documents[id] = { ...rest, w: [parts[0].noted, parts[0].annotated] };
      continue;
    }
    const byId = new Map(parts.map((p) => [p.blockId, p]));
    const ids = (idsOf(id) ?? []).filter((x) => byId.has(x));
    const oneList = !parts.some((p) => p.whole) && ids.length === parts.length && new Set(ids).size === parts.length;
    documents[id] = oneList
      ? {
          ...rest,
          p: ids.map((x) => {
            const part = byId.get(x);
            return [part?.noted ?? 0, part?.annotated ?? 0];
          }),
          h: partIdsHash(ids),
        }
      : { ...rest, parts };
  }
  return { ...full, documents };
}

/** [cost10] Today's shape from the compact one (COST10-03): a document's
    counts paired with its part ids when their hash is `h`. A document whose
    known ids are another list (the titles answer older or newer than this
    one) is in `mismatched`: its parts come from a full answer; until then,
    and for a document whose ids are not known yet, its counts carry no id
    (blockId ""), so the head, the row and the ring draw and the dots wait. */
export function expandCoverage(
  wire: ProjectCoverageWire,
  idsOf: (documentId: string) => readonly string[] | undefined,
): { coverage: ProjectCoverage; mismatched: string[] } {
  const documents: Record<string, DocumentCoverage> = {};
  const mismatched: string[] = [];
  for (const [id, d] of Object.entries(wire.documents)) {
    const { p, h, w, parts, ...rest } = d;
    if (parts) {
      documents[id] = { parts, ...rest };
      continue;
    }
    if (w) {
      documents[id] = { parts: [{ blockId: "", noted: w[0], annotated: w[1], whole: true }], ...rest };
      continue;
    }
    const counts = p ?? [];
    const ids = idsOf(id);
    const paired = ids !== undefined && ids.length === counts.length && partIdsHash(ids) === h;
    if (ids !== undefined && !paired) mismatched.push(id);
    documents[id] = {
      parts: counts.map(([noted, annotated], i) => ({ blockId: paired ? ids[i] : "", noted, annotated })),
      ...rest,
    };
  }
  return { coverage: { ...wire, documents }, mismatched };
}


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


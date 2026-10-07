import { db } from "@/lib/db";
import { partAt } from "@/lib/graph/outline";
import { projectPartTitles } from "@/lib/graph/outline-titles";
import {
  COVERAGE_COUNTS_ANNOTATIONS,
  COVERAGE_COUNTS_COMMENTS,
  commentAsks,
  type DocumentCoverage,
  type GraphComment,
  type ProjectCoverage,
} from "@/lib/graph/coverage-view";

export { COVERAGE_COUNTS_ANNOTATIONS, COVERAGE_COUNTS_COMMENTS, notedShare, type DocumentCoverage, type PartCoverage, type ProjectCoverage } from "@/lib/graph/coverage-view";

// What the reader's notes cover, for the graph (SPEC.md §13, VIEW4-01): per
// document, each part (the Documents list's parts: lib/graph/outline-titles.ts)
// with the notes whose sources lie in it, from the part's start block to the
// next part's start; the notes that quote the document at all; and whether
// the account ever opened it. A document with no parts is one part, the
// whole document (WALK5-06). [layer5] Each document's comments too, the
// reader's own words beside the notes (VIEW5-01). Read only, never a model
// call, stored rows only: the part titles' three queries, then one query
// for the part starts, one for the sources, one for the opened documents,
// and one for the comments.

export async function projectCoverage(notebookId: string, userId: string): Promise<ProjectCoverage> {
  const [titles, attached] = await Promise.all([
    projectPartTitles(notebookId),
    db.notebookDocument.findMany({
      where: { notebookId, document: { generatedCommand: null } },
      select: { documentId: true },
    }),
  ]);
  const docIds = attached.map((a) => a.documentId);
  if (docIds.length === 0) return { documents: {} };
  const startIds = docIds.flatMap((id) => (titles.documents[id] ?? []).map((p) => p.blockId));
  const [starts, sources, opened, commentRows] = await Promise.all([
    startIds.length > 0
      ? db.block.findMany({ where: { id: { in: startIds } }, select: { id: true, order: true } })
      : Promise.resolve([]),
    // Every live source of a note of the project in its documents: rejected
    // notes and side chats aside; an orphaned source has no place to lie in.
    db.$queryRaw<{ documentId: string; order: number; noteId: string; hidden: boolean; comment: boolean }[]>`
      SELECT s."documentId", b."order", s."noteId", sec.hidden,
        (sec.hidden AND n."derivationType" IS NULL AND n.color IS NULL) AS comment
      FROM "Section" sec
      JOIN "Note" n ON n."sectionId" = sec.id
      JOIN "Source" s ON s."noteId" = n.id
      JOIN "Block" b ON b.id = s."blockId" AND b."documentId" = s."documentId"
      WHERE sec."notebookId" = ${notebookId}
        AND n.status <> 'REJECTED'
        AND n."sideChatOfId" IS NULL
        AND s.orphaned = false
        AND s."documentId" = ANY(${docIds})
    `,
    db.$queryRaw<{ documentId: string }[]>`
      SELECT rp."documentId" FROM "ReadingPosition" rp
      WHERE rp."userId" = ${userId} AND rp."documentId" = ANY(${docIds})
      UNION
      SELECT n."documentId" FROM "Note" n JOIN "Section" sec ON sec.id = n."sectionId"
      WHERE sec."notebookId" = ${notebookId} AND n."createdById" = ${userId} AND n."documentId" = ANY(${docIds})
      UNION
      SELECT s."documentId" FROM "Source" s JOIN "Note" n ON n.id = s."noteId" JOIN "Section" sec ON sec.id = n."sectionId"
      WHERE sec."notebookId" = ${notebookId} AND n."createdById" = ${userId} AND s."documentId" = ANY(${docIds})
    `,
    // [layer5] The comments of the project in its documents, one row per
    // comment at its first live source (VIEW5-01): an annotation with no
    // tool and no highlight color, the rule of annotationKind.
    db.$queryRaw<
      { id: string; content: string; open: boolean; replies: number; sourceId: string; documentId: string; blockId: string; order: number }[]
    >`
      SELECT DISTINCT ON (n.id) n.id, left(n.content, 280) AS content, n."resolvedById" IS NULL AS open,
        (SELECT count(*)::int FROM "Reply" r WHERE r."noteId" = n.id) AS replies,
        s.id AS "sourceId", s."documentId", s."blockId", b."order"
      FROM "Section" sec
      JOIN "Note" n ON n."sectionId" = sec.id
      JOIN "Source" s ON s."noteId" = n.id
      JOIN "Block" b ON b.id = s."blockId" AND b."documentId" = s."documentId"
      WHERE sec."notebookId" = ${notebookId} AND sec.hidden
        AND n."derivationType" IS NULL AND n.color IS NULL
        AND n.status <> 'REJECTED' AND n."sideChatOfId" IS NULL
        AND s.orphaned = false AND s."documentId" = ANY(${docIds})
      ORDER BY n.id, b."order", s.id
    `,
  ]);
  const commentsOf = new Map<string, GraphComment[]>();
  const commentOrder = new Map<string, number>();
  for (const c of commentRows) {
    const text = c.content.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const row: GraphComment = { id: c.id, sourceId: c.sourceId, blockId: c.blockId, text, open: c.open, replies: c.replies, asks: commentAsks(text) };
    commentOrder.set(c.id, c.order);
    commentsOf.set(c.documentId, [...(commentsOf.get(c.documentId) ?? []), row]);
  }
  const orderOf = new Map(starts.map((b) => [b.id, b.order]));
  const openedIds = new Set(opened.map((r) => r.documentId));
  const sourcesOf = new Map<string, typeof sources>();
  for (const s of sources) sourcesOf.set(s.documentId, [...(sourcesOf.get(s.documentId) ?? []), s]);

  const documents: Record<string, DocumentCoverage> = {};
  for (const id of docIds) {
    // The parts in reading order; a part whose start block is gone drops.
    const titled = (titles.documents[id] ?? [])
      .filter((p) => orderOf.has(p.blockId))
      .sort((a, b) => (orderOf.get(a.blockId) ?? 0) - (orderOf.get(b.blockId) ?? 0));
    // A document with no parts is one part, the whole document (WALK5-06):
    // its one start lies before every block.
    const whole = titled.length === 0;
    const parts = whole ? [{ blockId: "" }] : titled;
    const partOrders = whole ? [Number.NEGATIVE_INFINITY] : parts.map((p) => orderOf.get(p.blockId) ?? 0);
    const noted = parts.map(() => new Set<string>());
    const annotated = parts.map(() => new Set<string>());
    const quoting = new Set<string>();
    for (const s of sourcesOf.get(id) ?? []) {
      const counts = COVERAGE_COUNTS_ANNOTATIONS || !s.hidden || (COVERAGE_COUNTS_COMMENTS && s.comment);
      if (counts) quoting.add(s.noteId);
      // A source before the first part lies in the first part: the words
      // before a document's first heading open it.
      const at = Math.max(0, partAt(partOrders, s.order));
      if (at >= parts.length) continue;
      (counts ? noted : annotated)[at]?.add(s.noteId);
    }
    documents[id] = {
      parts: parts.map((p, i) => ({
        blockId: p.blockId,
        noted: noted[i].size,
        annotated: annotated[i].size,
        ...(whole ? { whole: true as const } : {}),
      })),
      notes: quoting.size,
      opened: openedIds.has(id),
      comments: (commentsOf.get(id) ?? [])
        .sort((a, b) => Number(b.open) - Number(a.open) || (commentOrder.get(a.id) ?? 0) - (commentOrder.get(b.id) ?? 0)),
    };
  }
  return { documents };
}

import { db } from "@/lib/db";
import { partAt } from "@/lib/graph/outline";
import { projectPartTitles } from "@/lib/graph/outline-titles";
import { COVERAGE_COUNTS_ANNOTATIONS, type DocumentCoverage, type ProjectCoverage } from "@/lib/graph/coverage-view";

export { COVERAGE_COUNTS_ANNOTATIONS, notedShare, type DocumentCoverage, type PartCoverage, type ProjectCoverage } from "@/lib/graph/coverage-view";

// What the reader's notes cover, for the graph (SPEC.md §13, VIEW4-01): per
// document, each part (the Documents list's parts: lib/graph/outline-titles.ts)
// with the notes whose sources lie in it, from the part's start block to the
// next part's start; the notes that quote the document at all; and whether
// the account ever opened it. Read only, never a model call, stored rows
// only: the part titles' three queries, then one query for the part starts,
// one for the sources, and one for the opened documents.

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
  const [starts, sources, opened] = await Promise.all([
    startIds.length > 0
      ? db.block.findMany({ where: { id: { in: startIds } }, select: { id: true, order: true } })
      : Promise.resolve([]),
    // Every live source of a note of the project in its documents: rejected
    // notes and side chats aside; an orphaned source has no place to lie in.
    db.$queryRaw<{ documentId: string; order: number; noteId: string; hidden: boolean }[]>`
      SELECT s."documentId", b."order", s."noteId", sec.hidden
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
  ]);
  const orderOf = new Map(starts.map((b) => [b.id, b.order]));
  const openedIds = new Set(opened.map((r) => r.documentId));
  const sourcesOf = new Map<string, typeof sources>();
  for (const s of sources) sourcesOf.set(s.documentId, [...(sourcesOf.get(s.documentId) ?? []), s]);

  const documents: Record<string, DocumentCoverage> = {};
  for (const id of docIds) {
    // The parts in reading order; a part whose start block is gone drops.
    const parts = (titles.documents[id] ?? [])
      .filter((p) => orderOf.has(p.blockId))
      .sort((a, b) => (orderOf.get(a.blockId) ?? 0) - (orderOf.get(b.blockId) ?? 0));
    const partOrders = parts.map((p) => orderOf.get(p.blockId) ?? 0);
    const noted = parts.map(() => new Set<string>());
    const annotated = parts.map(() => new Set<string>());
    const quoting = new Set<string>();
    for (const s of sourcesOf.get(id) ?? []) {
      const counts = COVERAGE_COUNTS_ANNOTATIONS || !s.hidden;
      if (counts) quoting.add(s.noteId);
      // A source before the first part lies in the first part: the words
      // before a document's first heading open it.
      const at = Math.max(0, partAt(partOrders, s.order));
      if (at >= parts.length) continue;
      (counts ? noted : annotated)[at]?.add(s.noteId);
    }
    documents[id] = {
      parts: parts.map((p, i) => ({ blockId: p.blockId, noted: noted[i].size, annotated: annotated[i].size })),
      notes: quoting.size,
      opened: openedIds.has(id),
    };
  }
  return { documents };
}

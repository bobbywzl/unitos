import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

// Documents in no project (SPEC.md §6). Deleting a project takes its
// sections and notes; a document only that project held stays whole, in no
// project. The Library lists such a document for the account that read or
// wrote in it, so it is never out of reach: Add a document › Library puts it
// in a project again. Nothing here deletes a document.

/** The documents `notebookId` holds that no other project holds: the ones a
    delete of the project would leave in no project. */
export async function documentsOnlyIn(notebookId: string): Promise<{ id: string; title: string }[]> {
  return db.document.findMany({
    where: {
      notebooks: { some: { notebookId }, every: { notebookId } },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true },
  });
}

/** What makes a document in no project the account's, for its Library: the
    account keeps a reading position in it, edited a block of it, saved its
    rich text, saved one of its versions, or made a link from it (a
    generated document's links to its sources are its writer's). */
export function ownTrace(userId: string): Prisma.DocumentWhereInput {
  return {
    notebooks: { none: {} },
    OR: [
      { readingPositions: { some: { userId } } },
      { edits: { some: { userId } } },
      { versions: { some: { userId } } },
      { richTextSavedBy: userId },
      { linksFrom: { some: { createdById: userId } } },
    ],
  };
}

/** Before a project delete: give the deleting account a trace in each
    document the delete leaves in no project, so its Library lists them. The
    trace is a reading position at the document's first block (the top, where
    the document opens anyway), written only where the account keeps none:
    no existing row changes. */
export function keepTraceWrites(userId: string, documentIds: string[]): Prisma.PrismaPromise<unknown>[] {
  if (documentIds.length === 0) return [];
  return [
    db.$executeRaw`
      INSERT INTO "ReadingPosition" ("userId", "documentId", "blockId", "offset", "height", "at")
      SELECT ${userId}, b."documentId", b."id", 0, 0, NOW()
      FROM (
        SELECT DISTINCT ON ("documentId") "documentId", "id"
        FROM "Block" WHERE "documentId" IN (${Prisma.join(documentIds)})
        ORDER BY "documentId", "order" ASC
      ) b
      ON CONFLICT ("userId", "documentId") DO NOTHING`,
  ];
}

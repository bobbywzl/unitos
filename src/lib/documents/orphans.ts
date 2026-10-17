import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

// Documents in no project (SPEC.md §6). Deleting a project takes its
// sections and notes; a document only that project held stays whole, in no
// project. The Library lists such a document for the owner who deleted the
// project and for an account that wrote in it, so it is never out of reach:
// Add a document › Library puts it in a project again. Nothing here deletes
// a document.

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

/** What makes a document in no project the account's, for its Library:
    the account kept it when it deleted the project that held it
    (`KeptDocument`), or it wrote in it — edited a block, saved one of its
    versions, saved its rich text, or made a link from it (a generated
    document's links to its sources are its writer's). Reading is no claim:
    a reading position never lists a document, so one account's document
    never reaches another account's Library past the owner's delete. */
export function ownTrace(userId: string): Prisma.DocumentWhereInput {
  return {
    notebooks: { none: {} },
    OR: [
      { kept: { some: { userId } } },
      { edits: { some: { userId } } },
      { versions: { some: { userId } } },
      { richTextSavedBy: userId },
      { linksFrom: { some: { createdById: userId } } },
    ],
  };
}

/** Before a project delete: the deleting owner keeps each document the
    delete leaves in no project, so the owner's Library lists them. Only new
    `KeptDocument` rows; a pair already kept stays as it is. */
export function keepDocuments(userId: string, documentIds: string[]): Prisma.PrismaPromise<unknown>[] {
  if (documentIds.length === 0) return [];
  return [
    db.keptDocument.createMany({
      data: documentIds.map((documentId) => ({ userId, documentId })),
      skipDuplicates: true,
    }),
  ];
}

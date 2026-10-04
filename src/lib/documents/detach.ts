import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

// Detaching a document from a project (SPEC.md §6): the project's
// NotebookDocument row goes, and with it the project's own work on the
// document — its extractions, its matches, its summaries, its salience, its
// formalized article, its folder. That work is kept in the DOCUMENT_DETACH
// history event (`meta.kept`), and adding the document back to the project
// (attachDocument) puts it back. Nothing the reader made in the project is
// lost by a detach.

const KEPT = ["salience", "summaries", "distillations", "extractions", "formalized", "folderId"] as const;

type Kept = Partial<Record<(typeof KEPT)[number], Prisma.JsonValue>>;

type Detach = { notebookId: string; documentId: string; userId: string; title: string };

/** The writes that detach each document from its project, kept work and all:
    one delete and one history event per attachment. Run in one transaction. */
export async function detachWrites(detaches: Detach[]): Promise<Prisma.PrismaPromise<unknown>[]> {
  const writes: Prisma.PrismaPromise<unknown>[] = [];
  for (const d of detaches) {
    const row = await db.notebookDocument.findUnique({
      where: { notebookId_documentId: { notebookId: d.notebookId, documentId: d.documentId } },
    });
    if (!row) continue;
    const kept: Kept = {};
    for (const key of KEPT) {
      const value = row[key];
      if (value !== null && value !== undefined) kept[key] = value as Prisma.JsonValue;
    }
    writes.push(
      db.notebookDocument.delete({
        where: { notebookId_documentId: { notebookId: d.notebookId, documentId: d.documentId } },
      }),
      db.notebookEvent.create({
        data: {
          notebookId: d.notebookId,
          userId: d.userId,
          kind: "DOCUMENT_DETACH",
          content: d.title,
          meta: { documentId: d.documentId, kept } as Prisma.InputJsonValue,
        },
      }),
    );
  }
  return writes;
}

/** The work a detach kept for this project and document, the latest first;
    null when none was kept (a detach made before detaches kept it). */
export async function keptAttachment(notebookId: string, documentId: string): Promise<Kept | null> {
  const event = await db.notebookEvent.findFirst({
    where: { notebookId, kind: "DOCUMENT_DETACH", meta: { path: ["documentId"], equals: documentId } },
    orderBy: { createdAt: "desc" },
    select: { meta: true },
  });
  const kept = (event?.meta as { kept?: unknown } | null)?.kept;
  return kept && typeof kept === "object" && !Array.isArray(kept) ? (kept as Kept) : null;
}

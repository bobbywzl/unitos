import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { keptAttachment } from "@/lib/documents/detach";

// Attach is db-only. It lives apart from the parse chain so routes that only attach
// do not load jsdom/unpdf.
//
// folderId: the folder of this project the new document lands in (SPEC.md
// §6: the + of a folder's list adds a file there). A folder of another
// project, or one deleted meanwhile, lands it at the project itself. A
// document already in the project keeps the place the reader gave it.
//
// A document added back to a project it was removed from gets back the
// project's work on it that the removal kept (lib/documents/detach.ts): its
// extractions, matches, summaries, salience, formalized article, and folder.
export async function attachDocument(notebookId: string, documentId: string, folderId?: string | null) {
  const existing = await db.notebookDocument.findUnique({
    where: { notebookId_documentId: { notebookId, documentId } },
    select: { documentId: true },
  });
  if (existing) return;
  const kept = await keptAttachment(notebookId, documentId);
  const wanted = folderId ?? (typeof kept?.folderId === "string" ? kept.folderId : null);
  const folder = wanted
    ? await db.documentFolder.findFirst({ where: { id: wanted, notebookId }, select: { id: true } })
    : null;
  const json = (value: Prisma.JsonValue | undefined) =>
    value === null || value === undefined ? undefined : (value as Prisma.InputJsonValue);
  await db.notebookDocument.upsert({
    where: { notebookId_documentId: { notebookId, documentId } },
    update: {},
    create: {
      notebookId,
      documentId,
      folderId: folder?.id ?? null,
      salience: json(kept?.salience),
      summaries: json(kept?.summaries),
      distillations: json(kept?.distillations),
      extractions: json(kept?.extractions),
      formalized: json(kept?.formalized),
    },
  });
}

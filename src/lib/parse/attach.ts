import { db } from "@/lib/db";

// Attach is db-only. It lives apart from the parse chain so routes that only attach
// do not load jsdom/unpdf.
//
// folderId: the folder of this project the new document lands in (SPEC.md
// §6: the + of a folder's list adds a file there). A folder of another
// project, or one deleted meanwhile, lands it at the project itself. A
// document already in the project keeps the place the reader gave it.
export async function attachDocument(notebookId: string, documentId: string, folderId?: string | null) {
  const folder = folderId
    ? await db.documentFolder.findFirst({ where: { id: folderId, notebookId }, select: { id: true } })
    : null;
  await db.notebookDocument.upsert({
    where: { notebookId_documentId: { notebookId, documentId } },
    update: {},
    create: { notebookId, documentId, folderId: folder?.id ?? null },
  });
}

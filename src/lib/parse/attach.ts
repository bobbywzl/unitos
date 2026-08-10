import { db } from "@/lib/db";

// Attach is db-only. It lives apart from the parse chain so routes that only attach
// do not load jsdom/unpdf.
export async function attachDocument(notebookId: string, documentId: string) {
  await db.notebookDocument.upsert({
    where: { notebookId_documentId: { notebookId, documentId } },
    update: {},
    create: { notebookId, documentId },
  });
}

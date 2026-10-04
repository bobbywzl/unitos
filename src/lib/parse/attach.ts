import { db } from "@/lib/db";
import { samePdfPages, storedPdfPages } from "@/lib/pdf-pages";

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

/** The document of a project that an add made a new copy of. page: the
    match is by web address alone, no file. */
export type SameFileIn = { id: string; title: string; page: boolean };

type AddedDocument = { id: string; title: string; fileHash: string | null; sourceUrl: string | null; pdfPages?: unknown };

/** The document of this project from the same file (the same pages of a
    PDF) or the same web address as the one an add just made, edited since
    its import. Dedupe hands out only an unedited document (SPEC.md §30), so
    the add made a new copy, and the reader is told. Reads only, and only
    this project: the caller can edit it. Null when the add handed out a
    document, or the project holds no such one; the oldest when it holds
    several. */
export async function sameFileIn(
  notebookId: string,
  document: AddedDocument,
  deduped: boolean,
): Promise<SameFileIn | null> {
  if (deduped) return null;
  const same = [
    ...(document.fileHash ? [{ fileHash: document.fileHash }] : []),
    ...(document.sourceUrl ? [{ sourceUrl: document.sourceUrl }] : []),
  ];
  if (same.length === 0) return null;
  const found = await db.document.findMany({
    where: {
      id: { not: document.id },
      notebooks: { some: { notebookId } },
      OR: same,
      importRev: { not: null },
      richTextRev: { gt: db.document.fields.importRev },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, fileHash: true, pdfPages: true },
  });
  // The same file with other pages is another document, no copy.
  const pages = storedPdfPages(document);
  const match = found.find(
    (other) => other.fileHash !== document.fileHash || samePdfPages(storedPdfPages(other), pages),
  );
  return match ? { id: match.id, title: match.title, page: !document.fileHash } : null;
}

/** An add's terminal line: the document, whether dedupe handed it out, and
    the edited document of this project it is a new copy of. The document is
    saved and attached by now: a failed read leaves the notice out, never
    the add. */
export async function addedResult(notebookId: string, document: AddedDocument, deduped: boolean) {
  const same = await sameFileIn(notebookId, document, deduped).catch((err: unknown) => {
    console.warn("[add] same-file check failed:", err);
    return null;
  });
  return { id: document.id, title: document.title, deduped, ...(same ? { sameFileIn: same } : {}) };
}

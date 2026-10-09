import type { Prisma, User } from "@prisma/client";
import { NextResponse } from "next/server";
import { authEnabled } from "@/lib/auth";
import { db } from "@/lib/db";
import { DuplicateDocumentError, type DuplicateMatch } from "@/lib/documents/duplicate-answer";
import { ownTrace } from "@/lib/documents/orphans";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { pdfPagesOf, samePdfPages, storedPdfPages, type PageRange } from "@/lib/pdf-pages";

// Every add is its own document (SPEC.md §15): the same file or the same
// source added again parses again into a new document, never into one
// already stored. Before it does, the add asks the reader when the account
// already has a document with that file or that source. Only the account's
// own documents count, never another account's: the documents in a project
// it owns or collaborates on, and the documents in no project that carry
// its trace (lib/documents/orphans.ts). Sign-in off: one reader, every
// document.

/** What makes two adds the same document: the file's bytes (a PDF's chosen
    pages too: the same file with other pages is another document), the
    page's address (a split page's parts too), or the YouTube video. */
export type DuplicateKey =
  | { fileHash: string; pdfPages?: PageRange[] }
  | { url: string; splitMarker?: string }
  | { youtubeId: string };

/** The projects an account can open: it owns them or collaborates on them. */
function openableBy(user: User): Prisma.NotebookWhereInput {
  return { OR: [{ userId: user.id }, { collaborators: { some: { email: user.email } } }] };
}

/** The account's documents: in a project it can open, or in no project
    with its trace. Sign-in off: every document. */
export function accountDocuments(user: User): Prisma.DocumentWhereInput {
  if (!authEnabled()) return {};
  return { OR: [{ notebooks: { some: { notebook: openableBy(user) } } }, ownTrace(user.id)] };
}

function keyWhere(key: DuplicateKey): Prisma.DocumentWhereInput {
  if ("fileHash" in key) return { fileHash: key.fileHash };
  if ("youtubeId" in key) return { video: { is: { youtubeId: key.youtubeId } } };
  return {
    OR: [
      { sourceUrl: key.url },
      ...(key.splitMarker ? [{ sourceUrl: { startsWith: `${key.url}${key.splitMarker}` } }] : []),
    ],
  };
}

/** The account's documents with this file or this source, the ones in
    `notebookId` first, then the newest. Each names one project the account
    can open that holds it, this one when it does; null: in no project. */
export async function findDuplicates(user: User, notebookId: string, key: DuplicateKey): Promise<DuplicateMatch[]> {
  const found = await db.document.findMany({
    where: { AND: [keyWhere(key), accountDocuments(user)] },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      title: true,
      pdfPages: true,
      notebooks: {
        where: authEnabled() ? { notebook: openableBy(user) } : {},
        select: { notebookId: true, notebook: { select: { title: true } } },
      },
    },
  });
  const wanted = "fileHash" in key ? key.pdfPages : undefined;
  const same = found.filter((document) => {
    if (!("fileHash" in key)) return true;
    const stored = storedPdfPages(document);
    return samePdfPages(stored, pdfPagesOf(wanted, stored?.count ?? Number.MAX_SAFE_INTEGER));
  });
  const holds = (document: (typeof same)[number]) => document.notebooks.some((n) => n.notebookId === notebookId);
  return [...same.filter(holds), ...same.filter((document) => !holds(document))].map((document) => {
    const where = document.notebooks.find((n) => n.notebookId === notebookId) ?? document.notebooks[0] ?? null;
    return {
      id: document.id,
      title: document.title,
      notebookId: where?.notebookId ?? null,
      notebookTitle: where?.notebook.title ?? null,
    };
  });
}

/** Before an add whose file or source is known up front: the 409 that asks
    the reader, or null when the add may run (no match, or confirmed). */
export async function duplicateAnswer(
  user: User,
  notebookId: string,
  key: DuplicateKey,
  confirmed: boolean,
  t: TFunc,
): Promise<NextResponse | null> {
  if (confirmed) return null;
  const documents = await findDuplicates(user, notebookId, key);
  if (documents.length === 0) return null;
  return NextResponse.json({ error: t("api.duplicateDocument"), duplicate: { documents } }, { status: 409 });
}

/** Inside an add's stream, once the file is known (a Drive download):
    throws the ask, which the stream's last line carries
    (lib/ingest-response.ts). */
export async function assertNotDuplicate(
  user: User,
  notebookId: string,
  key: DuplicateKey,
  confirmed: boolean,
  t: TFunc,
): Promise<void> {
  if (confirmed) return;
  const documents = await findDuplicates(user, notebookId, key);
  if (documents.length > 0) throw new DuplicateDocumentError(t("api.duplicateDocument"), documents);
}

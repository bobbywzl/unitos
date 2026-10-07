import type { Prisma } from "@prisma/client";

// A link belongs to the project it was made in (DocLink.notebookId, SPEC.md
// §13). A document row can sit in several projects of several accounts, so a
// project reads only its own links. A link made before links carried a
// project (notebookId null) shows in every project that holds both
// documents, as it did (rule zero item 4). A link whose project was deleted
// (formerNotebookId set) is kept and shows nowhere. A link removed from a
// project while its row stays (DocLinkHidden: another account replied on it,
// or another account's project shows it) is kept and shows nowhere in that
// project. The access gate for one link is linkAccess in lib/collab.ts.

/** The links one project reads: its own and the ones with no project, less
    the ones removed from it. `withHidden` keeps the removed ones: a scan
    that skips links that exist must not propose a removed one again. */
export function projectLinks(notebookId: string, opts?: { withHidden?: boolean }): Prisma.DocLinkWhereInput {
  const scope: Prisma.DocLinkWhereInput = { OR: [{ notebookId }, { notebookId: null, formerNotebookId: null }] };
  return opts?.withHidden ? scope : { ...scope, hiddenIn: { none: { notebookId } } };
}

/** The route of one link, asked from one project: a link of another project
    is not found there. */
export function linkPath(linkId: string, notebookId: string | undefined): string {
  const path = `/api/links/${encodeURIComponent(linkId)}`;
  return notebookId ? `${path}?notebookId=${encodeURIComponent(notebookId)}` : path;
}

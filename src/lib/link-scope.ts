import type { Prisma } from "@prisma/client";

// A link belongs to the project it was made in (DocLink.notebookId, SPEC.md
// §13). A document row can sit in several projects of several accounts, so a
// project reads only its own links. A link made before links carried a
// project (notebookId null) shows in every project that holds both
// documents, as it did (rule zero item 4). The access gate for one link is
// linkAccess in lib/collab.ts.

/** The links one project reads: its own and the ones with no project. */
export function projectLinks(notebookId: string): Prisma.DocLinkWhereInput {
  return { OR: [{ notebookId }, { notebookId: null }] };
}

/** The route of one link, asked from one project: a link of another project
    is not found there. */
export function linkPath(linkId: string, notebookId: string | undefined): string {
  const path = `/api/links/${encodeURIComponent(linkId)}`;
  return notebookId ? `${path}?notebookId=${encodeURIComponent(notebookId)}` : path;
}

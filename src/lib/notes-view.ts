import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { NoteView, ReplyView, SectionView } from "@/lib/types";

// The project's sections and notes as the workspace reads them (SPEC.md §6,
// §13): one query shape and one mapping for the page
// (app/n/[notebookId]/page.tsx) and for GET …/notes-view, which the graph
// reads while it is open in place of a page refresh (COST10-04,
// components/collab/use-sync.ts). Read only.

/** The sections query the page and the route share: every section with its
    live notes, each note's sources (with the document's title) and replies. */
export const sectionsInclude = Prisma.validator<Prisma.Notebook$sectionsArgs>()({
  orderBy: { order: "asc" },
  include: {
    notes: {
      where: { status: { not: "REJECTED" } },
      orderBy: { order: "asc" },
      include: {
        sources: { include: { document: { select: { id: true, title: true } } } },
        replies: { orderBy: { createdAt: "asc" } },
      },
    },
  },
});

export type SectionRow = Prisma.SectionGetPayload<{ include: (typeof sectionsInclude)["include"] }>;
export type NoteRow = SectionRow["notes"][number];
export type SourceRow = NoteRow["sources"][number];

export function replyViews(replies: NoteRow["replies"]): ReplyView[] {
  return replies.map((r) => ({
    id: r.id,
    content: r.content,
    userId: r.userId,
    resolvedById: r.resolvedById,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** orphanedOf: whether a source is orphaned; the page answers from the open
    panes' anchor resolution, the stored flag otherwise. */
export function noteView(n: NoteRow, orphanedOf: (src: SourceRow) => boolean = (src) => src.orphaned): NoteView {
  return {
    id: n.id,
    content: n.content,
    gist: n.gist,
    status: n.status,
    derivationType: n.derivationType,
    pinned: n.pinned,
    order: n.order,
    createdById: n.createdById,
    updatedAt: n.updatedAt.toISOString(),
    createdAt: n.createdAt.toISOString(),
    documentId: n.documentId,
    sources: n.sources.map((src) => ({
      id: src.id,
      documentId: src.documentId ?? "",
      documentTitle: src.document?.title ?? "",
      quotedText: src.quotedText,
      orphaned: orphanedOf(src),
    })),
    replies: replyViews(n.replies),
  };
}

/** One section with its notes; children are filled by sectionTree. */
export function sectionView(s: SectionRow, orphanedOf?: (src: SourceRow) => boolean): SectionView {
  return {
    id: s.id,
    title: s.title,
    order: s.order,
    parentId: s.parentId,
    notes: s.notes.map((n) => noteView(n, orphanedOf)),
    children: [],
  };
}

/** The outline's tree: the top sections with their children. A hidden
    section (Annotations) is the rail's, not the outline's. */
export function sectionTree(rows: SectionRow[], orphanedOf?: (src: SourceRow) => boolean): SectionView[] {
  const byParent = new Map<string | null, SectionView[]>();
  for (const s of rows) {
    if (s.hidden) continue;
    const list = byParent.get(s.parentId) ?? [];
    list.push(sectionView(s, orphanedOf));
    byParent.set(s.parentId, list);
  }
  const top = byParent.get(null) ?? [];
  for (const s of top) s.children = byParent.get(s.id) ?? [];
  return top;
}

/** The project's sections and notes, as the page renders them; null when
    the project is gone. */
export async function notesView(notebookId: string): Promise<SectionView[] | null> {
  const notebook = await db.notebook.findUnique({ where: { id: notebookId }, select: { sections: sectionsInclude } });
  return notebook ? sectionTree(notebook.sections) : null;
}

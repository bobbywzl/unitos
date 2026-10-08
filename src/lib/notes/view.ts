import { db } from "@/lib/db";
import type { NoteView } from "@/lib/types";

/** A note as the outline draws it — the notes pages' own shape — and its
    section: the restore route answers with it, so the tray shows a
    restored note at once, without waiting for the page's data. Null for a
    note that is not there or that the outline does not list (rejected). */
export async function noteViewOf(id: string): Promise<{ note: NoteView; sectionId: string } | null> {
  const n = await db.note.findUnique({
    where: { id },
    include: {
      sources: { include: { document: { select: { id: true, title: true } } } },
      replies: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!n || n.status === "REJECTED") return null;
  return {
    sectionId: n.sectionId,
    note: {
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
        orphaned: src.orphaned,
      })),
      replies: n.replies.map((r) => ({
        id: r.id,
        content: r.content,
        userId: r.userId,
        resolvedById: r.resolvedById,
        createdAt: r.createdAt.toISOString(),
      })),
    },
  };
}

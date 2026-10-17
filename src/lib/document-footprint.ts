import type { User } from "@prisma/client";
import { authEnabled } from "@/lib/auth";
import { roleOf } from "@/lib/collab";
import { db } from "@/lib/db";
import { ANNOTATIONS_SECTION_TITLE } from "@/lib/derive/config";

// What a document's delete reaches (SPEC.md §5): the annotations that go
// with it, the notes that stay, and the projects involved. The delete route
// acts on it, and the confirm dialog shows it before the reader agrees.
export type DocumentFootprint = {
  // Notes of a hidden Annotations section whose every source quotes it:
  // they go with the document.
  annotations: string[];
  // Notes that quote it or were written in it, outside the annotations:
  // they stay, their quotes orphaned.
  notes: number;
  // The projects that hold it, quote it, or have notes written in it.
  involved: string[];
  // The projects that hold it (NotebookDocument rows).
  attached: string[];
  // The projects whose notes quote it.
  quoting: string[];
};

export async function documentFootprint(documentId: string): Promise<DocumentFootprint> {
  const [attached, writtenIn] = await Promise.all([
    db.notebookDocument.findMany({ where: { documentId }, select: { notebookId: true } }),
    db.note.findMany({ where: { documentId }, select: { id: true, section: { select: { hidden: true, notebookId: true } } } }),
  ]);
  const citing = await db.source.findMany({
    where: { documentId },
    select: {
      noteId: true,
      note: {
        select: {
          derivationType: true,
          section: { select: { hidden: true, title: true, notebookId: true } },
          sources: { select: { documentId: true } },
        },
      },
    },
  });
  const annotations = new Set(
    citing
      .filter(
        ({ note }) =>
          note.section.hidden &&
          note.section.title === ANNOTATIONS_SECTION_TITLE &&
          note.derivationType !== "SYNTHESIS" &&
          note.sources.every((s) => s.documentId === documentId),
      )
      .map((c) => c.noteId),
  );
  const quoting = [...new Set(citing.map(({ note }) => note.section.notebookId))];
  // Notes in the outline (not a hidden section) that quote it or were
  // written in it: what the reader sees stay.
  const kept = new Set([
    ...citing.filter(({ noteId, note }) => !annotations.has(noteId) && !note.section.hidden).map((c) => c.noteId),
    ...writtenIn.filter((n) => !n.section.hidden).map((n) => n.id),
  ]);
  return {
    annotations: [...annotations],
    notes: kept.size,
    involved: [...new Set([...attached.map((a) => a.notebookId), ...writtenIn.map((n) => n.section.notebookId), ...quoting])],
    attached: attached.map((a) => a.notebookId),
    quoting,
  };
}

// The projects among these the account can edit (owner or editor). Sign-in
// off: the one reader edits every project.
export async function editableNotebooks(ids: string[], user: User): Promise<Set<string>> {
  if (!authEnabled()) return new Set(ids);
  const rows = await db.notebook.findMany({
    where: { id: { in: ids } },
    select: { id: true, userId: true, collaborators: { select: { email: true, role: true } } },
  });
  return new Set(
    rows
      .filter((n) => {
        const role = roleOf(n, user);
        return role === "owner" || role === "editor";
      })
      .map((n) => n.id),
  );
}

// The projects among these the account can open (owner, editor, or viewer).
// Sign-in off: the one reader opens every project.
export async function openableNotebooks(ids: string[], user: User): Promise<Set<string>> {
  if (!authEnabled()) return new Set(ids);
  const rows = await db.notebook.findMany({
    where: { id: { in: ids } },
    select: { id: true, userId: true, collaborators: { select: { email: true, role: true } } },
  });
  return new Set(rows.filter((n) => roleOf(n, user) !== null).map((n) => n.id));
}

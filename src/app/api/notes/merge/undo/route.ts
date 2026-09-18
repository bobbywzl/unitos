import { Prisma, type DerivationType } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { recordNoteEdit } from "@/lib/notes/edits";
import { mergeSnapshotSchema, NOTE_MERGE_KIND, type MergedNote } from "@/lib/notes/merge-snapshot";
import { normalizeNoteOrders } from "@/lib/order";
import { parseBody } from "@/lib/validate";

const undoSchema = z.object({ undoId: z.string().min(1) });

/** A stored JSON value as Prisma writes it back: null as a database null. */
function json(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

// Undo a merge (SPEC.md §6): the target gets its text back, the notes the
// merge consumed come back with their ids, their anchors, and their replies,
// and the anchors copied from annotations go. The merge's history entry
// (merge/route.ts) holds all of it. The undo runs while the target still
// holds the merged text: a note edited since is the reader's newer work, and
// the undo would throw it away.
export async function POST(req: Request) {
  const t = await serverT();
  const { data, error } = await parseBody(req, undoSchema);
  if (error) return error;

  const event = await db.notebookEvent.findUnique({ where: { id: data.undoId } });
  if (!event || event.kind !== NOTE_MERGE_KIND) {
    return NextResponse.json({ error: t("api.mergeUndoNotFound") }, { status: 404 });
  }
  const access = await notebookAccess(event.notebookId, "editor");
  if (access instanceof NextResponse) return access;

  const parsed = mergeSnapshotSchema.safeParse(event.meta);
  if (!parsed.success) {
    return NextResponse.json({ error: t("api.mergeUndoNotFound") }, { status: 404 });
  }
  const snapshot = parsed.data;
  if (snapshot.undoneAt) {
    return NextResponse.json({ error: t("api.mergeUndoneAlready") }, { status: 409 });
  }

  const target = await db.note.findUnique({
    where: { id: snapshot.targetId },
    include: { section: { select: { id: true, notebookId: true } } },
  });
  if (!target || target.section.notebookId !== event.notebookId) {
    return NextResponse.json({ error: t("api.noteNotFound") }, { status: 404 });
  }
  if (target.content !== snapshot.mergedContent) {
    return NextResponse.json({ error: t("api.mergeUndoStale") }, { status: 409 });
  }
  const ids = snapshot.notes.map((n) => n.id);
  if (ids.length > 0) {
    const present = await db.note.count({ where: { id: { in: ids } } });
    if (present > 0) return NextResponse.json({ error: t("api.mergeUndoneAlready") }, { status: 409 });
  }
  // A section deleted since the merge cannot take its note back: the note
  // comes back beside the target instead.
  const sections = await db.section.findMany({
    where: { id: { in: snapshot.notes.map((n) => n.sectionId) }, notebookId: event.notebookId },
    select: { id: true },
  });
  const live = new Set(sections.map((s) => s.id));
  const sectionOf = (n: MergedNote) => (live.has(n.sectionId) ? n.sectionId : target.section.id);

  // Each note comes back at the row it had: the rows from there on move down
  // one first. In order, so two notes of one section land in their order.
  const restored = [...snapshot.notes].sort((a, b) => a.order - b.order);
  await db.$transaction([
    db.note.update({
      where: { id: target.id },
      data: { content: snapshot.targetContent, gist: snapshot.targetGist },
    }),
    ...restored.flatMap((n) => {
      const sectionId = sectionOf(n);
      return [
        db.note.updateMany({
          where: { sectionId, order: { gte: n.order } },
          data: { order: { increment: 1 } },
        }),
        db.note.create({
          data: {
            id: n.id,
            sectionId,
            order: n.order,
            content: n.content,
            gist: n.gist,
            status: n.status,
            derivationType: n.derivationType as DerivationType | null,
            color: n.color,
            pinned: n.pinned,
            createdById: n.createdById,
            createdAt: new Date(n.createdAt),
            conversation: json(n.conversation),
            log: json(n.log),
          },
        }),
        ...(n.sourceIds.length > 0
          ? [db.source.updateMany({ where: { id: { in: n.sourceIds }, noteId: target.id }, data: { noteId: n.id } })]
          : []),
        ...(n.replyIds.length > 0
          ? [db.reply.updateMany({ where: { id: { in: n.replyIds }, noteId: target.id }, data: { noteId: n.id } })]
          : []),
      ];
    }),
    ...(snapshot.copiedSourceIds.length > 0
      ? [db.source.deleteMany({ where: { id: { in: snapshot.copiedSourceIds }, noteId: target.id } })]
      : []),
    db.notebookEvent.update({
      where: { id: event.id },
      data: { meta: { ...snapshot, undoneAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue },
    }),
  ]);

  // Putting the text back is an edit of the target too (SPEC.md §12).
  if (snapshot.targetContent !== target.content) {
    await recordNoteEdit(target.id, access.user.id || null, snapshot.targetContent);
  }
  const sectionIds = new Set([target.section.id, ...restored.map(sectionOf)]);
  for (const sectionId of sectionIds) await normalizeNoteOrders(sectionId);
  await bumpNotebook(event.notebookId);
  return NextResponse.json({ ok: true, restored: ids });
}

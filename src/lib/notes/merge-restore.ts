import type { DerivationType, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { mergeSnapshotSchema, type MergedNote } from "@/lib/notes/merge-snapshot";
import { shiftNoteOrders } from "@/lib/notes/order-writes";
import { keptNoteFrom, noteWrites, type KeptNote } from "@/lib/notes/removed";
import { normalizeNoteOrders } from "@/lib/order";

// The notes a merge took away, put back (SPEC.md §6, §12). The merge's
// NOTE_MERGE event keeps every consumed note (lib/notes/merge-snapshot.ts).
// The 12-second Undo (merge/undo/route.ts) puts the target's old text back
// too, and runs only while the target holds the merged text. History's
// Restore runs any time after: it brings the consumed notes back beside the
// target, with their sources and replies, and leaves the target's text as it
// is — the reader's newer words stay. A note kept whole (merges since round
// 15) comes back with its edits and side chats too.

const json = (value: unknown) =>
  value === null || value === undefined ? undefined : (value as Prisma.InputJsonValue);

/** The kept-whole note of a merged note, or null (a merge made before notes were kept whole). */
export function keptOfMerged(n: MergedNote): KeptNote | null {
  const kept = keptNoteFrom(n.kept);
  return kept && kept.id === n.id ? kept : null;
}

/** The documents still there among those the merged notes name. */
export async function liveDocumentsOf(notes: MergedNote[]): Promise<Set<string>> {
  const ids = notes.flatMap((n) => {
    const kept = keptOfMerged(n);
    return [
      n.documentId,
      kept?.documentId,
      ...(kept?.sources.map((s) => s.documentId) ?? []),
      ...(kept?.sideChats.flatMap((c) => [c.documentId, ...c.sources.map((s) => s.documentId)]) ?? []),
    ];
  });
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  if (wanted.length === 0) return new Set();
  return new Set((await db.document.findMany({ where: { id: { in: wanted } }, select: { id: true } })).map((d) => d.id));
}

/** The writes that put a merged note's own row back at `order` of the
    section: its columns and its edits, and its side chats at `chatOrder` on.
    Its sources and replies are the caller's (Undo moves them back from the
    target; Restore copies the sources and moves the replies). */
export function mergedNoteWrites(
  n: MergedNote,
  sectionId: string,
  order: number,
  chatOrder: number,
  documents: Set<string>,
  present: Set<string>,
): Prisma.PrismaPromise<unknown>[] {
  const kept = keptOfMerged(n);
  if (kept) {
    return [
      ...noteWrites({ ...kept, sources: [], replies: [] }, sectionId, order, documents),
      ...kept.sideChats
        .filter((chat) => !present.has(chat.id))
        .flatMap((chat, i) => noteWrites(chat, sectionId, chatOrder + i, documents)),
    ];
  }
  return [
    db.note.create({
      data: {
        id: n.id,
        sectionId,
        order,
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
        documentId: n.documentId && documents.has(n.documentId) ? n.documentId : null,
      },
    }),
  ];
}

export type MergeRestoreResult =
  | { ok: true; notes: { noteId: string; sectionId: string }[] }
  | { ok: false; reason: "restored" | "notKept" };

/** History's Restore of a merge: the consumed notes that are not back come
    back beside the target (right under it, in their order), or in their own
    section when the target is gone. Each gets copies of its sources (the
    target keeps its own, its text may quote them) and the replies written
    under it. The target's text is never written. */
export async function restoreMerge(meta: unknown, notebookId: string): Promise<MergeRestoreResult> {
  const parsed = mergeSnapshotSchema.safeParse(meta);
  if (!parsed.success || parsed.data.notes.length === 0) return { ok: false, reason: "notKept" };
  const snapshot = parsed.data;
  if (snapshot.undoneAt || snapshot.restoredAt) return { ok: false, reason: "restored" };

  const allIds = snapshot.notes.flatMap((n) => [n.id, ...(keptOfMerged(n)?.sideChats.map((c) => c.id) ?? [])]);
  const present = new Set(
    (await db.note.findMany({ where: { id: { in: allIds } }, select: { id: true } })).map((n) => n.id),
  );
  const notes = snapshot.notes.filter((n) => !present.has(n.id));
  if (notes.length === 0) return { ok: false, reason: "restored" };

  const target = await db.note.findFirst({
    where: { id: snapshot.targetId, section: { notebookId } },
    select: { id: true, sectionId: true, order: true },
  });
  const sections = await db.section.findMany({
    where: { notebookId, hidden: false },
    select: { id: true },
    orderBy: [{ parentId: { sort: "asc", nulls: "first" } }, { order: "asc" }],
  });
  const live = new Set(sections.map((s) => s.id));
  const home = target?.sectionId ?? sections[0]?.id;
  if (!home) return { ok: false, reason: "notKept" };
  const documents = await liveDocumentsOf(notes);

  // The sources each note quoted: the live row where it still is (on the
  // target, healed since), else the row kept with the note.
  const keptSources = notes.flatMap((n) => keptOfMerged(n)?.sources ?? []);
  const wantedSourceIds = [...new Set([...notes.flatMap((n) => n.sourceIds), ...keptSources.map((s) => s.id)])];
  const liveSources = new Map(
    (await db.source.findMany({ where: { id: { in: wantedSourceIds } } })).map((s) => [s.id, s as Record<string, unknown>]),
  );
  // The replies written under each note: moved back from the target, or
  // written again from the kept note when they are gone.
  const wantedReplyIds = [
    ...new Set(notes.flatMap((n) => [...n.replyIds, ...(keptOfMerged(n)?.replies.map((r) => r.id) ?? [])])),
  ];
  const liveReplies = new Map(
    (await db.reply.findMany({ where: { id: { in: wantedReplyIds } }, select: { id: true, noteId: true } })).map((r) => [
      r.id,
      r.noteId,
    ]),
  );

  const counts = new Map<string, number>();
  const countOf = async (sectionId: string) => {
    if (!counts.has(sectionId)) counts.set(sectionId, await db.note.count({ where: { sectionId } }));
    return counts.get(sectionId)!;
  };
  const placed: { noteId: string; sectionId: string }[] = [];
  const writes: Prisma.PrismaPromise<unknown>[] = [];
  let besideTarget = 0;
  for (const n of notes) {
    const kept = keptOfMerged(n);
    const sectionId = target ? target.sectionId : live.has(n.sectionId) ? n.sectionId : home;
    const at = target ? target.order + 1 + besideTarget++ : Math.max(0, Math.min(n.order, await countOf(sectionId)));
    const chatOrder = (await countOf(sectionId)) + notes.length + 1;
    writes.push(shiftNoteOrders(sectionId, at), ...mergedNoteWrites(n, sectionId, at, chatOrder, documents, present));

    const keptRows = new Map((kept?.sources ?? []).map((s) => [s.id, s as unknown as Record<string, unknown>]));
    const sourceRows = [...new Set([...keptRows.keys(), ...n.sourceIds])]
      .map((id) => liveSources.get(id) ?? keptRows.get(id))
      .filter((s): s is Record<string, unknown> => !!s);
    if (sourceRows.length > 0) {
      writes.push(
        db.source.createMany({
          data: sourceRows.map((s) => {
            const { id: _id, noteId: _noteId, ...row } = s as Prisma.SourceCreateManyInput & { id: string };
            void _id;
            void _noteId;
            const docKept = typeof row.documentId === "string" && documents.has(row.documentId);
            const fromLive = liveSources.has(s.id as string);
            return {
              ...row,
              noteId: n.id,
              // A kept row whose document is gone since keeps its quote, orphaned (SPEC.md §5).
              documentId: fromLive || docKept ? row.documentId : null,
              orphaned: fromLive || docKept ? row.orphaned : true,
              region: json(row.region),
            };
          }),
        }),
      );
    }

    const replyIds = [...new Set([...n.replyIds, ...(kept?.replies.map((r) => r.id) ?? [])])];
    const moveBack = replyIds.filter((id) => liveReplies.get(id) === snapshot.targetId);
    if (moveBack.length > 0) {
      writes.push(db.reply.updateMany({ where: { id: { in: moveBack }, noteId: snapshot.targetId }, data: { noteId: n.id } }));
    }
    const gone = (kept?.replies ?? []).filter((r) => !liveReplies.has(r.id));
    if (gone.length > 0) {
      writes.push(
        db.reply.createMany({
          data: gone.map((r) => ({ ...r, noteId: n.id, createdAt: new Date(r.createdAt) })),
        }),
      );
    }
    placed.push({ noteId: n.id, sectionId });
  }
  try {
    await db.$transaction(writes);
  } catch (err) {
    // A second Restore (another tab, a double press) put the notes back first.
    if ((err as { code?: unknown } | null)?.code === "P2002") return { ok: false, reason: "restored" };
    throw err;
  }
  for (const sectionId of new Set(placed.map((p) => p.sectionId))) await normalizeNoteOrders(sectionId);
  return { ok: true, notes: placed };
}

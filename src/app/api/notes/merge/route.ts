import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpNotebook, noteAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { currentLang, serverT } from "@/lib/i18n/server";
import { recordNoteEdit } from "@/lib/notes/edits";
import { joinNoteContents } from "@/lib/notes/join";
import { mergeNoteText } from "@/lib/notes/merge";
import { NOTE_MERGE_KIND, type MergeSnapshot } from "@/lib/notes/merge-snapshot";
import { normalizeNoteOrders } from "@/lib/order";
import { parseBody } from "@/lib/validate";

const mergeSchema = z.object({
  targetId: z.string().min(1),
  sourceIds: z.array(z.string().min(1)).min(1).max(30),
  // join: the notes' text lands in the target as it is, in the order the
  // notes stand in (lib/notes/join.ts). ai: the model writes the one note
  // that takes their place (SPEC.md §6). A failed AI call joins.
  mode: z.enum(["join", "ai"]).default("join"),
});

const MAX_CONTENT = 50_000;

type MergeNote = Prisma.NoteGetPayload<{
  include: {
    section: {
      select: {
        id: true;
        notebookId: true;
        hidden: true;
        order: true;
        parentId: true;
        parent: { select: { order: true } };
      };
    };
  };
}>;

/** Where the note stands in the project: its root section, then the child
    section (or none), then its own row — the order the tray and the notes
    full page show. An annotation (a note of the hidden section) stands
    nowhere on those pages, so it comes last. */
function rankOf(note: MergeNote): [number, number, number] {
  if (note.section.hidden) return [Number.MAX_SAFE_INTEGER, 0, note.order];
  const parentOrder = note.section.parent?.order;
  return parentOrder === undefined
    ? [note.section.order, -1, note.order]
    : [parentOrder, note.section.order, note.order];
}

function byDisplayOrder(a: MergeNote, b: MergeNote): number {
  const ra = rankOf(a);
  const rb = rankOf(b);
  return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
}

// Merge notes: the sources' content lands in the target, their source anchors
// and replies move to the target, and the source notes are deleted. An
// annotation — a note of the hidden Annotations section — is copied instead:
// its text lands in the target and its anchors are copied as sources of the
// target, and the annotation stays where it is, still painted in the article.
// Accepted notes only — pending notes go through Accept/Reject first. What
// the merge took apart is kept as a NOTE_MERGE history event, so the merge
// can be undone (merge/undo/route.ts); the answer carries the event's id.
export async function POST(req: Request) {
  const t = await serverT();
  const { data, error } = await parseBody(req, mergeSchema);
  if (error) return error;

  const sourceIds = [...new Set(data.sourceIds)].filter((id) => id !== data.targetId);
  if (sourceIds.length === 0) {
    return NextResponse.json({ error: t("api.mergeNeedsTwo") }, { status: 400 });
  }

  const access = await noteAccess(data.targetId, "editor");
  if (access instanceof NextResponse) return access;

  const notes: MergeNote[] = await db.note.findMany({
    where: { id: { in: [data.targetId, ...sourceIds] } },
    include: {
      section: {
        select: {
          id: true,
          notebookId: true,
          hidden: true,
          order: true,
          parentId: true,
          parent: { select: { order: true } },
        },
      },
    },
  });
  const byId = new Map(notes.map((n) => [n.id, n]));
  const target = byId.get(data.targetId);
  if (!target || sourceIds.some((id) => !byId.has(id))) {
    return NextResponse.json({ error: t("api.noteNotFound") }, { status: 404 });
  }
  if (notes.some((n) => n.section.notebookId !== target.section.notebookId)) {
    return NextResponse.json({ error: t("api.mergeSameProject") }, { status: 400 });
  }
  if (notes.some((n) => n.status !== "ACCEPTED")) {
    return NextResponse.json({ error: t("api.mergeAcceptedOnly") }, { status: 400 });
  }
  // The target is a note the reader keeps, never an annotation: an annotation
  // is what gets copied in, and the article's marks stay as they are.
  if (target.section.hidden) {
    return NextResponse.json({ error: t("api.mergeIntoNoteOnly") }, { status: 400 });
  }

  const sources = sourceIds.map((id) => byId.get(id)!);
  // Consumed: the sources' anchors and replies move and the notes are deleted.
  // Copied: an annotation's anchors are copied and the annotation stays.
  const consumedNotes = sources.filter((n) => !n.section.hidden);
  const consumed = consumedNotes.map((n) => n.id);
  const copied = sources.filter((n) => n.section.hidden).map((n) => n.id);

  // Join text puts the notes in the order they stand in: the note on top
  // first (SPEC.md §6).
  const ordered = [target, ...sources].sort(byDisplayOrder);
  const joined = joinNoteContents(ordered.map((n) => n.content));
  const written =
    data.mode === "ai"
      ? await mergeNoteText(
          [target, ...sources].map((n) => ({ id: n.id, content: n.content })),
          access.user.id || null,
          await currentLang(),
        )
      : null;
  const content = (written ?? joined).slice(0, MAX_CONTENT);

  // What the merge takes apart, before it does: the consumed notes' anchors
  // and replies by note, and the target's own anchors, so the copies the
  // merge adds can be told apart afterwards.
  const [ownedAnchors, ownedReplies, targetAnchorsBefore, copiedSources] = await Promise.all([
    consumed.length > 0
      ? db.source.findMany({ where: { noteId: { in: consumed } }, select: { id: true, noteId: true } })
      : Promise.resolve([]),
    consumed.length > 0
      ? db.reply.findMany({ where: { noteId: { in: consumed } }, select: { id: true, noteId: true } })
      : Promise.resolve([]),
    db.source.findMany({ where: { noteId: target.id }, select: { id: true } }),
    copied.length > 0 ? db.source.findMany({ where: { noteId: { in: copied } } }) : Promise.resolve([]),
  ]);

  await db.$transaction([
    // A merged note says something new: its gist is written again (SPEC.md §6).
    db.note.update({ where: { id: target.id }, data: { content, gist: null } }),
    ...(consumed.length > 0
      ? [
          db.source.updateMany({ where: { noteId: { in: consumed } }, data: { noteId: target.id } }),
          db.reply.updateMany({ where: { noteId: { in: consumed } }, data: { noteId: target.id } }),
          db.note.deleteMany({ where: { id: { in: consumed } } }),
        ]
      : []),
    ...(copiedSources.length > 0
      ? [
          // The annotation keeps its own anchors; the note gets its own copies,
          // so both stay anchored to the same words (SPEC.md §5).
          db.source.createMany({
            data: copiedSources.map((source) => ({
              noteId: target.id,
              documentId: source.documentId,
              blockId: source.blockId,
              startOffset: source.startOffset,
              endOffset: source.endOffset,
              quotedText: source.quotedText,
              prefix: source.prefix,
              suffix: source.suffix,
              orphaned: source.orphaned,
              startTime: source.startTime,
              endTime: source.endTime,
              ...(source.region === null ? {} : { region: source.region as Prisma.InputJsonValue }),
            })),
          }),
        ]
      : []),
  ]);

  // The copies the merge added: the target's anchors now that were neither
  // its own before nor moved in from a consumed note.
  const known = new Set([...targetAnchorsBefore.map((s) => s.id), ...ownedAnchors.map((s) => s.id)]);
  const targetAnchorsAfter = await db.source.findMany({ where: { noteId: target.id }, select: { id: true } });
  const copiedSourceIds = targetAnchorsAfter.map((s) => s.id).filter((id) => !known.has(id));

  const snapshot: MergeSnapshot = {
    targetId: target.id,
    targetContent: target.content,
    targetGist: target.gist,
    mergedContent: content,
    notes: consumedNotes.map((n) => ({
      id: n.id,
      sectionId: n.sectionId,
      order: n.order,
      content: n.content,
      gist: n.gist,
      status: n.status,
      derivationType: n.derivationType,
      color: n.color,
      pinned: n.pinned,
      createdById: n.createdById,
      createdAt: n.createdAt.toISOString(),
      ...(n.conversation === null ? {} : { conversation: n.conversation }),
      ...(n.log === null ? {} : { log: n.log }),
      sourceIds: ownedAnchors.filter((s) => s.noteId === n.id).map((s) => s.id),
      replyIds: ownedReplies.filter((r) => r.noteId === n.id).map((r) => r.id),
    })),
    copiedSourceIds,
  };
  // The merge is corpus history (SPEC.md §12), and what it took apart rides
  // with the entry so the merge can be undone.
  const event = await db.notebookEvent.create({
    data: {
      notebookId: target.section.notebookId,
      userId: access.user.id,
      kind: NOTE_MERGE_KIND,
      content: content.slice(0, 500),
      meta: snapshot as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  // The merge is an edit of the target's text (SPEC.md §12).
  if (content !== target.content) await recordNoteEdit(target.id, access.user.id || null, content);
  const sectionIds = new Set([target.section.id, ...sources.map((n) => n.section.id)]);
  for (const sectionId of sectionIds) await normalizeNoteOrders(sectionId);
  await bumpNotebook(target.section.notebookId);

  const merged = await db.note.findUnique({ where: { id: target.id }, include: { sources: true } });
  return NextResponse.json({ ...merged, mergedByAi: written !== null, undoId: event.id });
}

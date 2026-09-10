import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpNotebook, noteAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { currentLang, serverT } from "@/lib/i18n/server";
import { recordNoteEdit } from "@/lib/notes/edits";
import { mergeNoteText } from "@/lib/notes/merge";
import { normalizeNoteOrders } from "@/lib/order";
import { parseBody } from "@/lib/validate";

const mergeSchema = z.object({
  targetId: z.string().min(1),
  // Merged into the target in this order; the client sends them in display order.
  sourceIds: z.array(z.string().min(1)).min(1).max(30),
  // join: the sources' text is appended to the target. ai: the model writes
  // the one note that takes their place (SPEC.md §6). A failed AI call joins.
  mode: z.enum(["join", "ai"]).default("join"),
});

const MAX_CONTENT = 50_000;

// Merge notes: the sources' content lands in the target, their source anchors
// and replies move to the target, and the source notes are deleted. An
// annotation — a note of the hidden Annotations section — is copied instead:
// its text lands in the target and its anchors are copied as sources of the
// target, and the annotation stays where it is, still painted in the article.
// Accepted notes only — pending notes go through Accept/Reject first.
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

  const notes = await db.note.findMany({
    where: { id: { in: [data.targetId, ...sourceIds] } },
    include: { section: { select: { id: true, notebookId: true, hidden: true } } },
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
  const consumed = sources.filter((n) => !n.section.hidden).map((n) => n.id);
  const copied = sources.filter((n) => n.section.hidden).map((n) => n.id);

  const joined = [target, ...sources]
    .map((n) => n.content.trim())
    .filter(Boolean)
    .join("\n\n");
  const written =
    data.mode === "ai"
      ? await mergeNoteText(
          [target, ...sources].map((n) => ({ id: n.id, content: n.content })),
          access.user.id || null,
          await currentLang(),
        )
      : null;
  const content = (written ?? joined).slice(0, MAX_CONTENT);

  const copiedSources =
    copied.length > 0
      ? await db.source.findMany({ where: { noteId: { in: copied } } })
      : [];

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

  // The merge is an edit of the target's text (SPEC.md §12).
  if (content !== target.content) await recordNoteEdit(target.id, access.user.id || null, content);
  const sectionIds = new Set([target.section.id, ...sources.map((n) => n.section.id)]);
  for (const sectionId of sectionIds) await normalizeNoteOrders(sectionId);
  await bumpNotebook(target.section.notebookId);

  const merged = await db.note.findUnique({ where: { id: target.id }, include: { sources: true } });
  return NextResponse.json({ ...merged, mergedByAi: written !== null });
}

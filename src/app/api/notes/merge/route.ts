import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpNotebook, noteAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { normalizeNoteOrders } from "@/lib/order";
import { parseBody } from "@/lib/validate";

const mergeSchema = z.object({
  targetId: z.string().min(1),
  // Merged into the target in this order; the client sends them in display order.
  sourceIds: z.array(z.string().min(1)).min(1).max(30),
});

// Merge notes: the sources' content is appended to the target, their source
// anchors and replies move to the target, and the source notes are deleted.
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
    include: { section: { select: { id: true, notebookId: true } } },
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

  const content = [target.content, ...sourceIds.map((id) => byId.get(id)!.content)]
    .map((c) => c.trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 50_000);

  await db.$transaction([
    db.note.update({ where: { id: target.id }, data: { content } }),
    db.source.updateMany({ where: { noteId: { in: sourceIds } }, data: { noteId: target.id } }),
    db.reply.updateMany({ where: { noteId: { in: sourceIds } }, data: { noteId: target.id } }),
    db.note.deleteMany({ where: { id: { in: sourceIds } } }),
  ]);

  const sectionIds = new Set(notes.map((n) => n.section.id));
  for (const sectionId of sectionIds) await normalizeNoteOrders(sectionId);
  await bumpNotebook(target.section.notebookId);

  const merged = await db.note.findUnique({ where: { id: target.id }, include: { sources: true } });
  return NextResponse.json(merged);
}

import { NextResponse } from "next/server";
import { noteAccess, peopleByIds } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";

// A note's own history (SPEC.md §12): who wrote it, and every edit of its
// text since — newest first, each with the text it left. The people who
// appear come along, so the list can show a badge and a name for each.
export async function GET(_req: Request, ctx: { params: Promise<{ noteId: string }> }) {
  const t = await serverT();
  const { noteId } = await ctx.params;
  const access = await noteAccess(noteId, "viewer");
  if (access instanceof NextResponse) return access;
  const note = await db.note.findUnique({
    where: { id: noteId },
    select: {
      createdAt: true,
      createdById: true,
      edits: { orderBy: { createdAt: "desc" }, select: { id: true, userId: true, content: true, createdAt: true, updatedAt: true } },
    },
  });
  if (!note) return NextResponse.json({ error: t("api.noteNotFound") }, { status: 404 });
  const ids = [note.createdById, ...note.edits.map((e) => e.userId)].filter((id): id is string => Boolean(id));
  return NextResponse.json({
    createdAt: note.createdAt.toISOString(),
    createdById: note.createdById,
    edits: note.edits.map((e) => ({
      id: e.id,
      userId: e.userId,
      content: e.content,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    })),
    people: await peopleByIds(ids),
  });
}

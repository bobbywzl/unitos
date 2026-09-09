import { db } from "@/lib/db";

// A note's own history (SPEC.md §12): every change to its text is recorded
// with who made it and when. Auto-save writes every few keystrokes, so a
// save within SITTING_MS of the same person's last edit updates that edit
// instead of adding one: one sitting is one entry, holding the text it ended
// with.
const SITTING_MS = 10 * 60 * 1000;

export async function recordNoteEdit(noteId: string, userId: string | null, content: string): Promise<void> {
  const last = await db.noteEdit.findFirst({
    where: { noteId },
    orderBy: { createdAt: "desc" },
    select: { id: true, userId: true, updatedAt: true },
  });
  if (last && last.userId === userId && Date.now() - last.updatedAt.getTime() < SITTING_MS) {
    await db.noteEdit.update({ where: { id: last.id }, data: { content } });
    return;
  }
  await db.noteEdit.create({ data: { noteId, userId, content } });
}

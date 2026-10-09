import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

// A note's own history (SPEC.md §12): every change to its text is recorded
// with who made it and when. Auto-save writes every few keystrokes, so a
// save within SITTING_MS of the same person's last edit updates that edit
// instead of adding one: one sitting is one entry, holding the text it ended
// with. A write starts its own entry when the note's text before it is not
// the entry's text (the note changed in a way History did not record), or
// when it asks to (`fresh`: an editor's Cancel), so the text it replaces
// stays a version.
const SITTING_MS = 10 * 60 * 1000;

export async function recordNoteEdit(
  noteId: string,
  userId: string | null,
  content: string,
  // The transaction the note's write runs in, when it runs in one.
  client: Prisma.TransactionClient = db,
  // before: the note's text before this write; fresh: never fold.
  opts: { before?: string; fresh?: boolean } = {},
): Promise<void> {
  const last = await client.noteEdit.findFirst({
    where: { noteId },
    orderBy: { createdAt: "desc" },
    select: { id: true, userId: true, updatedAt: true, content: true },
  });
  if (
    last &&
    !opts.fresh &&
    last.userId === userId &&
    Date.now() - last.updatedAt.getTime() < SITTING_MS &&
    (opts.before === undefined || last.content.trim() === opts.before.trim())
  ) {
    await client.noteEdit.update({ where: { id: last.id }, data: { content } });
    return;
  }
  await client.noteEdit.create({ data: { noteId, userId, content } });
}

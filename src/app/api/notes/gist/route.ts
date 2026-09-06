import { NextResponse } from "next/server";
import { z } from "zod";
import { notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { writeGists } from "@/lib/notes/gist";
import { parseBody } from "@/lib/validate";

const schema = z.object({ noteIds: z.array(z.string().min(1)).min(1).max(100) });

// The gists of collapsed notes and annotations that have none yet (SPEC.md
// §6): one request per render, one model call per batch. Returns
// {gists: {<noteId>: <phrase>}} for the notes that got one; a note the reader
// cannot read, or one the model skipped, is left out.
export async function POST(req: Request) {
  const { data, error } = await parseBody(req, schema);
  if (error) return error;
  const notes = await db.note.findMany({
    where: { id: { in: data.noteIds } },
    select: { id: true, section: { select: { notebookId: true } } },
  });
  const byNotebook = new Map<string, string[]>();
  for (const n of notes) {
    const ids = byNotebook.get(n.section.notebookId) ?? [];
    ids.push(n.id);
    byNotebook.set(n.section.notebookId, ids);
  }
  const allowed: string[] = [];
  let userId: string | null = null;
  for (const [notebookId, ids] of byNotebook) {
    const access = await notebookAccess(notebookId, "viewer");
    if (access instanceof NextResponse) continue;
    userId = access.user.id;
    allowed.push(...ids);
  }
  const gists = allowed.length > 0 ? await writeGists(allowed, userId) : {};
  return NextResponse.json({ gists });
}

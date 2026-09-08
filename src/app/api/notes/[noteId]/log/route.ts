import { NextResponse } from "next/server";
import { noteAccess } from "@/lib/collab";
import { ensureConversationLog } from "@/lib/notes/conversation-log";

export const maxDuration = 60;

// The condensed log of a note's conversation (SPEC.md §21): the reader hovers
// the conversation's mark, the reader's card shows this. Written once per
// conversation length and stored on the note; a stored log that matches the
// conversation returns as it is. Returns {log: {turns, lines}} or {log: null}
// when the note has no conversation.
export async function POST(_req: Request, ctx: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await ctx.params;
  const access = await noteAccess(noteId, "viewer");
  if (access instanceof NextResponse) return access;
  const log = await ensureConversationLog(noteId, access.user.id);
  return NextResponse.json({ log });
}

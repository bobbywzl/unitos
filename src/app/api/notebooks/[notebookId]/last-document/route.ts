import { NextResponse } from "next/server";
import { z } from "zod";
import { notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { parseBody } from "@/lib/validate";

// The last-open document (SPEC.md §6): the reader saves the document it has
// open as it opens, and a project opened without a document in its link
// opens there. The row is the account's own: no rev moves, nothing lands in
// the history. A document not attached to the project saves nothing.
const Body = z.object({ documentId: z.string().min(1).max(64) });

export async function PUT(req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await ctx.params;
  const access = await notebookAccess(notebookId, "viewer");
  if (access instanceof NextResponse) return access;
  const { data, error } = await parseBody(req, Body);
  if (error) return error;
  const attached = await db.notebookDocument.findUnique({
    where: { notebookId_documentId: { notebookId, documentId: data.documentId } },
    select: { documentId: true },
  });
  if (!attached) return NextResponse.json({ ok: true });
  await db.lastDocument.upsert({
    where: { userId_notebookId: { userId: access.user.id, notebookId } },
    update: { documentId: data.documentId, at: new Date() },
    create: { userId: access.user.id, notebookId, documentId: data.documentId },
  });
  return NextResponse.json({ ok: true });
}

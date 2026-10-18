import { NextResponse } from "next/server";
import { z } from "zod";
import { notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { parseBody } from "@/lib/validate";

const Body = z.object({ documentId: z.string().min(1).max(100) });

// The document the account has open in this project (SPEC.md §6,
// LastDocument). PUT (viewer: every reader keeps their own) replaces the
// account's one row for the project; a project opened with no document in
// its address opens it. A document the project does not hold saves nothing.
// The row is the account's own, not the project's: no rev moves, nothing
// lands in the history.
export async function PUT(req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await ctx.params;
  const access = await notebookAccess(notebookId, "viewer");
  if (access instanceof NextResponse) return access;
  const { data, error } = await parseBody(req, Body);
  if (error) return error;

  const held = await db.notebookDocument.findFirst({
    where: { notebookId, documentId: data.documentId },
    select: { documentId: true },
  });
  if (!held) return NextResponse.json({ ok: false }, { status: 404 });
  const at = new Date();
  await db.lastDocument.upsert({
    where: { userId_notebookId: { userId: access.user.id, notebookId } },
    update: { documentId: data.documentId, at },
    create: { userId: access.user.id, notebookId, documentId: data.documentId, at },
  });
  return NextResponse.json({ ok: true });
}

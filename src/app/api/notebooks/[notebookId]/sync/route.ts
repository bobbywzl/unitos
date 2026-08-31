import { NextResponse } from "next/server";
import { authEnabled } from "@/lib/auth";
import { notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { personOf, type Person } from "@/lib/person";

// The live sync poll. Open workspaces call this every few seconds: the call
// stamps the caller's presence and answers the corpus's rev plus who else has
// it open. The client refreshes when the rev moves — that is how one reader
// sees another's changes land.

const PRESENT_WINDOW_MS = 25_000;

export type SyncPresence = Person & { documentId: string | null };

export async function GET(req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await ctx.params;
  const access = await notebookAccess(notebookId, "viewer");
  if (access instanceof NextResponse) return access;

  const notebook = await db.notebook.findUnique({
    where: { id: notebookId },
    select: { rev: true },
  });
  if (!notebook) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Single-reader mode has no accounts to be present as.
  if (!authEnabled()) return NextResponse.json({ rev: notebook.rev, people: [] });

  const documentId = new URL(req.url).searchParams.get("doc") || null;
  await db.notebookPresence.upsert({
    where: { notebookId_userId: { notebookId, userId: access.user.id } },
    update: { documentId, lastSeenAt: new Date() },
    create: { notebookId, userId: access.user.id, documentId },
  });

  const rows = await db.notebookPresence.findMany({
    where: {
      notebookId,
      lastSeenAt: { gt: new Date(Date.now() - PRESENT_WINDOW_MS) },
      NOT: { userId: access.user.id },
    },
  });
  let people: SyncPresence[] = [];
  if (rows.length > 0) {
    const users = await db.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } } });
    const byId = new Map(users.map((u) => [u.id, u]));
    people = rows
      .map((r) => {
        const user = byId.get(r.userId);
        return user ? { ...personOf(user), documentId: r.documentId } : null;
      })
      .filter((p): p is SyncPresence => p !== null);
  }
  return NextResponse.json({ rev: notebook.rev, people });
}

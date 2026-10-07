import { after, NextResponse } from "next/server";
import { notebookAccess } from "@/lib/collab";
import { warmSkeletons } from "@/lib/graph/skeleton";

// The graph opened (SPEC.md §22): the project's missing or stale skeletons
// build in the background while the reader writes the first command, so
// that command does not wait for them. Nothing builds for a project too
// short to read skeletons. Editor role: only an editor runs Stitch.
export async function POST(_req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await ctx.params;
  const access = await notebookAccess(notebookId, "editor");
  if (access instanceof NextResponse) return access;
  after(() => warmSkeletons(notebookId, access.user.id).catch((err: unknown) => console.warn("[skeleton] warm failed:", err)));
  return NextResponse.json({ ok: true }, { status: 202 });
}

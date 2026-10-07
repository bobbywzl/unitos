import { NextResponse } from "next/server";
import { notebookAccess } from "@/lib/collab";
import { graphData } from "@/lib/graph/data";

// The graph's data (SPEC.md §13), read when the graph opens and again when
// the project's rev moves while it is open: the workspace page does not
// carry it. Read only, no model call. The offline copy keeps this route's
// answer (lib/offline/saved.ts), so a saved project's graph opens offline.
export async function GET(_req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await ctx.params;
  const access = await notebookAccess(notebookId, "viewer");
  if (access instanceof NextResponse) return access;
  return NextResponse.json(await graphData(notebookId, access.user));
}

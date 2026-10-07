import { NextResponse } from "next/server";
import { notebookAccess } from "@/lib/collab";
import { projectCoverage } from "@/lib/graph/coverage";

// What the reader's notes cover (SPEC.md §13, VIEW4-01): per document, the
// notes in each part, the notes that quote it, and whether this account
// opened it (lib/graph/coverage.ts). Viewer: read only, stored rows only,
// never a model call. The graph refetches it when the project's notes change.
export async function GET(_req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await ctx.params;
  const access = await notebookAccess(notebookId, "viewer");
  if (access instanceof NextResponse) return access;
  return NextResponse.json(await projectCoverage(notebookId, access.user.id));
}

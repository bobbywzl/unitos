import { NextResponse } from "next/server";
import { notebookAccess } from "@/lib/collab";
import { jsonWithEtag } from "@/lib/etag";
import { projectCoverage } from "@/lib/graph/coverage";

// What the reader's notes cover (SPEC.md §13, VIEW4-01): per document, the
// notes in each part, the notes that quote it, and whether this account
// opened it (lib/graph/coverage.ts). Viewer: read only, stored rows only,
// never a model call. The graph refetches it when the project's notes change;
// an answer that did not change is a 304 (the body's ETag, COST5-09).
export async function GET(req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await ctx.params;
  const access = await notebookAccess(notebookId, "viewer");
  if (access instanceof NextResponse) return access;
  return jsonWithEtag(req, await projectCoverage(notebookId, access.user.id));
}

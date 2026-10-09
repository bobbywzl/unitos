import { NextResponse } from "next/server";
import { z } from "zod";
import { notebookAccess } from "@/lib/collab";
import { jsonWithEtag } from "@/lib/etag";
import { projectCoverage, projectCoverageWire } from "@/lib/graph/coverage";

// What the reader's notes cover (SPEC.md §13, VIEW4-01): per document, the
// notes in each part, the notes that quote it, and whether this account
// opened it (lib/graph/coverage.ts). Viewer: read only, stored rows only,
// never a model call. The graph refetches it when the project's notes change;
// an answer that did not change is a 304 (the body's ETag, COST5-09).
// [cost10] ?parts=counts answers the compact form (COST10-03): each
// document's counts in its part titles' order and no block ids, which the
// titles answer carries; the graph pairs the two (components/graph/
// coverage.tsx). Without it, today's shape, for a tab from before.
const querySchema = z.object({ parts: z.literal("counts") });

export async function GET(req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await ctx.params;
  const access = await notebookAccess(notebookId, "viewer");
  if (access instanceof NextResponse) return access;
  const counts = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams)).success;
  return jsonWithEtag(req, counts ? await projectCoverageWire(notebookId, access.user.id) : await projectCoverage(notebookId, access.user.id));
}

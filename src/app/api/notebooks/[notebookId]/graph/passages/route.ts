import { NextResponse } from "next/server";
import { z } from "zod";
import { notebookAccess } from "@/lib/collab";
import { linkPassages } from "@/lib/graph/view";

// The passage each end of a link sits in (SPEC.md §13): the link panel reads
// it when a link opens (?linkId=), so the graph's data does not carry every
// end's whole block (COST3-03). Without linkId: every link of the project,
// which the offline copy keeps (lib/offline/saved.ts) and the service worker
// answers a one-link call from when the network is gone. Same access as the
// graph: a viewer of the project. Read only.

const querySchema = z.object({ linkId: z.string().min(1).max(64).optional() });

export async function GET(req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await ctx.params;
  const access = await notebookAccess(notebookId, "viewer");
  if (access instanceof NextResponse) return access;
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid linkId" }, { status: 400 });
  const { linkId } = parsed.data;
  const passages = await linkPassages(notebookId, linkId);
  if (linkId && !passages.links[linkId]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(passages, { headers: { "Cache-Control": "private, no-cache" } });
}

import { NextResponse } from "next/server";
import { notebookAccess } from "@/lib/collab";
import { jsonWithEtag } from "@/lib/etag";
import { notesView } from "@/lib/notes-view";

// The project's sections and notes in the workspace's shape (lib/notes-view.ts,
// SPEC.md §13), for the graph while it is open (COST10-04): a rev move
// another account made fetches this in place of the page's refresh
// (components/collab/use-sync.ts), the notes alone in place of every pane.
// Viewer, read only, stored rows only. The body's ETag: a 304 when the notes
// did not change (a link or a reply moved the rev).
export async function GET(req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await ctx.params;
  const access = await notebookAccess(notebookId, "viewer");
  if (access instanceof NextResponse) return access;
  const sections = await notesView(notebookId);
  if (!sections) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return jsonWithEtag(req, { sections });
}

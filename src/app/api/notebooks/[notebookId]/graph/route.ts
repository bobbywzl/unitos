import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { notebookAccess } from "@/lib/collab";
import { graphData } from "@/lib/graph/data";

// The graph's data (SPEC.md §13), read when the graph opens and again when
// the project's rev moves while it is open: the workspace page does not
// carry it. Read only, no model call. ?provenance=1 adds the generated
// documents' provenance links (lib/graph/data.ts). The offline copy keeps
// this route's answer, both ways (lib/offline/saved.ts), so a saved
// project's graph opens offline.
//
// COST3-04: the answer carries an ETag, a hash of its own body, so a refetch
// after a rev move that changed nothing the graph shows (a note moved, a
// reply on a note, an annotation) is a 304 with no body. The hash covers
// every field the overlay reads, so no change is ever missed.
export async function GET(req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await ctx.params;
  const access = await notebookAccess(notebookId, "viewer");
  if (access instanceof NextResponse) return access;
  const provenance = new URL(req.url).searchParams.get("provenance") === "1";
  const body = JSON.stringify(await graphData(notebookId, access.user, { provenance }));
  const etag = `"${createHash("sha1").update(body).digest("base64url")}"`;
  // private: the answer is this account's (crossAccount, runs left); no-cache:
  // the browser asks again every time, with If-None-Match.
  const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
  const sent = req.headers.get("if-none-match");
  if (sent && sent.split(",").some((tag) => tag.trim().replace(/^W\//, "") === etag)) {
    return new NextResponse(null, { status: 304, headers });
  }
  return new NextResponse(body, { headers: { ...headers, "Content-Type": "application/json" } });
}

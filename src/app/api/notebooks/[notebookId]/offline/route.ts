import { NextResponse } from "next/server";
import { authEnabled } from "@/lib/auth";
import { notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { ultraActive } from "@/lib/tiers";

// What a project's offline copy holds (SPEC.md §17, Unitos Ultra): the
// title, the section count, and the documents, one reader page each. The
// browser fetches those pages and their images into its cache
// (lib/offline/saved.ts). This route is the gate: below Ultra it answers 403,
// so no copy is made. The local reader (sign-in off) is Ultra.
export async function GET(_req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await ctx.params;
  const access = await notebookAccess(notebookId, "viewer");
  if (access instanceof NextResponse) return access;
  const t = await serverT();
  if (authEnabled() && !ultraActive(access.user)) {
    return NextResponse.json({ error: t("api.offlineNeedsUltra") }, { status: 403 });
  }
  const notebook = await db.notebook.findUnique({
    where: { id: notebookId },
    select: {
      title: true,
      _count: { select: { sections: { where: { hidden: false } } } },
      documents: {
        orderBy: { document: { createdAt: "asc" } },
        select: { document: { select: { id: true, title: true, video: { select: { id: true } } } } },
      },
    },
  });
  if (!notebook) return NextResponse.json({ error: t("api.corpusNotFound") }, { status: 404 });
  return NextResponse.json({
    title: notebook.title,
    sectionCount: notebook._count.sections,
    documents: notebook.documents.map((nd) => ({
      id: nd.document.id,
      title: nd.document.title,
      hasVideo: nd.document.video !== null,
    })),
  });
}

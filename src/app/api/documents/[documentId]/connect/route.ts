import { NextResponse } from "next/server";
import { z } from "zod";
import { notebookAccess } from "@/lib/collab";
import { buildConnections } from "@/lib/connect";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

export const maxDuration = 120;

const bodySchema = z.object({ notebookId: z.string().min(1) });

// Run the recommended-links scan on demand — for documents that were in the
// corpus before the scan existed, or to scan again after big edits.
export async function POST(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: t("api.deriveNeedsKey") }, { status: 503 });
  }
  const { documentId } = await ctx.params;
  const { data, error } = await parseBody(req, bodySchema);
  if (error) return error;
  const access = await notebookAccess(data.notebookId, "editor");
  if (access instanceof NextResponse) return access;
  const attachment = await db.notebookDocument.findUnique({
    where: { notebookId_documentId: { notebookId: data.notebookId, documentId } },
  });
  if (!attachment) {
    return NextResponse.json({ error: t("api.documentNotAttachedToCorpus") }, { status: 404 });
  }
  const linkCount = await buildConnections(data.notebookId, documentId, access.user.id);
  return NextResponse.json({ ok: true, linkCount });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { notebookAccess, peopleByIds } from "@/lib/collab";
import { db } from "@/lib/db";
import { historyPage } from "@/lib/history/list";
import { serverT } from "@/lib/i18n/server";

const querySchema = z.object({
  // The last row shown: its time and id. Rows older than it come back.
  beforeAt: z.string().datetime(),
  beforeId: z.string().min(1).max(64),
  // History's This document: that document's edits alone.
  documentId: z.string().min(1).max(64).optional(),
});

// Show older in History (SPEC.md §12): the page of rows under the last row
// shown, with the people who signed them and their replies. Read-only.
export async function GET(req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await ctx.params;
  const access = await notebookAccess(notebookId, "viewer");
  if (access instanceof NextResponse) return access;
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    const t = await serverT();
    return NextResponse.json({ error: t("api.validationFailed"), issues: parsed.error.issues }, { status: 400 });
  }
  const attached = await db.notebookDocument.findMany({ where: { notebookId }, select: { documentId: true } });
  const attachedIds = attached.map((a) => a.documentId);
  const { documentId } = parsed.data;
  // A document out of the project reads nothing, as the project's page does.
  const ids = documentId ? attachedIds.filter((id) => id === documentId) : attachedIds;
  const { entries, more } = await historyPage(
    notebookId,
    ids,
    { at: new Date(parsed.data.beforeAt), id: parsed.data.beforeId },
    undefined,
    { editsOnly: documentId !== undefined },
  );
  const people = await peopleByIds(
    entries.flatMap((e) => [...(e.userId ? [e.userId] : []), ...(e.edit?.replies.map((r) => r.userId) ?? [])]),
  );
  return NextResponse.json({ entries, more, people });
}

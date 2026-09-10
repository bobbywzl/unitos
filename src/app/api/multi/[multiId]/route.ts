import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200),
});

// Rename a multi upload (SPEC.md §22).
export async function PATCH(req: Request, ctx: { params: Promise<{ multiId: string }> }) {
  const t = await serverT();
  const { multiId } = await ctx.params;
  const { data, error } = await parseBody(req, patchSchema);
  if (error) return error;
  const multi = await db.multiUpload.findUnique({ where: { id: multiId } });
  if (!multi) return NextResponse.json({ error: t("api.multiNotFound") }, { status: 404 });
  const access = await notebookAccess(multi.notebookId, "editor");
  if (access instanceof NextResponse) return access;
  const updated = await db.multiUpload.update({
    where: { id: multiId },
    data: { title: data.title },
    select: { id: true, title: true },
  });
  await bumpNotebook(multi.notebookId);
  return NextResponse.json(updated);
}

// Delete a multi upload. Its members and its generated documents stay in
// the project; a generated document keeps its blocks and loses its origin.
export async function DELETE(_req: Request, ctx: { params: Promise<{ multiId: string }> }) {
  const t = await serverT();
  const { multiId } = await ctx.params;
  const multi = await db.multiUpload.findUnique({ where: { id: multiId } });
  if (!multi) return NextResponse.json({ error: t("api.multiNotFound") }, { status: 404 });
  const access = await notebookAccess(multi.notebookId, "editor");
  if (access instanceof NextResponse) return access;
  await db.multiUpload.delete({ where: { id: multiId } });
  await bumpNotebook(multi.notebookId);
  return NextResponse.json({ ok: true });
}

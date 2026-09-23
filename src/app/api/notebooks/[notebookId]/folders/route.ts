import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

const createSchema = z.object({
  title: z.string().trim().min(1).max(80),
  // The folder to make it in; null or absent = the project itself.
  parentId: z.string().min(1).nullable().optional(),
});

// Make a folder (SPEC.md §6): a named group of the project's documents,
// in the project itself or inside another folder of the project.
export async function POST(req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const t = await serverT();
  const { notebookId } = await ctx.params;
  const access = await notebookAccess(notebookId, "editor");
  if (access instanceof NextResponse) return access;
  const { data, error } = await parseBody(req, createSchema);
  if (error) return error;

  const notebook = await db.notebook.findUnique({ where: { id: notebookId }, select: { id: true } });
  if (!notebook) return NextResponse.json({ error: t("api.corpusNotFound") }, { status: 404 });
  const parentId = data.parentId ?? null;
  if (parentId) {
    const parent = await db.documentFolder.findFirst({
      where: { id: parentId, notebookId },
      select: { id: true },
    });
    if (!parent) return NextResponse.json({ error: t("api.parentFolderNotFound") }, { status: 404 });
  }
  const folder = await db.documentFolder.create({
    data: { notebookId, title: data.title, parentId },
    select: { id: true, title: true, parentId: true },
  });
  await bumpNotebook(notebookId);
  return NextResponse.json(folder, { status: 201 });
}

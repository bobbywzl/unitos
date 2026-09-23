import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

// Rename the folder, move it into another folder (null = the project
// itself), or both.
const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(80).optional(),
    parentId: z.string().min(1).nullable().optional(),
  })
  .refine((d) => d.title !== undefined || d.parentId !== undefined, {
    message: "Provide title or parentId",
  });

// True when `folderId` is `candidateId` or one of its ancestors: moving a
// folder there would put it inside itself.
async function containsFolder(folderId: string, candidateId: string): Promise<boolean> {
  let cursor: string | null = candidateId;
  // A folder tree is a few levels deep; the walk stops at the project
  // itself. The bound only guards against a corrupt chain.
  for (let i = 0; cursor && i < 64; i++) {
    if (cursor === folderId) return true;
    const row: { parentId: string | null } | null = await db.documentFolder.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    cursor = row?.parentId ?? null;
  }
  return false;
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ notebookId: string; folderId: string }> },
) {
  const t = await serverT();
  const { notebookId, folderId } = await ctx.params;
  const access = await notebookAccess(notebookId, "editor");
  if (access instanceof NextResponse) return access;
  const { data, error } = await parseBody(req, patchSchema);
  if (error) return error;
  const folder = await db.documentFolder.findFirst({
    where: { id: folderId, notebookId },
    select: { id: true },
  });
  if (!folder) return NextResponse.json({ error: t("api.folderNotFound") }, { status: 404 });
  if (data.parentId) {
    const parent = await db.documentFolder.findFirst({
      where: { id: data.parentId, notebookId },
      select: { id: true },
    });
    if (!parent) return NextResponse.json({ error: t("api.parentFolderNotFound") }, { status: 404 });
    if (await containsFolder(folderId, data.parentId)) {
      return NextResponse.json({ error: t("api.folderIntoItself") }, { status: 400 });
    }
  }
  await db.documentFolder.update({
    where: { id: folderId },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.parentId !== undefined ? { parentId: data.parentId } : {}),
    },
  });
  await bumpNotebook(notebookId);
  return NextResponse.json({ ok: true });
}

// Delete a folder. What it holds — documents and folders — moves up one
// level, into the folder's parent or the project itself; nothing leaves the
// project.
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ notebookId: string; folderId: string }> },
) {
  const t = await serverT();
  const { notebookId, folderId } = await ctx.params;
  const access = await notebookAccess(notebookId, "editor");
  if (access instanceof NextResponse) return access;
  const folder = await db.documentFolder.findFirst({
    where: { id: folderId, notebookId },
    select: { id: true, parentId: true },
  });
  if (!folder) return NextResponse.json({ error: t("api.folderNotFound") }, { status: 404 });
  await db.$transaction([
    db.documentFolder.updateMany({
      where: { parentId: folderId },
      data: { parentId: folder.parentId },
    }),
    db.notebookDocument.updateMany({
      where: { notebookId, folderId },
      data: { folderId: folder.parentId },
    }),
    db.documentFolder.delete({ where: { id: folderId } }),
  ]);
  await bumpNotebook(notebookId);
  return NextResponse.json({ ok: true });
}

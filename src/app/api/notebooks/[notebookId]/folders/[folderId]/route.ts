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
    select: { id: true, parentId: true },
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
      // A move into another list drops the place it had in the old one
      // (Custom order, SPEC.md §6): it lists first in the new one.
      ...(data.parentId !== undefined
        ? { parentId: data.parentId, ...(data.parentId !== folder.parentId ? { position: null } : {}) }
        : {}),
    },
  });
  await bumpNotebook(notebookId);
  return NextResponse.json({ ok: true });
}

// Delete a folder. What it holds — documents and folders — moves up one
// level, into the folder's parent or the project itself; nothing leaves the
// project. The body may name `order`: the parent's list as the reader saw it
// under Custom order, with the folder's rows in the folder's place, in their
// own order (SPEC.md §6). Each named row of the parent's list or the
// folder's list takes its index as its position; a row not named, or every
// row when no order comes, lists first there under Custom order. Only rows
// of this project change.
const deleteSchema = z.object({
  order: z
    .array(z.object({ kind: z.enum(["document", "folder"]), id: z.string().min(1) }))
    .max(2000)
    .optional(),
});

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ notebookId: string; folderId: string }> },
) {
  const t = await serverT();
  const { notebookId, folderId } = await ctx.params;
  const access = await notebookAccess(notebookId, "editor");
  if (access instanceof NextResponse) return access;
  // An empty body is the delete with no order (before 2026-10-09 the client
  // sent none).
  const text = await req.text().catch(() => "");
  let order: { kind: "document" | "folder"; id: string }[] = [];
  if (text.trim()) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: t("api.bodyNotJson") }, { status: 400 });
    }
    const parsed = deleteSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: t("api.validationFailed"), issues: parsed.error.issues }, { status: 400 });
    }
    order = parsed.data.order ?? [];
  }
  const folder = await db.documentFolder.findFirst({
    where: { id: folderId, notebookId },
    select: { id: true, parentId: true },
  });
  if (!folder) return NextResponse.json({ error: t("api.folderNotFound") }, { status: 404 });
  // The rows the order may place: those of the parent's list and the
  // folder's list. A named row that has moved elsewhere since is skipped.
  const lists = [folder.parentId, folderId];
  const [documentRows, folderRows] = await Promise.all([
    order.length
      ? db.notebookDocument.findMany({
          where: { notebookId, OR: lists.map((id) => ({ folderId: id })) },
          select: { documentId: true },
        })
      : [],
    order.length
      ? db.documentFolder.findMany({
          where: { notebookId, id: { not: folderId }, OR: lists.map((id) => ({ parentId: id })) },
          select: { id: true },
        })
      : [],
  ]);
  const documentIds = new Set(documentRows.map((r) => r.documentId));
  const folderIds = new Set(folderRows.map((r) => r.id));
  const seen = new Set<string>();
  const placed = order.filter((item) => {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return item.kind === "document" ? documentIds.has(item.id) : folderIds.has(item.id);
  });
  await db.$transaction([
    db.documentFolder.updateMany({
      where: { parentId: folderId },
      data: { parentId: folder.parentId, position: null },
    }),
    db.notebookDocument.updateMany({
      where: { notebookId, folderId },
      data: { folderId: folder.parentId, position: null },
    }),
    db.documentFolder.delete({ where: { id: folderId } }),
    ...placed.map((item, position) =>
      item.kind === "document"
        ? db.notebookDocument.update({
            where: { notebookId_documentId: { notebookId, documentId: item.id } },
            data: { position },
          })
        : db.documentFolder.update({ where: { id: item.id }, data: { position } }),
    ),
  ]);
  await bumpNotebook(notebookId);
  return NextResponse.json({ ok: true });
}

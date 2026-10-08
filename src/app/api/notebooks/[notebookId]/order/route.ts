import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

// Custom order (SPEC.md §6): one list of the document list — the project
// itself or a folder's own list — in the order a drag left it. Every row
// named lands in that list at its index: a row from another list moves in.
// Rows of the list not named keep a null position and list first. Only
// NotebookDocument and DocumentFolder rows of this project change: a
// document shared with other projects keeps its place there.
const putSchema = z.object({
  // The list: a folder's id, or null = the project itself.
  parentId: z.string().min(1).nullable(),
  items: z
    .array(z.object({ kind: z.enum(["document", "folder"]), id: z.string().min(1) }))
    .min(1)
    .max(2000),
});

export async function PUT(req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const t = await serverT();
  const { notebookId } = await ctx.params;
  const access = await notebookAccess(notebookId, "editor");
  if (access instanceof NextResponse) return access;
  const { data, error } = await parseBody(req, putSchema);
  if (error) return error;

  const folders = await db.documentFolder.findMany({
    where: { notebookId },
    select: { id: true, parentId: true },
  });
  const parentOf = new Map(folders.map((f) => [f.id, f.parentId]));
  if (data.parentId && !parentOf.has(data.parentId)) {
    return NextResponse.json({ error: t("api.parentFolderNotFound") }, { status: 404 });
  }
  const documentIds = data.items.filter((i) => i.kind === "document").map((i) => i.id);
  const folderIds = data.items.filter((i) => i.kind === "folder").map((i) => i.id);
  const attached = await db.notebookDocument.count({
    where: { notebookId, documentId: { in: documentIds } },
  });
  if (attached !== new Set(documentIds).size) {
    return NextResponse.json({ error: t("api.documentNotAttachedToCorpus") }, { status: 404 });
  }
  for (const id of folderIds) {
    if (!parentOf.has(id)) return NextResponse.json({ error: t("api.folderNotFound") }, { status: 404 });
    // A folder never moves into itself: the list's folder may not be the
    // folder or one under it.
    let cursor: string | null = data.parentId;
    for (let i = 0; cursor && i < 64; i++) {
      if (cursor === id) return NextResponse.json({ error: t("api.folderIntoItself") }, { status: 400 });
      cursor = parentOf.get(cursor) ?? null;
    }
  }

  await db.$transaction(
    data.items.map((item, position) =>
      item.kind === "document"
        ? db.notebookDocument.update({
            where: { notebookId_documentId: { notebookId, documentId: item.id } },
            data: { folderId: data.parentId, position },
          })
        : db.documentFolder.update({
            where: { id: item.id },
            data: { parentId: data.parentId, position },
          }),
    ),
  );
  await bumpNotebook(notebookId);
  return NextResponse.json({ ok: true });
}

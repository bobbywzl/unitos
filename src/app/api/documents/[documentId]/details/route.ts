import { NextResponse } from "next/server";
import { z } from "zod";
import { documentAccess, notebookAccess, peopleByIds } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";

const querySchema = z.object({ notebookId: z.string().min(1).max(64) });

// File > Details (SPEC.md §29), Google Docs' Document details: where the
// document sits in the project (the project, then its folders), the
// project's owner, when the text was last saved and by whom, and when the
// document was made. A viewer of the project may read them.
export async function GET(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  const { documentId } = await ctx.params;
  const query = querySchema.safeParse({ notebookId: new URL(req.url).searchParams.get("notebookId") });
  if (!query.success) return NextResponse.json({ error: t("api.validationFailed"), issues: query.error.issues }, { status: 400 });
  const { notebookId } = query.data;
  const access = await documentAccess(documentId, "viewer");
  if (access instanceof NextResponse) return access;
  // The project named must be one the reader can open.
  const project = await notebookAccess(notebookId, "viewer");
  if (project instanceof NextResponse) return project;
  const attached = await db.notebookDocument.findUnique({
    where: { notebookId_documentId: { notebookId, documentId } },
    select: {
      folderId: true,
      notebook: { select: { title: true, userId: true, folders: { select: { id: true, title: true, parentId: true } } } },
      document: { select: { title: true, createdAt: true, richTextSavedAt: true, richTextSavedBy: true } },
    },
  });
  if (!attached) return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });
  const { notebook, document } = attached;
  // The folders from the project's top down to the document's own.
  const byId = new Map(notebook.folders.map((f) => [f.id, f]));
  const folders: string[] = [];
  for (let id = attached.folderId; id && folders.length < 50; id = byId.get(id)?.parentId ?? null) {
    const folder = byId.get(id);
    if (!folder) break;
    folders.unshift(folder.title);
  }
  const savedBy = document.richTextSavedBy;
  const people = await peopleByIds([notebook.userId, ...(savedBy ? [savedBy] : [])]);
  return NextResponse.json({
    title: document.title,
    project: notebook.title,
    folders,
    owner: people[notebook.userId] ?? null,
    ownerIsYou: notebook.userId === access.user.id,
    createdAt: document.createdAt,
    modifiedAt: document.richTextSavedAt ?? document.createdAt,
    modifiedBy: savedBy ? (people[savedBy] ?? null) : null,
    modifiedByYou: savedBy === access.user.id,
  });
}

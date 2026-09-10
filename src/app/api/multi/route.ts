import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

// A multi upload (SPEC.md §22): two or more documents of a project on one
// page. The upload assistant box makes one after a batch add; the document
// list can make one from documents already attached.
const createSchema = z.object({
  notebookId: z.string().min(1),
  documentIds: z.array(z.string().min(1)).min(2).max(40),
  title: z.string().trim().min(1).max(200).optional(),
});

export async function POST(req: Request) {
  const t = await serverT();
  const { data, error } = await parseBody(req, createSchema);
  if (error) return error;
  const access = await notebookAccess(data.notebookId, "editor");
  if (access instanceof NextResponse) return access;
  const ids = [...new Set(data.documentIds)];
  if (ids.length < 2) {
    return NextResponse.json({ error: t("api.multiNeedsTwo") }, { status: 400 });
  }
  const attached = await db.notebookDocument.findMany({
    where: { notebookId: data.notebookId, documentId: { in: ids } },
    select: { documentId: true, document: { select: { title: true } } },
  });
  if (attached.length !== ids.length) {
    return NextResponse.json({ error: t("api.documentNotAttachedToCorpus") }, { status: 404 });
  }
  const titleById = new Map(attached.map((a) => [a.documentId, a.document.title]));
  const title =
    data.title ??
    ids
      .map((id) => titleById.get(id) ?? "")
      .filter(Boolean)
      .join(" · ")
      .slice(0, 200);
  const multi = await db.multiUpload.create({
    data: {
      notebookId: data.notebookId,
      title,
      createdById: access.user.id,
      members: { create: ids.map((documentId, order) => ({ documentId, order })) },
    },
    select: { id: true, title: true },
  });
  await bumpNotebook(data.notebookId);
  return NextResponse.json(multi, { status: 201 });
}

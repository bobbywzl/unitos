import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

const createSchema = z.object({
  notebookId: z.string().min(1),
  title: z.string().min(1).max(200),
  parentId: z.string().min(1).nullish(),
});

export async function POST(req: Request) {
  const t = await serverT();
  const { data, error } = await parseBody(req, createSchema);
  if (error) return error;

  const notebook = await db.notebook.findUnique({ where: { id: data.notebookId } });
  if (!notebook) return NextResponse.json({ error: t("api.corpusNotFound") }, { status: 404 });

  if (data.parentId) {
    const parent = await db.section.findUnique({ where: { id: data.parentId } });
    if (!parent || parent.notebookId !== data.notebookId) {
      return NextResponse.json({ error: t("api.parentSectionNotFound") }, { status: 404 });
    }
    if (parent.parentId) {
      return NextResponse.json({ error: t("api.sectionsNestOneLevel") }, { status: 400 });
    }
  }

  const siblingCount = await db.section.count({
    where: { notebookId: data.notebookId, parentId: data.parentId ?? null },
  });
  const section = await db.section.create({
    data: {
      notebookId: data.notebookId,
      title: data.title,
      parentId: data.parentId ?? null,
      order: siblingCount,
    },
  });
  return NextResponse.json(section, { status: 201 });
}

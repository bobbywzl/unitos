import { NextResponse } from "next/server";
import { notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { JOT_COLORS, jottingsSaveSchema, parseJotPoints, type JotColor, type StoredJotting } from "@/lib/jottings";
import { parseBody } from "@/lib/validate";

// Jottings (SPEC.md §33): the handwriting drawn over a document in one
// project. A jotting belongs to the project it was drawn in, so every call
// names the project and the route checks the document is in it: a document
// row shared by several accounts never carries one account's jottings into
// another account's project.

async function attached(notebookId: string, documentId: string): Promise<boolean> {
  const row = await db.notebookDocument.findUnique({
    where: { notebookId_documentId: { notebookId, documentId } },
    select: { documentId: true },
  });
  return row !== null;
}

async function notInProject(): Promise<NextResponse> {
  const t = await serverT();
  return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });
}

// GET ?notebookId= (viewer): the document's jottings in the project, oldest
// first, erased ones left out. Everyone in the project sees every jotting.
export async function GET(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await ctx.params;
  const notebookId = new URL(req.url).searchParams.get("notebookId") ?? "";
  if (!notebookId) return notInProject();
  const access = await notebookAccess(notebookId, "viewer");
  if (access instanceof NextResponse) return access;
  if (!(await attached(notebookId, documentId))) return notInProject();

  const rows = await db.jotting.findMany({
    where: { notebookId, documentId, erasedAt: null },
    orderBy: { createdAt: "asc" },
  });
  const jottings: StoredJotting[] = [];
  for (const row of rows) {
    const points = parseJotPoints(row.points);
    // A row this code cannot draw is left out of the answer and stays stored.
    if (!points || !JOT_COLORS.includes(row.color as JotColor)) continue;
    jottings.push({
      id: row.id,
      userId: row.userId,
      blockId: row.blockId,
      blockOrder: row.blockOrder,
      layer: row.layer === "core" ? "core" : null,
      color: row.color as JotColor,
      width: row.width,
      aspect: row.aspect,
      points,
    });
  }
  return NextResponse.json({ jottings });
}

// POST (editor): one save — strokes to add, strokes to erase, erased strokes
// to bring back. An add whose id is already stored is skipped, so a save the
// browser sends again after a lost answer changes nothing. Erase and restore
// reach the caller's own jottings only, in this project and this document;
// erase sets erasedAt and deletes no row.
export async function POST(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await ctx.params;
  const { data, error } = await parseBody(req, jottingsSaveSchema);
  if (error) return error;
  const access = await notebookAccess(data.notebookId, "editor");
  if (access instanceof NextResponse) return access;
  if (!(await attached(data.notebookId, documentId))) return notInProject();

  const userId = access.user.id;
  const own = { userId, notebookId: data.notebookId, documentId };
  if (data.add.length > 0) {
    await db.jotting.createMany({
      data: data.add.map((j) => ({ ...j, ...own })),
      skipDuplicates: true,
    });
  }
  if (data.erase.length > 0) {
    await db.jotting.updateMany({
      where: { ...own, id: { in: data.erase }, erasedAt: null },
      data: { erasedAt: new Date() },
    });
  }
  if (data.restore.length > 0) {
    await db.jotting.updateMany({
      where: { ...own, id: { in: data.restore } },
      data: { erasedAt: null },
    });
  }
  return NextResponse.json({ ok: true });
}

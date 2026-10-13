import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { readStructure, structureBodySchema, STRUCTURE_VERSION, tidy, type Structure } from "@/lib/structure";
import { parseBody } from "@/lib/validate";

// Breakwork (SPEC.md §32): the document's structure in this project. GET
// (viewer) answers the stored structure, or an empty one. PUT (editor)
// replaces it whole: the reader's canvas is the source of truth, saved a
// moment after every change. A save names the rev it was built on; a save
// from an older rev is refused with 409 and the current structure, so two
// editors never write over each other's moves — the browser reloads and the
// reader makes the change again. Nothing here touches the document's blocks,
// notes, or annotations: a structure is one JSON column of the attachment.

const putSchema = structureBodySchema.extend({ baseRev: z.number().int().nonnegative() });

async function load(notebookId: string, documentId: string) {
  const attachment = await db.notebookDocument.findUnique({
    where: { notebookId_documentId: { notebookId, documentId } },
    select: { structure: true },
  });
  return attachment ? readStructure(attachment.structure) : null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ notebookId: string; documentId: string }> }) {
  const t = await serverT();
  const { notebookId, documentId } = await ctx.params;
  const access = await notebookAccess(notebookId, "viewer");
  if (access instanceof NextResponse) return access;
  const structure = await load(notebookId, documentId);
  if (!structure) return NextResponse.json({ error: t("api.documentNotAttached") }, { status: 404 });
  return NextResponse.json({ ok: true, structure });
}

export async function PUT(req: Request, ctx: { params: Promise<{ notebookId: string; documentId: string }> }) {
  const t = await serverT();
  const { notebookId, documentId } = await ctx.params;
  const access = await notebookAccess(notebookId, "editor");
  if (access instanceof NextResponse) return access;
  const { data, error } = await parseBody(req, putSchema);
  if (error) return error;
  const current = await load(notebookId, documentId);
  if (!current) return NextResponse.json({ error: t("api.documentNotAttached") }, { status: 404 });
  if (data.baseRev !== current.rev) {
    return NextResponse.json({ error: t("api.structureStale"), structure: current }, { status: 409 });
  }
  const { baseRev: _base, ...body } = data;
  void _base;
  const next: Structure = { v: STRUCTURE_VERSION, rev: current.rev + 1, ...tidy(body) };
  await db.notebookDocument.update({
    where: { notebookId_documentId: { notebookId, documentId } },
    data: { structure: next as unknown as Prisma.InputJsonValue },
  });
  await bumpNotebook(notebookId);
  return NextResponse.json({ ok: true, structure: next });
}

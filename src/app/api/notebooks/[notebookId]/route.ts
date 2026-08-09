import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseBody } from "@/lib/validate";

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await ctx.params;
  const { data, error } = await parseBody(req, patchSchema);
  if (error) return error;
  const notebook = await db.notebook.update({ where: { id: notebookId }, data }).catch(() => null);
  if (!notebook) return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  return NextResponse.json(notebook);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await ctx.params;
  const notebook = await db.notebook.delete({ where: { id: notebookId } }).catch(() => null);
  if (!notebook) return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

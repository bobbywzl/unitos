import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseBody } from "@/lib/validate";

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  // Context override for this notebook; null clears it (SPEC.md §3). Every field
  // is optional: the Context tab saves whatever is filled.
  profile: z
    .object({
      background: z.string().max(2000),
      purpose: z.string().max(2000),
      application: z.string().max(2000),
    })
    .nullable()
    .optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await ctx.params;
  const { data, error } = await parseBody(req, patchSchema);
  if (error) return error;
  // An all-empty override is no override: store null so prompts fall back to the
  // global context.
  const profileValue =
    data.profile === null ||
    (data.profile !== undefined &&
      !data.profile.background.trim() &&
      !data.profile.purpose.trim() &&
      !data.profile.application.trim())
      ? Prisma.JsonNull
      : data.profile;
  const notebook = await db.notebook
    .update({
      where: { id: notebookId },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.profile !== undefined ? { profile: profileValue } : {}),
      },
    })
    .catch(() => null);
  if (!notebook) return NextResponse.json({ error: "Corpus not found" }, { status: 404 });
  return NextResponse.json(notebook);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await ctx.params;
  const notebook = await db.notebook.delete({ where: { id: notebookId } }).catch(() => null);
  if (!notebook) return NextResponse.json({ error: "Corpus not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

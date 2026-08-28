import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { corpusDistillationList } from "@/lib/types";
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
  // Delete one stored corpus distillation (SPEC.md §13).
  removeDistillationId: z.string().min(1).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const t = await serverT();
  const { notebookId } = await ctx.params;
  const access = await notebookAccess(notebookId, "editor");
  if (access instanceof NextResponse) return access;
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
  let removeDistillations: { distillations: object[] } | null = null;
  if (data.removeDistillationId) {
    const row = await db.notebook.findUnique({
      where: { id: notebookId },
      select: { distillations: true },
    });
    removeDistillations = {
      distillations: corpusDistillationList(row?.distillations).filter(
        (d) => d.id !== data.removeDistillationId,
      ),
    };
  }
  const notebook = await db.notebook
    .update({
      where: { id: notebookId },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.profile !== undefined ? { profile: profileValue } : {}),
        ...(removeDistillations ?? {}),
      },
    })
    .catch(() => null);
  if (!notebook) return NextResponse.json({ error: t("api.corpusNotFound") }, { status: 404 });
  await bumpNotebook(notebookId);
  return NextResponse.json(notebook);
}

// Deleting a corpus is the owner's alone; an editor edits, never removes.
export async function DELETE(_req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const t = await serverT();
  const { notebookId } = await ctx.params;
  const access = await notebookAccess(notebookId, "owner");
  if (access instanceof NextResponse) return access;
  const notebook = await db.notebook.delete({ where: { id: notebookId } }).catch(() => null);
  if (!notebook) return NextResponse.json({ error: t("api.corpusNotFound") }, { status: 404 });
  return NextResponse.json({ ok: true });
}

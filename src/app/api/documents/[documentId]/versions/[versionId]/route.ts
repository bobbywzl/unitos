import { NextResponse } from "next/server";
import { z } from "zod";
import { documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

const renameSchema = z.object({ name: z.string().trim().min(1).max(100).nullable() });

type Ctx = { params: Promise<{ documentId: string; versionId: string }> };

// One version of a blank document (SPEC.md §29). GET reads its rich text;
// PATCH is Name this version (null takes the name away).
export async function GET(_req: Request, ctx: Ctx) {
  const t = await serverT();
  const { documentId, versionId } = await ctx.params;
  const access = await documentAccess(documentId, "viewer");
  if (access instanceof NextResponse) return access;
  const version = await db.documentVersion.findFirst({
    where: { id: versionId, documentId },
    select: { richText: true },
  });
  if (!version) return NextResponse.json({ error: t("api.versionNotFound") }, { status: 404 });
  return NextResponse.json(version);
}

export async function PATCH(req: Request, ctx: Ctx) {
  const t = await serverT();
  const { documentId, versionId } = await ctx.params;
  const access = await documentAccess(documentId, "editor");
  if (access instanceof NextResponse) return access;
  const { data, error } = await parseBody(req, renameSchema);
  if (error) return error;
  const { count } = await db.documentVersion.updateMany({ where: { id: versionId, documentId }, data: { name: data.name } });
  if (count === 0) return NextResponse.json({ error: t("api.versionNotFound") }, { status: 404 });
  return NextResponse.json({ id: versionId, name: data.name });
}

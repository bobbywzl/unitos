import { NextResponse } from "next/server";
import { z } from "zod";
import { documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { readPageSetup, type RichNode } from "@/lib/docs/schema";
import { figureMedia } from "@/lib/docs/server";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

const renameSchema = z.object({ name: z.string().trim().min(1).max(100).nullable() });

type Ctx = { params: Promise<{ documentId: string; versionId: string }> };

// One version of a blank document (SPEC.md §29). GET reads its rich text
// and the media of the figure objects it holds (SPEC.md §30: the page sends
// only the media of the text as it stands); PATCH is Name this version
// (null takes the name away).
export async function GET(_req: Request, ctx: Ctx) {
  const t = await serverT();
  const { documentId, versionId } = await ctx.params;
  const access = await documentAccess(documentId, "viewer");
  if (access instanceof NextResponse) return access;
  const version = await db.documentVersion.findFirst({
    where: { id: versionId, documentId },
    select: { richText: true, document: { select: { pageSetup: true } } },
  });
  if (!version) return NextResponse.json({ error: t("api.versionNotFound") }, { status: 404 });
  const richText = version.richText as unknown as RichNode;
  const figures = await figureMedia(documentId, richText, readPageSetup(version.document.pageSetup));
  return NextResponse.json({ richText, figures: figures ?? {} });
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

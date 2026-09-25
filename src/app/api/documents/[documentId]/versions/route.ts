import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { documentAccess, peopleByIds } from "@/lib/collab";
import { db } from "@/lib/db";
import type { RichNode } from "@/lib/docs/schema";
import { isEmptyRichText } from "@/lib/docs/versions";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

const keepSchema = z.object({ name: z.string().trim().min(1).max(100).optional() });

const VERSION_FIELDS = { id: true, rev: true, savedAt: true, userId: true, name: true } as const;

// A blank document's version history (SPEC.md §29). GET lists the versions,
// newest first, with the current version (the live document) and the people
// who saved them. POST keeps the live text as a version at once: Name current
// version names it (or the version that already holds it), and Restore this
// version keeps the text it replaces.
export async function GET(_req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  const { documentId } = await ctx.params;
  const access = await documentAccess(documentId, "viewer");
  if (access instanceof NextResponse) return access;
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: {
      richTextRev: true,
      richTextSavedAt: true,
      richTextSavedBy: true,
      createdAt: true,
      versions: { orderBy: { rev: "desc" }, select: VERSION_FIELDS },
    },
  });
  if (!document) return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });
  const current = {
    rev: document.richTextRev,
    savedAt: document.richTextSavedAt ?? document.createdAt,
    userId: document.richTextSavedBy,
  };
  const ids = [current.userId, ...document.versions.map((v) => v.userId)].filter((id): id is string => Boolean(id));
  return NextResponse.json({ current, versions: document.versions, people: await peopleByIds(ids) });
}

export async function POST(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  const { documentId } = await ctx.params;
  const access = await documentAccess(documentId, "editor");
  if (access instanceof NextResponse) return access;
  const { data, error } = await parseBody(req, keepSchema);
  if (error) return error;
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: { richText: true, richTextRev: true, richTextSavedAt: true, richTextSavedBy: true },
  });
  if (!document?.richText) return NextResponse.json({ error: t("api.notBlankDocument") }, { status: 400 });
  if (isEmptyRichText(document.richText as unknown as RichNode)) {
    return NextResponse.json({ error: t("api.versionEmpty") }, { status: 400 });
  }
  const version = await db.documentVersion.upsert({
    where: { documentId_rev: { documentId, rev: document.richTextRev } },
    create: {
      documentId,
      rev: document.richTextRev,
      richText: document.richText as Prisma.InputJsonValue,
      userId: document.richTextSavedBy,
      name: data.name ?? null,
      savedAt: document.richTextSavedAt ?? new Date(),
    },
    update: data.name ? { name: data.name } : {},
    select: VERSION_FIELDS,
  });
  return NextResponse.json(version);
}

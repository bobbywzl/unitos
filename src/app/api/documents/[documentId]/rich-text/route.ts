import type { Prisma } from "@prisma/client";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { bumpDocument, documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { hasBlockIds } from "@/lib/docs/blocks";
import { MAX_RICH_TEXT_CHARS, pageSetupSchema, richDocSchema, sanitizeRichText } from "@/lib/docs/schema";
import { importShared, importSharedResponse } from "@/lib/docs/server";
import { syncRichText } from "@/lib/docs/sync";
import { refreshSkeleton } from "@/lib/graph/skeleton";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

const saveSchema = z.object({
  richText: richDocSchema,
  // The revision the editor's copy started from (SPEC.md §29).
  rev: z.number().int().min(0),
});

const setupSchema = z.object({ pageSetup: pageSetupSchema });

// A document's rich text, a blank document's or an import's (SPEC.md §29).
// GET reads it with its revision; PUT saves the editor's copy, which must
// start from the stored revision — an older one answers 409 with the stored
// copy, never a silent overwrite; PATCH sets the page setup. PUT and PATCH
// refuse an import shared across accounts (403).
export async function GET(_req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  const { documentId } = await ctx.params;
  const access = await documentAccess(documentId, "viewer");
  if (access instanceof NextResponse) return access;
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: { richText: true, richTextRev: true, pageSetup: true },
  });
  if (!document?.richText) return NextResponse.json({ error: t("api.notBlankDocument") }, { status: 404 });
  return NextResponse.json({ richText: document.richText, rev: document.richTextRev, pageSetup: document.pageSetup });
}

export async function PUT(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  const { documentId } = await ctx.params;
  const access = await documentAccess(documentId, "editor");
  if (access instanceof NextResponse) return access;
  if (await importShared(documentId)) return importSharedResponse(t);
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_RICH_TEXT_CHARS) {
    return NextResponse.json({ error: t("api.richTextTooLarge") }, { status: 413 });
  }
  const { data, error } = await parseBody(req, saveSchema);
  if (error) return error;
  const document = await db.document.findUnique({ where: { id: documentId }, select: { richText: true } });
  if (!document?.richText) return NextResponse.json({ error: t("api.notBlankDocument") }, { status: 400 });
  const richText = sanitizeRichText(data.richText);
  if (!richText || !hasBlockIds(richText)) {
    return NextResponse.json({ error: t("api.richTextInvalid") }, { status: 400 });
  }
  const result = await syncRichText({ documentId, richText, userId: access.user.id, baseRev: data.rev });
  if (!result.ok) {
    if (result.reason === "rev") {
      return NextResponse.json(
        { error: t("api.richTextConflict"), reason: "rev", rev: result.rev, richText: result.richText },
        { status: 409 },
      );
    }
    if (result.reason === "ids") {
      return NextResponse.json({ error: t("api.richTextConflict"), reason: "ids", ids: result.ids }, { status: 409 });
    }
    return NextResponse.json({ error: t("api.richTextInvalid") }, { status: 400 });
  }
  const notebookRevs = await bumpDocument(documentId);
  // The skeleton rebuilds after the response once more than a tenth of the
  // document has changed (SPEC.md §22); under that the check is all it does.
  after(() => refreshSkeleton(documentId, access.user.id).catch(() => {}));
  // The page that saved needs no refresh for its own save unless a mark was
  // lost or found again (components/collab/use-sync.ts).
  return NextResponse.json({ rev: result.rev, notebookRevs: result.marksChanged ? {} : notebookRevs, marksChanged: result.marksChanged });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  const { documentId } = await ctx.params;
  const access = await documentAccess(documentId, "editor");
  if (access instanceof NextResponse) return access;
  if (await importShared(documentId)) return importSharedResponse(t);
  const { data, error } = await parseBody(req, setupSchema);
  if (error) return error;
  const document = await db.document.findUnique({ where: { id: documentId }, select: { richText: true } });
  if (!document?.richText) return NextResponse.json({ error: t("api.notBlankDocument") }, { status: 400 });
  // The header and the footer are rich text: each goes through the
  // sanitizer a save runs, so no setup can carry markup into the page.
  const pageSetup = { ...data.pageSetup };
  for (const key of ["header", "footer", "firstHeader", "firstFooter"] as const) {
    const value = pageSetup[key];
    if (value) pageSetup[key] = sanitizeRichText(value);
  }
  await db.document.update({
    where: { id: documentId },
    data: { pageSetup: pageSetup as unknown as Prisma.InputJsonValue },
  });
  await bumpDocument(documentId);
  return NextResponse.json({ pageSetup });
}

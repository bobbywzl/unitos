import { NextResponse } from "next/server";
import { documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { docxComments, richTextDocx } from "@/lib/docs/export";
import { readPageSetup, type RichNode } from "@/lib/docs/schema";
import { figureMedia } from "@/lib/docs/server";
import { serverT } from "@/lib/i18n/server";

export const maxDuration = 60;

// File > Download > Microsoft Word (.docx) of a document with rich text, a
// blank document or an import (SPEC.md §29, §30). A download is a read:
// viewers download too. The other formats are made in the browser from the
// page (components/docs/page/download.ts).
export async function GET(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  const { documentId } = await ctx.params;
  const access = await documentAccess(documentId, "viewer");
  if (access instanceof NextResponse) return access;
  const url = new URL(req.url);
  if (url.searchParams.get("format") !== "docx") {
    return NextResponse.json({ error: t("api.documentExportFormatInvalid") }, { status: 400 });
  }
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: { title: true, richText: true, pageSetup: true, sourceUrl: true },
  });
  if (!document?.richText) return NextResponse.json({ error: t("api.notBlankDocument") }, { status: 404 });
  const richText = document.richText as unknown as RichNode;
  const setup = readPageSetup(document.pageSetup);
  const media = (await figureMedia(documentId, richText, setup)) ?? {};
  // A PDF figure is the crop of its page: the PDF is read only when one is there.
  const crops = Object.values(media).some((m) => m.html === null && m.page !== null);
  const file = crops ? await db.document.findUnique({ where: { id: documentId }, select: { fileData: true } }) : null;
  const docx = await richTextDocx(document.title, richText, setup, url.origin, await docxComments(documentId, access.user), {
    media,
    pdf: file?.fileData ? new Uint8Array(file.fileData) : null,
    pageUrl: document.sourceUrl,
  });
  return new NextResponse(new Uint8Array(docx), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  });
}

import { NextResponse } from "next/server";
import { documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { richTextDocx } from "@/lib/docs/export";
import { readPageSetup, type RichNode } from "@/lib/docs/schema";
import { serverT } from "@/lib/i18n/server";

export const maxDuration = 60;

// File > Download > Microsoft Word (.docx) of a blank document (SPEC.md §29).
// A download is a read: viewers download too. The other formats are made in
// the browser from the page (components/docs/page/download.ts).
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
    select: { title: true, richText: true, pageSetup: true },
  });
  if (!document?.richText) return NextResponse.json({ error: t("api.notBlankDocument") }, { status: 404 });
  const file = await richTextDocx(
    document.title,
    document.richText as unknown as RichNode,
    readPageSetup(document.pageSetup),
    url.origin,
  );
  return new NextResponse(new Uint8Array(file), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  });
}

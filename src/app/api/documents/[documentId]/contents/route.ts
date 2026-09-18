import { NextResponse } from "next/server";
import { documentAccess } from "@/lib/collab";
import { buildContents, contentsEntries, headingContents } from "@/lib/contents";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { kimiConfigured } from "@/lib/kimi";

export const maxDuration = 120;

// The contents of a document (SPEC.md §26). Stored: answered as they are,
// no model call. None: one model call builds and stores them. A failed
// call answers the document's headings instead, with `fallback: true`, and
// stores nothing, so the next open tries the model again. A viewer reads
// what is stored and, with nothing stored, the headings.
export async function POST(_req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  const { documentId } = await ctx.params;
  const access = await documentAccess(documentId, "viewer");
  if (access instanceof NextResponse) return access;
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: {
      contents: true,
      blocks: {
        orderBy: { order: "asc" },
        select: { id: true, type: true, text: true, order: true, html: true },
      },
    },
  });
  if (!document) return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });
  const stored = contentsEntries(document.contents);
  if (stored.length > 0) return NextResponse.json({ ok: true, parts: stored, fallback: false });
  const headings = headingContents(document.blocks);
  if (access.role === "viewer" || !kimiConfigured()) {
    return NextResponse.json({ ok: true, parts: headings, fallback: true });
  }
  try {
    const parts = await buildContents(documentId, access.user.id);
    return NextResponse.json({ ok: true, parts: parts.length > 0 ? parts : headings, fallback: parts.length === 0 });
  } catch (err) {
    console.error("Contents failed:", err);
    return NextResponse.json({ ok: true, parts: headings, fallback: true });
  }
}

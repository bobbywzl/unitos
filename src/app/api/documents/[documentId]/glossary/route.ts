import { NextResponse } from "next/server";
import { bumpDocument, documentAccess } from "@/lib/collab";
import { buildGlossary } from "@/lib/glossary";
import { serverT } from "@/lib/i18n/server";
import { kimiConfigured } from "@/lib/kimi";

export const maxDuration = 120;

// Build or rebuild the document glossary.
export async function POST(_req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  if (!kimiConfigured()) {
    return NextResponse.json({ error: t("api.glossaryNeedsKey") }, { status: 503 });
  }
  const { documentId } = await ctx.params;
  const access = await documentAccess(documentId, "editor");
  if (access instanceof NextResponse) return access;
  try {
    const count = await buildGlossary(documentId);
    if (count === 0) return NextResponse.json({ error: t("api.documentNotFoundOrEmpty") }, { status: 404 });
    await bumpDocument(documentId);
    return NextResponse.json({ ok: true, termCount: count });
  } catch (err) {
    console.error("Glossary failed:", err);
    return NextResponse.json({ error: t("api.glossaryFailed") }, { status: 422 });
  }
}

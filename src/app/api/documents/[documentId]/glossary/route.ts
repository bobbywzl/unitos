import { NextResponse } from "next/server";
import { buildGlossary } from "@/lib/glossary";
import { serverT } from "@/lib/i18n/server";

export const maxDuration = 120;

// Build or rebuild the document glossary.
export async function POST(_req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: t("api.glossaryNeedsKey") }, { status: 503 });
  }
  const { documentId } = await ctx.params;
  try {
    const count = await buildGlossary(documentId);
    if (count === 0) return NextResponse.json({ error: t("api.documentNotFoundOrEmpty") }, { status: 404 });
    return NextResponse.json({ ok: true, termCount: count });
  } catch (err) {
    console.error("Glossary failed:", err);
    return NextResponse.json({ error: t("api.glossaryFailed") }, { status: 422 });
  }
}

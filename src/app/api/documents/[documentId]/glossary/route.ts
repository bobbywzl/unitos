import { NextResponse } from "next/server";
import { buildGlossary } from "@/lib/glossary";

export const maxDuration = 120;

// Build or rebuild the document glossary.
export async function POST(_req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set. Glossary extraction needs it." },
      { status: 503 },
    );
  }
  const { documentId } = await ctx.params;
  try {
    const count = await buildGlossary(documentId);
    if (count === 0) return NextResponse.json({ error: "Document not found or empty" }, { status: 404 });
    return NextResponse.json({ ok: true, termCount: count });
  } catch (err) {
    console.error("Glossary failed:", err);
    return NextResponse.json({ error: "Glossary extraction failed" }, { status: 422 });
  }
}

import { NextResponse } from "next/server";
import { reparseDocument } from "@/lib/parse/ingest";

export const maxDuration = 120;

// Forced re-parse. Block ids change; anchors must survive via quote fallback (SPEC.md §5).
export async function POST(_req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await ctx.params;
  try {
    const document = await reparseDocument(documentId);
    if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Re-parse failed:", err);
    return NextResponse.json({ error: "Re-parse failed" }, { status: 422 });
  }
}

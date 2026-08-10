import { NextResponse } from "next/server";

export const maxDuration = 120;

// Forced re-parse. Block ids change; anchors must survive via quote fallback (SPEC.md §5).
export async function POST(_req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await ctx.params;
  try {
    // Parse chain (jsdom, unpdf) loads per request; see /api/documents.
    const { reparseDocument } = await import("@/lib/parse/ingest");
    const document = await reparseDocument(documentId);
    if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Re-parse failed:", err);
    const message = err instanceof Error ? err.message : "Re-parse failed";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

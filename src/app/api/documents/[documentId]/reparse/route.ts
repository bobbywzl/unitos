import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ndjsonWriter } from "@/lib/ndjson";

export const maxDuration = 120;

// Forced re-parse with the current parser. Block ids change; anchors must
// survive via quote fallback (SPEC.md §5). Streams the same stage events as
// /api/documents so the client shows the same progress card.
export async function POST(_req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await ctx.params;

  // Parse chain (jsdom, unpdf) loads per request; see /api/documents.
  let parse: typeof import("@/lib/parse/ingest");
  try {
    parse = await import("@/lib/parse/ingest");
  } catch (err) {
    console.error("Parse module load failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Document parsing is unavailable: ${message}` },
      { status: 500 },
    );
  }

  const document = await db.document.findUnique({ where: { id: documentId }, select: { id: true } });
  if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = ndjsonWriter(controller);
      try {
        const updated = await parse.reparseDocument(documentId, (stage, detail) =>
          send({ stage, detail }),
        );
        if (!updated) send({ error: "Document not found" });
        else send({ id: updated.id, title: updated.title, deduped: false });
      } catch (err) {
        console.error("Re-parse failed:", err);
        send({ error: err instanceof Error ? err.message : "Re-parse failed" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}

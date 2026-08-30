import { NextResponse } from "next/server";
import { bumpDocument, documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { ndjsonWriter } from "@/lib/ndjson";

export const maxDuration = 120;

// Forced re-parse with the current parser. Block ids change; anchors must
// survive via quote fallback (SPEC.md §5). Streams the same stage events as
// /api/documents so the client shows the same progress card.
export async function POST(_req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  const { documentId } = await ctx.params;
  const access = await documentAccess(documentId, "editor");
  if (access instanceof NextResponse) return access;

  // Parse chain (jsdom, unpdf) loads per request; see /api/documents.
  let parse: typeof import("@/lib/parse/ingest");
  try {
    parse = await import("@/lib/parse/ingest");
  } catch (err) {
    console.error("Parse module load failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: t("api.parsingUnavailable", { message }) },
      { status: 500 },
    );
  }

  const document = await db.document.findUnique({
    where: { id: documentId },
    select: { id: true, video: { select: { id: true } } },
  });
  if (!document) return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });
  // A video document's blocks are its player and transcript — re-parsing its
  // sourceUrl as an article would replace them (SPEC.md §11).
  if (document.video) {
    return NextResponse.json({ error: t("api.videoNoReparse") }, { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = ndjsonWriter(controller);
      try {
        const updated = await parse.reparseDocument(documentId, (stage, detail) =>
          send({ stage, detail }),
        );
        if (!updated) send({ error: t("api.documentNotFound") });
        else {
          await bumpDocument(documentId);
          send({ id: updated.id, title: updated.title, deduped: false });
        }
      } catch (err) {
        console.error("Re-parse failed:", err);
        const message = err instanceof Error ? err.message : null;
        send({
          error:
            message === "Could not extract readable content"
              ? t("api.unreadableContent")
              : message
                ? t("api.reparseFailedReason", { reason: message })
                : t("api.reparseFailed"),
        });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}

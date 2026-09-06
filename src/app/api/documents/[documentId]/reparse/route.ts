import { after, NextResponse } from "next/server";
import { z } from "zod";
import { bumpDocument, documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { buildGlossary } from "@/lib/glossary";
import { runConversion } from "@/lib/handwritten/convert";
import { currentLang, serverT } from "@/lib/i18n/server";
import { ndjsonHeartbeat, ndjsonWriter } from "@/lib/ndjson";
import { modelPassDeadline } from "@/lib/parse/ingest";
import { describeIngestError } from "@/lib/parse/ingest-error";

// A URL re-parse runs the same model passes as an add (SPEC.md §2); the
// passes get the same time budget the add gets.
export const maxDuration = 300;

// The body is optional: no body re-parses in the document's shape; `as` flips
// a PDF between article and handwritten (SPEC.md §16) — the escape hatch when
// Import PDF judged it wrong.
const bodySchema = z.object({ as: z.enum(["article", "handwritten"]).optional() });

// Forced re-parse with the current parser. Block ids change; anchors must
// survive via quote fallback (SPEC.md §5). Streams the same stage events as
// /api/documents so the client shows the same progress card.
export async function POST(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  // Captured now: the after() scans below outlive the request and its cookies.
  const lang = await currentLang();
  const { documentId } = await ctx.params;
  const access = await documentAccess(documentId, "editor");
  if (access instanceof NextResponse) return access;
  const raw: unknown = await req.json().catch(() => ({}));
  const body = bodySchema.safeParse(raw ?? {});
  if (!body.success) {
    return NextResponse.json({ error: t("api.validationFailed") }, { status: 400 });
  }
  const as = body.data.as;

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
    select: { id: true, fileHash: true, video: { select: { id: true } } },
  });
  if (!document) return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });
  // A video document's blocks are its player and transcript — re-parsing its
  // sourceUrl as an article would replace them (SPEC.md §11).
  if (document.video) {
    return NextResponse.json({ error: t("api.videoNoReparse") }, { status: 400 });
  }
  // A shape switch needs the PDF bytes.
  if (as && document.fileHash === null) {
    return NextResponse.json({ error: t("api.shapeSwitchNeedsPdf") }, { status: 400 });
  }

  const userId = access.user.id;
  // The model passes must finish inside the route's time; past the budget a
  // pass is skipped and the mechanical parse stands (SPEC.md §2).
  const deadline = modelPassDeadline(maxDuration);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = ndjsonWriter(controller);
      const stopHeartbeat = ndjsonHeartbeat(controller);
      try {
        const updated = await parse.reparseDocument(
          documentId,
          (stage, detail) => send({ stage, detail }),
          as,
          deadline,
          userId,
        );
        if (!updated) send({ error: t("api.documentNotFound") });
        else {
          await bumpDocument(documentId);
          // A switch to handwritten starts conversion on its own, like a
          // fresh import (SPEC.md §16).
          if (as === "handwritten") {
            after(() =>
              runConversion(documentId, userId)
                .then((r) => (r.ok ? buildGlossary(documentId, userId, lang) : undefined))
                .catch(() => {}),
            );
          }
          send({ id: updated.id, title: updated.title, deduped: false });
        }
      } catch (err) {
        console.error("Re-parse failed:", err);
        send({ error: describeIngestError(err, t, "reparse") });
      } finally {
        stopHeartbeat();
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}

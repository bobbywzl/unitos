import { after, NextResponse } from "next/server";
import { z } from "zod";
import { bumpDocument, documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { importShared } from "@/lib/docs/server";
import { refreshSkeleton } from "@/lib/graph/skeleton";
import { runConversion } from "@/lib/handwritten/convert";
import { renderPageImages } from "@/lib/handwritten/page-images";
import { serverT } from "@/lib/i18n/server";
import { ndjsonHeartbeat, ndjsonWriter } from "@/lib/ndjson";
import { modelPassDeadline } from "@/lib/parse/ingest";
import { describeIngestError } from "@/lib/parse/ingest-error";

// A URL re-parse runs the same model passes as an add (SPEC.md §2); the
// passes get the same time budget the add gets.
export const maxDuration = 300;
// A re-parse stamp older than this is a dead run: the route's time budget
// plus a margin.
const REPARSE_STALE_MS = (maxDuration + 60) * 1000;

// The body is optional: no body re-parses in the document's shape; `as` flips
// a PDF between article and handwritten (SPEC.md §16) — the escape hatch when
// Import PDF judged it wrong. replaceEdits: the reader said yes to replacing
// an import's edits since it was imported (SPEC.md §29; the document menu
// asks first).
const bodySchema = z.object({
  as: z.enum(["article", "handwritten"]).optional(),
  replaceEdits: z.boolean().optional(),
});

// Forced re-parse with the current parser. Block ids change; anchors must
// survive via quote fallback (SPEC.md §5); an import's rows keep their ids
// where the words match (SPEC.md §29). Streams the same stage events as
// /api/documents so the client shows the same progress card. An import
// edited since it was imported answers 409 "edited" unless the body carries
// replaceEdits: the silent runs (the figure run on open) stop there.
export async function POST(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  const { documentId } = await ctx.params;
  const access = await documentAccess(documentId, "editor");
  if (access instanceof NextResponse) return access;
  const raw: unknown = await req.json().catch(() => ({}));
  const body = bodySchema.safeParse(raw ?? {});
  if (!body.success) {
    return NextResponse.json({ error: t("api.validationFailed") }, { status: 400 });
  }
  const { as, replaceEdits = false } = body.data;

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
    select: {
      id: true,
      fileHash: true,
      handwritten: true,
      richTextRev: true,
      importRev: true,
      video: { select: { id: true } },
    },
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
  // An import edited since it was imported (SPEC.md §29): the re-parse would
  // replace the edits, so it waits for the reader's yes. The document menu
  // shows this answer as its question, never as an error.
  const edited = document.importRev !== null && document.richTextRev > document.importRev;
  if (edited && !replaceEdits) {
    return NextResponse.json({ error: t("api.importEdited"), reason: "edited" }, { status: 409 });
  }
  // Another account's project holds the import too: its edits are not this
  // reader's to replace, as its words are not theirs to edit.
  if (edited && (await importShared(documentId))) {
    return NextResponse.json({ error: t("api.importShared"), reason: "shared" }, { status: 403 });
  }

  // One re-parse per document at a time. Every open of a stale document
  // starts the automatic upgrade re-parse (document-bar.tsx); two tabs or a
  // reload must not run two full parses of the same document. The stamp
  // claims the run; a claim older than the time budget is a dead run.
  const claimed = await db.document.updateMany({
    where: {
      id: documentId,
      OR: [
        { reparseStartedAt: null },
        { reparseStartedAt: { lt: new Date(Date.now() - REPARSE_STALE_MS) } },
      ],
    },
    data: { reparseStartedAt: new Date() },
  });
  if (claimed.count === 0) {
    return NextResponse.json({ error: t("api.reparseRunning") }, { status: 409 });
  }
  const releaseClaim = () =>
    db.document
      .updateMany({ where: { id: documentId }, data: { reparseStartedAt: null } })
      .catch(() => {});

  const userId = access.user.id;
  // The model passes must finish inside the route's time; past the budget a
  // pass is skipped and the mechanical parse stands (SPEC.md §2).
  const deadline = modelPassDeadline(maxDuration);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = ndjsonWriter(controller);
      const stopHeartbeat = ndjsonHeartbeat(controller);
      try {
        const updated = await parse.reparseDocument(documentId, (stage, detail) => send({ stage, detail }), {
          as,
          deadline,
          userId,
          replaceEdits,
        });
        if (!updated) send({ error: t("api.documentNotFound") });
        else {
          await bumpDocument(documentId);
          // Handwritten pages — a switch to them, or a re-parse in that
          // shape — start conversion on their own, like a fresh import
          // (SPEC.md §16).
          if (as === "handwritten" || (as === undefined && document.handwritten)) {
            // The rebuilt pages render and store after the response (SPEC.md §16).
            after(() => renderPageImages(documentId).catch(() => {}));
            after(() => runConversion(documentId, userId).catch(() => {}));
          } else {
            // The blocks are new: the skeleton builds again (SPEC.md §22).
            after(() => refreshSkeleton(documentId, userId).catch(() => {}));
          }
          send({ id: updated.id, title: updated.title, deduped: false });
        }
      } catch (err) {
        // Edited while the parse ran: nothing was written, and the menu asks.
        if (err instanceof parse.ImportEditedError) send({ error: t("api.importEdited"), reason: "edited" });
        else {
          console.error("Re-parse failed:", err);
          send({ error: describeIngestError(err, t, "reparse") });
        }
      } finally {
        await releaseClaim();
        stopHeartbeat();
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}

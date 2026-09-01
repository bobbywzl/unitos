import { createHash } from "node:crypto";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
import { buildConnections } from "@/lib/connect";
import { buildGlossary } from "@/lib/glossary";
import { runConversion } from "@/lib/handwritten/convert";
import { serverT } from "@/lib/i18n/server";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { progressResponse } from "@/lib/ingest-response";
import { attachDocument } from "@/lib/parse/attach";
import { sniffMedia } from "@/lib/video/storage";
import { runTranscription } from "@/lib/video/transcription-job";
import { MAX_VIDEO_BYTES, UPLOAD_CHUNK_BYTES } from "@/lib/video/types";
import { parseBody } from "@/lib/validate";

// Media uploads kick off transcription in after(); a long audio's chunked run
// plus the cleanup pass needs the headroom.
export const maxDuration = 300;

const MAX_PDF_BYTES = 50 * 1024 * 1024;

const bodySchema = z.object({
  uploadId: z.string().regex(/^[a-zA-Z0-9-]{8,64}$/),
  filename: z.string().min(1),
  notebookId: z.string().min(1),
  kind: z.enum(["pdf", "video"]).default("pdf"),
});

type Body = z.infer<typeof bodySchema>;

// Assembles the chunks of a large upload and ingests the result. PDFs run the
// same parse, save, attach path as a direct upload to /api/documents. Videos
// and audio become a media document (SPEC.md §11): Document + VIDEO block +
// VideoAsset (an audio/* sniff marks it audio), with the staged chunks copied
// to VideoChunk rows inside Postgres — the file never assembles in server
// memory.
export async function POST(req: Request) {
  const user = await currentUser();
  const t = await serverT();
  const { data, error } = await parseBody(req, bodySchema);
  if (error) return error;
  const notebook = await db.notebook.findUnique({ where: { id: data.notebookId } });
  if (!notebook) return NextResponse.json({ error: t("api.corpusNotFound") }, { status: 404 });
  const access = await notebookAccess(data.notebookId, "editor");
  if (access instanceof NextResponse) return access;

  if (data.kind === "video") return completeVideo(data, user?.id ?? null, t);

  // The parse chain (jsdom, unpdf) loads per request; see /api/documents.
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

  const chunks = await db.uploadChunk.findMany({
    where: { uploadId: data.uploadId },
    orderBy: { index: "asc" },
  });
  if (chunks.length === 0) {
    return NextResponse.json({ error: t("api.uploadNotFound") }, { status: 404 });
  }
  if (chunks.some((c, i) => c.index !== i)) {
    return NextResponse.json({ error: t("api.uploadMissingChunks") }, { status: 400 });
  }
  const total = chunks.reduce((n, c) => n + c.data.length, 0);
  if (total > MAX_PDF_BYTES) {
    await db.uploadChunk.deleteMany({ where: { uploadId: data.uploadId } });
    return NextResponse.json({ error: t("api.pdfTooLarge") }, { status: 413 });
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk.data, offset);
    offset += chunk.data.length;
  }
  // Chunks are staging only; the assembled bytes are in memory now.
  await db.uploadChunk.deleteMany({ where: { uploadId: data.uploadId } });

  if (bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") {
    return NextResponse.json({ error: t("api.notPdf") }, { status: 400 });
  }

  return progressResponse(async (onProgress) => {
    try {
      const { document, deduped } = await parse.ingestPdf(
        bytes,
        data.filename,
        onProgress,
        user?.id ?? null,
      );
      await attachDocument(data.notebookId, document.id);
      await bumpNotebook(data.notebookId);
      if (!deduped && document.handwritten) {
        // A handwritten document (SPEC.md §14): conversion starts on its own —
        // the text is the point. Glossary and the recommended-links scan
        // follow it, so they read the converted text.
        after(() =>
          runConversion(document.id, user?.id ?? null)
            .then((r) =>
              r.ok ? buildGlossary(document.id, user?.id ?? null).catch(() => {}) : undefined,
            )
            .then(() => buildConnections(data.notebookId, document.id, user?.id ?? null))
            .catch(() => {}),
        );
      } else {
        // On-ingest glossary extraction (SPEC.md §8 Phase 7). Best-effort; after() keeps it
        // alive past the response on serverless.
        if (!deduped) after(() => buildGlossary(document.id, user?.id ?? null).catch(() => {}));
        after(() => buildConnections(data.notebookId, document.id, user?.id ?? null).catch(() => {}));
      }
      return { id: document.id, title: document.title, deduped };
    } catch (err) {
      console.error("PDF ingest failed:", err);
      throw new Error(t("api.pdfParseFailed"));
    }
  });
}

// Video completion. The staged chunks are validated in place (uniform slice
// size, contiguous), hashed one at a time for dedupe, then copied to VideoChunk
// rows with one INSERT … SELECT.
async function completeVideo(data: Body, userId: string | null, t: TFunc) {
  const staged = await db.$queryRaw<{ index: number; len: number }[]>`
    SELECT "index", octet_length("data") AS len
    FROM "UploadChunk" WHERE "uploadId" = ${data.uploadId} ORDER BY "index"`;
  if (staged.length === 0) {
    return NextResponse.json({ error: t("api.uploadNotFound") }, { status: 404 });
  }
  const contiguous = staged.every(
    (c, i) => c.index === i && (i === staged.length - 1 || c.len === UPLOAD_CHUNK_BYTES),
  );
  if (!contiguous) {
    await db.uploadChunk.deleteMany({ where: { uploadId: data.uploadId } });
    return NextResponse.json({ error: t("api.uploadMissingChunks") }, { status: 400 });
  }
  const size = staged.reduce((n, c) => n + c.len, 0);
  if (size > MAX_VIDEO_BYTES) {
    await db.uploadChunk.deleteMany({ where: { uploadId: data.uploadId } });
    return NextResponse.json({ error: t("api.videoTooLarge") }, { status: 413 });
  }

  // Hash chunk by chunk — 3.5 MB resident at a time, never the whole file.
  const hash = createHash("sha256");
  let mimeType: string | null = null;
  for (const { index } of staged) {
    const chunk = await db.uploadChunk.findUnique({
      where: { uploadId_index: { uploadId: data.uploadId, index } },
      select: { data: true },
    });
    if (!chunk) {
      return NextResponse.json({ error: t("api.uploadMissingChunks") }, { status: 400 });
    }
    if (index === 0) {
      mimeType = sniffMedia(chunk.data);
      if (!mimeType) {
        await db.uploadChunk.deleteMany({ where: { uploadId: data.uploadId } });
        return NextResponse.json({ error: t("api.notMedia") }, { status: 400 });
      }
    }
    hash.update(chunk.data);
  }
  const fileHash = hash.digest("hex");

  // Dedupe by fileHash: a re-upload attaches the existing video document.
  const existing = await db.document.findUnique({ where: { fileHash } });
  if (existing) {
    await db.uploadChunk.deleteMany({ where: { uploadId: data.uploadId } });
    await attachDocument(data.notebookId, existing.id);
    await bumpNotebook(data.notebookId);
    after(() => buildConnections(data.notebookId, existing.id, userId).catch(() => {}));
    return progressResponse(async () => ({
      id: existing.id,
      title: existing.title,
      deduped: true,
    }));
  }

  const title = data.filename.replace(/\.[a-z0-9]+$/i, "");
  return progressResponse(async (onProgress) => {
    onProgress("save");
    const document = await db.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: { title, fileHash },
      });
      // Exactly one VIDEO block: the pane renders the player from it, and
      // video anchors point at it when no transcript block fits (SPEC.md §11).
      await tx.block.create({
        data: { documentId: doc.id, order: 0, type: "VIDEO", text: title },
      });
      await tx.videoAsset.create({
        data: { documentId: doc.id, mimeType: mimeType!, size, chunkSize: UPLOAD_CHUNK_BYTES },
      });
      return doc;
    });
    try {
      const asset = await db.videoAsset.findUniqueOrThrow({
        where: { documentId: document.id },
        select: { id: true },
      });
      await db.$executeRaw`
        INSERT INTO "VideoChunk" ("id", "videoId", "index", "data")
        SELECT gen_random_uuid()::text, ${asset.id}, "index", "data"
        FROM "UploadChunk" WHERE "uploadId" = ${data.uploadId}`;
      const copied = await db.videoChunk.count({ where: { videoId: asset.id } });
      if (copied !== staged.length) {
        throw new Error(t("api.videoCopyIncomplete"));
      }
      await db.uploadChunk.deleteMany({ where: { uploadId: data.uploadId } });
      await attachDocument(data.notebookId, document.id);
      await bumpNotebook(data.notebookId);
      // Transcription starts on its own — the transcript is the point. The
      // recommended-links scan follows it, so it reads the transcript.
      after(() =>
        runTranscription(document.id)
          .then(() => buildConnections(data.notebookId, document.id, userId))
          .catch(() => {}),
      );
    } catch (err) {
      // A half-saved video document must not survive; chunks cascade with it.
      await db.document.delete({ where: { id: document.id } }).catch(() => {});
      await db.uploadChunk.deleteMany({ where: { uploadId: data.uploadId } });
      console.error("Video ingest failed:", err);
      throw new Error(err instanceof Error ? err.message : t("api.videoSaveFailed"));
    }
    return { id: document.id, title, deduped: false };
  });
}

import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { outboundFetch } from "@/lib/outbound-fetch";
import type { TFunc } from "@/lib/i18n/dictionaries";
import type { OnIngestProgress } from "@/lib/parse/ingest";
import { sniffMedia } from "@/lib/video/storage";
import { MAX_VIDEO_BYTES, UPLOAD_CHUNK_BYTES } from "@/lib/video/types";

// A direct video or audio file URL becomes a media document (SPEC.md §11), the
// same shape as an uploaded file: Document + VIDEO block + VideoAsset +
// VideoChunk rows. The download streams into staged UploadChunk rows — one
// chunk resident at a time, never the whole file — then the staged rows copy
// to VideoChunk rows with one INSERT … SELECT, like /api/uploads/complete.
// Dedupe: by sourceUrl before downloading, by fileHash after.
export async function ingestMediaUrl(url: string, t: TFunc, onProgress?: OnIngestProgress) {
  const existing = await db.document.findFirst({
    where: { sourceUrl: url, video: { isNot: null } },
  });
  if (existing) return { document: existing, deduped: true };

  onProgress?.("fetch");
  const res = await outboundFetch(url, {});
  if (!res.ok || !res.body) throw new Error(t("api.mediaUnavailable"));
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_VIDEO_BYTES) throw new Error(t("api.videoTooLarge"));

  const uploadId = crypto.randomUUID();
  try {
    const hash = createHash("sha256");
    let mimeType: string | null = null;
    let size = 0;
    let chunkCount = 0;

    const stage = async (data: Uint8Array) => {
      if (chunkCount === 0) {
        mimeType = sniffMedia(data);
        if (!mimeType) throw new Error(t("api.notMedia"));
      }
      hash.update(data);
      // Buffer.from copies, so the slice buffer below can refill safely.
      await db.uploadChunk.create({
        data: { uploadId, index: chunkCount, data: Buffer.from(data) },
      });
      chunkCount += 1;
    };

    // Slice the download into the uniform chunk size as it arrives.
    const reader = res.body.getReader();
    const slice = new Uint8Array(UPLOAD_CHUNK_BYTES);
    let filled = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      let offset = 0;
      while (offset < value.length) {
        const take = Math.min(UPLOAD_CHUNK_BYTES - filled, value.length - offset);
        slice.set(value.subarray(offset, offset + take), filled);
        filled += take;
        offset += take;
        size += take;
        if (size > MAX_VIDEO_BYTES) throw new Error(t("api.videoTooLarge"));
        if (filled === UPLOAD_CHUNK_BYTES) {
          await stage(slice);
          filled = 0;
        }
      }
    }
    if (filled > 0) await stage(slice.subarray(0, filled));
    if (size === 0) throw new Error(t("api.mediaUnavailable"));

    // Dedupe by fileHash: re-adding the same file attaches the existing
    // video document.
    const fileHash = hash.digest("hex");
    const dupe = await db.document.findUnique({ where: { fileHash } });
    if (dupe) {
      await db.uploadChunk.deleteMany({ where: { uploadId } });
      return { document: dupe, deduped: true };
    }

    onProgress?.("save");
    const title = mediaUrlTitle(url);
    const document = await db.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: { title, sourceUrl: url, fileHash },
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
        FROM "UploadChunk" WHERE "uploadId" = ${uploadId}`;
      const copied = await db.videoChunk.count({ where: { videoId: asset.id } });
      if (copied !== chunkCount) throw new Error(t("api.videoCopyIncomplete"));
    } catch (err) {
      // A half-saved video document must not survive; chunks cascade with it.
      await db.document.delete({ where: { id: document.id } }).catch(() => {});
      throw err;
    }
    await db.uploadChunk.deleteMany({ where: { uploadId } });
    return { document, deduped: false };
  } catch (err) {
    await db.uploadChunk.deleteMany({ where: { uploadId } }).catch(() => {});
    throw err;
  }
}

// The file name from the URL path, without its extension; the host when the
// path gives nothing readable.
function mediaUrlTitle(raw: string): string {
  try {
    const { pathname, hostname } = new URL(raw);
    const base = decodeURIComponent(pathname.split("/").pop() ?? "");
    const name = base.replace(/\.[a-z0-9]+$/i, "").trim();
    return name || hostname;
  } catch {
    return raw;
  }
}

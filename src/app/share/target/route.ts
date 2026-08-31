import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { MAX_VIDEO_BYTES, UPLOAD_CHUNK_BYTES } from "@/lib/video/types";

export const maxDuration = 60;

const MAX_PDF_BYTES = 50 * 1024 * 1024;

// The share sheet's POST (manifest share_target): another app shares a URL,
// text, or a file to Unitos. A file is staged into UploadChunk rows — the same
// staging the chunked uploader uses, swept after a day — then the browser is
// redirected to /share, where the reader picks the project and ingestion runs.
export async function POST(req: Request) {
  const to = (path: string) => NextResponse.redirect(new URL(path, req.url), 303);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return to("/share");
  }

  const file = form.get("file");
  if (file instanceof Blob && file.size > 0) {
    const name = (file instanceof File && file.name) || "document.pdf";
    const kind =
      file.type === "application/pdf" || /\.pdf$/i.test(name)
        ? "pdf"
        : file.type.startsWith("audio/") || file.type.startsWith("video/")
          ? "video"
          : null;
    if (!kind) return to("/share");
    if (file.size > (kind === "pdf" ? MAX_PDF_BYTES : MAX_VIDEO_BYTES)) return to("/share");

    // Abandoned uploads (complete never ran) sweep out after a day.
    await db.uploadChunk.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });
    const uploadId = crypto.randomUUID();
    const bytes = new Uint8Array(await file.arrayBuffer());
    for (let sent = 0; sent < bytes.length; sent += UPLOAD_CHUNK_BYTES) {
      await db.uploadChunk.create({
        data: {
          uploadId,
          index: Math.floor(sent / UPLOAD_CHUNK_BYTES),
          data: bytes.slice(sent, sent + UPLOAD_CHUNK_BYTES),
        },
      });
    }
    return to(`/share?u=${uploadId}&name=${encodeURIComponent(name)}&k=${kind}`);
  }

  // Shared apps put the link in url, text, or title — take the first URL found.
  for (const key of ["url", "text", "title"]) {
    const value = form.get(key);
    if (typeof value !== "string") continue;
    const match = value.match(/https?:\/\/[^\s"'<>]+/);
    if (match) return to(`/share?url=${encodeURIComponent(match[0])}`);
  }
  return to("/share");
}

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isMarkdownFile } from "@/lib/markdown-file";
import { MAX_VIDEO_BYTES, UPLOAD_CHUNK_BYTES } from "@/lib/video/types";

export const maxDuration = 60;

const MAX_PDF_BYTES = 50 * 1024 * 1024;
// The most a sent page may hold (the bookmarklet drops scripts and styles first).
const MAX_PAGE_HTML_CHARS = 4_000_000;

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

  // The bookmarklet (SPEC.md §15): the page's HTML as the reader's browser
  // saw it, with its address and title. Staged like a file, then the reader
  // picks the project on /share. The browser that posts it is on the site's
  // origin, so no session cookie comes with the post (the middleware lets
  // this route through); the staged page is only reachable by its id, and
  // nothing is added until the signed-in reader says so.
  const html = form.get("html");
  if (typeof html === "string" && html.trim()) {
    if (html.length > MAX_PAGE_HTML_CHARS) return to("/share?e=pageTooLarge");
    await db.uploadChunk.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });
    const uploadId = crypto.randomUUID();
    const bytes = new TextEncoder().encode(html);
    for (let sent = 0; sent < bytes.length; sent += UPLOAD_CHUNK_BYTES) {
      await db.uploadChunk.create({
        data: {
          uploadId,
          index: Math.floor(sent / UPLOAD_CHUNK_BYTES),
          data: bytes.slice(sent, sent + UPLOAD_CHUNK_BYTES),
        },
      });
    }
    const url = form.get("url");
    const title = form.get("title");
    const params = new URLSearchParams({ u: uploadId, k: "page" });
    if (typeof url === "string" && /^https?:\/\//.test(url)) params.set("url", url.slice(0, 2000));
    if (typeof title === "string" && title.trim()) params.set("name", title.trim().slice(0, 300));
    return to(`/share?${params.toString()}`);
  }

  const file = form.get("file");
  if (file instanceof Blob && file.size > 0) {
    const name = (file instanceof File && file.name) || "document.pdf";
    const kind =
      file.type === "application/pdf" || /\.pdf$/i.test(name) || isMarkdownFile({ type: file.type, name })
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

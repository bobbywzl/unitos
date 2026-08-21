import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseByteRange, videoByteStream } from "@/lib/video/storage";
import { parseBody } from "@/lib/validate";

// Streaming a long video can outlive the default timeout.
export const maxDuration = 300;

// The video document's bytes, with HTTP Range support so the player seeks
// without downloading the file (SPEC.md §11). The <video> element is the caller.
export async function GET(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await ctx.params;
  const asset = await db.videoAsset.findUnique({
    where: { documentId },
    select: { id: true, kind: true, mimeType: true, size: true, chunkSize: true },
  });
  if (!asset) return NextResponse.json({ error: "Video not found" }, { status: 404 });
  if (asset.kind !== "UPLOAD" || asset.mimeType === null || asset.size === null || asset.chunkSize === null) {
    return NextResponse.json({ error: "This video plays from YouTube" }, { status: 404 });
  }

  const sharedHeaders = {
    "Content-Type": asset.mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };
  const range = parseByteRange(req.headers.get("range"), asset.size);
  if (range.kind === "invalid") {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${asset.size}` },
    });
  }
  const start = range.kind === "range" ? range.start : 0;
  const end = range.kind === "range" ? range.end : asset.size - 1;
  return new Response(videoByteStream(asset.id, asset.chunkSize, start, end), {
    status: range.kind === "range" ? 206 : 200,
    headers: {
      ...sharedHeaders,
      "Content-Length": String(end - start + 1),
      ...(range.kind === "range"
        ? { "Content-Range": `bytes ${start}-${end}/${asset.size}` }
        : {}),
    },
  });
}

const patchSchema = z.object({
  duration: z.number().positive().max(24 * 60 * 60),
  // The YouTube player reports no frame size; uploads report both.
  width: z.number().int().positive().max(16_384).optional(),
  height: z.number().int().positive().max(16_384).optional(),
});

// The client reports duration and frame size once metadata loads; the deck and
// the scrubber read them server-side on the next render.
export async function PATCH(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await ctx.params;
  const { data, error } = await parseBody(req, patchSchema);
  if (error) return error;
  const asset = await db.videoAsset.findUnique({ where: { documentId }, select: { id: true } });
  if (!asset) return NextResponse.json({ error: "Video not found" }, { status: 404 });
  await db.videoAsset.update({
    where: { id: asset.id },
    data: { duration: data.duration, width: data.width, height: data.height },
  });
  return NextResponse.json({ ok: true });
}

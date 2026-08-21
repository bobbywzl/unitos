import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { groupSegments, TRANSCRIBE_MAX_BYTES, transcribeVideo } from "@/lib/video/transcribe";

// Transcription can take minutes on a long video.
export const maxDuration = 300;

// Transcribe the video document (SPEC.md §11): send the video to Whisper,
// write the timed lines as TRANSCRIPT blocks. Re-running replaces the lines.
// VideoAsset.transcriptStatus: NONE → PENDING → READY | FAILED with the reason.
export async function POST(_req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not set. Transcription needs it." },
      { status: 503 },
    );
  }
  const { documentId } = await ctx.params;
  const asset = await db.videoAsset.findUnique({
    where: { documentId },
    select: { id: true, size: true, mimeType: true, transcriptStatus: true },
  });
  if (!asset) return NextResponse.json({ error: "This document has no video" }, { status: 404 });
  if (asset.size > TRANSCRIBE_MAX_BYTES) {
    return NextResponse.json(
      { error: "Video is larger than 25 MB, the transcription cap for now" },
      { status: 413 },
    );
  }
  if (asset.transcriptStatus === "PENDING") {
    return NextResponse.json({ error: "Transcription is already running" }, { status: 409 });
  }

  await db.videoAsset.update({
    where: { id: asset.id },
    data: { transcriptStatus: "PENDING", transcriptError: null },
  });

  try {
    const chunks = await db.videoChunk.findMany({
      where: { videoId: asset.id },
      orderBy: { index: "asc" },
      select: { data: true },
    });
    const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.data.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk.data, offset);
      offset += chunk.data.length;
    }

    const lines = groupSegments(await transcribeVideo(bytes, asset.mimeType));
    await db.$transaction(async (tx) => {
      await tx.block.deleteMany({ where: { documentId, type: "TRANSCRIPT" } });
      await tx.block.createMany({
        data: lines.map((line, i) => ({
          documentId,
          order: i + 1, // the VIDEO block holds order 0
          type: "TRANSCRIPT" as const,
          text: line.text,
          startTime: line.start,
          endTime: line.end,
        })),
      });
      await tx.videoAsset.update({
        where: { id: asset.id },
        data: { transcriptStatus: "READY", transcriptError: null },
      });
    });
    return NextResponse.json({ ok: true, lines: lines.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription failed";
    console.error("[transcribe] failed:", err);
    await db.videoAsset.update({
      where: { id: asset.id },
      data: { transcriptStatus: "FAILED", transcriptError: message },
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  groupSegments,
  transcribe,
  TRANSCRIBE_MAX_BYTES,
  type TranscribeSource,
} from "@/lib/video/transcribe";

// Transcription can take minutes on a long video.
export const maxDuration = 300;

// Transcribe the video document (SPEC.md §11) down the provider ladder —
// YouTube: Gemini → YouTube captions; uploads: Whisper → Gemini — and write
// the timed lines as TRANSCRIPT blocks. Re-running replaces the lines.
// VideoAsset.transcriptStatus: NONE → PENDING → READY | FAILED with the reason.
export async function POST(_req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await ctx.params;
  const asset = await db.videoAsset.findUnique({
    where: { documentId },
    select: {
      id: true,
      kind: true,
      youtubeId: true,
      size: true,
      mimeType: true,
      transcriptStatus: true,
      transcriptStartedAt: true,
    },
  });
  if (!asset) return NextResponse.json({ error: "This document has no video" }, { status: 404 });

  if (asset.kind === "YOUTUBE") {
    if (!asset.youtubeId) {
      return NextResponse.json({ error: "This video has no YouTube id" }, { status: 400 });
    }
  } else {
    // Uploads need a provider key; the YouTube ladder has a keyless rung.
    if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "Set OPENAI_API_KEY or GEMINI_API_KEY. Transcription needs one." },
        { status: 503 },
      );
    }
    if (asset.size === null || asset.size > TRANSCRIBE_MAX_BYTES) {
      return NextResponse.json(
        { error: "Video is larger than 25 MB, the transcription cap for now" },
        { status: 413 },
      );
    }
  }
  // A PENDING older than 10 minutes is a dead run (the function timed out or
  // crashed before writing FAILED) and may start again.
  const running =
    asset.transcriptStatus === "PENDING" &&
    asset.transcriptStartedAt !== null &&
    Date.now() - asset.transcriptStartedAt.getTime() < 10 * 60 * 1000;
  if (running) {
    return NextResponse.json({ error: "Transcription is already running" }, { status: 409 });
  }

  await db.videoAsset.update({
    where: { id: asset.id },
    data: { transcriptStatus: "PENDING", transcriptError: null, transcriptStartedAt: new Date() },
  });

  try {
    let source: TranscribeSource;
    if (asset.kind === "YOUTUBE") {
      source = { kind: "youtube", youtubeId: asset.youtubeId! };
    } else {
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
      source = { kind: "upload", bytes, mimeType: asset.mimeType };
    }

    const { segments, provider } = await transcribe(source);
    const lines = groupSegments(segments);
    console.log(`[transcribe] ${asset.kind} via ${provider}: ${lines.length} lines`);
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
    return NextResponse.json({ ok: true, lines: lines.length, provider });
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

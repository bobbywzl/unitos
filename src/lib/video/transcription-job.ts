import { bumpDocument } from "@/lib/collab";
import { db } from "@/lib/db";
import { parsePastedTranscript } from "@/lib/video/paste";
import { tidyTranscript } from "@/lib/video/tidy";
import {
  groupSegments,
  transcribe,
  TRANSCRIBE_MAX_BYTES,
  type TranscribeSource,
  type TranscriptSegment,
} from "@/lib/video/transcribe";

// The transcription job (SPEC.md §11): guards, the provider ladder, the
// cleanup pass, and the TRANSCRIPT block writes. Transcription starts on its
// own when a video or audio is added — the transcript is the point — and
// /api/documents/[documentId]/transcribe runs the same job for Retry and
// Transcribe again. A pasted transcript (/api/documents/[documentId]/transcript)
// skips the ladder and takes the same cleanup and writes.
export type TranscriptionResult =
  | { ok: true; lines: number; provider: string }
  | { ok: false; status: number; error: string };

// The ladder's time budget. Vercel ends the function at 300 seconds (the
// routes' maxDuration, which after() work shares); the cleanup pass and the
// block writes need the rest.
const LADDER_BUDGET_MS = 240_000;

export async function runTranscription(documentId: string): Promise<TranscriptionResult> {
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
  if (!asset) return { ok: false, status: 404, error: "This document has no video or audio" };

  if (asset.kind === "YOUTUBE") {
    if (!asset.youtubeId) {
      return { ok: false, status: 400, error: "This video has no YouTube id" };
    }
  } else {
    // Uploads need a provider key; the YouTube ladder has a keyless rung.
    if (!process.env.GROQ_API_KEY && !process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
      return {
        ok: false,
        status: 503,
        error: "Set GROQ_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY. Transcription needs one.",
      };
    }
    // An MP3 past the cap transcribes in frame-boundary chunks; other
    // containers cannot be cut safely and keep the cap.
    const chunkable = asset.mimeType === "audio/mpeg";
    if (asset.size === null || (!chunkable && asset.size > TRANSCRIBE_MAX_BYTES)) {
      return {
        ok: false,
        status: 413,
        error: "File is larger than 25 MB, the transcription cap for this format",
      };
    }
  }
  // A PENDING older than 10 minutes is a dead run (the function timed out or
  // crashed before writing FAILED) and may start again.
  const running =
    asset.transcriptStatus === "PENDING" &&
    asset.transcriptStartedAt !== null &&
    Date.now() - asset.transcriptStartedAt.getTime() < 10 * 60 * 1000;
  if (running) {
    return { ok: false, status: 409, error: "Transcription is already running" };
  }

  const startedAt = Date.now();
  await db.videoAsset.update({
    where: { id: asset.id },
    data: { transcriptStatus: "PENDING", transcriptError: null, transcriptStartedAt: new Date(startedAt) },
  });
  // Every status change bumps: open workspaces see the run start, the
  // transcript land, or the failure — whoever started it.
  await bumpDocument(documentId);

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

    const { segments, provider } = await transcribe(source, {
      deadline: startedAt + LADDER_BUDGET_MS,
    });
    const lines = await storeTranscript(documentId, asset.id, segments, `${asset.kind} via ${provider}`);
    return { ok: true, lines, provider };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription failed";
    console.error("[transcribe] failed:", err);
    await db.videoAsset.update({
      where: { id: asset.id },
      data: { transcriptStatus: "FAILED", transcriptError: message },
    });
    await bumpDocument(documentId);
    return { ok: false, status: 502, error: message };
  }
}

// Cleanup, grouping, and the block writes — every transcript, whatever rung
// produced it, lands through here. Returns the line count.
async function storeTranscript(
  documentId: string,
  assetId: string,
  segments: TranscriptSegment[],
  origin: string,
): Promise<number> {
  // Cleanup before anything stores: fillers, stutters, and false starts out,
  // punctuation and casing fixed — the transcript reads like an article.
  // Cleanup emptying every line means it misfired; the raw lines stand.
  const grouped = groupSegments(segments);
  const tidied = await tidyTranscript(grouped);
  const lines = tidied.lines.length > 0 ? tidied.lines : grouped;
  console.log(`[transcribe] ${origin}, cleaned by ${tidied.provider}: ${lines.length} lines`);
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
      where: { id: assetId },
      data: { transcriptStatus: "READY", transcriptError: null },
    });
  });
  await bumpDocument(documentId);
  return lines.length;
}

// A transcript the reader pasted (SPEC.md §11): parsed, then stored exactly
// like a transcribed one. A parse failure answers 400 with the reason; the
// pane maps the reason to its language.
export async function storePastedTranscript(
  documentId: string,
  text: string,
): Promise<TranscriptionResult> {
  const asset = await db.videoAsset.findUnique({
    where: { documentId },
    select: { id: true },
  });
  if (!asset) return { ok: false, status: 404, error: "This document has no video or audio" };
  let segments: TranscriptSegment[];
  try {
    segments = parsePastedTranscript(text);
  } catch (err) {
    return { ok: false, status: 400, error: err instanceof Error ? err.message : "unreadable" };
  }
  try {
    const lines = await storeTranscript(documentId, asset.id, segments, "pasted");
    return { ok: true, lines, provider: "pasted" };
  } catch (err) {
    console.error("[transcribe] pasted transcript failed to store:", err);
    return { ok: false, status: 500, error: "the transcript could not be stored" };
  }
}

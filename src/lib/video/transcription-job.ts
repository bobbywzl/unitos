import { Prisma } from "@prisma/client";
import { bumpDocument } from "@/lib/collab";
import { refreshSkeleton } from "@/lib/graph/skeleton";
import { cronSecret } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { parseSpeakers, parseTried, type Speaker } from "@/lib/video/types";
import { parsePastedTranscript } from "@/lib/video/paste";
import { tidyTranscript } from "@/lib/video/tidy";
import { deepgramConfigured } from "@/lib/video/deepgram";
import { geminiConfigured } from "@/lib/video/gemini";
import { GEMINI_FILE_TTL_MS, geminiFileFresh, type GeminiFile } from "@/lib/video/gemini-files";
import { clipSegments } from "@/lib/video/segments";
import {
  geminiMediaPart,
  GEMINI_FILE_MAX_BYTES,
  groupSegments,
  LadderExhausted,
  LadderOutOfTime,
  normalizeSegments,
  type RungFailure,
  transcribe,
  TRANSCRIBE_MAX_BYTES,
  type TranscribeOptions,
  type TranscribeSource,
  type TranscriptSegment,
  TRANSCRIPTION_KEYS_UNSET,
  whisperConfigured,
} from "@/lib/video/transcribe";
import { detectSpeakers, nameSpeakers } from "@/lib/video/speakers";

// The transcription job (SPEC.md §11): guards, the provider ladder, the
// cleanup pass, and the TRANSCRIPT block writes. Transcription starts on its
// own when a video or audio is added — the transcript is the point — and
// /api/documents/[documentId]/transcribe runs the same job for Retry and
// Transcribe again: every attempt is the whole ladder from its first rung.
// A pasted transcript (/api/documents/[documentId]/transcript) skips the
// ladder and takes the same cleanup and writes.
//
// One attempt can take more than one function. The ladder stops before the
// function's clock runs out (LadderOutOfTime); the job then stores the rungs
// tried so far on VideoAsset.transcriptTried, keeps the status PENDING, and
// starts its next leg on a fresh function — on Vercel a request to its own
// transcribe route carrying CRON_SECRET, elsewhere the same job in this
// process — which runs the rungs left. FAILED, with every rung's reason, is
// written only after every rung has actually run.
export type TranscriptionResult =
  | { ok: true; continuing: false; lines: number; provider: string }
  | { ok: true; continuing: true; tried: string[] }
  | { ok: false; status: number; error: string };


// The ladder's time budget. Vercel ends the function at 300 seconds (the
// routes' maxDuration, which after() work shares); the cleanup pass, the
// speakers pass, and the block writes need the rest.
const LADDER_BUDGET_MS = 200_000;
// The speakers pass runs on what is left, and only when there is enough of
// it to be worth starting (SPEC.md §11). A run that skips it leaves the
// transcript without names; Detect speakers runs it on its own afterwards.
const SPEAKERS_MIN_MS = 30_000;
// Detect speakers on its own gets the whole function, less the writes.
const SPEAKERS_BUDGET_MS = 260_000;

export async function runTranscription(
  documentId: string,
  // leg: the running attempt's next leg — the rungs left, past the ones
  // transcriptTried names. Never a new attempt.
  // userId: the reader who asked for this run, for the admin usage page.
  // Null when nothing asked: transcription starts on its own when media is
  // added, and that cost is the app's, not a reader's (SPEC.md §11). Retry
  // and Transcribe again pass the reader who pressed them.
  opts: { leg?: boolean; userId?: string | null } = {},
): Promise<TranscriptionResult> {
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
      transcriptTried: true,
      geminiFileUri: true,
      geminiFileExpiresAt: true,
    },
  });
  if (!asset) return { ok: false, status: 404, error: "This document has no video or audio" };

  if (asset.kind === "YOUTUBE") {
    if (!asset.youtubeId) {
      return { ok: false, status: 400, error: "This video has no YouTube id" };
    }
  } else {
    // Uploads need a provider key; the YouTube ladder has a keyless rung.
    if (!deepgramConfigured() && !whisperConfigured() && !geminiConfigured()) {
      return { ok: false, status: 503, error: TRANSCRIPTION_KEYS_UNSET };
    }
    // What a big file can still be transcribed by: Deepgram takes the whole
    // file, an MP3 past the Whisper cap splits at frame boundaries, and any
    // format at all goes through Gemini's file store. Only without all of
    // them is the 25 MB cap the end of it.
    const chunkable = asset.mimeType === "audio/mpeg";
    const store = geminiConfigured() || deepgramConfigured();
    if (asset.size === null) {
      return { ok: false, status: 400, error: "This file has no recorded size" };
    }
    if (asset.size > GEMINI_FILE_MAX_BYTES) {
      return { ok: false, status: 413, error: "File is larger than the 200 MB upload cap" };
    }
    if (!chunkable && !store && asset.size > TRANSCRIBE_MAX_BYTES) {
      return {
        ok: false,
        status: 413,
        error:
          "File is larger than 25 MB, the transcription cap for this format. Set DEEPGRAM_API_KEY or GEMINI_API_KEY to transcribe longer media.",
      };
    }
  }
  // A PENDING older than 10 minutes is a dead run (the function timed out or
  // crashed before writing FAILED) and may start again. A leg is the running
  // attempt itself, so it passes.
  const running =
    asset.transcriptStatus === "PENDING" &&
    asset.transcriptStartedAt !== null &&
    Date.now() - asset.transcriptStartedAt.getTime() < 10 * 60 * 1000;
  if (running && !opts.leg) {
    return { ok: false, status: 409, error: "Transcription is already running" };
  }
  if (opts.leg && asset.transcriptStatus !== "PENDING") {
    return { ok: false, status: 409, error: "No transcription is running" };
  }

  // The rungs an earlier leg of this attempt tried; a new attempt starts
  // with none — every attempt is the whole ladder.
  const tried: RungFailure[] = opts.leg ? parseTried(asset.transcriptTried) : [];
  const startedAt = Date.now();
  await db.videoAsset.update({
    where: { id: asset.id },
    data: {
      transcriptStatus: "PENDING",
      transcriptError: null,
      transcriptStartedAt: new Date(startedAt),
      transcriptTried: opts.leg ? tried : Prisma.DbNull,
    },
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

    // A file already in Gemini's store is reused: sending an hour of media is
    // the slow part of the run, and a retry should not repeat it.
    const stored: GeminiFile | null =
      asset.geminiFileUri && geminiFileFresh(asset.geminiFileExpiresAt)
        ? {
            uri: asset.geminiFileUri,
            name: asset.geminiFileUri.split("/").slice(-2).join("/"),
            mimeType: asset.mimeType ?? "video/mp4",
          }
        : null;
    const { segments, provider } = await transcribe(source, {
      deadline: startedAt + LADDER_BUDGET_MS,
      skip: tried.map((f) => f.rung),
      userId: opts.userId ?? null,
      geminiFile: stored,
      onGeminiFile: (file) => {
        // Fire and forget: the run must not wait on remembering the file.
        void db.videoAsset
          .update({
            where: { id: asset.id },
            data: {
              geminiFileUri: file.uri,
              geminiFileExpiresAt: new Date(Date.now() + GEMINI_FILE_TTL_MS),
            },
          })
          .catch(() => {});
      },
    });
    const deadline = startedAt + LADDER_BUDGET_MS + SPEAKERS_MIN_MS + 30_000;
    const lines = await storeTranscript(documentId, asset.id, segments, `${asset.kind} via ${provider}`, opts.userId ?? null, {
      // The speakers pass reads the media again, so it takes the same stored
      // file the ladder used. Skipped when the ladder left it no time.
      source: Date.now() < deadline - SPEAKERS_MIN_MS ? source : null,
      transcribeOptions: { deadline, geminiFile: stored },
    });
    return { ok: true, continuing: false, lines, provider };
  } catch (err) {
    if (err instanceof LadderOutOfTime) {
      // Rungs left, no clock left: store what this leg tried and run the
      // rest on a fresh function. The status stays PENDING.
      const allTried = [...tried, ...err.failures];
      console.log(
        `[transcribe] leg ended with ${err.remaining.length} rung(s) left (${err.remaining.join(", ")}); continuing`,
      );
      await db.videoAsset.update({
        where: { id: asset.id },
        data: { transcriptTried: allTried, transcriptStartedAt: new Date() },
      });
      await bumpDocument(documentId);
      return continueTranscription(documentId, allTried.map((f) => f.rung));
    }
    const failures =
      err instanceof LadderExhausted ? [...tried, ...err.failures] : [...tried];
    const message =
      err instanceof LadderExhausted
        ? failures.map((f) => `${f.rung}: ${f.reason}`).join(" · ")
        : [...failures.map((f) => `${f.rung}: ${f.reason}`), err instanceof Error ? err.message : "Transcription failed"].join(" · ");
    console.error("[transcribe] failed:", err);
    await db.videoAsset.update({
      where: { id: asset.id },
      data: { transcriptStatus: "FAILED", transcriptError: message, transcriptTried: Prisma.DbNull },
    });
    await bumpDocument(documentId);
    return { ok: false, status: 502, error: message };
  }
}

// The next leg of the running attempt, on a fresh function. On Vercel the
// function ends at maxDuration, so the leg is a request to this app's own
// transcribe route (APP_URL, or the deployment's VERCEL_URL; CRON_SECRET is
// the credential, as for the cron routes), which answers at once and runs
// the leg in after(). Off Vercel there is no clock to escape, so the leg
// runs right here. When the request cannot be made or fails, the leg runs
// here as well: the function may end under it, and the run then reads as
// stale, which offers Retry — never as FAILED with rungs untried.
async function continueTranscription(documentId: string, tried: string[]): Promise<TranscriptionResult> {
  const secret = cronSecret();
  const origin = process.env.APP_URL?.replace(/\/$/, "") ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  if (process.env.VERCEL && secret && origin) {
    try {
      const res = await fetch(`${origin}/api/documents/${documentId}/transcribe`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "x-transcribe-leg": "1",
          ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET
            ? { "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET }
            : {}),
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return { ok: true, continuing: true, tried };
      console.warn(`[transcribe] next leg request answered ${res.status}; running the leg here`);
    } catch (err) {
      console.warn("[transcribe] next leg request failed; running the leg here:", err instanceof Error ? err.message : err);
    }
  }
  return runTranscription(documentId, { leg: true });
}

// Cleanup, grouping, speakers, and the block writes — every transcript,
// whatever rung produced it, lands through here. Returns the line count.
async function storeTranscript(
  documentId: string,
  assetId: string,
  segments: TranscriptSegment[],
  origin: string,
  userId: string | null,
  speakers: { source: TranscribeSource | null; transcribeOptions: TranscribeOptions } = {
    source: null,
    transcribeOptions: {},
  },
): Promise<number> {
  // Cleanup before anything stores: fillers, stutters, and false starts out,
  // punctuation and casing fixed — the transcript reads like an article.
  // Cleanup emptying every line means it misfired; the raw lines stand.
  // Only the imported part of the recording (SPEC.md §15): the range the
  // reader picked in the upload box, when they picked one. Normalize before
  // grouping: the ranges have to be in order and pulled apart before lines
  // are cut out of them (lib/video/segments.ts).
  const clip = await db.videoAsset.findUnique({
    where: { id: assetId },
    select: { clipStart: true, clipEnd: true },
  });
  const kept = clipSegments(segments, clip?.clipStart ?? null, clip?.clipEnd ?? null);
  const grouped = groupSegments(normalizeSegments(kept));
  const tidied = await tidyTranscript(grouped, userId);
  const lines = tidied.lines.length > 0 ? tidied.lines : grouped;
  console.log(`[transcribe] ${origin}, cleaned by ${tidied.provider}: ${lines.length} lines`);
  // Who says each line (SPEC.md §11). Lines whose rung told the voices apart
  // (Deepgram) only need names, from the text. Any other transcript takes
  // the pass that reads the media again; it runs after the lines are
  // settled and never blocks them: a pass that fails leaves an unnamed
  // transcript, which is what stored before it existed.
  const diarized = lines.some((line) => line.speaker !== undefined);
  const voices = diarized
    ? await nameSpeakers(lines, userId).catch(() => null)
    : speakers.source
      ? await detectSpeakers(
          await geminiMediaPart(speakers.source, speakers.transcribeOptions),
          lines,
          { ...speakers.transcribeOptions, userId },
        ).catch(() => null)
      : null;
  if (voices) {
    console.log(`[speakers] ${origin}: ${voices.speakers.length} voices`);
  }
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
        speaker: voices?.byLine[i] ?? null,
      })),
    });
    await tx.videoAsset.update({
      where: { id: assetId },
      data: {
        transcriptStatus: "READY",
        transcriptError: null,
        transcriptTried: Prisma.DbNull,
        speakers: voices && voices.speakers.length > 0 ? voices.speakers : undefined,
      },
    });
  });
  await bumpDocument(documentId);
  // The transcript is the document's text: its skeleton builds now
  // (SPEC.md §22). A failure here is the skeleton's, never the transcript's.
  await refreshSkeleton(documentId, null).catch((err: unknown) => console.warn("[transcribe] skeleton failed:", err));
  return lines.length;
}

/** Speakers for a transcript that already exists (SPEC.md §11): Detect
    speakers on the pane, and the one path a pasted transcript takes to get
    names. Reads the media again and rewrites the lines' speaker, nothing
    else — the words, the times, and the block ids all stand, so every note,
    mark, and link anchored to a line survives. */
export async function runSpeakers(
  documentId: string,
  // The reader who pressed Detect speakers, for the admin usage page.
  userId: string | null = null,
  // The reader's Stop: a stopped run saves nothing. The pass itself finishes
  // the call it is in; its answer is dropped.
  signal?: AbortSignal,
): Promise<{ ok: true; speakers: Speaker[] } | { ok: false; status: number; error: string }> {
  if (!geminiConfigured()) {
    return { ok: false, status: 503, error: "Set GEMINI_API_KEY or the gateway. Detecting speakers needs one." };
  }
  const asset = await db.videoAsset.findUnique({
    where: { documentId },
    select: {
      id: true,
      kind: true,
      youtubeId: true,
      mimeType: true,
      geminiFileUri: true,
      geminiFileExpiresAt: true,
    },
  });
  if (!asset) return { ok: false, status: 404, error: "This document has no video or audio" };
  const blocks = await db.block.findMany({
    where: { documentId, type: "TRANSCRIPT" },
    orderBy: { order: "asc" },
    select: { id: true, text: true, startTime: true, endTime: true },
  });
  const lines = blocks.filter((b) => b.startTime !== null && b.endTime !== null);
  if (lines.length === 0) {
    return { ok: false, status: 400, error: "Transcribe first — speakers are found on the lines" };
  }

  const startedAt = Date.now();
  try {
    const source = await mediaSource(asset);
    const voices = await detectSpeakers(
      await geminiMediaPart(source, { deadline: startedAt + SPEAKERS_BUDGET_MS }),
      lines.map((b) => ({ start: b.startTime!, end: b.endTime!, text: b.text })),
      { deadline: startedAt + SPEAKERS_BUDGET_MS, userId },
    );
    if (signal?.aborted) return { ok: false, status: 499, error: "Stopped" };
    await db.$transaction(async (tx) => {
      await Promise.all(
        lines.map((block, i) =>
          tx.block.update({ where: { id: block.id }, data: { speaker: voices.byLine[i] ?? null } }),
        ),
      );
      await tx.videoAsset.update({
        where: { id: asset.id },
        data: { speakers: voices.speakers.length > 0 ? voices.speakers : Prisma.DbNull },
      });
    });
    await bumpDocument(documentId);
    return { ok: true, speakers: voices.speakers };
  } catch (err) {
    console.error("[speakers] failed:", err);
    return {
      ok: false,
      status: 502,
      error: err instanceof Error ? err.message : "Detecting speakers failed",
    };
  }
}

/** Rename one voice (SPEC.md §11). The id stays, so every line it says
    follows the new name at once. */
export async function renameSpeaker(
  documentId: string,
  speakerId: string,
  name: string,
): Promise<{ ok: true; speakers: Speaker[] } | { ok: false; status: number; error: string }> {
  const asset = await db.videoAsset.findUnique({
    where: { documentId },
    select: { id: true, speakers: true },
  });
  if (!asset) return { ok: false, status: 404, error: "This document has no video or audio" };
  const speakers = parseSpeakers(asset.speakers);
  if (!speakers.some((s) => s.id === speakerId)) {
    return { ok: false, status: 404, error: "This recording has no such speaker" };
  }
  const renamed = speakers.map((s) => (s.id === speakerId ? { ...s, name } : s));
  await db.videoAsset.update({ where: { id: asset.id }, data: { speakers: renamed } });
  await bumpDocument(documentId);
  return { ok: true, speakers: renamed };
}

// The media as the ladder's source, for a pass that reads it again.
async function mediaSource(asset: {
  id: string;
  kind: string;
  youtubeId: string | null;
  mimeType: string | null;
}): Promise<TranscribeSource> {
  if (asset.kind === "YOUTUBE") {
    if (!asset.youtubeId) throw new Error("This video has no YouTube id");
    return { kind: "youtube", youtubeId: asset.youtubeId };
  }
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
  return { kind: "upload", bytes, mimeType: asset.mimeType };
}

// A transcript the reader pasted (SPEC.md §11): parsed, then stored exactly
// like a transcribed one. A parse failure answers 400 with the reason; the
// pane maps the reason to its language.
export async function storePastedTranscript(
  documentId: string,
  text: string,
  // The reader who pasted it: the cleanup pass is their call.
  userId: string | null = null,
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
    const lines = await storeTranscript(documentId, asset.id, segments, "pasted", userId);
    return { ok: true, continuing: false, lines, provider: "pasted" };
  } catch (err) {
    console.error("[transcribe] pasted transcript failed to store:", err);
    return { ok: false, status: 500, error: "the transcript could not be stored" };
  }
}

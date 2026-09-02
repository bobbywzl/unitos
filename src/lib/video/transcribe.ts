import { z } from "zod";
import { extractJson } from "@/lib/derive/json";
import { recordUsage } from "@/lib/usage";
import { browserCaptions } from "@/lib/video/browser-transcript";
import { youtubeCaptions } from "@/lib/video/captions";
import { geminiCall, geminiCountTokens } from "@/lib/video/gemini";
import { splitMp3 } from "@/lib/video/mp3";
import { normalizeSegments, type TranscriptSegment } from "@/lib/video/segments";
import { parseTimeInput } from "@/lib/video/types";
import { youtubeWatchUrl } from "@/lib/video/youtube";
import { youtubeAudio } from "@/lib/video/youtube-audio";

export { groupSegments, normalizeSegments, type TranscriptSegment } from "@/lib/video/segments";

// Transcription (SPEC.md §11) is a provider ladder, ordered by source:
//   YouTube video:  caption tracks from YouTube's player API — the transcript
//                   YouTube itself shows (ANDROID, IOS, then ANDROID_VR
//                   client, then the watch page) → the same captions read by
//                   a real browser, where one is configured → Gemini reads
//                   the video by URL → the audio stream downloads and takes
//                   the upload ladder.
//   Uploaded video or audio: Groq Whisper (best quality per dollar; free tier)
//                   → OpenAI Whisper → Gemini with the bytes inline.
// Each rung throws a plain reason; the ladder tries the next and reports every
// reason when all fail. A rung never starts with under 20 seconds left of the
// caller's deadline. Segments group into transcript lines at the end; the job
// writes them as TRANSCRIPT blocks.

export const TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024; // Whisper-family upload cap
// An MP3 past the cap splits at frame boundaries and transcribes in chunks
// (lib/video/mp3.ts); other containers cannot be cut safely and keep the cap.
const MP3_CHUNK_BYTES = 24 * 1024 * 1024;
const MP3_CHUNK_CONCURRENCY = 3;
// Inline bytes reach Gemini base64-encoded inside a 20 MB request.
const GEMINI_INLINE_MAX_BYTES = 14 * 1024 * 1024;

// A video costs Gemini roughly 100 tokens per second, so a feature-length one
// runs past the 1M context window in a single call (and its transcript would
// crowd the output cap). Past this many tokens the video transcribes in
// windows that are stitched back together.
const GEMINI_SINGLE_CALL_TOKENS = 700_000;
const CHUNK_SECONDS = 900; // 15 minutes per window — a longer one invites a partial answer
const MAX_CHUNKS = 16; // 4 hours; past that the run cannot finish inside one request
// Windows run together, so a long video costs about one window of wall clock
// rather than the sum — the request has to finish inside the function timeout.
const CHUNK_CONCURRENCY = 6;

export type TranscribeSource =
  | { kind: "upload"; bytes: Uint8Array<ArrayBuffer>; mimeType: string | null }
  | { kind: "youtube"; youtubeId: string };

export type TranscribeOptions = {
  /** Epoch ms. A rung does not start with under RUNG_MIN_MS left before it. */
  deadline?: number;
};

const RUNG_MIN_MS = 20_000;

type Rung = [string, () => Promise<TranscriptSegment[]>];

export async function transcribe(
  source: TranscribeSource,
  opts: TranscribeOptions = {},
): Promise<{ segments: TranscriptSegment[]; provider: string }> {
  const rungs: Rung[] =
    source.kind === "youtube"
      ? [
          ["YouTube captions", () => youtubeCaptions(source.youtubeId)],
          ["YouTube captions (browser)", () => browserCaptions(source.youtubeId)],
          ["Gemini", () => geminiYouTube(source.youtubeId)],
          ["YouTube audio", () => youtubeAudioRung(source.youtubeId, opts)],
        ]
      : uploadRungs(source.bytes, source.mimeType ?? "video/mp4");
  return runLadder(rungs, opts);
}

function uploadRungs(bytes: Uint8Array<ArrayBuffer>, mimeType: string): Rung[] {
  return [
    ["Groq Whisper", () => whisperFamily(GROQ_WHISPER, bytes, mimeType)],
    ["OpenAI Whisper", () => whisperFamily(OPENAI_WHISPER, bytes, mimeType)],
    ["Gemini", () => geminiUpload(bytes, mimeType)],
  ];
}

async function runLadder(
  rungs: Rung[],
  opts: TranscribeOptions,
): Promise<{ segments: TranscriptSegment[]; provider: string }> {
  const failures: string[] = [];
  for (const [name, run] of rungs) {
    if (opts.deadline !== undefined && Date.now() > opts.deadline - RUNG_MIN_MS) {
      failures.push(`${name}: skipped, out of time`);
      continue;
    }
    try {
      return { segments: await run(), provider: name };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[transcribe] ${name} failed:`, message);
      failures.push(`${name}: ${message}`);
    }
  }
  throw new Error(failures.join(" · "));
}

// The audio stream takes the upload ladder, so it needs an upload provider
// and fits that provider's cap: 25 MB for the Whisper rungs, 14 MB inline
// for Gemini alone.
function youtubeAudioRung(youtubeId: string, opts: TranscribeOptions): Promise<TranscriptSegment[]> {
  const whisper = Boolean(process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY);
  if (!whisper && !process.env.GEMINI_API_KEY) {
    return Promise.reject(new Error("GROQ_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY is not set"));
  }
  return youtubeAudio(youtubeId, {
    maxBytes: whisper ? TRANSCRIBE_MAX_BYTES : GEMINI_INLINE_MAX_BYTES,
    transcribeBytes: (bytes, mimeType) =>
      runLadder(uploadRungs(bytes, mimeType), opts).then((result) => {
        console.log(`[transcribe] YouTube audio transcribed by ${result.provider}`);
        return result.segments;
      }),
  });
}

// ── Whisper family: Groq and OpenAI, one endpoint shape ─────────────────────

const whisperResponseSchema = z.object({
  segments: z
    .array(
      z.object({
        start: z.number().min(0),
        end: z.number().min(0),
        text: z.string(),
      }),
    )
    .min(1),
});

const EXTENSION: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/flac": "flac",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
};

// Groq and OpenAI take the same multipart request; only the endpoint, key,
// model, and per-minute price differ. Groq serves whisper-large-v3-turbo at
// $0.04 per hour with a free tier — the best transcription quality per
// dollar, so it goes first.
type WhisperProvider = {
  keyEnv: "GROQ_API_KEY" | "OPENAI_API_KEY";
  endpoint: string;
  model: string;
  usdPerMinute: number;
};

const GROQ_WHISPER: WhisperProvider = {
  keyEnv: "GROQ_API_KEY",
  endpoint: "https://api.groq.com/openai/v1/audio/transcriptions",
  model: "whisper-large-v3-turbo",
  usdPerMinute: 0.04 / 60,
};

const OPENAI_WHISPER: WhisperProvider = {
  keyEnv: "OPENAI_API_KEY",
  endpoint: "https://api.openai.com/v1/audio/transcriptions",
  model: "whisper-1",
  usdPerMinute: 0.006,
};

// One OpenAI-compatible transcription call.
async function whisperCall(
  opts: { endpoint: string; key: string; model: string; usdPerMinute: number },
  bytes: Uint8Array,
  mimeType: string,
): Promise<TranscriptSegment[]> {
  const form = new FormData();
  form.set(
    "file",
    new Blob([bytes as BlobPart], { type: mimeType }),
    `media.${EXTENSION[mimeType] ?? "mp4"}`,
  );
  form.set("model", opts.model);
  form.set("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");

  // Plain fetch: multipart bodies do not fit outboundFetch's string body.
  const res = await fetch(opts.endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.key}` },
    body: form,
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(detail?.error?.message ?? `request failed (${res.status})`);
  }
  const parsed = whisperResponseSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error("no timed segments returned");
  const segments = normalizeSegments(parsed.data.segments);
  // Whisper bills per minute; tokens do not apply.
  const minutes = (segments.at(-1)?.end ?? 0) / 60;
  recordUsage(
    { userId: null, feature: "transcribe", model: opts.model },
    { inputTokens: Math.ceil(minutes * 60) },
    minutes * opts.usdPerMinute,
  );
  return segments;
}

// A file under the cap goes in one call. A bigger MP3 splits at frame
// boundaries (chunks decode cleanly), each chunk transcribes on its own clock,
// and the segments shift back onto the audio's. Chunks run a few at a time; a
// chunk that fails twice leaves a gap rather than losing the transcript, like
// the YouTube windows.
async function whisperFamily(
  provider: WhisperProvider,
  bytes: Uint8Array,
  mimeType: string,
): Promise<TranscriptSegment[]> {
  const key = process.env[provider.keyEnv];
  if (!key) throw new Error(`${provider.keyEnv} is not set`);
  const opts = { ...provider, key };
  if (bytes.length <= TRANSCRIBE_MAX_BYTES) return whisperCall(opts, bytes, mimeType);
  if (mimeType !== "audio/mpeg") {
    throw new Error("file is larger than the 25 MB transcription cap for this format");
  }
  const chunks = splitMp3(bytes, MP3_CHUNK_BYTES);
  if (!chunks) throw new Error("MP3 frames did not parse; the file cannot be split");
  console.log(`[transcribe] ${bytes.length} bytes → ${chunks.length} MP3 chunks`);

  const results: TranscriptSegment[][] = new Array(chunks.length).fill([]);
  for (let i = 0; i < chunks.length; i += MP3_CHUNK_CONCURRENCY) {
    const batch = chunks.slice(i, i + MP3_CHUNK_CONCURRENCY);
    await Promise.all(
      batch.map(async (chunk, j) => {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const segments = await whisperCall(opts, chunk.bytes, mimeType);
            results[i + j] = segments.map((s) => ({
              start: s.start + chunk.startTime,
              end: s.end + chunk.startTime,
              text: s.text,
            }));
            return;
          } catch (err) {
            console.warn(
              `[transcribe] MP3 chunk ${i + j} attempt ${attempt + 1} failed:`,
              err instanceof Error ? err.message : err,
            );
          }
        }
      }),
    );
  }
  const segments = normalizeSegments(results.flat());
  if (segments.length === 0) throw new Error("every MP3 chunk failed to transcribe");
  return segments;
}

// ── Gemini ──────────────────────────────────────────────────────────────────

const GEMINI_TRANSCRIPT_PROMPT = [
  "Transcribe this video's speech with timestamps.",
  'Return ONLY JSON: {"segments": [{"start": <seconds>, "end": <seconds>, "text": "…"}]}',
  "1. One segment per sentence or phrase, 5–15 seconds each.",
  "2. start and end are plain numbers of SECONDS from the start of what you were given — never milliseconds, never a formatted clock.",
  "3. Transcribe the spoken words exactly; no summaries, no speaker labels.",
  '4. No speech: return {"segments": []}.',
].join("\n");

// Seconds as Gemini writes them: a number, "92", "1:32", or "1:02:05".
const secondsSchema = z.union([z.number().min(0), z.string()]).transform((value, ctx) => {
  if (typeof value === "number") return value;
  const parsed = parseTimeInput(value);
  if (parsed === null) {
    ctx.addIssue({ code: "custom", message: `not a time: ${value}` });
    return z.NEVER;
  }
  return parsed;
});

const geminiSegmentsSchema = z.object({
  segments: z.array(z.object({ start: secondsSchema, end: secondsSchema, text: z.string() })),
});

function geminiSegments(
  parts: unknown[],
  opts: { allowEmpty?: boolean } = {},
): Promise<TranscriptSegment[]> {
  return geminiCall(
    parts,
    { json: true, maxOutputTokens: 65536, lowResolution: true, usage: { userId: null, feature: "transcribe" } },
    (text) => {
      const parsed = geminiSegmentsSchema.safeParse(extractJson(text));
      if (!parsed.success) throw new Error("output was not timed segments");
      if (parsed.data.segments.length === 0 && !opts.allowEmpty) {
        throw new Error("no speech found");
      }
      return normalizeSegments(parsed.data.segments);
    },
  );
}

function youtubeVideoPart(
  youtubeId: string,
  window?: { start: number; end: number; last?: boolean },
) {
  return {
    fileData: { fileUri: youtubeWatchUrl(youtubeId) },
    ...(window
      ? {
          videoMetadata: {
            startOffset: `${Math.floor(window.start)}s`,
            // The last window runs open-ended to the real end of the video.
            // The duration is an estimate that deliberately overshoots, and
            // asking for time past the end returns nothing useful.
            ...(window.last ? {} : { endOffset: `${Math.ceil(window.end)}s` }),
          },
        }
      : {}),
  };
}

// One window of a long video, on the video's own clock.
function transcribeWindow(
  youtubeId: string,
  w: { start: number; end: number; last?: boolean },
): Promise<TranscriptSegment[]> {
  return geminiSegments(
    [youtubeVideoPart(youtubeId, w), { text: GEMINI_TRANSCRIPT_PROMPT }],
    { allowEmpty: true },
  ).then((segments) => {
    if (segments.length === 0) return segments;
    const span = w.end - w.start;
    let latest = Math.max(...segments.map((s) => s.end));

    // Unit first: a window's timestamps cannot run far past the window's own
    // end, so a value orders of magnitude too large is milliseconds.
    const scale = latest > (w.end + span) * 20 ? 1000 : 1;
    const scaled =
      scale === 1
        ? segments
        : segments.map((s) => ({ ...s, start: s.start / scale, end: s.end / scale }));
    latest /= scale;

    // Then the clock: a window answers on its own clock or on the video's, and
    // which one varies per call. Past the first window the two ranges cannot
    // overlap — a window starting at 30:00 is either 0..30:00 or 30:00..60:00 —
    // so the largest timestamp says which came back, and only a window clock
    // gets shifted onto the video's.
    const aligned =
      latest > span * 1.15
        ? scaled
        : scaled.map((s) => ({
            ...s,
            start: s.start + w.start,
            end: Math.min(s.end + w.start, w.end),
          }));

    return aligned;
  });
}

// How much of its own span a window actually answered for.
function windowCoverage(segments: TranscriptSegment[], w: { start: number }): number {
  if (segments.length === 0) return 0;
  return Math.max(...segments.map((s) => s.end)) - w.start;
}

// One window, with a second attempt when the first comes back short. A window
// that answers for only part of its span leaves a hole in the transcript, so
// it is worth asking again — but a partial answer still beats none, so the
// better of the two attempts is what survives. The final window is exempt:
// the video ends inside it.
async function transcribeWindowBest(
  youtubeId: string,
  w: { start: number; end: number; last?: boolean },
): Promise<TranscriptSegment[]> {
  const span = w.end - w.start;
  let best: TranscriptSegment[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const segments = await transcribeWindow(youtubeId, w);
      if (windowCoverage(segments, w) > windowCoverage(best, w)) best = segments;
    } catch (err) {
      console.warn(
        `[transcribe] window ${w.start}-${w.end}s attempt ${attempt + 1} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
    if (w.last || windowCoverage(best, w) >= span * 0.75) break;
  }
  const covered = windowCoverage(best, w);
  if (!w.last && covered < span * 0.75) {
    console.warn(
      `[transcribe] window ${w.start}-${w.end}s covered ${Math.round(covered)}s of ${Math.round(span)}s`,
    );
  }
  return best;
}

// Gemini reads public YouTube videos directly by URL. A video short enough to
// fit the context window goes in one call; a longer one is measured, split
// into windows, and stitched. Timestamps inside a window come back relative to
// that window, so each window's offset is added back.
async function geminiYouTube(youtubeId: string): Promise<TranscriptSegment[]> {
  const whole = [youtubeVideoPart(youtubeId), { text: GEMINI_TRANSCRIPT_PROMPT }];
  const total = await geminiCountTokens(whole);
  if (total === null || total <= GEMINI_SINGLE_CALL_TOKENS) {
    return geminiSegments(whole);
  }

  // Too long for one call. The video's own token rate converts the total into
  // a duration: count one known minute, then divide.
  const probe = await geminiCountTokens([
    youtubeVideoPart(youtubeId, { start: 0, end: 60 }),
    { text: GEMINI_TRANSCRIPT_PROMPT },
  ]);
  if (probe === null || probe <= 0) throw new Error("video is too long to measure");
  const duration = (total / (probe / 60)) * 1.05; // slight overshoot; empty tail windows drop out
  const count = Math.ceil(duration / CHUNK_SECONDS);
  if (count > MAX_CHUNKS) {
    throw new Error(
      `video is about ${Math.round(duration / 60)} minutes — longer than the ${(MAX_CHUNKS * CHUNK_SECONDS) / 3600}-hour transcription limit`,
    );
  }
  const windows = Array.from({ length: count }, (_, i) => ({
    start: i * CHUNK_SECONDS,
    end: Math.min((i + 1) * CHUNK_SECONDS, Math.ceil(duration)),
    last: i === count - 1,
  }));
  console.log(
    `[transcribe] ${Math.round(duration / 60)}min video (${total} tokens) → ${count} windows`,
  );

  const results: TranscriptSegment[][] = [];
  for (let i = 0; i < windows.length; i += CHUNK_CONCURRENCY) {
    const batch = windows.slice(i, i + CHUNK_CONCURRENCY);
    results.push(
      ...(await Promise.all(
        batch.map((w) => transcribeWindowBest(youtubeId, w)),
      )),
    );
  }
  const segments = normalizeSegments(results.flat());
  if (segments.length === 0) throw new Error("no speech found");
  return segments;
}

function geminiUpload(
  bytes: Uint8Array<ArrayBuffer>,
  mimeType: string,
): Promise<TranscriptSegment[]> {
  if (bytes.length > GEMINI_INLINE_MAX_BYTES) {
    return Promise.reject(new Error("file is larger than the 14 MB inline cap"));
  }
  return geminiSegments([
    { inlineData: { mimeType, data: Buffer.from(bytes).toString("base64") } },
    { text: GEMINI_TRANSCRIPT_PROMPT },
  ]);
}

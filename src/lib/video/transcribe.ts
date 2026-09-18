import { z } from "zod";
import { extractJson } from "@/lib/derive/json";
import {
  gatewayConfigured,
  gatewayHeaders,
  gatewayModelId,
  gatewayUrl,
  keyFor,
  providerConfigured,
} from "@/lib/gateway";
import { recordUsage } from "@/lib/usage";
import { browserCaptions } from "@/lib/video/browser-transcript";
import { youtubeCaptions } from "@/lib/video/captions";
import { deepgramConfigured, deepgramTranscribe } from "@/lib/video/deepgram";
import { geminiCall, geminiConfigured, geminiCountTokens } from "@/lib/video/gemini";
import { splitFmp4, type ByteRange } from "@/lib/video/fmp4";
import { uploadGeminiFile, type GeminiFile } from "@/lib/video/gemini-files";
import { type Mp3Chunk, splitMp3 } from "@/lib/video/mp3";
import { normalizeSegments, type TranscriptSegment } from "@/lib/video/segments";
import { MAX_VIDEO_BYTES, parseTimeInput } from "@/lib/video/types";
import { youtubeWatchUrl } from "@/lib/video/youtube";
import { youtubeAudio } from "@/lib/video/youtube-audio";

export { groupSegments, normalizeSegments, type TranscriptSegment } from "@/lib/video/segments";

// Transcription (SPEC.md §11) is a provider ladder, ordered by source:
//   YouTube video:  caption tracks from YouTube's player API — the transcript
//                   YouTube itself shows (ANDROID, IOS, then ANDROID_VR
//                   client, then the watch page) → the same captions read by
//                   a real browser, where one is configured → the audio
//                   stream downloads and takes the upload ladder (the
//                   smallest stream, split for Whisper at its segment
//                   boundaries: $0.04 an hour, no video tokens) → Gemini
//                   reads the video by URL, last: about 100 tokens a second
//                   of video, three times the audio's, and one call over an
//                   hour of video outruns the ladder's clock.
//   Uploaded video or audio: Deepgram Nova-3 (one call over the whole file,
//                   2 GB allowed; timestamps and the voice on every utterance
//                   from the audio itself, $0.26 an hour) → Groq Whisper (best
//                   quality per dollar among the rest; free tier) → OpenAI
//                   Whisper → Gemini, with the bytes inline when they are small
//                   enough and through Gemini's file store when they are not
//                   — an hour of media is far past every other rung's cap,
//                   and the store takes 2 GB.
// Each rung throws a plain reason; the ladder tries the next and reports every
// reason when all have run. A rung never starts with under 20 seconds left of
// the caller's deadline: the ladder then stops with LadderOutOfTime, which
// names the rungs that failed and the rungs left, and the transcription job
// runs the rest on a fresh function (its next leg, `skip` naming the rungs
// already tried) — FAILED is written only after every rung has actually run.
// Segments group into transcript lines at the end; the job writes them as
// TRANSCRIPT blocks.

export const TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024; // Whisper-family upload cap
// An MP3 past the cap splits at frame boundaries (lib/video/mp3.ts), an
// indexed MP4 stream at its segment boundaries (lib/video/fmp4.ts), and the
// chunks transcribe a few at a time; other containers cannot be cut safely
// and keep the cap.
const WHISPER_CHUNK_BYTES = 24 * 1024 * 1024;
const WHISPER_CHUNK_CONCURRENCY = 3;
// Inline bytes reach Gemini base64-encoded inside a 20 MB request; past that
// the file goes in Gemini's store, which takes 2 GB — more than this app
// accepts, so the app's own upload ceiling is the real cap (lib/video/types.ts).
const GEMINI_INLINE_MAX_BYTES = 14 * 1024 * 1024;
export const GEMINI_FILE_MAX_BYTES = MAX_VIDEO_BYTES;

// A video costs Gemini roughly 100 tokens per second, so a feature-length one
// runs past the 1M context window in a single call (and its transcript would
// crowd the output cap). Past this many tokens a pass over the video runs in
// windows that are stitched back together. The speakers pass keeps this
// ceiling: it hears every voice at once, which is what keeps one id per
// voice honest.
export const GEMINI_SINGLE_CALL_TOKENS = 700_000;
// Transcription windows far sooner: Gemini's timestamps drift with the
// length of what it reads, minutes late by the end of an hour in one call,
// and every line then sits under the wrong moment. A window of fifteen
// minutes keeps them within seconds. About fifteen minutes of video at low
// resolution, so anything longer windows.
export const GEMINI_TRANSCRIBE_SINGLE_CALL_TOKENS = 100_000;
export const CHUNK_SECONDS = 900; // 15 minutes per window — a longer one invites a partial answer
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
  /** Rungs already tried by an earlier leg of the same attempt, by name; the
      ladder starts past them. */
  skip?: string[];
  /** The reader who asked, for the admin usage page; null = the app's own
      automatic run (SPEC.md §11). */
  userId?: string | null;
  /** A file already in Gemini's store for this media: the upload is skipped. */
  geminiFile?: GeminiFile | null;
  /** Called when a file lands in the store, so a retry can reuse it. */
  onGeminiFile?: (file: GeminiFile) => void;
};

const RUNG_MIN_MS = 20_000;

type Rung = [string, () => Promise<TranscriptSegment[]>];

export type RungFailure = { rung: string; reason: string };

/** The ladder stopped before its deadline with rungs left to run. `failures`
    are the rungs that ran and failed in this leg; `remaining` the rungs not
    run, first the one that was about to start. */
export class LadderOutOfTime extends Error {
  constructor(
    public failures: RungFailure[],
    public remaining: string[],
  ) {
    super(
      [
        ...failures.map((f) => `${f.rung}: ${f.reason}`),
        `out of time before ${remaining.join(", ")}`,
      ].join(" · "),
    );
  }
}

/** Every rung ran and failed. */
export class LadderExhausted extends Error {
  constructor(public failures: RungFailure[]) {
    super(failures.map((f) => `${f.rung}: ${f.reason}`).join(" · "));
  }
}

// The abort signal a rung's request takes, so a call cannot outlive the
// caller's deadline.
function deadlineSignal(opts: TranscribeOptions): AbortSignal | undefined {
  if (opts.deadline === undefined) return undefined;
  return AbortSignal.timeout(Math.max(1_000, opts.deadline - Date.now()));
}

export async function transcribe(
  source: TranscribeSource,
  opts: TranscribeOptions = {},
): Promise<{ segments: TranscriptSegment[]; provider: string }> {
  const rungs: Rung[] =
    source.kind === "youtube"
      ? [
          ["YouTube captions", () => youtubeCaptions(source.youtubeId)],
          ["YouTube captions (browser)", () => browserCaptions(source.youtubeId)],
          ["YouTube audio", () => youtubeAudioRung(source.youtubeId, opts)],
          ["Gemini", () => geminiYouTube(source.youtubeId, opts.userId ?? null)],
        ]
      : uploadRungs(source.bytes, source.mimeType ?? "video/mp4", opts);
  return runLadder(rungs, opts);
}

// ranges: a DASH stream's init and index ranges (the YouTube audio rung),
// so a Whisper rung can split it past the cap.
function uploadRungs(
  bytes: Uint8Array<ArrayBuffer>,
  mimeType: string,
  opts: TranscribeOptions = {},
  ranges: StreamRanges = null,
): Rung[] {
  return [
    [
      "Deepgram",
      () =>
        deepgramTranscribe(bytes, mimeType, {
          signal: deadlineSignal(opts),
          userId: opts.userId ?? null,
        }),
    ],
    ["Groq Whisper", () => whisperFamily(GROQ_WHISPER, bytes, mimeType, ranges, opts.userId ?? null)],
    ["OpenAI Whisper", () => whisperFamily(OPENAI_WHISPER, bytes, mimeType, ranges, opts.userId ?? null)],
    ["Gemini", () => geminiUpload(bytes, mimeType, opts)],
  ];
}

type StreamRanges = { init: ByteRange; index: ByteRange } | null;

// The rungs in order, past the ones an earlier leg tried. A rung that runs
// out of time inside its own work (the YouTube audio rung runs the upload
// ladder inside it) counts as not run: the next leg runs it again.
async function runLadder(
  rungs: Rung[],
  opts: TranscribeOptions,
): Promise<{ segments: TranscriptSegment[]; provider: string }> {
  const pending = rungs.filter(([name]) => !opts.skip?.includes(name));
  const failures: RungFailure[] = [];
  for (let i = 0; i < pending.length; i++) {
    const [name, run] = pending[i];
    const remaining = () => pending.slice(i).map(([n]) => n);
    if (opts.deadline !== undefined && Date.now() > opts.deadline - RUNG_MIN_MS) {
      throw new LadderOutOfTime(failures, remaining());
    }
    try {
      return { segments: await run(), provider: name };
    } catch (err) {
      if (err instanceof LadderOutOfTime) throw new LadderOutOfTime(failures, remaining());
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[transcribe] ${name} failed:`, message);
      failures.push({ rung: name, reason: message });
    }
  }
  throw new LadderExhausted(failures);
}

// The audio stream takes the upload ladder, so it needs an upload provider
// and fits that provider's cap: 25 MB for the Whisper rungs, 14 MB inline
// for Gemini alone.
function youtubeAudioRung(youtubeId: string, opts: TranscribeOptions): Promise<TranscriptSegment[]> {
  const whisper = whisperConfigured();
  if (!whisper && !geminiConfigured() && !deepgramConfigured()) {
    return Promise.reject(new Error(TRANSCRIPTION_KEYS_UNSET));
  }
  return youtubeAudio(youtubeId, {
    // Deepgram and Gemini's file store take what the Whisper rungs cannot:
    // with either key set, the stream only has to fit the app's own upload
    // ceiling.
    maxBytes: geminiConfigured() || deepgramConfigured()
      ? GEMINI_FILE_MAX_BYTES
      : whisper
        ? TRANSCRIBE_MAX_BYTES
        : GEMINI_INLINE_MAX_BYTES,
    transcribeBytes: (bytes, mimeType, ranges) =>
      runLadder(uploadRungs(bytes, mimeType, opts, ranges), { ...opts, skip: undefined }).then((result) => {
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
// dollar, so it goes first. Under the gateway (lib/gateway.ts) both go to
// its transcription route as <provider>/<model> with the app key.
type WhisperProvider = {
  provider: "groq" | "openai";
  keyEnv: "GROQ_API_KEY" | "OPENAI_API_KEY";
  endpoint: () => string;
  model: string;
  usdPerMinute: number;
};

const GROQ_WHISPER: WhisperProvider = {
  provider: "groq",
  keyEnv: "GROQ_API_KEY",
  // GROQ_API_URL points a local run at a stand-in server (scripts/qa).
  endpoint: () =>
    gatewayConfigured()
      ? gatewayUrl("/v1/audio/transcriptions")
      : (process.env.GROQ_API_URL ?? "https://api.groq.com/openai/v1/audio/transcriptions"),
  model: "whisper-large-v3-turbo",
  usdPerMinute: 0.04 / 60,
};

const OPENAI_WHISPER: WhisperProvider = {
  provider: "openai",
  keyEnv: "OPENAI_API_KEY",
  endpoint: () =>
    gatewayConfigured() ? gatewayUrl("/v1/audio/transcriptions") : "https://api.openai.com/v1/audio/transcriptions",
  model: "whisper-1",
  usdPerMinute: 0.006,
};

/** The gateway or a Whisper key is set, so a Whisper rung runs. */
export function whisperConfigured(): boolean {
  return providerConfigured("groq") || providerConfigured("openai");
}

/** The reason when no transcription provider is set at all. */
export const TRANSCRIPTION_KEYS_UNSET =
  "Set LITELLM_BASE_URL and LITELLM_API_KEY, or DEEPGRAM_API_KEY, GROQ_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY. Transcription needs one.";

// One OpenAI-compatible transcription call.
async function whisperCall(
  opts: WhisperProvider & { key: string; userId: string | null },
  bytes: Uint8Array,
  mimeType: string,
): Promise<TranscriptSegment[]> {
  const form = new FormData();
  form.set(
    "file",
    new Blob([bytes as BlobPart], { type: mimeType }),
    `media.${EXTENSION[mimeType] ?? "mp4"}`,
  );
  form.set("model", gatewayModelId(opts.provider, opts.model));
  form.set("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");

  // Plain fetch: multipart bodies do not fit outboundFetch's string body.
  const res = await fetch(opts.endpoint(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.key}`,
      ...gatewayHeaders({ userId: opts.userId, feature: "transcribe" }),
    },
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
    { userId: opts.userId, feature: "transcribe", model: opts.model },
    { inputTokens: Math.ceil(minutes * 60) },
    minutes * opts.usdPerMinute,
  );
  return segments;
}

// The chunks a file over the cap splits into: an MP3 at frame boundaries,
// an indexed MP4 stream at segment boundaries. Throws with the reason when
// the file cannot be split.
function splitForWhisper(bytes: Uint8Array, mimeType: string, ranges: StreamRanges): Mp3Chunk[] {
  if (mimeType === "audio/mpeg") {
    const chunks = splitMp3(bytes, WHISPER_CHUNK_BYTES);
    if (!chunks) throw new Error("MP3 frames did not parse; the file cannot be split");
    return chunks;
  }
  if (mimeType === "audio/mp4" && ranges) {
    const chunks = splitFmp4(bytes, ranges, WHISPER_CHUNK_BYTES);
    if (!chunks) throw new Error("the MP4 stream's segment index did not parse; the stream cannot be split");
    return chunks;
  }
  throw new Error("file is larger than the 25 MB transcription cap for this format");
}

// A file under the cap goes in one call. A bigger file splits (chunks decode
// cleanly), each chunk transcribes on its own clock, and the segments shift
// back onto the audio's. Chunks run a few at a time; a chunk that fails
// twice leaves a gap rather than losing the transcript, like the YouTube
// windows.
async function whisperFamily(
  provider: WhisperProvider,
  bytes: Uint8Array,
  mimeType: string,
  ranges: StreamRanges = null,
  userId: string | null = null,
): Promise<TranscriptSegment[]> {
  const key = keyFor(provider.provider);
  if (!key) throw new Error(`${provider.keyEnv} is not set`);
  const opts = { ...provider, key, userId };
  if (bytes.length <= TRANSCRIBE_MAX_BYTES) return whisperCall(opts, bytes, mimeType);
  const chunks = splitForWhisper(bytes, mimeType, ranges);
  console.log(`[transcribe] ${bytes.length} bytes ${mimeType} → ${chunks.length} chunks`);

  const results: TranscriptSegment[][] = new Array(chunks.length).fill([]);
  for (let i = 0; i < chunks.length; i += WHISPER_CHUNK_CONCURRENCY) {
    const batch = chunks.slice(i, i + WHISPER_CHUNK_CONCURRENCY);
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
              `[transcribe] chunk ${i + j} attempt ${attempt + 1} failed:`,
              err instanceof Error ? err.message : err,
            );
          }
        }
      }),
    );
  }
  const segments = normalizeSegments(results.flat());
  if (segments.length === 0) throw new Error("every chunk failed to transcribe");
  return segments;
}

// ── Gemini ──────────────────────────────────────────────────────────────────

// Timestamps are asked for as a clock ("M:SS", "H:MM:SS"): that is how
// Gemini refers to moments of the media it reads, and a clock it reads off
// lands closer to the moment than a count of seconds it works out.
const GEMINI_TRANSCRIPT_PROMPT = [
  "Transcribe this recording's speech with timestamps.",
  'Return ONLY JSON: {"segments": [{"start": "M:SS", "end": "M:SS", "text": "…"}]}',
  "1. One segment per sentence or phrase, 5–15 seconds each.",
  '2. start and end are the clock of the recording you were given, as "M:SS" or "H:MM:SS" (for example "4:07", "1:02:05"), the moment the words are spoken — read from the recording, never estimated from the text. Segments follow the recording in order and never overlap.',
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
  opts: { allowEmpty?: boolean; userId?: string | null } = {},
): Promise<TranscriptSegment[]> {
  return geminiCall(
    parts,
    {
      json: true,
      maxOutputTokens: 65536,
      lowResolution: true,
      usage: { userId: opts.userId ?? null, feature: "transcribe" },
    },
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

// The media as a Gemini part, whole or windowed: a YouTube URL and a file in
// Gemini's store are the same shape, so one windowing path serves both.
export type MediaWindow = { start: number; end: number; last?: boolean };
export type MediaPart = (window?: MediaWindow) => unknown;

/** The media as something Gemini can read (SPEC.md §11): a YouTube URL, the
    bytes inline when they fit one request, or the file in Gemini's store —
    uploaded now when it is not there yet. One media path for every pass that
    reads the media: transcription, and the speakers pass over its lines.
    `windowable` says whether it can be asked for by time range; only video
    can. `inline` media is one call and is never counted or windowed. */
export async function geminiMediaPart(
  source: TranscribeSource,
  opts: TranscribeOptions = {},
): Promise<{ part: MediaPart; windowable: boolean; inline: boolean; label: string }> {
  if (source.kind === "youtube") {
    return {
      part: (w) => youtubeVideoPart(source.youtubeId, w),
      windowable: true,
      inline: false,
      label: "video",
    };
  }
  const mimeType = source.mimeType ?? "video/mp4";
  const kind = mimeType.startsWith("video/") ? "video" : "audio";
  if (source.bytes.length <= GEMINI_INLINE_MAX_BYTES && !opts.geminiFile) {
    const data = Buffer.from(source.bytes).toString("base64");
    return {
      part: () => ({ inlineData: { mimeType, data } }),
      windowable: false,
      inline: true,
      label: kind,
    };
  }
  const file =
    opts.geminiFile ??
    (await uploadGeminiFile(source.bytes, mimeType, {
      displayName: `unitos-media.${EXTENSION[mimeType] ?? "mp4"}`,
      deadline: opts.deadline,
    }));
  if (!opts.geminiFile) opts.onGeminiFile?.(file);
  console.log(`[transcribe] ${source.bytes.length} bytes in Gemini's store as ${file.name}`);
  const video = file.mimeType.startsWith("video/");
  return {
    part: (w) => ({
      fileData: { fileUri: file.uri, mimeType: file.mimeType },
      ...(video && w
        ? {
            videoMetadata: {
              startOffset: `${Math.floor(w.start)}s`,
              ...(w.last ? {} : { endOffset: `${Math.ceil(w.end)}s` }),
            },
          }
        : {}),
    }),
    windowable: video,
    inline: false,
    label: video ? "video" : "audio",
  };
}

// One window of a long video, on the video's own clock.
function transcribeWindow(
  part: MediaPart,
  w: { start: number; end: number; last?: boolean },
  userId: string | null,
): Promise<TranscriptSegment[]> {
  return geminiSegments(
    [part(w), { text: GEMINI_TRANSCRIPT_PROMPT }],
    { allowEmpty: true, userId },
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
    // overlap — a window starting at 30:00 is either 0..30:00 or 30:00..60:00.
    // The earliest timestamp decides: an answer on the video's clock never
    // starts before the window does, so one that starts well before it is
    // on the window's own clock. The last window's span is an estimate, so
    // its answer can run past it on either clock; the earliest timestamp
    // still tells them apart. Only a window clock gets shifted onto the
    // video's.
    const earliest = Math.min(...scaled.map((s) => s.start));
    const ownClock =
      earliest < w.start * 0.5 || (latest <= span * 1.15 && earliest < w.start - 30);
    const aligned = ownClock
      ? scaled.map((s) => ({
          ...s,
          start: s.start + w.start,
          end: Math.min(s.end + w.start, w.end),
        }))
      : scaled;

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
  part: MediaPart,
  w: { start: number; end: number; last?: boolean },
  userId: string | null,
): Promise<TranscriptSegment[]> {
  const span = w.end - w.start;
  let best: TranscriptSegment[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const segments = await transcribeWindow(part, w, userId);
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

// Gemini transcribes media it can read — a public YouTube URL, or a file in
// its own store — in one call when the media fits the context window, and in
// windows when it does not. Timestamps inside a window come back relative to
// that window, so each window's offset is added back. `windowable` is false
// for media that cannot be asked for by time range (audio has no video
// metadata), which then has to fit one call.
async function geminiWindowed(
  part: MediaPart,
  opts: { windowable: boolean; label: string; userId: string | null },
): Promise<TranscriptSegment[]> {
  const whole = [part(), { text: GEMINI_TRANSCRIPT_PROMPT }];
  const total = await geminiCountTokens(whole);
  if (total === null || total <= GEMINI_TRANSCRIBE_SINGLE_CALL_TOKENS) {
    return geminiSegments(whole, { userId: opts.userId });
  }
  if (!opts.windowable) {
    throw new Error(`${opts.label} is too long to transcribe in one call`);
  }

  // Too long for one call. The media's own token rate converts the total into
  // a duration: count one known minute, then divide.
  const probe = await geminiCountTokens([
    part({ start: 0, end: 60 }),
    { text: GEMINI_TRANSCRIPT_PROMPT },
  ]);
  if (probe === null || probe <= 0) throw new Error(`${opts.label} is too long to measure`);
  const duration = (total / (probe / 60)) * 1.05; // slight overshoot; empty tail windows drop out
  const count = Math.ceil(duration / CHUNK_SECONDS);
  if (count > MAX_CHUNKS) {
    throw new Error(
      `${opts.label} is about ${Math.round(duration / 60)} minutes — longer than the ${(MAX_CHUNKS * CHUNK_SECONDS) / 3600}-hour transcription limit`,
    );
  }
  const windows = Array.from({ length: count }, (_, i) => ({
    start: i * CHUNK_SECONDS,
    end: Math.min((i + 1) * CHUNK_SECONDS, Math.ceil(duration)),
    last: i === count - 1,
  }));
  console.log(
    `[transcribe] ${Math.round(duration / 60)}min ${opts.label} (${total} tokens) → ${count} windows`,
  );

  const results: TranscriptSegment[][] = [];
  for (let i = 0; i < windows.length; i += CHUNK_CONCURRENCY) {
    const batch = windows.slice(i, i + CHUNK_CONCURRENCY);
    results.push(
      ...(await Promise.all(
        batch.map((w) => transcribeWindowBest(part, w, opts.userId)),
      )),
    );
  }
  const segments = normalizeSegments(results.flat());
  if (segments.length === 0) throw new Error("no speech found");
  return segments;
}

function geminiYouTube(youtubeId: string, userId: string | null): Promise<TranscriptSegment[]> {
  return geminiWindowed((w) => youtubeVideoPart(youtubeId, w), {
    windowable: true,
    label: "video",
    userId,
  });
}

// An uploaded file, read through the shared media part: small enough goes
// inline in one request; anything bigger — an hour of media is far past every
// other rung's cap — goes in Gemini's file store, which is where the long
// context is, and takes the same windowing the YouTube path uses.
async function geminiUpload(
  bytes: Uint8Array<ArrayBuffer>,
  mimeType: string,
  opts: TranscribeOptions = {},
): Promise<TranscriptSegment[]> {
  const media = await geminiMediaPart({ kind: "upload", bytes, mimeType }, opts);
  const userId = opts.userId ?? null;
  if (media.inline) {
    return geminiSegments([media.part(), { text: GEMINI_TRANSCRIPT_PROMPT }], { userId });
  }
  return geminiWindowed(media.part, {
    windowable: media.windowable,
    label: media.label,
    userId,
  });
}

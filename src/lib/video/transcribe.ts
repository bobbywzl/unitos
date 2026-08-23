import { z } from "zod";
import { extractJson } from "@/lib/derive/json";
import { outboundFetch } from "@/lib/outbound-fetch";
import { geminiCall, geminiCountTokens } from "@/lib/video/gemini";
import { fetchPlayerResponse } from "@/lib/video/innertube";
import { parseTimeInput } from "@/lib/video/types";
import { youtubeWatchUrl } from "@/lib/video/youtube";

// Transcription (SPEC.md §11) is a provider ladder, ordered by source:
//   YouTube video:  Gemini reads the video by URL → caption tracks from the
//                   player API (ANDROID, then IOS client) → caption tracks
//                   scraped from the watch page.
//   Uploaded video: Whisper → Gemini with the bytes inline.
// Each rung throws a plain reason; the ladder tries the next and reports every
// reason when all fail. Segments group into transcript lines at the end; the
// route writes them as TRANSCRIPT blocks.

export const TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024; // Whisper's upload cap
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

export type TranscriptSegment = { start: number; end: number; text: string };

export type TranscribeSource =
  | { kind: "upload"; bytes: Uint8Array<ArrayBuffer>; mimeType: string | null }
  | { kind: "youtube"; youtubeId: string };

export async function transcribe(
  source: TranscribeSource,
): Promise<{ segments: TranscriptSegment[]; provider: string }> {
  const rungs: [string, () => Promise<TranscriptSegment[]>][] =
    source.kind === "youtube"
      ? [
          ["Gemini", () => geminiYouTube(source.youtubeId)],
          ["YouTube captions (API)", () => youtubeCaptionsApi(source.youtubeId)],
          ["YouTube captions (page)", () => youtubeCaptionsPage(source.youtubeId)],
        ]
      : [
          ["Whisper", () => whisper(source.bytes, source.mimeType ?? "video/mp4")],
          ["Gemini", () => geminiUpload(source.bytes, source.mimeType ?? "video/mp4")],
        ];
  const failures: string[] = [];
  for (const [name, run] of rungs) {
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

// ── Whisper ─────────────────────────────────────────────────────────────────

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
};

async function whisper(
  bytes: Uint8Array<ArrayBuffer>,
  mimeType: string,
): Promise<TranscriptSegment[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  if (bytes.length > TRANSCRIBE_MAX_BYTES) throw new Error("video is larger than the 25 MB cap");

  const form = new FormData();
  form.set("file", new Blob([bytes], { type: mimeType }), `video.${EXTENSION[mimeType] ?? "mp4"}`);
  form.set("model", "whisper-1");
  form.set("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");

  // Plain fetch: multipart bodies do not fit outboundFetch's string body.
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(detail?.error?.message ?? `request failed (${res.status})`);
  }
  const parsed = whisperResponseSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error("no timed segments returned");
  return normalizeSegments(parsed.data.segments);
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
    { json: true, maxOutputTokens: 65536, lowResolution: true },
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
    return Promise.reject(new Error("video is larger than the 14 MB inline cap"));
  }
  return geminiSegments([
    { inlineData: { mimeType, data: Buffer.from(bytes).toString("base64") } },
    { text: GEMINI_TRANSCRIPT_PROMPT },
  ]);
}

// ── YouTube caption tracks ──────────────────────────────────────────────────
// Two independent ways to the same tracks. The player API answers datacenter
// IPs that the watch page refuses ("confirm you're not a bot"), so it goes
// first. The watch-page scrape stays as the last resort for networks where
// the API is the blocked one.

const captionTracksSchema = z
  .array(
    z.object({
      baseUrl: z.string().url(),
      languageCode: z.string().optional(),
      kind: z.string().optional(), // "asr" = auto-generated
    }),
  )
  .min(1);
type CaptionTrack = z.infer<typeof captionTracksSchema>[number];

const timedTextSchema = z.object({
  events: z.array(
    z.object({
      tStartMs: z.number().optional(),
      dDurationMs: z.number().optional(),
      segs: z.array(z.object({ utf8: z.string().optional() })).optional(),
    }),
  ),
});

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Prefer human English captions, then auto-generated English, then anything.
function pickTrack(tracks: CaptionTrack[]): CaptionTrack {
  return (
    tracks.find((t) => t.languageCode?.startsWith("en") && t.kind !== "asr") ??
    tracks.find((t) => t.languageCode?.startsWith("en")) ??
    tracks[0]
  );
}

async function fetchTimedText(baseUrl: string, userAgent: string): Promise<TranscriptSegment[]> {
  const timed = await outboundFetch(`${baseUrl}&fmt=json3`, {
    headers: { "User-Agent": userAgent },
  });
  if (!timed.ok) throw new Error(`caption fetch failed (${timed.status})`);
  const parsed = timedTextSchema.safeParse(await timed.json());
  if (!parsed.success) throw new Error("caption track was not readable");
  const segments = parsed.data.events
    .map((event) => ({
      start: (event.tStartMs ?? 0) / 1000,
      end: ((event.tStartMs ?? 0) + (event.dDurationMs ?? 2000)) / 1000,
      text: (event.segs ?? [])
        .map((s) => s.utf8 ?? "")
        .join("")
        .replace(/\n/g, " ")
        .trim(),
    }))
    .filter((s) => s.text !== "");
  if (segments.length === 0) throw new Error("caption track was empty");
  return normalizeSegments(segments);
}

async function youtubeCaptionsApi(youtubeId: string): Promise<TranscriptSegment[]> {
  const { userAgent, data } = await fetchPlayerResponse(youtubeId);
  const tracks = captionTracksSchema.safeParse(
    data.captions?.playerCaptionsTracklistRenderer?.captionTracks,
  );
  if (!tracks.success) throw new Error("no caption tracks on this video");
  return fetchTimedText(pickTrack(tracks.data).baseUrl, userAgent);
}

// The value of `"<key>": [...]` in a script blob, by bracket matching — the
// array nests objects and strings that a regex cannot bound.
function extractJsonArray(source: string, key: string): unknown | null {
  const at = source.indexOf(`"${key}":`);
  if (at === -1) return null;
  const start = source.indexOf("[", at);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

async function youtubeCaptionsPage(youtubeId: string): Promise<TranscriptSegment[]> {
  const watch = await outboundFetch(`https://www.youtube.com/watch?v=${youtubeId}&hl=en`, {
    headers: { "User-Agent": BROWSER_UA, "Accept-Language": "en" },
  });
  if (!watch.ok) throw new Error(`watch page fetch failed (${watch.status})`);
  const tracks = captionTracksSchema.safeParse(
    extractJsonArray(await watch.text(), "captionTracks"),
  );
  if (!tracks.success) throw new Error("no caption tracks on this video");
  return fetchTimedText(pickTrack(tracks.data).baseUrl, BROWSER_UA);
}

// ── Shared ──────────────────────────────────────────────────────────────────

function normalizeSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  return segments
    .map((s) => ({ start: s.start, end: Math.max(s.end, s.start), text: s.text.trim() }))
    .filter((s) => s.text !== "")
    .sort((a, b) => a.start - b.start);
}

// Group segments into transcript lines: one line reads like a sentence or two.
// A line closes at ~280 characters, at a speech gap over 1.5s, or at 30s.
export function groupSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const lines: TranscriptSegment[] = [];
  let open: TranscriptSegment | null = null;
  for (const segment of segments) {
    if (
      open &&
      (open.text.length + segment.text.length > 280 ||
        segment.start - open.end > 1.5 ||
        segment.end - open.start > 30)
    ) {
      lines.push(open);
      open = null;
    }
    open = open
      ? { start: open.start, end: segment.end, text: `${open.text} ${segment.text}` }
      : { ...segment };
  }
  if (open) lines.push(open);
  return lines;
}

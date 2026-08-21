import { z } from "zod";
import { extractJson } from "@/lib/derive/json";
import { outboundFetch } from "@/lib/outbound-fetch";
import { parseTimeInput } from "@/lib/video/types";

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
// The first model that answers wins; the second covers quota and outages.
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];

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
  "2. start and end are numbers in seconds from the video start.",
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

async function geminiSegments(parts: unknown[]): Promise<TranscriptSegment[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const failures: string[] = [];
  for (const model of GEMINI_MODELS) {
    try {
      const res = await outboundFetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: { responseMimeType: "application/json", maxOutputTokens: 65536 },
          }),
        },
      );
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(detail?.error?.message ?? `request failed (${res.status})`);
      }
      const body = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      const parsed = geminiSegmentsSchema.safeParse(extractJson(text));
      if (!parsed.success) throw new Error("output was not timed segments");
      if (parsed.data.segments.length === 0) throw new Error("no speech found");
      return normalizeSegments(parsed.data.segments);
    } catch (err) {
      failures.push(`${model}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(failures.join("; "));
}

// Gemini reads public YouTube videos directly by URL.
function geminiYouTube(youtubeId: string): Promise<TranscriptSegment[]> {
  return geminiSegments([
    { fileData: { fileUri: `https://www.youtube.com/watch?v=${youtubeId}` } },
    { text: GEMINI_TRANSCRIPT_PROMPT },
  ]);
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
// first — ANDROID client, then IOS. The watch-page scrape stays as the last
// resort for networks where the API is the blocked one.

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

// The player API caption tracks, mobile clients first — they answer where the
// web surfaces demand a sign-in.
const INNERTUBE_CLIENTS = [
  {
    label: "ANDROID",
    userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip",
    client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 30, hl: "en" },
  },
  {
    label: "IOS",
    userAgent: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)",
    client: { clientName: "IOS", clientVersion: "20.10.4", deviceModel: "iPhone16,2", hl: "en" },
  },
];

const playerResponseSchema = z.object({
  playabilityStatus: z.object({ status: z.string(), reason: z.string().optional() }).optional(),
  captions: z
    .object({
      playerCaptionsTracklistRenderer: z.object({ captionTracks: z.unknown() }).optional(),
    })
    .optional(),
});

async function youtubeCaptionsApi(youtubeId: string): Promise<TranscriptSegment[]> {
  const failures: string[] = [];
  for (const { label, userAgent, client } of INNERTUBE_CLIENTS) {
    try {
      const res = await outboundFetch("https://www.youtube.com/youtubei/v1/player", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": userAgent },
        body: JSON.stringify({ context: { client }, videoId: youtubeId }),
      });
      if (!res.ok) throw new Error(`player request failed (${res.status})`);
      const body = playerResponseSchema.safeParse(await res.json());
      if (!body.success) throw new Error("player response was not readable");
      const status = body.data.playabilityStatus;
      if (status && status.status !== "OK") {
        throw new Error(status.reason ?? status.status);
      }
      const tracks = captionTracksSchema.safeParse(
        body.data.captions?.playerCaptionsTracklistRenderer?.captionTracks,
      );
      if (!tracks.success) throw new Error("no caption tracks on this video");
      return await fetchTimedText(pickTrack(tracks.data).baseUrl, userAgent);
    } catch (err) {
      failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(failures.join("; "));
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

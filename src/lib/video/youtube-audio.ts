import { outboundFetch } from "@/lib/outbound-fetch";
import { adaptiveFormatsOf, playerResponses, type AdaptiveFormat } from "@/lib/video/innertube";
import type { TranscriptSegment } from "@/lib/video/segments";

// The audio rung (SPEC.md §11), the last resort for a YouTube video: no
// caption track anywhere and Gemini could not read the video. The audio-only
// stream downloads through the player API's app clients — the same ones that
// serve the captions — and takes the upload ladder like a file the reader
// uploaded. Bounded by the upload cap: the best stream that fits it, and a
// video whose smallest stream is over the cap says so.

const DOWNLOAD_TIMEOUT_MS = 90_000;

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

function audioStreams(formats: AdaptiveFormat[]): AdaptiveFormat[] {
  return formats.filter(
    (f) =>
      f.mimeType.startsWith("audio/") &&
      typeof f.url === "string" &&
      typeof f.contentLength === "string" &&
      Number(f.contentLength) > 0,
  );
}

/** The best audio-only stream under the cap: the highest bitrate that fits. */
export function pickAudioFormat(formats: AdaptiveFormat[], maxBytes: number): AdaptiveFormat | null {
  const fitting = audioStreams(formats).filter((f) => Number(f.contentLength) <= maxBytes);
  fitting.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
  return fitting[0] ?? null;
}

async function download(
  url: string,
  userAgent: string,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  // A stream URL comes out of a parsed response; only YouTube's media host is fetched.
  if (!/\.googlevideo\.com$/.test(new URL(url).hostname)) {
    throw new Error("audio stream is not on googlevideo.com");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await outboundFetch(url, {
      headers: { "User-Agent": userAgent },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`audio stream refused (${res.status})`);
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength === 0) throw new Error("audio stream was empty");
    if (buffer.byteLength > maxBytes) throw new Error("audio stream ran past the cap");
    return new Uint8Array(buffer);
  } catch (err) {
    if (controller.signal.aborted) throw new Error("audio download ran out of time");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export type YouTubeAudioOptions = {
  /** The upload cap of the providers configured: 25 MB with a Whisper key, 14 MB with Gemini alone. */
  maxBytes: number;
  /** The upload ladder: the same rungs a file the reader uploaded takes. */
  transcribeBytes: (bytes: Uint8Array<ArrayBuffer>, mimeType: string) => Promise<TranscriptSegment[]>;
};

/** Download the smallest good audio stream and transcribe it. Throws with
    every client's reason when no stream downloads. */
export async function youtubeAudio(
  youtubeId: string,
  opts: YouTubeAudioOptions,
): Promise<TranscriptSegment[]> {
  const failures: string[] = [];
  const capMb = Math.round(opts.maxBytes / 1024 / 1024);
  for await (const { label, userAgent, data } of playerResponses(youtubeId, failures)) {
    const formats = adaptiveFormatsOf(data);
    const pick = pickAudioFormat(formats, opts.maxBytes);
    if (!pick) {
      const sizes = audioStreams(formats).map((f) => Number(f.contentLength));
      failures.push(
        sizes.length === 0
          ? `${label}: no audio stream`
          : `${label}: the smallest audio stream is ${Math.ceil(Math.min(...sizes) / 1024 / 1024)} MB, over the ${capMb} MB transcription cap`,
      );
      continue;
    }
    if (!pick.url) continue; // audioStreams keeps only streams with a URL
    try {
      const bytes = await download(pick.url, userAgent, opts.maxBytes);
      const mimeType = pick.mimeType.split(";")[0].trim();
      console.log(
        `[transcribe] YouTube audio via ${label}: itag ${pick.itag} ${mimeType}, ${bytes.length} bytes`,
      );
      return await opts.transcribeBytes(bytes, mimeType);
    } catch (err) {
      failures.push(`${label}: ${reason(err)}`);
    }
  }
  throw new Error(failures.join("; "));
}

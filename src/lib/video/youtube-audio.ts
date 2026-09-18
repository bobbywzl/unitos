import { outboundFetch } from "@/lib/outbound-fetch";
import { adaptiveFormatsOf, playerResponses, type AdaptiveFormat } from "@/lib/video/innertube";
import type { TranscriptSegment } from "@/lib/video/segments";

// The audio rung (SPEC.md §11): no caption track anywhere. The audio-only
// stream downloads through the player API's app clients — the same ones that
// serve the captions — and takes the upload ladder like a file the reader
// uploaded. The smallest stream that fits the cap: a transcript reads the
// words, and 48 kbps carries them as well as 128, at a third of the bytes
// and a third of the download time. An indexed MP4 stream is preferred, so
// one over the Whisper cap can split at its segment boundaries; a video
// whose smallest stream is over the cap says so.

const DOWNLOAD_TIMEOUT_MS = 90_000;

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

// The audio streams of the track the player plays. A video with several
// audio tracks (a dub, described audio) marks the original one default; a
// transcript of any other track would not match what the reader hears.
function audioStreams(formats: AdaptiveFormat[]): AdaptiveFormat[] {
  const audio = formats.filter(
    (f) =>
      f.mimeType.startsWith("audio/") &&
      typeof f.url === "string" &&
      typeof f.contentLength === "string" &&
      Number(f.contentLength) > 0,
  );
  const original = audio.filter((f) => f.audioTrack?.audioIsDefault === true);
  return original.length > 0 ? original : audio;
}

/** The smallest audio-only stream under the cap, an indexed MP4 stream
    first (it splits for Whisper), then by bitrate, lowest first. */
export function pickAudioFormat(formats: AdaptiveFormat[], maxBytes: number): AdaptiveFormat | null {
  const fitting = audioStreams(formats).filter((f) => Number(f.contentLength) <= maxBytes);
  const indexed = (f: AdaptiveFormat) =>
    f.mimeType.startsWith("audio/mp4") && f.initRange !== undefined && f.indexRange !== undefined;
  fitting.sort((a, b) => {
    const byIndex = Number(indexed(b)) - Number(indexed(a));
    return byIndex !== 0 ? byIndex : (a.bitrate ?? 0) - (b.bitrate ?? 0);
  });
  return fitting[0] ?? null;
}

/** The DASH byte ranges of a stream, as the splitter reads them; null when
    the stream carries none. */
export function streamRanges(
  format: AdaptiveFormat,
): { init: { start: number; end: number }; index: { start: number; end: number } } | null {
  if (!format.initRange || !format.indexRange) return null;
  const range = (r: { start: string; end: string }) => ({ start: Number(r.start), end: Number(r.end) });
  const init = range(format.initRange);
  const index = range(format.indexRange);
  if ([init.start, init.end, index.start, index.end].some((n) => !Number.isFinite(n))) return null;
  return { init, index };
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
  /** The upload ladder: the same rungs a file the reader uploaded takes,
      with the stream's DASH ranges when it has them, so a Whisper rung can
      split it. */
  transcribeBytes: (
    bytes: Uint8Array<ArrayBuffer>,
    mimeType: string,
    ranges: ReturnType<typeof streamRanges>,
  ) => Promise<TranscriptSegment[]>;
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
      return await opts.transcribeBytes(bytes, mimeType, streamRanges(pick));
    } catch (err) {
      failures.push(`${label}: ${reason(err)}`);
    }
  }
  throw new Error(failures.join("; "));
}

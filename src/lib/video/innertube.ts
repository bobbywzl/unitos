import { z } from "zod";
import { outboundFetch } from "@/lib/outbound-fetch";

// YouTube's player API (SPEC.md §11). Clients in the order that answers a
// datacenter IP today: the ANDROID and IOS app clients serve caption tracks,
// storyboards, and audio streams where the web clients demand a bot check.
// ANDROID_VR served datacenter IPs until it started demanding the same check;
// it stays as the third try for networks where it still answers.
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
  {
    label: "ANDROID_VR",
    userAgent:
      "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; GB) gzip",
    client: {
      clientName: "ANDROID_VR",
      clientVersion: "1.60.19",
      deviceMake: "Oculus",
      deviceModel: "Quest 3",
      androidSdkVersion: 32,
      hl: "en",
    },
  },
];

// One caption track. Validated one element at a time, so a track this schema
// does not recognize drops without failing the whole response.
const captionTrackSchema = z.object({
  baseUrl: z.string(),
  languageCode: z.string().optional(),
  kind: z.string().optional(), // "asr" = auto-generated
});
export type CaptionTrack = z.infer<typeof captionTrackSchema>;

// One stream in streamingData.adaptiveFormats. Same one-at-a-time validation.
const adaptiveFormatSchema = z.object({
  itag: z.number(),
  mimeType: z.string(),
  bitrate: z.number().optional(),
  contentLength: z.string().optional(),
  url: z.string().optional(),
});
export type AdaptiveFormat = z.infer<typeof adaptiveFormatSchema>;

const playerResponseSchema = z.object({
  playabilityStatus: z.object({ status: z.string(), reason: z.string().optional() }).optional(),
  videoDetails: z.object({ lengthSeconds: z.string().optional() }).optional(),
  captions: z
    .object({
      playerCaptionsTracklistRenderer: z
        .object({
          captionTracks: z.unknown().optional(),
          audioTracks: z.array(z.unknown()).optional(),
          defaultAudioTrackIndex: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
  storyboards: z
    .object({ playerStoryboardSpecRenderer: z.object({ spec: z.string() }).optional() })
    .optional(),
  streamingData: z.object({ adaptiveFormats: z.array(z.unknown()).optional() }).optional(),
});

export type PlayerResponse = z.infer<typeof playerResponseSchema>;
export type PlayerResult = { label: string; userAgent: string; data: PlayerResponse };

function validEach<T>(raw: unknown, schema: z.ZodType<T>): T[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/** The caption tracks in a player response, or in any parsed `captionTracks` value. */
export function captionTracksOf(raw: unknown): CaptionTrack[] {
  return validEach(raw, captionTrackSchema);
}

/** The index of the track YouTube shows by default, when the response says so. */
export function defaultCaptionIndexOf(data: PlayerResponse): number | null {
  const renderer = data.captions?.playerCaptionsTracklistRenderer;
  const audio = renderer?.audioTracks?.[renderer.defaultAudioTrackIndex ?? 0];
  if (typeof audio !== "object" || audio === null || !("defaultCaptionTrackIndex" in audio)) {
    return null;
  }
  const index = audio.defaultCaptionTrackIndex;
  return typeof index === "number" ? index : null;
}

/** The adaptive streams in a player response, audio and video alike. */
export function adaptiveFormatsOf(data: PlayerResponse): AdaptiveFormat[] {
  return validEach(data.streamingData?.adaptiveFormats, adaptiveFormatSchema);
}

// Every client that answers, one at a time, in ladder order. The caller stops
// pulling once it has what it needs. A client that does not answer adds its
// reason to `failures`, so a caller that drains the generator and gets
// nothing can report every reason.
export async function* playerResponses(
  youtubeId: string,
  failures: string[] = [],
): AsyncGenerator<PlayerResult> {
  for (const { label, userAgent, client } of INNERTUBE_CLIENTS) {
    let result: PlayerResult;
    try {
      const res = await outboundFetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": userAgent },
        body: JSON.stringify({
          context: { client },
          videoId: youtubeId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      });
      if (!res.ok) throw new Error(`player request failed (${res.status})`);
      const parsed = playerResponseSchema.safeParse(await res.json());
      if (!parsed.success) throw new Error("player response was not readable");
      const status = parsed.data.playabilityStatus;
      if (status && status.status !== "OK") throw new Error(status.reason ?? status.status);
      result = { label, userAgent, data: parsed.data };
    } catch (err) {
      failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    yield result;
  }
}

// The first client that answers. Throws with every client's reason when none does.
export async function fetchPlayerResponse(youtubeId: string): Promise<PlayerResult> {
  const failures: string[] = [];
  for await (const result of playerResponses(youtubeId, failures)) return result;
  throw new Error(failures.join("; "));
}

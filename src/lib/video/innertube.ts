import { z } from "zod";
import { outboundFetch } from "@/lib/outbound-fetch";

// YouTube's player API (SPEC.md §11). Embedded-device clients go first: the
// phone and web clients now answer datacenter IPs with a bot check, while the
// VR client still serves them. Captions and storyboard frames both come from
// the response this returns.
const INNERTUBE_CLIENTS = [
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
  videoDetails: z.object({ lengthSeconds: z.string().optional() }).optional(),
  captions: z
    .object({
      playerCaptionsTracklistRenderer: z.object({ captionTracks: z.unknown() }).optional(),
    })
    .optional(),
  storyboards: z
    .object({ playerStoryboardSpecRenderer: z.object({ spec: z.string() }).optional() })
    .optional(),
});

export type PlayerResponse = z.infer<typeof playerResponseSchema>;
export type PlayerResult = { label: string; userAgent: string; data: PlayerResponse };

// One player response, trying each client until one answers. Throws with every
// client's reason when none does.
export async function fetchPlayerResponse(youtubeId: string): Promise<PlayerResult> {
  const failures: string[] = [];
  for (const { label, userAgent, client } of INNERTUBE_CLIENTS) {
    try {
      const res = await outboundFetch("https://www.youtube.com/youtubei/v1/player", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": userAgent },
        body: JSON.stringify({ context: { client }, videoId: youtubeId }),
      });
      if (!res.ok) throw new Error(`player request failed (${res.status})`);
      const parsed = playerResponseSchema.safeParse(await res.json());
      if (!parsed.success) throw new Error("player response was not readable");
      const status = parsed.data.playabilityStatus;
      if (status && status.status !== "OK") throw new Error(status.reason ?? status.status);
      return { label, userAgent, data: parsed.data };
    } catch (err) {
      failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(failures.join("; "));
}

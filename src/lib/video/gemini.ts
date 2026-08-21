import { outboundFetch } from "@/lib/outbound-fetch";
import { regionBounds, type Region } from "@/lib/video/types";
import { youtubeWatchUrl } from "@/lib/video/youtube";

// Gemini calls for video (SPEC.md §11): transcription segments and clip
// descriptions. One core: the first model that answers wins; the second
// covers quota and outages. A caller's parse throwing counts as a failure,
// so a bad answer from one model retries on the next.
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];

export async function geminiCall<T>(
  parts: unknown[],
  opts: { json?: boolean; maxOutputTokens: number },
  parse: (text: string) => T,
): Promise<T> {
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
            generationConfig: {
              ...(opts.json ? { responseMimeType: "application/json" } : {}),
              maxOutputTokens: opts.maxOutputTokens,
            },
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
      return parse(text);
    } catch (err) {
      failures.push(`${model}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(failures.join("; "));
}

// What is on screen in a clip of a YouTube video. EXPLAIN uses this when the
// frame cannot be captured cross-origin: Gemini watches the clip and the
// description grounds the explanation (SPEC.md §11).
export async function describeYouTubeClip(
  youtubeId: string,
  startTime: number,
  endTime: number,
  region: Region | null,
): Promise<string> {
  const from = Math.max(0, Math.floor(startTime) - 1);
  const to = Math.max(from + 2, Math.ceil(endTime) + 1);
  const bounds = region ? regionBounds(region) : null;
  const prompt = [
    "Describe exactly what is on screen in this clip.",
    "1. Read out all visible text, numbers, labels, and chart or diagram contents verbatim.",
    "2. Describe the imagery in one or two sentences.",
    ...(bounds
      ? [
          `3. The viewer circled the area roughly ${Math.round(bounds.x1)}–${Math.round(bounds.x2)}% across and ${Math.round(bounds.y1)}–${Math.round(bounds.y2)}% down the frame. Describe that area in the most detail.`,
        ]
      : []),
    "Under 150 words. Only what is actually visible.",
  ].join("\n");
  return geminiCall(
    [
      {
        fileData: { fileUri: youtubeWatchUrl(youtubeId) },
        videoMetadata: { startOffset: `${from}s`, endOffset: `${to}s` },
      },
      { text: prompt },
    ],
    { maxOutputTokens: 1024 },
    (text) => {
      const trimmed = text.trim();
      if (!trimmed) throw new Error("no description returned");
      return trimmed.length > 1500 ? `${trimmed.slice(0, 1499)}…` : trimmed;
    },
  );
}

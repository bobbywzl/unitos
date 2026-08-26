import { outboundFetch } from "@/lib/outbound-fetch";
import { recordUsage } from "@/lib/usage";
import { regionBounds, type Region } from "@/lib/video/types";
import { youtubeWatchUrl } from "@/lib/video/youtube";

// Usage telemetry for the admin usage page: whose call, for which function.
export type GeminiUsageMeta = { userId: string | null; feature: string };

// Gemini calls for video (SPEC.md §11): transcription segments and clip
// descriptions. The first model that answers wins; the alias rung means a
// retired model can never take the feature down — it always resolves to the
// current flash. A caller's parse throwing counts as a failure, so a bad
// answer from one model retries on the next.
const GEMINI_MODELS = ["gemini-3.7-flash", "gemini-flash-latest"];

export async function geminiCall<T>(
  parts: unknown[],
  opts: { json?: boolean; maxOutputTokens: number; lowResolution?: boolean; usage?: GeminiUsageMeta },
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
              // Transcription needs the audio, not the pixels: low media
              // resolution cuts the video tokens a long video spends.
              ...(opts.lowResolution ? { mediaResolution: "MEDIA_RESOLUTION_LOW" } : {}),
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
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          cachedContentTokenCount?: number;
        };
      };
      if (opts.usage && body.usageMetadata) {
        recordUsage(
          { userId: opts.usage.userId, feature: opts.usage.feature, model },
          {
            inputTokens: body.usageMetadata.promptTokenCount ?? 0,
            outputTokens: body.usageMetadata.candidatesTokenCount ?? 0,
            cacheReadTokens: body.usageMetadata.cachedContentTokenCount ?? 0,
          },
        );
      }
      const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      return parse(text);
    } catch (err) {
      failures.push(`${model}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(failures.join("; "));
}

// Token count for a request, so a long video can be split before it runs into
// the context window. Null when the count is unavailable — the caller then
// takes its normal path and lets the real call report any limit.
export async function geminiCountTokens(parts: unknown[]): Promise<number | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = GEMINI_MODELS[0];
  try {
    const res = await outboundFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:countTokens`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          generateContentRequest: { model: `models/${model}`, contents: [{ role: "user", parts }] },
        }),
      },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { totalTokens?: number };
    return typeof body.totalTokens === "number" ? body.totalTokens : null;
  } catch {
    return null;
  }
}

// What is on screen in a clip of a YouTube video. EXPLAIN uses this when the
// frame cannot be captured cross-origin: Gemini watches the clip and the
// description grounds the explanation (SPEC.md §11).
export async function describeYouTubeClip(
  youtubeId: string,
  startTime: number,
  endTime: number,
  region: Region | null,
  usage?: GeminiUsageMeta,
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
    { maxOutputTokens: 1024, usage },
    (text) => {
      const trimmed = text.trim();
      if (!trimmed) throw new Error("no description returned");
      return trimmed.length > 1500 ? `${trimmed.slice(0, 1499)}…` : trimmed;
    },
  );
}

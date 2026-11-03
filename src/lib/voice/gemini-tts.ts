import { geminiApiKey, geminiBaseUrl, geminiConfigured } from "@/lib/video/gemini";
import { gatewayHeaders } from "@/lib/gateway";
import { outboundFetch } from "@/lib/outbound-fetch";
import { recordUsage } from "@/lib/usage";

// Gemini's voice (SPEC.md §6, Voice): the second rung of /api/speech, after
// the free Edge voice and before OpenAI TTS. Gemini 3.8 Flash-Lite TTS is
// Google's fast, low-cost speech model; Gemini 3.8 Flash TTS reads when it
// is refused. One generateContent call per text: the audio comes back as
// base64 PCM (16-bit, mono, 24 kHz unless the mime type says otherwise),
// wrapped here in a WAV header so the browser plays it as it is.

export const GEMINI_TTS_MODELS = ["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts"];
// Kore: the clear, even voice Google's guide reads with.
const GEMINI_VOICE = "Kore";

export function geminiSpeechConfigured(): boolean {
  return geminiConfigured();
}

/** `text` read aloud as WAV bytes, with the model that read it. Throws with
    every model's failure when none reads it. */
export async function geminiSpeech(
  text: string,
  usage: { userId: string | null },
): Promise<{ audio: Buffer; model: string }> {
  const key = geminiApiKey();
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const failures: string[] = [];
  for (const model of GEMINI_TTS_MODELS) {
    try {
      const res = await outboundFetch(`${geminiBaseUrl()}/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key,
          ...gatewayHeaders({ userId: usage.userId, feature: "voice" }),
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_VOICE } } },
          },
        }),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(`${res.status} ${detail?.error?.message ?? ""}`.trim());
      }
      const body = (await res.json()) as {
        candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const inline = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
      if (!inline?.data) throw new Error("no audio in the answer");
      const bytes = Buffer.from(inline.data, "base64");
      recordUsage(
        { userId: usage.userId, feature: "voice", model },
        {
          inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
        },
      );
      return { audio: asWav(bytes, inline.mimeType ?? ""), model };
    } catch (err) {
      failures.push(`${model}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(failures.join("; "));
}

/** The bytes as a WAV file: as they are when they already are one, else
    raw 16-bit little-endian PCM given a header (the rate from the mime
    type, "audio/L16;codec=pcm;rate=24000"; 24 kHz when it names none). */
export function asWav(bytes: Buffer, mimeType: string): Buffer {
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF") return bytes;
  const rate = Number(/rate=(\d+)/i.exec(mimeType)?.[1] ?? 24000);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + bytes.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(bytes.length, 40);
  return Buffer.concat([header, bytes]);
}

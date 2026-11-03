import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { gatewayConfigured, gatewayHeaders, gatewayModelId, gatewayUrl, keyFor, providerConfigured } from "@/lib/gateway";
import { serverT } from "@/lib/i18n/server";
import { recordUsage } from "@/lib/usage";
import { parseBody } from "@/lib/validate";
import { azureSpeech, azureSpeechConfigured } from "@/lib/voice/azure";
import { EDGE_TTS_MODEL, edgeSpeech } from "@/lib/voice/edge";
import { geminiSpeech, geminiSpeechConfigured } from "@/lib/voice/gemini-tts";

export const maxDuration = 60;

// Voice (SPEC.md §6): the text read aloud, by the first voice that reads it.
// 1. Azure AI Speech (lib/voice/azure.ts), when AZURE_SPEECH_KEY and
//    AZURE_SPEECH_REGION are set: Microsoft's own service, the same Ava and
//    Xiaoxiao voices as the Edge voice, with a key.
// 2. The Edge voice: free neural voices, no key, Chinese and English alike.
// 3. Gemini's voice (lib/voice/gemini-tts.ts), when GEMINI_API_KEY is set.
// 4. OpenAI TTS (model gpt-4o-mini-tts, voice alloy), when OPENAI_API_KEY is
//    set (under the gateway, its speech route with the app key).
// When none reads it — out of service, out of quota (429), no key — the
// route answers 503 with the reason, and the client reads with the browser
// voice. So a provider's failure never leaves the reader with no voice.
const TTS_MODEL = "gpt-4o-mini-tts";
const speechSchema = z.object({
  text: z.string().min(1).max(4096),
});

export async function POST(req: Request) {
  const t = await serverT();
  const { data, error } = await parseBody(req, speechSchema);
  if (error) return error;
  const user = await currentUser();
  const userId = user?.id ?? null;
  // Estimate: ~4 chars per text token in, roughly the same in audio tokens out.
  const tokens = Math.ceil(data.text.length / 4);

  if (azureSpeechConfigured()) {
    try {
      const audio = await azureSpeech(data.text, { userId });
      return new Response(new Uint8Array(audio), { headers: { "Content-Type": "audio/mpeg" } });
    } catch (err) {
      console.error("[speech] azure TTS failed:", err instanceof Error ? err.message : err);
    }
  }

  try {
    const audio = await edgeSpeech(data.text);
    recordUsage({ userId, feature: "voice", model: EDGE_TTS_MODEL }, { inputTokens: tokens, outputTokens: tokens });
    return new Response(new Uint8Array(audio), { headers: { "Content-Type": "audio/mpeg" } });
  } catch (err) {
    console.error("[speech] edge-tts failed:", err);
  }

  if (geminiSpeechConfigured()) {
    try {
      const { audio } = await geminiSpeech(data.text, { userId });
      return new Response(new Uint8Array(audio), { headers: { "Content-Type": "audio/wav" } });
    } catch (err) {
      console.error("[speech] gemini TTS failed:", err instanceof Error ? err.message : err);
    }
  }

  if (providerConfigured("openai")) {
    try {
      const res = await fetch(
        gatewayConfigured() ? gatewayUrl("/v1/audio/speech") : "https://api.openai.com/v1/audio/speech",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${keyFor("openai") ?? ""}`,
            "Content-Type": "application/json",
            ...gatewayHeaders({ userId, feature: "voice" }),
          },
          body: JSON.stringify({
            model: gatewayModelId("openai", TTS_MODEL),
            voice: "alloy",
            input: data.text,
            response_format: "mp3",
          }),
        },
      );
      if (res.ok && res.body) {
        recordUsage({ userId, feature: "voice", model: TTS_MODEL }, { inputTokens: tokens, outputTokens: tokens });
        return new Response(res.body, { headers: { "Content-Type": "audio/mpeg" } });
      }
      const detail = await res.text().catch(() => "");
      console.error("[speech] OpenAI TTS failed:", res.status, detail.slice(0, 300));
    } catch (err) {
      console.error("[speech] OpenAI TTS request failed:", err);
    }
  }

  // No server voice read it: the browser voice reads instead (the client
  // takes a 503 as that word).
  return NextResponse.json({ error: t("api.speechNeedsKey") }, { status: 503 });
}

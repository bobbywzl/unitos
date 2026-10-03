import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { gatewayConfigured, gatewayHeaders, gatewayModelId, gatewayUrl, keyFor, providerConfigured } from "@/lib/gateway";
import { serverT } from "@/lib/i18n/server";
import { recordUsage, type TokenCounts } from "@/lib/usage";
import { parseBody } from "@/lib/validate";
import { EDGE_TTS_MODEL, edgeSpeech } from "@/lib/voice/edge";

export const maxDuration = 60;

// Voice (SPEC.md §6): the Edge voice reads the text aloud — free neural
// voices, no key, Chinese and English alike. When it fails and
// OPENAI_API_KEY or the gateway is set, OpenAI TTS reads instead (model
// gpt-4o-mini-tts, voice alloy; under the gateway, its speech route with the
// app key). When both are out, the route answers 503 and the client reads
// with the browser voice.
const TTS_MODEL = "gpt-4o-mini-tts";

// What one reading costs, for the usage record (lib/usage.ts). OpenAI bills
// gpt-4o-mini-tts by audio tokens out, about 1,250 per minute of speech
// ($0.015 a minute at $12 per 1M), and the text in at about 4 characters a
// token. A minute of speech is about 900 characters of English or 250 of
// Chinese.
const AUDIO_TOKENS_PER_MINUTE = 1_250;
const CHARS_PER_MINUTE = 900;
const CJK_CHARS_PER_MINUTE = 250;
const CJK_RX = /[\u3400-\u9fff\uf900-\ufaff]/g;

function speechTokens(text: string): TokenCounts {
  const cjk = text.match(CJK_RX)?.length ?? 0;
  const minutes = cjk / CJK_CHARS_PER_MINUTE + (text.length - cjk) / CHARS_PER_MINUTE;
  return {
    inputTokens: Math.ceil(text.length / 4),
    outputTokens: Math.ceil(minutes * AUDIO_TOKENS_PER_MINUTE),
  };
}

const speechSchema = z.object({
  text: z.string().min(1).max(4096),
});

export async function POST(req: Request) {
  const t = await serverT();
  const { data, error } = await parseBody(req, speechSchema);
  if (error) return error;
  const user = await currentUser();
  const tokens = speechTokens(data.text);
  try {
    const audio = await edgeSpeech(data.text);
    recordUsage(
      { userId: user?.id ?? null, feature: "voice", model: EDGE_TTS_MODEL },
      tokens,
    );
    return new Response(new Uint8Array(audio), { headers: { "Content-Type": "audio/mpeg" } });
  } catch (err) {
    console.error("[speech] edge-tts failed:", err);
  }
  if (!providerConfigured("openai")) {
    return NextResponse.json({ error: t("api.speechNeedsKey") }, { status: 503 });
  }
  let res: Response;
  try {
    res = await fetch(gatewayConfigured() ? gatewayUrl("/v1/audio/speech") : "https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${keyFor("openai") ?? ""}`,
        "Content-Type": "application/json",
        ...gatewayHeaders({ userId: user?.id ?? null, feature: "voice" }),
      },
      body: JSON.stringify({
        model: gatewayModelId("openai", TTS_MODEL),
        voice: "alloy",
        input: data.text,
        response_format: "mp3",
      }),
    });
  } catch (err) {
    console.error("[speech] TTS request failed:", err);
    return NextResponse.json({ error: t("api.voiceFailedRetry") }, { status: 502 });
  }
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    console.error("[speech] TTS failed:", res.status, detail.slice(0, 300));
    // Under the gateway the app cannot know whether the gateway holds an
    // OpenAI key; a refusal from it (no key, no such model) is the same case
    // as no key here, and 503 is what sends the client to the browser voice.
    if (gatewayConfigured() && [400, 401, 403, 404].includes(res.status)) {
      return NextResponse.json({ error: t("api.speechNeedsKey") }, { status: 503 });
    }
    return NextResponse.json({ error: t("api.voiceFailedStatus", { status: res.status }) }, { status: 502 });
  }
  recordUsage(
    { userId: user?.id ?? null, feature: "voice", model: TTS_MODEL },
    tokens,
  );
  return new Response(res.body, { headers: { "Content-Type": "audio/mpeg" } });
}

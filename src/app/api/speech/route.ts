import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { serverT } from "@/lib/i18n/server";
import { recordUsage } from "@/lib/usage";
import { parseBody } from "@/lib/validate";
import { EDGE_TTS_MODEL, edgeSpeech } from "@/lib/voice/edge";

export const maxDuration = 60;

// Voice (SPEC.md §6): the Edge voice reads the text aloud — free neural
// voices, no key, Chinese and English alike. When it fails and
// OPENAI_API_KEY is set, OpenAI TTS reads instead (model gpt-4o-mini-tts,
// voice alloy). When both are out, the route answers 503 and the client
// reads with the browser voice.
const speechSchema = z.object({
  text: z.string().min(1).max(4096),
});

export async function POST(req: Request) {
  const t = await serverT();
  const { data, error } = await parseBody(req, speechSchema);
  if (error) return error;
  const user = await currentUser();
  // Estimate: ~4 chars per text token in, roughly the same in audio tokens out.
  const tokens = Math.ceil(data.text.length / 4);
  try {
    const audio = await edgeSpeech(data.text);
    recordUsage(
      { userId: user?.id ?? null, feature: "voice", model: EDGE_TTS_MODEL },
      { inputTokens: tokens, outputTokens: tokens },
    );
    return new Response(new Uint8Array(audio), { headers: { "Content-Type": "audio/mpeg" } });
  } catch (err) {
    console.error("[speech] edge-tts failed:", err);
  }
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: t("api.speechNeedsKey") }, { status: 503 });
  }
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
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
    return NextResponse.json({ error: t("api.voiceFailedStatus", { status: res.status }) }, { status: 502 });
  }
  recordUsage(
    { userId: user?.id ?? null, feature: "voice", model: "gpt-4o-mini-tts" },
    { inputTokens: tokens, outputTokens: tokens },
  );
  return new Response(res.body, { headers: { "Content-Type": "audio/mpeg" } });
}

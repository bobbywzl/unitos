import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { serverT } from "@/lib/i18n/server";
import { recordUsage } from "@/lib/usage";
import { parseBody } from "@/lib/validate";

export const maxDuration = 60;

// Voice (SPEC.md §6): OpenAI TTS reads the text aloud — model gpt-4o-mini-tts,
// voice alloy. The model reads the input language directly, Chinese and
// English alike. Without OPENAI_API_KEY the route answers 503 and the client
// reads with the browser voice instead.
const speechSchema = z.object({
  text: z.string().min(1).max(4096),
});

export async function POST(req: Request) {
  const t = await serverT();
  const { data, error } = await parseBody(req, speechSchema);
  if (error) return error;
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
  // Estimate: ~4 chars per text token in, roughly the same in audio tokens out.
  const user = await currentUser();
  const tokens = Math.ceil(data.text.length / 4);
  recordUsage(
    { userId: user?.id ?? null, feature: "voice", model: "gpt-4o-mini-tts" },
    { inputTokens: tokens, outputTokens: tokens },
  );
  return new Response(res.body, { headers: { "Content-Type": "audio/mpeg" } });
}

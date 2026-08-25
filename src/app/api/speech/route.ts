import { NextResponse } from "next/server";
import { z } from "zod";
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
  const { data, error } = await parseBody(req, speechSchema);
  if (error) return error;
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not set" }, { status: 503 });
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
    return NextResponse.json({ error: "Voice failed. Try again." }, { status: 502 });
  }
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    console.error("[speech] TTS failed:", res.status, detail.slice(0, 300));
    return NextResponse.json({ error: `Voice failed (${res.status})` }, { status: 502 });
  }
  return new Response(res.body, { headers: { "Content-Type": "audio/mpeg" } });
}

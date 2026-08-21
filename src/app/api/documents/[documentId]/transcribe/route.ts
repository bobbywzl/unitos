import { NextResponse } from "next/server";
import { runTranscription } from "@/lib/video/transcription-job";

// Transcription can take minutes on a long video.
export const maxDuration = 300;

// Transcription starts on its own when a video is added (SPEC.md §11); this
// route runs the same job for Retry and Transcribe again.
export async function POST(_req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await ctx.params;
  const result = await runTranscription(documentId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, lines: result.lines, provider: result.provider });
}

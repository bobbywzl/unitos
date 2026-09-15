import { after, NextResponse } from "next/server";
import { bumpDocument, documentAccess } from "@/lib/collab";
import { cronAuthorized } from "@/lib/cron-auth";
import { runTranscription } from "@/lib/video/transcription-job";

// Transcription can take minutes on a long video.
export const maxDuration = 300;

// Transcription starts on its own when a video is added (SPEC.md §11); this
// route runs the same job for Retry and Transcribe again — the whole ladder
// from its first rung. With the x-transcribe-leg header and CRON_SECRET, it
// is the running attempt's next leg: the job asks for one when the ladder
// reaches the function's clock with rungs left. The leg answers at once and
// runs in after(), so the leg that asked can end.
export async function POST(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await ctx.params;
  if (req.headers.get("x-transcribe-leg") === "1") {
    if (!cronAuthorized(req, "transcribe leg")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    after(() => runTranscription(documentId, { leg: true }).catch(() => {}));
    return NextResponse.json({ ok: true, continuing: true }, { status: 202 });
  }
  const access = await documentAccess(documentId, "editor");
  if (access instanceof NextResponse) return access;
  const result = await runTranscription(documentId, { userId: access.user.id });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  await bumpDocument(documentId);
  if (result.continuing) return NextResponse.json({ ok: true, continuing: true });
  return NextResponse.json({ ok: true, lines: result.lines, provider: result.provider });
}

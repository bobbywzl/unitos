import { NextResponse } from "next/server";
import { z } from "zod";
import { documentAccess } from "@/lib/collab";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";
import { storePastedTranscript } from "@/lib/video/transcription-job";

// The cleanup pass can take a minute on a long transcript.
export const maxDuration = 120;

const bodySchema = z.object({ text: z.string().min(1).max(2_000_000) });

// A transcript the reader pasted (SPEC.md §11): the last rung of the ladder,
// the one that never depends on the server's network. Parsed, cleaned, and
// written exactly like a transcribed one.
export async function POST(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  const { documentId } = await ctx.params;
  const access = await documentAccess(documentId, "editor");
  if (access instanceof NextResponse) return access;
  const body = await parseBody(req, bodySchema);
  if (body.error) return body.error;
  const result = await storePastedTranscript(documentId, body.data.text);
  if (!result.ok) {
    const error =
      result.status === 400
        ? /no times/.test(result.error)
          ? t("api.pastedTranscriptNoTimes")
          : /no words/.test(result.error)
            ? t("api.pastedTranscriptNoWords")
            : t("api.pastedTranscriptTooLong")
        : result.error;
    return NextResponse.json({ error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, lines: result.lines });
}

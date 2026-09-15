import { NextResponse } from "next/server";
import { MEDIA_MAX_BYTES, mediaAttachSchema } from "@/lib/assistant/attachments";
import { mediaAttachmentText } from "@/lib/assistant/media";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

export const maxDuration = 300;

// The ladder stops starting rungs this long before the request's own limit,
// so a failure reports instead of the request dying in silence.
const LADDER_BUDGET_MS = 270_000;

// A video or audio file attached to an assistant message (SPEC.md §7). The
// browser staged it in chunks (POST /api/uploads, the upload's own path —
// a request body caps at about 4.5 MB); this route assembles the chunks,
// transcribes them, and answers with the transcript as the file's text. The
// staging rows go either way; nothing is stored.
export async function POST(req: Request) {
  const t = await serverT();
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: t("api.signInRequired") }, { status: 401 });
  const { data, error } = await parseBody(req, mediaAttachSchema);
  if (error) return error;
  const startedAt = Date.now();

  const chunks = await db.uploadChunk.findMany({
    where: { uploadId: data.uploadId },
    orderBy: { index: "asc" },
    select: { index: true, data: true },
  });
  await db.uploadChunk.deleteMany({ where: { uploadId: data.uploadId } });
  if (chunks.length === 0) return NextResponse.json({ error: t("api.uploadNotFound") }, { status: 404 });
  if (!chunks.every((c, i) => c.index === i)) {
    return NextResponse.json({ error: t("api.uploadMissingChunks") }, { status: 400 });
  }
  const size = chunks.reduce((n, c) => n + c.data.length, 0);
  if (size > MEDIA_MAX_BYTES) {
    return NextResponse.json({ error: t("api.videoTooLarge") }, { status: 413 });
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c.data, at);
    at += c.data.length;
  }

  try {
    const text = await mediaAttachmentText(bytes, data.mimeType ?? null, data.name, startedAt + LADDER_BUDGET_MS, user?.id ?? null);
    return NextResponse.json({ text });
  } catch (err) {
    console.error("[assistant] attach-media: transcription failed:", err);
    return NextResponse.json(
      { error: t("api.attachmentTranscribeFailed", { reason: err instanceof Error ? err.message : String(err) }) },
      { status: 422 },
    );
  }
}

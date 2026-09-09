import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpDocument, documentAccess } from "@/lib/collab";
import { parseBody } from "@/lib/validate";
import { renameSpeaker, runSpeakers } from "@/lib/video/transcription-job";

// Reading the media again takes as long as a transcription does.
export const maxDuration = 300;

// Speakers on a transcript that already exists (SPEC.md §11): Detect speakers
// on the media pane. A new transcription finds them on its own; this is for a
// transcript that landed before, or one that was pasted.
export async function POST(_req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await ctx.params;
  const access = await documentAccess(documentId, "editor");
  if (access instanceof NextResponse) return access;
  const result = await runSpeakers(documentId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  await bumpDocument(documentId);
  return NextResponse.json({ ok: true, speakers: result.speakers });
}

const renameSchema = z.object({
  speakerId: z.string().min(1),
  name: z.string().trim().min(1).max(60),
});

// Rename one voice. The id stays, so every line it says follows at once.
export async function PATCH(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await ctx.params;
  const access = await documentAccess(documentId, "editor");
  if (access instanceof NextResponse) return access;
  const { data, error } = await parseBody(req, renameSchema);
  if (error) return error;
  const result = await renameSpeaker(documentId, data.speakerId, data.name);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, speakers: result.speakers });
}

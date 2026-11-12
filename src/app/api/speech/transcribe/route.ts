import { NextResponse } from "next/server";
import { notebookAccess } from "@/lib/collab";
import { geminiConfigured } from "@/lib/gemini";
import { serverT } from "@/lib/i18n/server";
import { transcribe, whisperConfigured } from "@/lib/video/transcribe";

// A spoken note written out (SPEC.md §33): the phone page records what the
// reader says where the browser cannot hear speech itself (the iPhone app's
// web view) and sends the recording here; the answer is the words, which the
// page puts in the note box for the reader to read over and add. Nothing is
// stored: no note is written here and the recording is not kept.
//
//   POST /api/speech/transcribe?notebookId=…   body: the recording
//   → { text }
//
// The project names who may ask (an editor of it) and where the cost is
// counted. The transcription ladder is the media's own (lib/video/transcribe).

export const maxDuration = 120;

// Two minutes at the page's bitrate is under 1 MB; the cap leaves room for a
// browser that records at a higher one.
const MAX_BYTES = 4 * 1024 * 1024;
// A pause this long between two segments starts a new paragraph.
const PARAGRAPH_GAP_SECONDS = 2;

export async function POST(req: Request) {
  const t = await serverT();
  const notebookId = new URL(req.url).searchParams.get("notebookId");
  if (!notebookId) return NextResponse.json({ error: t("api.missingNotebookId") }, { status: 400 });
  const access = await notebookAccess(notebookId, "editor");
  if (access instanceof NextResponse) return access;
  if (!whisperConfigured() && !geminiConfigured()) {
    return NextResponse.json({ error: t("api.voiceNoteNeedsKey") }, { status: 503 });
  }

  const mimeType = (req.headers.get("content-type") ?? "audio/webm").split(";")[0].trim();
  if (!mimeType.startsWith("audio/") && !mimeType.startsWith("video/")) {
    return NextResponse.json({ error: t("api.voiceNoteNotAudio") }, { status: 400 });
  }
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0) return NextResponse.json({ error: t("api.voiceNoteEmpty") }, { status: 400 });
  if (bytes.length > MAX_BYTES) return NextResponse.json({ error: t("api.voiceNoteTooLarge") }, { status: 413 });

  try {
    const { segments } = await transcribe(
      { kind: "upload", bytes, mimeType },
      { deadline: Date.now() + 100_000, userId: access.user.id },
    );
    const paragraphs: string[] = [];
    let open = "";
    let lastEnd = -Infinity;
    for (const segment of segments) {
      const text = segment.text.trim();
      if (!text) continue;
      if (open && segment.start - lastEnd > PARAGRAPH_GAP_SECONDS) {
        paragraphs.push(open);
        open = "";
      }
      open = open ? `${open} ${text}` : text;
      lastEnd = segment.end;
    }
    if (open) paragraphs.push(open);
    return NextResponse.json({ text: paragraphs.join("\n\n").trim() });
  } catch (err) {
    console.error("speech transcribe", err);
    return NextResponse.json({ error: t("api.speechNotWritten") }, { status: 502 });
  }
}

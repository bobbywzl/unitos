import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpNotebook, sectionAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { tidyTranscript } from "@/lib/video/tidy";
import { transcribe } from "@/lib/video/transcribe";

export const maxDuration = 120;

// A voice note (SPEC.md §6): the reader speaks, the recording takes the upload
// transcription ladder (Groq Whisper → OpenAI Whisper → Gemini), the lines are
// cleaned like a transcript, and the text lands as one PENDING note in the
// section — the reader reads it over and accepts it, so nothing enters notes
// unread. The body is the recording's bytes; the query names the section.
// A request body past about 4.5 MB is refused by the host, so the client
// records at a low bitrate and stops at five minutes.
const MAX_BYTES = 4 * 1024 * 1024;
// Lines further apart than this start a new paragraph in the note.
const PARAGRAPH_GAP_SECONDS = 2;

const querySchema = z.object({ sectionId: z.string().min(1) });

export async function POST(req: Request) {
  const t = await serverT();
  const query = querySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams.entries()),
  );
  if (!query.success) {
    return NextResponse.json({ error: t("api.validationFailed") }, { status: 400 });
  }
  const { sectionId } = query.data;
  const section = await db.section.findUnique({ where: { id: sectionId } });
  if (!section) return NextResponse.json({ error: t("api.sectionNotFound") }, { status: 404 });
  const access = await sectionAccess(sectionId, "editor");
  if (access instanceof NextResponse) return access;
  if (!process.env.GROQ_API_KEY && !process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: t("api.voiceNoteNeedsKey") }, { status: 503 });
  }

  const mimeType = (req.headers.get("content-type") ?? "audio/webm").split(";")[0].trim();
  if (!mimeType.startsWith("audio/") && !mimeType.startsWith("video/")) {
    return NextResponse.json({ error: t("api.voiceNoteNotAudio") }, { status: 400 });
  }
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0) {
    return NextResponse.json({ error: t("api.voiceNoteEmpty") }, { status: 400 });
  }
  if (bytes.length > MAX_BYTES) {
    return NextResponse.json({ error: t("api.voiceNoteTooLarge") }, { status: 413 });
  }

  let text: string;
  let provider: string;
  try {
    const result = await transcribe(
      { kind: "upload", bytes, mimeType },
      { deadline: Date.now() + 100_000 },
    );
    provider = result.provider;
    const { lines } = await tidyTranscript(result.segments);
    // Paragraphs at pauses, so a spoken note keeps its shape.
    const paragraphs: string[] = [];
    let open = "";
    let lastEnd = -Infinity;
    for (const line of lines) {
      if (open && line.start - lastEnd > PARAGRAPH_GAP_SECONDS) {
        paragraphs.push(open);
        open = "";
      }
      open = open ? `${open} ${line.text}` : line.text;
      lastEnd = line.end;
    }
    if (open) paragraphs.push(open);
    text = paragraphs.join("\n\n").trim();
  } catch (err) {
    console.error("[voice-note] transcription failed:", err);
    return NextResponse.json(
      { error: t("api.voiceNoteFailed", { reason: err instanceof Error ? err.message : String(err) }) },
      { status: 502 },
    );
  }
  if (!text) {
    return NextResponse.json({ error: t("api.voiceNoteNoSpeech") }, { status: 422 });
  }

  const count = await db.note.count({ where: { sectionId } });
  const note = await db.note.create({
    data: {
      sectionId,
      content: text,
      // Transcribed speech is AI output: it lands PENDING, no exceptions (SPEC.md §1).
      status: "PENDING",
      derivationType: "VOICE",
      createdById: access.user.id,
      order: count,
    },
  });
  await bumpNotebook(section.notebookId);
  console.log(`[voice-note] ${bytes.length} bytes → ${text.length} chars via ${provider}`);
  return NextResponse.json({ id: note.id, content: text, provider }, { status: 201 });
}

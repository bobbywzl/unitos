import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { serverT } from "@/lib/i18n/server";
import { grokConfigured, segmentsText } from "@/lib/video/grok";
import { NoSpeech, transcribe, transcriptionConfigured } from "@/lib/video/transcribe";

// Spoken words written out (SPEC.md §6, voice typing; §33, the phone page).
// Voice typing records what the reader says, cuts the recording at each
// pause, and sends each phrase here; the phone page's microphone sends a
// whole spoken note. The answer is the words, which the page types at the
// caret or puts in the note box. Nothing is stored: no note is written here
// and the recording is not kept.
//
//   GET  /api/speech/transcribe            → { model, any }
//   POST /api/speech/transcribe?language=  body: the recording  → { text }
//
// GET says what this deploy can do, so the page picks how it listens: `model`
// when the voice model is set (lib/video/grok.ts), `any` when some rung of
// the transcription ladder is. POST runs the ladder (lib/video/transcribe),
// the voice model first, for the signed-in account, which the cost is
// counted under. `language` is the language the reader chose for voice
// typing, a hint for the model.

export const maxDuration = 120;

// Two minutes at the page's bitrate is under 1 MB; the cap leaves room for a
// browser that records at a higher one.
const MAX_BYTES = 4 * 1024 * 1024;

export async function GET() {
  const t = await serverT();
  if (!(await currentUser())) return NextResponse.json({ error: t("common.signInToContinue") }, { status: 401 });
  return NextResponse.json({ model: grokConfigured(), any: transcriptionConfigured() });
}

export async function POST(req: Request) {
  const t = await serverT();
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: t("common.signInToContinue") }, { status: 401 });
  if (!transcriptionConfigured()) {
    return NextResponse.json({ error: t("api.voiceNoteNeedsKey") }, { status: 503 });
  }

  const mimeType = (req.headers.get("content-type") ?? "audio/webm").split(";")[0].trim();
  if (!mimeType.startsWith("audio/") && !mimeType.startsWith("video/")) {
    return NextResponse.json({ error: t("api.voiceNoteNotAudio") }, { status: 400 });
  }
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0) return NextResponse.json({ error: t("api.voiceNoteEmpty") }, { status: 400 });
  if (bytes.length > MAX_BYTES) return NextResponse.json({ error: t("api.voiceNoteTooLarge") }, { status: 413 });

  const hint = new URL(req.url).searchParams.get("language") ?? "";
  try {
    const { segments } = await transcribe(
      { kind: "upload", bytes, mimeType },
      {
        deadline: Date.now() + 100_000,
        userId: user.id,
        // One person speaking: no voices to tell apart.
        speakers: false,
        language: /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(hint) ? hint : undefined,
        noSpeechEnds: true,
      },
    );
    return NextResponse.json({ text: segmentsText(segments) });
  } catch (err) {
    // A recording with no words in it (a cough, a door) is not a failure.
    if (err instanceof NoSpeech) return NextResponse.json({ text: "" });
    console.error("speech transcribe", err);
    return NextResponse.json({ error: t("api.speechNotWritten") }, { status: 502 });
  }
}

import { z } from "zod";

// Transcription (SPEC.md §11): the video goes to OpenAI Whisper, which returns
// timed segments. Segments group into transcript lines here; the route writes
// them as TRANSCRIPT blocks.

export const TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024; // Whisper's upload cap

export type TranscriptSegment = { start: number; end: number; text: string };

const responseSchema = z.object({
  segments: z
    .array(
      z.object({
        start: z.number().min(0),
        end: z.number().min(0),
        text: z.string(),
      }),
    )
    .min(1),
});

const EXTENSION: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/ogg": "ogg",
};

export async function transcribeVideo(
  bytes: Uint8Array<ArrayBuffer>,
  mimeType: string,
): Promise<TranscriptSegment[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set. Transcription needs it.");

  const form = new FormData();
  form.set("file", new Blob([bytes], { type: mimeType }), `video.${EXTENSION[mimeType] ?? "mp4"}`);
  form.set("model", "whisper-1");
  form.set("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(detail?.error?.message ?? `Transcription failed (${res.status})`);
  }
  const parsed = responseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error("Transcription returned no timed segments");
  }
  return parsed.data.segments
    .map((s) => ({ start: s.start, end: Math.max(s.end, s.start), text: s.text.trim() }))
    .filter((s) => s.text !== "");
}

// Group segments into transcript lines: one line reads like a sentence or two.
// A line closes at ~280 characters, at a speech gap over 1.5s, or at 30s.
export function groupSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const lines: TranscriptSegment[] = [];
  let open: TranscriptSegment | null = null;
  for (const segment of segments) {
    if (
      open &&
      (open.text.length + segment.text.length > 280 ||
        segment.start - open.end > 1.5 ||
        segment.end - open.start > 30)
    ) {
      lines.push(open);
      open = null;
    }
    open = open
      ? { start: open.start, end: segment.end, text: `${open.text} ${segment.text}` }
      : { ...segment };
  }
  if (open) lines.push(open);
  return lines;
}

import { z } from "zod";
import { recordUsage } from "@/lib/usage";
import { normalizeSegments, type TranscriptSegment } from "@/lib/video/segments";

// Deepgram Nova-3 (SPEC.md §11): the first rung of the upload ladder. One
// synchronous call over the whole file (2 GB allowed; the app's own 200 MB
// ceiling is the real cap) answers utterances, each with its start, its
// end, its words, and the voice that says it — timestamps and speakers from
// the audio itself, in one pass, at $0.0043 a minute. So a transcript from
// this rung needs no chunking and no separate speakers pass over the media;
// the speakers only need names, which the text alone gives
// (lib/video/speakers.ts nameSpeakers). DEEPGRAM_API_URL points a local run
// at a stand-in server.

const ENDPOINT = process.env.DEEPGRAM_API_URL ?? "https://api.deepgram.com/v1/listen";
const MODEL = "nova-3";
const USD_PER_MINUTE = 0.0043;

const wordSchema = z.object({
  word: z.string(),
  punctuated_word: z.string().optional(),
  start: z.number().min(0),
  end: z.number().min(0),
  speaker: z.number().int().optional(),
});
const responseSchema = z.object({
  metadata: z.object({ duration: z.number().optional() }).optional(),
  results: z.object({
    utterances: z
      .array(
        z.object({
          start: z.number().min(0),
          end: z.number().min(0),
          transcript: z.string(),
          speaker: z.number().int().optional(),
        }),
      )
      .optional(),
    channels: z
      .array(z.object({ alternatives: z.array(z.object({ words: z.array(wordSchema).optional() })) }))
      .optional(),
  }),
});

const speakerId = (n: number | undefined) => (n === undefined ? undefined : `S${n + 1}`);

/** Transcribe media bytes with speakers. Throws with the reason. */
export async function deepgramTranscribe(
  bytes: Uint8Array,
  mimeType: string,
  opts: { signal?: AbortSignal } = {},
): Promise<TranscriptSegment[]> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY is not set");
  const params = new URLSearchParams({
    model: MODEL,
    diarize: "true",
    utterances: "true",
    smart_format: "true",
    punctuate: "true",
    detect_language: "true",
  });
  // Plain fetch: the body is the media bytes, which outboundFetch's string
  // body does not carry.
  const res = await fetch(`${ENDPOINT}?${params}`, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": mimeType },
    body: new Blob([bytes as BlobPart], { type: mimeType }),
    signal: opts.signal,
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { err_msg?: string; error?: string } | null;
    throw new Error(detail?.err_msg ?? detail?.error ?? `request failed (${res.status})`);
  }
  const parsed = responseSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error("output was not a transcript");

  const utterances = parsed.data.results.utterances ?? [];
  let segments: TranscriptSegment[] = utterances.map((u) => ({
    start: u.start,
    end: u.end,
    text: u.transcript,
    speaker: speakerId(u.speaker),
  }));
  // No utterances: the words, in runs of one voice.
  if (segments.length === 0) {
    const words = parsed.data.results.channels?.[0]?.alternatives?.[0]?.words ?? [];
    let open: TranscriptSegment | null = null;
    for (const w of words) {
      const speaker = speakerId(w.speaker);
      const text = w.punctuated_word ?? w.word;
      if (open && open.speaker === speaker && w.start - open.end < 1.5) {
        open.end = w.end;
        open.text += ` ${text}`;
      } else {
        if (open) segments.push(open);
        open = { start: w.start, end: w.end, text, speaker };
      }
    }
    if (open) segments.push(open);
  }
  segments = normalizeSegments(segments);
  if (segments.length === 0) throw new Error("no speech found");

  // Deepgram bills per second of audio; tokens do not apply.
  const seconds = parsed.data.metadata?.duration ?? segments[segments.length - 1].end;
  recordUsage(
    { userId: null, feature: "transcribe", model: MODEL },
    { inputTokens: Math.ceil(seconds) },
    (seconds / 60) * USD_PER_MINUTE,
  );
  return segments;
}

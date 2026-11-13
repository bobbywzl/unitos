import { z } from "zod";
import { providerKey } from "@/lib/gateway";
import { recordUsage } from "@/lib/usage";
import { normalizeSegments, type TranscriptSegment } from "@/lib/video/segments";

// Grok Voice Transcribe 2.0 (xAI; SPEC.md §11): the voice model, the first
// rung of the upload ladder, and so what writes out every recording the app
// takes — an uploaded video or audio file, a YouTube video's audio, a voice
// command, a spoken note on the phone page, and voice typing. Chosen for
// accuracy per dollar (the Artificial Analysis speech-to-text index, Nov
// 2026): a word error rate of 2.3% at $0.10 an hour of audio, against
// Deepgram Nova-3's 5.2% at $0.26 and Groq Whisper's 4.6% at $0.04; the two
// models that read a little better cost twice as much (ElevenLabs Scribe v3,
// 1.9% at $0.20) or do from January 2027 (Microsoft MAI-Transcribe-2, 2.0%,
// $0.10 until then, $0.36 after).
//
// One call over the whole file (500 MB allowed; the app's own upload ceiling
// is the real cap) answers the words, each with its start, its end, and, on
// request, the voice that says it: timestamps and speakers from the audio
// itself, at no added price. The language is detected from the audio and may
// change mid-recording; English, Mandarin, and Cantonese are among the 38 it
// reads. XAI_API_URL points a local run at a stand-in server. A direct call
// with XAI_API_KEY; without the key the ladder starts at Deepgram, as it did
// before this rung.

const ENDPOINT = () => process.env.XAI_API_URL ?? "https://api.x.ai/v1/stt";
export const GROK_TRANSCRIBE_MODEL = "grok-voice-transcribe-2.0";
const USD_PER_MINUTE = 0.1 / 60;

/** XAI_API_KEY is set, so the Grok rung runs. */
export function grokConfigured(): boolean {
  return Boolean(providerKey("xai"));
}

const wordSchema = z.object({
  text: z.string(),
  start: z.number().min(0),
  end: z.number().min(0),
  speaker: z.number().int().optional(),
});
const responseSchema = z.object({
  text: z.string().optional(),
  language: z.string().optional(),
  duration: z.number().optional(),
  words: z.array(wordSchema).optional(),
});

// The languages the model formats numbers, dates, and currencies in
// (`format=true`, which needs the language named).
const FORMATS = new Set(["ar", "de", "en", "es", "fr", "ja", "pt", "ru", "sv", "vi", "zh"]);

/** The model's code for a language tag ("en-US" → "en", "zh-TW" → "zh");
    undefined for a tag that names no language. */
export function grokLanguage(tag: string | undefined): string | undefined {
  const primary = tag?.trim().toLowerCase().split(/[-_]/)[0];
  return primary && /^[a-z]{2,3}$/.test(primary) ? primary : undefined;
}

export type GrokOptions = {
  signal?: AbortSignal;
  userId?: string | null;
  /** Tell the voices apart (a recording of several people). Default true. */
  speakers?: boolean;
  /** The language the speaker most likely speaks, as a hint: the model still
      detects the language. Named for voice typing, where the reader chose it. */
  language?: string;
};

/** Transcribe media bytes. Throws with the reason. */
export async function grokTranscribe(
  bytes: Uint8Array,
  mimeType: string,
  opts: GrokOptions = {},
): Promise<TranscriptSegment[]> {
  const key = providerKey("xai");
  if (!key) throw new Error("XAI_API_KEY is not set");
  const speakers = opts.speakers ?? true;
  const language = grokLanguage(opts.language);

  const form = new FormData();
  form.set("model", GROK_TRANSCRIBE_MODEL);
  if (speakers) form.set("diarize", "true");
  if (language) {
    form.set("language", language);
    if (FORMATS.has(language)) form.set("format", "true");
  }
  // The file is the last field: the endpoint reads the fields before it.
  form.set("file", new Blob([bytes as BlobPart], { type: mimeType }), "media");

  // Plain fetch: a multipart body does not fit outboundFetch's string body.
  const res = await fetch(ENDPOINT(), {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: opts.signal,
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string | { message?: string } } | null;
    const reason = typeof detail?.error === "string" ? detail.error : detail?.error?.message;
    throw new Error(reason ?? `request failed (${res.status})`);
  }
  const body: unknown = await res.json();
  const segments = grokSegments(body);
  if (segments.length === 0) throw new Error("no speech found");

  // xAI bills per second of audio; tokens do not apply.
  const seconds = responseSchema.safeParse(body).data?.duration ?? segments[segments.length - 1].end;
  recordUsage(
    { userId: opts.userId ?? null, feature: "transcribe", model: GROK_TRANSCRIBE_MODEL },
    { inputTokens: Math.ceil(seconds) },
    (seconds / 60) * USD_PER_MINUTE,
  );
  return segments;
}

// A script written without spaces between words: two such words join with
// no space between them.
const NO_SPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}　-〿＀-￯]/u;
const SENTENCE_END = /[.?!。？！…]["'”’)]?$/;
// A pause this long starts a new segment, as an utterance ends.
const PAUSE_SECONDS = 0.8;
// A segment this long ends at its next sentence end, and this long anyway.
const SOFT_CHARS = 200;
const HARD_CHARS = 400;

function joinWord(text: string, word: string): string {
  if (!text) return word;
  const before = text[text.length - 1];
  if (NO_SPACES.test(before) && NO_SPACES.test(word[0])) return text + word;
  return `${text} ${word}`;
}

const speakerId = (n: number | undefined) => (n === undefined ? undefined : `S${n + 1}`);

/** The segments of a Grok answer: the words in runs of one voice, a run
    ending at a pause, and a long run at a sentence end. With no words, the
    text as one segment. Throws when the answer is not a transcript. */
export function grokSegments(body: unknown): TranscriptSegment[] {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) throw new Error("output was not a transcript");
  const { words = [], text = "", duration } = parsed.data;
  if (words.length === 0) {
    return normalizeSegments(text.trim() ? [{ start: 0, end: duration ?? 0, text }] : []);
  }

  const segments: TranscriptSegment[] = [];
  let open: TranscriptSegment | null = null;
  for (const w of words) {
    const word = w.text.trim();
    if (!word) continue;
    const speaker = speakerId(w.speaker);
    if (
      open &&
      (open.speaker !== speaker ||
        w.start - open.end > PAUSE_SECONDS ||
        open.text.length >= HARD_CHARS ||
        (open.text.length >= SOFT_CHARS && SENTENCE_END.test(open.text)))
    ) {
      segments.push(open);
      open = null;
    }
    if (open) {
      open.end = Math.max(open.end, w.end);
      open.text = joinWord(open.text, word);
    } else {
      open = { start: w.start, end: w.end, text: word, speaker };
    }
  }
  if (open) segments.push(open);
  return normalizeSegments(segments);
}

/** Segments as plain text: the words, a paragraph break at a pause of two
    seconds or more. What a voice command, a spoken note, and voice typing
    read. */
export function segmentsText(segments: TranscriptSegment[]): string {
  const paragraphs: string[] = [];
  let open = "";
  let lastEnd = -Infinity;
  for (const segment of segments) {
    const text = segment.text.trim();
    if (!text) continue;
    if (open && segment.start - lastEnd > 2) {
      paragraphs.push(open);
      open = "";
    }
    open = joinWord(open, text);
    lastEnd = segment.end;
  }
  if (open) paragraphs.push(open);
  return paragraphs.join("\n\n").trim();
}

import { z } from "zod";
import { extractJson } from "@/lib/derive/json";
import { geminiCall, geminiCountTokens } from "@/lib/video/gemini";
import {
  CHUNK_SECONDS,
  GEMINI_SINGLE_CALL_TOKENS,
  type MediaPart,
} from "@/lib/video/transcribe";
import type { TranscriptSegment } from "@/lib/video/segments";
import { formatTime, type Speaker } from "@/lib/video/types";

// Speakers (SPEC.md §11): who says each line. Two paths:
//   - A transcript whose rung told the voices apart (Deepgram: every
//     utterance carries its voice, from the audio itself) only needs names.
//     nameSpeakers reads the lines as text and names the voices the
//     conversation names; the media is not read again.
//   - Any other transcript (YouTube's captions carry no speakers and neither
//     Whisper rung returns any) takes detectSpeakers: the pass reads the
//     media beside the lines, tells the voices apart by voice and, in a
//     video, by who is on camera speaking, and names them.
// Both name a voice only from what the recording itself says or shows — an
// introduction, a host naming a guest, one person addressing another, a
// name caption on screen. A voice nobody names keeps its number.
//
// The pass never guesses from the subject, the channel, or a name it
// recognizes: a wrong name on every line of a transcript is worse than
// "Speaker 2".

/** At most this many voices in one recording. A pass that returns more has
    lost the thread — panel voices it cannot separate become one each. */
const MAX_SPEAKERS = 12;

const SPEAKER_PROMPT = [
  "You are given a recording and the lines already transcribed from it, each with the time it is spoken.",
  "Say which voice speaks each line, and name the voices the recording names.",
  'Return ONLY JSON: {"speakers": [{"id": "S1", "name": "…"}], "lines": [{"i": 0, "speaker": "S1"}]}',
  "1. Listen to the recording at each line's time and tell the voices apart by the sound of the voice: pitch, timbre, pace, accent. In a video, also use who is on camera with their mouth moving at that time. Never decide by what is said alone.",
  "2. Use the conversation as a check: a question and its answer are two voices; a reply that says a name is addressed to that voice; the same voice keeps its manner of speaking.",
  "3. Every line gets exactly one speaker id, and every id used is in speakers. A line where the voice changes mid-line goes to the voice that says most of it.",
  "4. The same voice keeps the same id everywhere in the recording.",
  "5. Name a voice only from what the recording says or shows: someone introduces themselves, a host names a guest, one person addresses another by name, a name caption on screen while that person speaks. Use the name as it is said or shown.",
  '6. A voice the recording never names keeps its number: "Speaker 2".',
  "7. Never guess a name from the subject, the channel, or a person you recognize. An unnamed voice is a number.",
  "8. One voice throughout: return one speaker and give it every line.",
  "Lines (index. time. text):",
].join("\n");

// Names for voices already told apart: the lines carry their voice ids, and
// the text says who is who. Text only, one call per 400 lines.
const NAME_PROMPT = [
  "You are given transcript lines of one recording. Each line carries the id of the voice that says it; the voices are already told apart.",
  "Name the voices the conversation names.",
  'Return ONLY JSON: {"speakers": [{"id": "S1", "name": "…"}]}',
  "1. Name a voice only from what is said: someone introduces themselves, a host names a guest, one person addresses another by name (the name then belongs to the voice being addressed, not the one saying it). Use the name as it is said.",
  '2. A voice the conversation never names: return "" as its name.',
  "3. Never guess a name from the subject or a person you recognize.",
  "4. Return every voice id that appears in the lines, each once.",
  "Lines (index. time. voice. text):",
].join("\n");
const NAME_LINES = 400;

const nameResponseSchema = z.object({
  speakers: z.array(z.object({ id: z.string(), name: z.string() })),
});

const responseSchema = z.object({
  speakers: z.array(z.object({ id: z.string(), name: z.string() })),
  lines: z.array(z.object({ i: z.number().int().min(0), speaker: z.string() })),
});

/** Which speaker says each line, and the voices heard. `byLine` is one entry
    per line in, null where the pass said nothing about that line. */
export type SpeakerLines = { speakers: Speaker[]; byLine: (string | null)[] };

const EMPTY: SpeakerLines = { speakers: [], byLine: [] };

function linesBlock(lines: TranscriptSegment[], offset: number): string {
  return lines
    .map((line, i) => `${offset + i}. ${formatTime(line.start)}. ${line.text.replace(/\n/g, " ")}`)
    .join("\n");
}

// One call over one stretch of the recording. `known` is the roster found so
// far: a later window reuses those ids, so the same voice keeps one id across
// the whole recording.
async function speakersOf(
  part: MediaPart,
  window: { start: number; end: number; last?: boolean } | undefined,
  lines: TranscriptSegment[],
  offset: number,
  known: Speaker[],
): Promise<z.infer<typeof responseSchema>> {
  const roster =
    known.length > 0
      ? [
          "Voices already found earlier in this recording. Reuse the id when you hear the same voice, and keep the name:",
          ...known.map((s) => `${s.id}: ${s.name}`),
        ].join("\n")
      : "";
  const prompt = [SPEAKER_PROMPT, linesBlock(lines, offset), roster].filter(Boolean).join("\n");
  return geminiCall(
    [part(window), { text: prompt }],
    {
      json: true,
      maxOutputTokens: 65536,
      lowResolution: true,
      usage: { userId: null, feature: "transcribe" },
    },
    (text) => {
      const parsed = responseSchema.safeParse(extractJson(text));
      if (!parsed.success) throw new Error("output was not speakers");
      return parsed.data;
    },
  );
}

/** Which voice speaks each line. Answers an empty roster when there is no
    key, when the pass fails, or when it heard one voice — a transcript with
    one speaker reads better with no name on it at all. */
export async function detectSpeakers(
  media: { part: MediaPart; windowable: boolean; inline: boolean },
  lines: TranscriptSegment[],
  opts: { deadline?: number } = {},
): Promise<SpeakerLines> {
  if (lines.length === 0 || !process.env.GEMINI_API_KEY) return EMPTY;

  const byLine: (string | null)[] = new Array(lines.length).fill(null);
  const roster = new Map<string, Speaker>();
  const take = (answer: z.infer<typeof responseSchema>) => {
    for (const speaker of answer.speakers) {
      if (roster.has(speaker.id) || roster.size >= MAX_SPEAKERS) continue;
      roster.set(speaker.id, { id: speaker.id, name: speaker.name.trim() });
    }
    for (const line of answer.lines) {
      // Only ids the pass declared, and only lines that exist.
      if (line.i < byLine.length && roster.has(line.speaker)) byLine[line.i] = line.speaker;
    }
  };

  try {
    // The whole recording in one call when it fits — the pass hears every
    // voice at once, which is what keeps one id per voice honest.
    const whole = [media.part(), { text: SPEAKER_PROMPT }];
    const total = media.inline ? 0 : await geminiCountTokens(whole);
    if (total === null || total <= GEMINI_SINGLE_CALL_TOKENS || !media.windowable) {
      take(await speakersOf(media.part, undefined, lines, 0, []));
    } else {
      // Too long for one call: windows in order, each carrying the roster
      // forward so a voice heard in the first window keeps its id in the
      // last. Sequential, so a window that runs out of time stops the rest
      // and leaves those lines unnamed rather than renaming a voice.
      const end = lines[lines.length - 1].end;
      for (let start = 0; start < end; start += CHUNK_SECONDS) {
        if (opts.deadline !== undefined && Date.now() > opts.deadline) break;
        const stop = start + CHUNK_SECONDS;
        const first = lines.findIndex((line) => line.start >= start && line.start < stop);
        if (first === -1) continue;
        let after = lines.findIndex((line) => line.start >= stop);
        if (after === -1) after = lines.length;
        take(
          await speakersOf(
            media.part,
            { start, end: stop, last: stop >= end },
            lines.slice(first, after),
            first,
            [...roster.values()],
          ),
        );
      }
    }
  } catch (err) {
    console.warn("[speakers] pass failed:", err instanceof Error ? err.message : err);
    return EMPTY;
  }

  return settleSpeakers(roster, byLine);
}

/** Names for lines that already carry their voice ids (a Deepgram
    transcript). Reads the text only; the roster is the ids in order of first
    speaking, named where the conversation names them. Answers an empty
    roster when one voice speaks throughout, and unnamed voices without a
    key or when the pass fails. */
export async function nameSpeakers(lines: TranscriptSegment[]): Promise<SpeakerLines> {
  const byLine = lines.map((line) => line.speaker ?? null);
  const roster = new Map<string, Speaker>();
  for (const id of byLine) {
    if (id !== null && !roster.has(id)) roster.set(id, { id, name: "" });
  }
  if (roster.size <= 1) return EMPTY;
  if (process.env.GEMINI_API_KEY) {
    try {
      // Names are said early — an introduction, a host's welcome — so the
      // first batch names most voices; later batches only fill in the rest.
      for (let at = 0; at < lines.length; at += NAME_LINES) {
        if ([...roster.values()].every((s) => s.name !== "")) break;
        const batch = lines.slice(at, at + NAME_LINES);
        const prompt = [
          NAME_PROMPT,
          ...batch.map(
            (line, i) =>
              `${at + i}. ${formatTime(line.start)}. ${line.speaker ?? "?"}. ${line.text.replace(/\n/g, " ")}`,
          ),
        ].join("\n");
        const answer = await geminiCall(
          [{ text: prompt }],
          { json: true, maxOutputTokens: 4096, usage: { userId: null, feature: "transcribe" } },
          (text) => {
            const parsed = nameResponseSchema.safeParse(extractJson(text));
            if (!parsed.success) throw new Error("output was not speakers");
            return parsed.data;
          },
        );
        for (const speaker of answer.speakers) {
          const known = roster.get(speaker.id);
          if (known && known.name === "" && speaker.name.trim() !== "") {
            roster.set(speaker.id, { id: speaker.id, name: speaker.name.trim() });
          }
        }
      }
    } catch (err) {
      console.warn("[speakers] naming failed:", err instanceof Error ? err.message : err);
    }
  }
  return settleSpeakers(roster, byLine);
}

/** The roster as it stores: only voices that actually got a line, an unnamed
    voice numbered by where it first speaks, and nothing at all when one voice
    speaks throughout — a transcript with one speaker reads better with no
    name on it. */
export function settleSpeakers(
  roster: Map<string, Speaker>,
  byLine: (string | null)[],
): SpeakerLines {
  const order: string[] = [];
  for (const id of byLine) {
    if (id !== null && !order.includes(id)) order.push(id);
  }
  if (order.length <= 1) return EMPTY;
  const speakers = order.map((id, i) => {
    const name = roster.get(id)?.name ?? "";
    return { id, name: name === "" ? `Speaker ${i + 1}` : name };
  });
  return { speakers, byLine };
}

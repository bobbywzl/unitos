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

// Speakers (SPEC.md §11): who says each line. The pass reads the media and
// the lines already transcribed, tells the voices apart, and names them from
// what the recording itself says — an introduction, a host naming a guest,
// one person addressing another. A voice nobody names keeps its number. It
// runs over every transcript whatever rung produced it, because it reads the
// lines rather than making them: YouTube's captions carry no speakers and
// neither Whisper rung returns any.
//
// Names come only from the audio. The pass never guesses from the subject,
// the channel, or a name it recognizes: a wrong name on every line of a
// transcript is worse than "Speaker 2".

/** At most this many voices in one recording. A pass that returns more has
    lost the thread — panel voices it cannot separate become one each. */
const MAX_SPEAKERS = 12;

const SPEAKER_PROMPT = [
  "You are given a recording and the lines already transcribed from it.",
  "Say which voice speaks each line, and name the voices the recording names.",
  'Return ONLY JSON: {"speakers": [{"id": "S1", "name": "…"}], "lines": [{"i": 0, "speaker": "S1"}]}',
  "1. Tell the voices apart by the sound of the voice, never by what is said.",
  "2. Every line gets exactly one speaker id, and every id used is in speakers.",
  "3. The same voice keeps the same id everywhere in the recording.",
  "4. Name a voice only from what the recording says: someone introduces themselves, a host names a guest, one person addresses another by name. Use the name as it is said.",
  '5. A voice the recording never names keeps its number: "Speaker 2".',
  "6. Never guess a name from the subject, the channel, or a person you recognize. An unnamed voice is a number.",
  "7. One voice throughout: return one speaker and give it every line.",
  "Lines (index. time. text):",
].join("\n");

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

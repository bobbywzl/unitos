// The voice model (SPEC.md §11, lib/video/grok.ts): how a Grok answer becomes
// segments and text, and where the rung stands in the ladder.
//
//   node scripts/qa/mock-services.mjs &          # :3398
//   npx tsx scripts/qa/voice-model-check.ts
//
// The second half calls the stand-in for xAI and for Groq; no call leaves
// this machine.
import { grokLanguage, grokSegments, segmentsText } from "@/lib/video/grok";
import { NoSpeech, transcribe, transcriptionConfigured } from "@/lib/video/transcribe";
import { spokenPieces } from "@/lib/voice-typing";

const MOCK = process.env.MOCK_SERVICES ?? "http://localhost:3398";
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

const word = (text: string, start: number, speaker?: number) => ({ text, start, end: start + 0.3, ...(speaker === undefined ? {} : { speaker }) });

async function main() {
  // ── An answer as segments ────────────────────────────────────────────────
  const two = grokSegments({
    text: "",
    duration: 6,
    words: [word("Hello", 0.2, 0), word("there.", 0.6, 0), word("Hi,", 1.0, 1), word("how", 1.4, 1), word("are", 1.8, 1), word("you?", 2.2, 1)],
  });
  check("a change of voice starts a new segment", two.length === 2 && two[0].text === "Hello there." && two[1].text === "Hi, how are you?", JSON.stringify(two.map((s) => s.text)));
  check("each segment carries its voice", two[0].speaker === "S1" && two[1].speaker === "S2");
  check("a segment runs from its first word to its last", two[1].start === 1.0 && Math.abs(two[1].end - 2.5) < 1e-9);

  const paused = grokSegments({ words: [word("One.", 0.2), word("Two.", 0.6), word("Three.", 3.0)] });
  check("a pause starts a new segment", paused.length === 2 && paused[0].text === "One. Two." && paused[1].text === "Three.");
  check("no voices asked for, none set", paused.every((s) => s.speaker === undefined));

  const long = grokSegments({
    words: Array.from({ length: 120 }, (_, i) => word(i % 12 === 11 ? "end." : "word", 0.2 + i * 0.35)),
  });
  check("a long run ends at a sentence end", long.length > 1 && long.slice(0, -1).every((s) => s.text.endsWith("end.") && s.text.length <= 400), `${long.length} segments`);

  const zh = grokSegments({ words: [word("今天", 0.2), word("我们", 0.6), word("讨论", 1.0), word("Google", 1.4), word("的", 1.8), word("默认", 2.2), word("设置。", 2.6)] });
  check("Chinese words join with no space; a Latin word keeps its spaces", zh.length === 1 && zh[0].text === "今天我们讨论 Google 的默认设置。", zh[0]?.text);

  check("an answer with text and no words is one segment", grokSegments({ text: "Only text.", duration: 2 })[0]?.text === "Only text.");
  check("an empty answer is no segment", grokSegments({ text: "", duration: 0.4 }).length === 0);
  let threw = false;
  try {
    grokSegments({ words: "nope" });
  } catch {
    threw = true;
  }
  check("an answer of another shape is refused", threw);

  check("segments read as text, a paragraph break at a long pause", segmentsText([{ start: 0, end: 1, text: "First." }, { start: 1.2, end: 2, text: "Still first." }, { start: 5, end: 6, text: "Second." }]) === "First. Still first.\n\nSecond.");
  check("a language tag becomes the model's code", grokLanguage("en-US") === "en" && grokLanguage("zh-TW") === "zh" && grokLanguage("") === undefined && grokLanguage("x") === undefined);

  // ── What voice typing types from a written phrase ───────────────────────
  const written = spokenPieces("First point. New line. Second period of the game.", true, true);
  check(
    "a written phrase keeps its words, and new line still breaks the line",
    JSON.stringify(written) === JSON.stringify([{ text: "First point." }, { lineBreak: true }, { text: "Second period of the game." }]),
    JSON.stringify(written),
  );
  const heard = spokenPieces("first point period new line second point", true);
  check(
    "a heard phrase types what period names, as before",
    JSON.stringify(heard) === JSON.stringify([{ text: "first point." }, { lineBreak: true }, { text: "second point" }]),
    JSON.stringify(heard),
  );

  // ── The ladder ───────────────────────────────────────────────────────────
  const audio = new Uint8Array(new ArrayBuffer(4000)).fill(7);
  const log = async () => (await (await fetch(`${MOCK}/v1/stt/log`)).json()) as { fields: Record<string, string> }[];
  await fetch(`${MOCK}/v1/stt/log`, { method: "DELETE" });

  for (const key of ["XAI_API_KEY", "DEEPGRAM_API_KEY", "GROQ_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"]) delete process.env[key];
  check("with no key nothing can be written out", !transcriptionConfigured());

  process.env.GROQ_API_KEY = "mock";
  process.env.GROQ_API_URL = `${MOCK}/openai/v1/audio/transcriptions`;
  let result = await transcribe({ kind: "upload", bytes: audio, mimeType: "audio/webm" });
  check("without the voice model's key the ladder is what it was", result.provider === "Groq Whisper", result.provider);
  check("without the key xAI is never called", (await log()).length === 0);

  process.env.XAI_API_KEY = "mock";
  process.env.XAI_API_URL = `${MOCK}/v1/stt`;
  result = await transcribe({ kind: "upload", bytes: audio, mimeType: "audio/webm" });
  check("with the key the voice model answers first", result.provider === "Grok Voice Transcribe", result.provider);
  check("a recording's voices are told apart", result.segments.length === 2 && result.segments[0].speaker === "S1" && result.segments[1].speaker === "S2", JSON.stringify(result.segments.map((s) => s.speaker)));
  let sent = (await log()).at(-1)?.fields ?? {};
  check("the call names the model and asks for voices, the file last", sent.model === "grok-voice-transcribe-2.0" && sent.diarize === "true" && Object.keys(sent).at(-1) === "file", JSON.stringify(Object.keys(sent)));
  check("no language is named for a recording", sent.language === undefined && sent.format === undefined);

  result = await transcribe({ kind: "upload", bytes: audio, mimeType: "audio/webm" }, { speakers: false, language: "zh-CN" });
  sent = (await log()).at(-1)?.fields ?? {};
  check("voice typing asks for no voices and names its language", sent.diarize === undefined && sent.language === "zh" && sent.format === "true", JSON.stringify(sent));
  check("one voice, one segment, no voice id", result.segments.length === 1 && result.segments[0].speaker === undefined);

  let ended: unknown = null;
  try {
    await transcribe({ kind: "upload", bytes: new Uint8Array(new ArrayBuffer(200)), mimeType: "audio/webm" }, { speakers: false, noSpeechEnds: true });
  } catch (err) {
    ended = err;
  }
  check("for voice typing, no speech ends the ladder", ended instanceof NoSpeech, String(ended));
  result = await transcribe({ kind: "upload", bytes: new Uint8Array(new ArrayBuffer(200)), mimeType: "audio/webm" });
  check("for a transcript, no speech in one rung goes on to the next", result.provider === "Groq Whisper", result.provider);

  process.env.XAI_API_KEY = "wrong";
  result = await transcribe({ kind: "upload", bytes: audio, mimeType: "audio/webm" });
  check("when the voice model refuses, the next rung answers", result.provider === "Groq Whisper", result.provider);

  console.log(failed === 0 ? "\nAll checks pass." : `\n${failed} check(s) failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();

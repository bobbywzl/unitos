import { normalizeSegments, type TranscriptSegment } from "@/lib/video/segments";
import { parseTimeInput } from "@/lib/video/types";

// A pasted transcript (SPEC.md §11): the last rung, and the one that never
// depends on the server's network. The reader copies the transcript YouTube
// shows them — or any timed transcript — and pastes it. Read here:
//   YouTube's transcript panel copy: a time on one line, its text on the next
//   Time and text on one line: "0:33 text", "[0:33] text", "(0:33) text"
//   SRT and WebVTT cues: "00:00:33,000 --> 00:00:34,433" with the text under it
// A segment without its own end runs to the next segment's start.

const MAX_PASTE_CHARS = 2_000_000;
const DEFAULT_SEGMENT_SECONDS = 4;

// A time: "33", "0:33", "1:02:05", "0:33.5", "00:00:33,000".
const TIME = String.raw`\d{1,2}(?::\d{2}){0,2}(?:[.,]\d{1,3})?`;
const TIME_ONLY = new RegExp(`^[\\[(]?(${TIME})[\\])]?$`);
const TIME_THEN_TEXT = new RegExp(`^[\\[(]?(${TIME})[\\])]?[\\s\\-–—:]+(\\S.*)$`);
const CUE_RANGE = new RegExp(`^(${TIME})\\s*-->\\s*(${TIME})`);

function seconds(raw: string): number | null {
  return parseTimeInput(raw.replace(",", "."));
}

type Open = { start: number; end: number | null; text: string[] };

/** Timed segments out of pasted text. Throws with a plain reason when the
    text is empty, too long, or carries no times. */
export function parsePastedTranscript(text: string): TranscriptSegment[] {
  if (text.length > MAX_PASTE_CHARS) throw new Error("the pasted text is too long");
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim());
  const opens: Open[] = [];
  let open: Open | null = null;
  const close = () => {
    if (open) opens.push(open);
    open = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === "" || line === "WEBVTT") continue;
    // An SRT cue number is the line before a range; the range carries the time.
    if (/^\d+$/.test(line) && lines[i + 1] !== undefined && CUE_RANGE.test(lines[i + 1])) continue;
    const range = CUE_RANGE.exec(line);
    if (range) {
      const start = seconds(range[1]);
      const end = seconds(range[2]);
      if (start === null) continue;
      close();
      open = { start, end: end !== null && end > start ? end : null, text: [] };
      continue;
    }
    const alone = TIME_ONLY.exec(line);
    if (alone) {
      const start = seconds(alone[1]);
      if (start === null) continue;
      close();
      open = { start, end: null, text: [] };
      continue;
    }
    const inline = TIME_THEN_TEXT.exec(line);
    if (inline) {
      const start = seconds(inline[1]);
      if (start !== null) {
        close();
        open = { start, end: null, text: [inline[2]] };
        continue;
      }
    }
    if (open) open.text.push(line);
  }
  close();

  const timed = opens.filter((o) => o.text.length > 0);
  if (timed.length === 0) {
    throw new Error(
      opens.length > 0 ? "the pasted text has times but no words" : "the pasted text has no times",
    );
  }
  const segments = timed.map((o, i) => {
    const next = timed[i + 1]?.start;
    const end =
      o.end ?? (next !== undefined && next > o.start ? next : o.start + DEFAULT_SEGMENT_SECONDS);
    return { start: o.start, end, text: o.text.join(" ") };
  });
  return normalizeSegments(segments);
}

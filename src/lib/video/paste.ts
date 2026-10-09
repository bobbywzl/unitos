import { normalizeSegments, type TranscriptSegment } from "@/lib/video/segments";
import { parseTimeInput } from "@/lib/video/types";

// A pasted transcript (SPEC.md §11): the last rung, and the one that never
// depends on the server's network. The reader copies the transcript YouTube
// shows them — or any timed transcript — and pastes it. Read here:
//   YouTube's transcript panel copy: a time on one line, its text on the next
//   Time and text on one line: "0:33 text", "[0:33] text", "(0:33) text"
//   SRT and WebVTT cues: "00:00:33,000 --> 00:00:34,433" with the text under it
// A segment without its own end runs to the next segment's start.
// A WebVTT file (its first line starts "WEBVTT") is read by the WebVTT
// standard's block rules: a cue is an optional identifier, a timing line, and
// text up to a blank line; NOTE, STYLE, and REGION blocks and cues with broken
// timings are not captions.

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
  const opens = WEBVTT_SIGNATURE.test(text) ? webVttCues(text) : looseCues(text);
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

// Any timed text: a time opens a segment and the lines under it are its text.
function looseCues(text: string): Open[] {
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
  return opens;
}

const WEBVTT_SIGNATURE = /^﻿?WEBVTT(?:[ \t\n\r]|$)/;

// The cues of a WebVTT file, by the standard's parser: blocks part at blank
// lines; a block whose first line, or whose second line after an identifier,
// holds "-->" is a cue, and its text runs to a blank line or to the next line
// that holds "-->". The header block and every other block are dropped.
function webVttCues(text: string): Open[] {
  const lines = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const cues: Open[] = [];
  let at = 1;
  // One block from `at`. In the header, a line with "-->" ends the block and
  // starts the next one.
  const block = (header: boolean) => {
    let count = 0;
    let arrow = false;
    let cue: Open | null = null;
    const buffer: string[] = [];
    while (at < lines.length) {
      const line = lines[at];
      at += 1;
      count += 1;
      if (line.includes("-->")) {
        if (!header && (count === 1 || (count === 2 && !arrow))) {
          arrow = true;
          const timing = webVttTiming(line);
          cue = timing ? { ...timing, text: [] } : null;
          buffer.length = 0;
          continue;
        }
        at -= 1;
        break;
      }
      if (line === "") break;
      buffer.push(line.trim());
    }
    if (cue) cues.push({ ...cue, text: buffer.filter((l) => l !== "") });
  };
  if (at < lines.length && lines[at] !== "") block(true);
  while (at < lines.length) {
    if (lines[at] === "") at += 1;
    else block(false);
  }
  return cues;
}

// [hh:]mm:ss.ttt: hours any number of digits, minutes and seconds two,
// milliseconds three. Two parts are minutes and seconds unless the first is
// not two digits or is over 59; then three parts are needed.
const WEBVTT_TIME = /(\d+):(\d{2})(?!\d)(?::(\d{2})(?!\d))?\.(\d{3})(?!\d)/y;

function webVttTime(line: string, at: number): { seconds: number; at: number } | null {
  WEBVTT_TIME.lastIndex = at;
  const m = WEBVTT_TIME.exec(line);
  if (!m) return null;
  const hours = m[3] !== undefined;
  if (!hours && (m[1].length !== 2 || Number(m[1]) > 59)) return null;
  const [h, min, sec] = hours ? [m[1], m[2], m[3]] : ["0", m[1], m[2]];
  if (Number(min) > 59 || Number(sec) > 59) return null;
  return { seconds: Number(h) * 3600 + Number(min) * 60 + Number(sec) + Number(m[4]) / 1000, at: WEBVTT_TIME.lastIndex };
}

// "00:01.000 --> 00:02.500 settings". Null when either time is broken.
function webVttTiming(line: string): { start: number; end: number | null } | null {
  const skip = (i: number) => {
    while (line[i] === " " || line[i] === "\t") i += 1;
    return i;
  };
  const start = webVttTime(line, skip(0));
  if (!start) return null;
  const arrow = skip(start.at);
  if (!line.startsWith("-->", arrow)) return null;
  const end = webVttTime(line, skip(arrow + 3));
  if (!end) return null;
  return { start: start.seconds, end: end.seconds > start.seconds ? end.seconds : null };
}

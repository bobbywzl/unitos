// The media benchmark (SPEC.md §11): the deterministic path of a video or
// audio document, from the file or the captions to the transcript lines the
// reader sees, scored against references read by other code.
//
//   npx tsx scripts/parse-bench/media.mts [--fetch] [--section a|b|c] [--only id,id]
//     [--baseline] [--save-baseline] [--worst n] [--detail id] [--json out.json]
//
// Three sections:
//   a. Container reading (lib/video/storage.ts sniffMedia, mp3.ts, fmp4.ts):
//      the type the upload is stored as (audio or video, and the MIME type),
//      against FFmpeg's reading of the file (media-ref.py); and an MP3 or an
//      indexed MP4 stream cut into chunks the way a long recording is cut for
//      transcription: every chunk starts on a frame or a segment, starts at
//      the time FFmpeg gives that byte (0.05 s), decodes to the packets it
//      holds, and no audio falls between chunks.
//   b. Captions (lib/video/paste.ts for WebVTT, SRT, and any pasted text;
//      captions.ts for YouTube's json3, srv3, and legacy XML): cues against
//      the W3C's WebVTT parser (the validator's; it passes WPT's
//      file parsing tests), pysubs2, the WPT
//      cue text tests' own expected trees, and YouTube's formats read from
//      their own structure. A cue matches when its start is within 1.5 ms and
//      its text is the reference's exactly (spaces collapsed). Word F1 counts
//      words in order. YouTube's auto captions in WebVTT repeat every line
//      (a rolling two-line caption); their reference is each word once, at
//      the time the file stamps it, and they score by words and word times.
//   c. Transcript lines and paragraphs (segments.ts, tidy.ts transcriptLines,
//      speakers.ts nameSpeakers, types.ts transcriptParagraphs): Earnings-21's
//      word-timed, diarized ASR outputs taken through the Deepgram rung's
//      reading (deepgram.ts deepgramSegments, the words path), and the real
//      caption files of section b taken through their parser: the stored
//      lines keep every word once and in order (fillers may go), each line's
//      time covers its words, and the paragraphs break where the human
//      transcript (Earnings-21's reference) changes speaker, and never inside
//      a sentence.
//
// Model passes in the path: transcript cleanup (tidy.ts) runs the model when
// a key is set; the bench has no key, so the rules pass runs, which is the
// keyless production path. `c` also prints what would reach the model (lines
// per batch, lines with markup) and how the soundness check answers a stubbed
// model reply that moves words between lines. Speaker naming and chapters
// are model passes with no deterministic part to score beyond the ids.
//
// Files: media-corpus.json (sources, licenses, what each file exercises).
// --fetch downloads them into .bench/media/files and builds the references.
// Baseline: media-baseline.json (numbers only). --baseline lists every file
// whose score dropped by more than 0.01 and exits 1 when one did.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { corpus, fetchAll, fileOf, MEDIA_ROOT, referenceOf, type CorpusFile } from "./media-fetch";

// No model, no network: the keyless path.
for (const key of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "LITELLM_BASE_URL", "LITELLM_API_KEY", "DEEPGRAM_API_KEY", "GROQ_API_KEY", "OPENAI_API_KEY", "TYPESAFE_API_KEY"]) {
  delete process.env[key];
}
globalThis.fetch = (async () => {
  throw new Error("offline");
}) as typeof fetch;

const { sniffMedia } = await import("@/lib/video/storage");
const { splitMp3 } = await import("@/lib/video/mp3");
const { splitFmp4 } = await import("@/lib/video/fmp4");
const { parsePastedTranscript } = await import("@/lib/video/paste");
const { parseJson3, parseXml } = await import("@/lib/video/captions");
const { deepgramSegments } = await import("@/lib/video/deepgram");
const { transcriptLines, lineIsSound } = await import("@/lib/video/tidy");
const { nameSpeakers } = await import("@/lib/video/speakers");
const { transcriptParagraphs } = await import("@/lib/video/types");
const { UPLOAD_CHUNK_BYTES } = await import("@/lib/video/types");
type Segment = { start: number; end: number; text: string; speaker?: string };

const REFS = join(MEDIA_ROOT, "refs");
const TOOLS = join(MEDIA_ROOT, "tools");
const TMP = join(MEDIA_ROOT, "tmp");
const BASELINE = join(import.meta.dirname, "media-baseline.json");

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
function value(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
}
const only = value("--only")?.split(",").map((s) => s.trim()).filter(Boolean);
const sectionOnly = value("--section");
const worst = value("--worst") ? Number(value("--worst")) : 8;
const detail = value("--detail");

if (flag("--fetch")) {
  fetchAll(flag("--force"));
  if (!existsSync(join(TOOLS, "node_modules", "webvtt-parser"))) {
    mkdirSync(TOOLS, { recursive: true });
    execFileSync("npm", ["install", "--prefix", TOOLS, "--no-audit", "--no-fund", "webvtt-parser@2.2.0"], { stdio: "inherit" });
  }
  console.log("Building references (FFmpeg, mutagen, pysubs2)…");
  execFileSync("python3", ["-I", join(import.meta.dirname, "media-ref.py"), join(import.meta.dirname, "media-corpus.json"), join(MEDIA_ROOT, "files"), REFS], { stdio: "inherit" });
}

// ── Text helpers ────────────────────────────────────────────────────────────

const CJK = String.raw`\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}`;
const UNSPACED = String.raw`\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}`;
// Spaces collapse; a space between two Chinese or Japanese characters is
// layout (a pretty-printed srv3 file puts its word elements on lines of
// their own), not a word break the reader sees.
const BETWEEN_CJK = new RegExp(`(?<=[${UNSPACED}]) (?=[${UNSPACED}\\p{P}])|(?<=[${UNSPACED}\\p{P}]) (?=[${UNSPACED}])`, "gu");
// Zero-width characters are invisible to the reader.
const collapse = (s: string) => s.normalize("NFC").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\s+/g, " ").trim().replace(BETWEEN_CJK, "");
const TOKEN = new RegExp(`[${CJK}]|[^\\s${CJK}]+`, "gu");
/** Words as the reader counts them: each CJK character is one; a run of
    punctuation alone is not a word. */
const tokens = (s: string) => (collapse(s).match(TOKEN) ?? []).filter((w) => norm(w) !== "");
/** A word for matching: lower case, letters and digits only. */
const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const FILLERS = new Set(["um", "uh", "er", "erm", "hmm", "mm", "uhm", "umm", "uhh", "ah"]);

/** a[i] → the index in b it aligns to, or -1: the longest common
    subsequence, windowed so an hour of words aligns in milliseconds. */
function align(a: string[], b: string[]): Int32Array {
  const map = new Int32Array(a.length).fill(-1);
  const W = 1200;
  let i0 = 0;
  let j0 = 0;
  while (i0 < a.length) {
    const n = Math.min(W, a.length - i0);
    const m = Math.min(Math.ceil(W * 1.6) + 50, b.length - j0);
    const last = i0 + n >= a.length;
    if (m <= 0) break;
    const L = new Uint16Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        L[i * (m + 1) + j] =
          a[i0 + i] === b[j0 + j] && a[i0 + i] !== ""
            ? L[(i + 1) * (m + 1) + j + 1] + 1
            : Math.max(L[(i + 1) * (m + 1) + j], L[i * (m + 1) + j + 1]);
      }
    }
    const commitTo = last ? n : Math.floor(n * 0.6);
    let i = 0;
    let j = 0;
    let lastJ = -1;
    while (i < commitTo && j < m) {
      if (a[i0 + i] === b[j0 + j] && a[i0 + i] !== "") {
        map[i0 + i] = j0 + j;
        lastJ = j;
        i++;
        j++;
      } else if (L[(i + 1) * (m + 1) + j] >= L[i * (m + 1) + j + 1]) i++;
      else j++;
    }
    if (last) break;
    i0 += commitTo;
    j0 += lastJ >= 0 ? lastJ + 1 : 0;
  }
  return map;
}

const f1 = (p: number, r: number) => (p + r === 0 ? 0 : (2 * p * r) / (p + r));
const mean = (xs: number[]) => (xs.length === 0 ? 1 : xs.reduce((a, b) => a + b, 0) / xs.length);
const round = (x: number) => Math.round(x * 1000) / 1000;
const fmt = (x: number) => x.toFixed(3);

type Result = { id: string; section: string; score: number; metrics: Record<string, number>; ms: number; notes: string[] };

// ── Section a: container reading ────────────────────────────────────────────

type Probe = {
  format?: string;
  brand?: string | null;
  duration?: number | null;
  streams?: { type: string; codec: string; picture: boolean }[];
  error?: unknown;
};
type ARef = { probe: Probe; packets?: [number, number, number, number][] };

/** The MIME type the upload should store as, from FFmpeg's reading: the
    container, audio or video by whether a real video stream (not a cover
    picture) is in it. A file FFmpeg cannot read, or a container the upload
    does not take (SPEC.md §11: mp4/webm/ogg/mov, mp3/m4a/aac/wav/flac/ogg),
    stores as nothing. */
function expectedMime(ref: ARef): string | null {
  const p = ref.probe;
  if (p.error || !p.format) return null;
  const video = (p.streams ?? []).some((s) => s.type === "video" && !s.picture);
  const audio = (p.streams ?? []).some((s) => s.type === "audio");
  if (!video && !audio) return null;
  const format = p.format.split(",");
  if (format.includes("mp4") || format.includes("mov")) {
    if (video) return (p.brand ?? "").startsWith("qt") ? "video/quicktime" : "video/mp4";
    return "audio/mp4";
  }
  if (format.includes("webm") || format.includes("matroska")) return video ? "video/webm" : "audio/webm";
  if (format.includes("ogg")) return video ? "video/ogg" : "audio/ogg";
  if (format.includes("mp3")) return "audio/mpeg";
  if (format.includes("aac")) return "audio/aac";
  if (format.includes("wav")) return "audio/wav";
  if (format.includes("flac")) return "audio/flac";
  return null;
}

const kindOf = (mime: string | null) => (mime === null ? "none" : mime.split("/")[0]);

// The packets FFmpeg reads out of one chunk, told the container as a
// provider is (by the file name it gets).
function ffprobePackets(path: string, format: "mp3" | "mp4"): number {
  try {
    const out = execFileSync("ffprobe", ["-v", "quiet", "-f", format, "-select_streams", "a:0", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", path], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return parseInt(out.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

type Box = { type: string; start: number; end: number };
function topBoxes(bytes: Uint8Array): Box[] {
  const boxes: Box[] = [];
  let at = 0;
  while (at + 8 <= bytes.length) {
    let size = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    if (size === 1 && at + 16 <= bytes.length) {
      size = Number(new DataView(bytes.buffer, bytes.byteOffset + at + 8, 8).getBigUint64(0));
    } else if (size === 0) size = bytes.length - at;
    if (size < 8) break;
    boxes.push({ type, start: at, end: Math.min(bytes.length, at + size) });
    at += size;
  }
  return boxes;
}

type ChunkCheck = { start: number; refStart: number | null; packets: number; refPackets: number };

function writeTmp(name: string, bytes: Uint8Array): string {
  mkdirSync(TMP, { recursive: true });
  const path = join(TMP, name);
  writeFileSync(path, bytes);
  return path;
}

function scoreA(file: CorpusFile, bytes: Uint8Array, ref: ARef): Result {
  const notes: string[] = [];
  const t0 = performance.now();
  // The upload route sniffs the first stored chunk.
  const got = sniffMedia(bytes.subarray(0, UPLOAD_CHUNK_BYTES));
  let ms = performance.now() - t0;
  const want = expectedMime(ref);
  const kindOk = kindOf(got) === kindOf(want) ? 1 : 0;
  const mimeOk = got === want ? 1 : 0;
  if (!mimeOk) notes.push(`stored as ${got ?? "nothing"}, FFmpeg reads ${want ?? "nothing"} (${ref.probe.format ?? "unreadable"}${ref.probe.brand ? ` ${ref.probe.brand}` : ""})`);
  const metrics: Record<string, number> = { kindOk, mimeOk };
  const parts = [kindOk, mimeOk];

  const packets = ref.packets ?? [];
  const firstPts = packets.length > 0 ? Math.min(...packets.map((p) => p[1])) : 0;
  const checks: ChunkCheck[] = [];
  let split: "mp3" | "fmp4" | null = null;
  let lost = 0;
  let failed = false;

  const boxes = want === "audio/mp4" || want === "video/mp4" ? topBoxes(bytes) : [];
  const sidx = boxes.findIndex((b) => b.type === "sidx");
  if (want === "audio/mpeg" && packets.length >= 16) {
    split = "mp3";
    const budget = Math.max(2048, Math.ceil(bytes.length / 4));
    const t1 = performance.now();
    const chunks = splitMp3(bytes, budget);
    ms += performance.now() - t1;
    if (!chunks) failed = true;
    else {
      const byPos = new Map(packets.map((p) => [p[0], p]));
      const covered: [number, number][] = [];
      chunks.forEach((chunk, k) => {
        const off = chunk.bytes.byteOffset - bytes.byteOffset;
        covered.push([off, off + chunk.bytes.length]);
        // The first chunk starts on the first frame, which in a VBR file is
        // the Xing, Info, or VBRI frame: no audio, so FFmpeg lists no packet
        // there; its audio starts at the first packet.
        const pkt = byPos.get(off) ?? (k === 0 && off < packets[0][0] ? packets[0] : undefined);
        const inside = packets.filter((p) => p[0] >= off && p[0] + p[3] <= off + chunk.bytes.length);
        checks.push({
          start: chunk.startTime,
          refStart: pkt ? pkt[1] - firstPts : null,
          packets: ffprobePackets(writeTmp(`${file.id}.${k}.mp3`, chunk.bytes), "mp3"),
          refPackets: inside.length,
        });
      });
      for (const p of packets) {
        if (!covered.some(([s, e]) => p[0] >= s && p[0] + p[3] <= e)) lost += p[2];
      }
    }
  } else if (sidx > 0 && boxes[sidx - 1].type === "moov") {
    split = "fmp4";
    const init = { start: 0, end: boxes[sidx].start - 1 };
    const index = { start: boxes[sidx].start, end: boxes[sidx].end - 1 };
    const segments: { start: number; end: number }[] = [];
    for (let i = sidx + 1; i < boxes.length; i++) {
      if (boxes[i].type === "moof" && boxes[i + 1]?.type === "mdat") segments.push({ start: boxes[i].start, end: boxes[i + 1].end });
    }
    const budget = init.end + 1 + Math.ceil((bytes.length - init.end) / 4);
    const t1 = performance.now();
    const chunks = splitFmp4(bytes, { init, index }, budget);
    ms += performance.now() - t1;
    if (!chunks) failed = true;
    else {
      let seg = 0;
      chunks.forEach((chunk, k) => {
        let size = chunk.bytes.length - (init.end + 1);
        const first = seg;
        while (size > 0 && seg < segments.length) {
          size -= segments[seg].end - segments[seg].start;
          seg += 1;
        }
        const span = segments.slice(first, seg);
        const inside = packets.filter((p) => span.some((s) => p[0] >= s.start && p[0] < s.end));
        checks.push({
          start: chunk.startTime,
          refStart: inside.length > 0 ? Math.min(...inside.map((p) => p[1])) - firstPts : null,
          packets: ffprobePackets(writeTmp(`${file.id}.${k}.mp4`, chunk.bytes), "mp4"),
          refPackets: inside.length,
        });
      });
      for (const s of segments.slice(seg)) {
        for (const p of packets) if (p[0] >= s.start && p[0] < s.end) lost += p[2];
      }
    }
  }
  if (split) {
    const good = checks.filter(
      (c) => c.refStart !== null && Math.abs(c.start - c.refStart) <= 0.05 && Math.abs(c.packets - c.refPackets) <= 1,
    ).length;
    const duration = ref.probe.duration ?? 0;
    const splitScore = failed ? 0 : (good / Math.max(1, checks.length)) * (1 - Math.min(1, duration > 0 ? lost / duration : 0));
    parts.push(splitScore);
    metrics.split = round(splitScore);
    metrics.chunks = checks.length;
    metrics.chunkStartErr = round(Math.max(0, ...checks.map((c) => (c.refStart === null ? 0 : Math.abs(c.start - c.refStart)))));
    metrics.chunksOffFrame = checks.filter((c) => c.refStart === null).length;
    metrics.chunksUndecoded = checks.filter((c) => Math.abs(c.packets - c.refPackets) > 1).length;
    metrics.lostSeconds = round(lost);
    metrics.splitFailed = failed ? 1 : 0;
    if (failed) notes.push(`${split} split returned nothing`);
    for (const [k, c] of checks.entries()) {
      if (c.refStart === null || Math.abs(c.start - c.refStart) > 0.05 || Math.abs(c.packets - c.refPackets) > 1) {
        notes.push(`chunk ${k}: starts ${c.start.toFixed(3)}s, FFmpeg ${c.refStart === null ? "has no frame at that byte" : `${c.refStart.toFixed(3)}s`}; ${c.packets} packets decode of ${c.refPackets}`);
      }
    }
    if (lost > 0) notes.push(`${lost.toFixed(3)} s of audio in no chunk`);
  }
  return { id: file.id, section: "a", score: mean(parts), metrics, ms, notes };
}

// ── Section b: captions ─────────────────────────────────────────────────────

type RefCue = { start: number; end: number; text: string; voice?: string; words?: [number, string][] };
type BRef = { cues: RefCue[]; rolling?: boolean; cases?: { data: string; expected: string }[] };

// The W3C's WebVTT parser (w3c/webvtt.js, the validator's), which follows the
// spec and passes WPT's file parsing tests, with the full table of character
// references. A cue's text is its tree's text; a <v> span names the voice;
// a timestamp node stamps the words after it.
type VttNode = { type: "text" | "object" | "timestamp"; name?: string; value?: string | number; children?: VttNode[] };
type VttCue = { start: number; end: number; text: string; voice?: string; pieces: [number, string][] };
let vttParse: null | ((raw: string) => VttCue[]) = null;
function vttReader(): (raw: string) => VttCue[] {
  if (vttParse) return vttParse;
  const req = createRequire(join(TOOLS, "node_modules", "/"));
  const { WebVTTParser } = req("webvtt-parser") as { WebVTTParser: new (entities?: unknown) => { parse: (input: string, mode: string) => { cues: { startTime: number; endTime: number; tree: VttNode }[] } } };
  const entities = req("webvtt-parser/html-entities.json");
  vttParse = (raw: string) =>
    new WebVTTParser(entities).parse(raw, "subtitles").cues.map((c) => {
      const pieces: [number, string][] = [];
      let time = c.startTime;
      let voice: string | undefined;
      const walk = (node: VttNode) => {
        if (node.type === "text") pieces.push([time, String(node.value ?? "")]);
        else if (node.type === "timestamp") time = Number(node.value);
        else {
          if (node.name === "v" && voice === undefined && typeof node.value === "string") voice = node.value.trim();
          (node.children ?? []).forEach(walk);
        }
      };
      walk(c.tree);
      return { start: c.startTime, end: c.endTime, text: pieces.map((p) => p[1]).join(""), voice, pieces };
    });
  return vttParse;
}

/** YouTube's auto captions in WebVTT: each cue repeats the line before and
    adds one, and the added line stamps its words. The reference keeps each
    word once: a cue's lines past the one it repeats, each word at the time
    stamped before it (the first at the cue's start). */
function rollingWords(cues: VttCue[]): [number, string][] {
  const words: [number, string][] = [];
  let prevLast = "";
  for (const cue of cues) {
    // The cue's lines, each a list of [time, text] pieces.
    const lines: [number, string][][] = [[]];
    for (const [t, text] of cue.pieces) {
      text.split("\n").forEach((part, i) => {
        if (i > 0) lines.push([]);
        lines[lines.length - 1].push([t, part]);
      });
    }
    const kept = lines.map((pieces) => ({ pieces, text: collapse(pieces.map((p) => p[1]).join("")) })).filter((l) => l.text !== "");
    let fresh = kept;
    if (fresh.length > 0 && fresh[0].text === prevLast) fresh = fresh.slice(1);
    if (kept.length > 0) prevLast = kept[kept.length - 1].text;
    for (const line of fresh) {
      for (const [t, piece] of line.pieces) for (const w of tokens(piece)) words.push([t, w]);
    }
  }
  return words;
}

function unescapeDat(s: string): string {
  return s.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|n|t|\\)/g, (_, e: string) =>
    e === "n" ? "\n" : e === "t" ? "\t" : e === "\\" ? "\\" : String.fromCharCode(parseInt(e.slice(1), 16)),
  );
}

/** WPT cue text tests: #data, then the expected tree; the text is the
    tree's text nodes in order. */
function datCases(raw: string): { data: string; expected: string }[] {
  return raw.split(/^#data\n/m).slice(1).map((block) => {
    const [data, rest = ""] = block.split(/\n#errors\n/);
    const tree = rest.split(/#document-fragment\n?/)[1] ?? "";
    const texts = [...tree.matchAll(/^\|\s*"((?:[^"\\]|\\.)*)"/gm)].map((m) => unescapeDat(m[1]));
    return { data: unescapeDat(data), expected: texts.join("") };
  });
}

function bReference(file: CorpusFile, raw: string): BRef | null {
  if (file.format === "vtt-cuetext") return { cues: [], cases: datCases(raw) };
  if (file.format === "vtt") {
    const cues = vttReader()(raw);
    if (cues.some((c) => c.pieces.some(([t]) => t !== c.start))) {
      return { cues: [], rolling: true, ...{ words: rollingWords(cues) } } as BRef & { words: [number, string][] };
    }
    return { cues: cues.map((c) => ({ start: c.start, end: c.end, text: collapse(c.text), voice: c.voice })).filter((c) => c.text !== "") };
  }
  const path = join(REFS, `${file.id}.json`);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as BRef) : null;
}

/** The code under test: the path a caption file takes into segments. */
function bParse(file: CorpusFile, raw: string): { segments: Segment[]; error: string | null } {
  try {
    if (file.format === "json3") return { segments: parseJson3(raw) ?? [], error: null };
    if (file.format === "srv3" || file.format === "timedtext") return { segments: parseXml(raw) ?? [], error: null };
    return { segments: parsePastedTranscript(raw), error: null };
  } catch (err) {
    return { segments: [], error: err instanceof Error ? err.message : String(err) };
  }
}

const LEAK = /<\/?[a-z][^>]*>|<\d{1,2}:\d{2}[:.]|&[a-z]+;|&#\d+;|-->|^(?:NOTE|STYLE|REGION|WEBVTT)\b/i;

/** Word F1 in order, and the alignment for word times. */
function wordsInOrder(out: string[], ref: string[]) {
  const map = align(out.map(norm), ref.map(norm));
  let matched = 0;
  for (const j of map) if (j >= 0) matched++;
  const p = out.length === 0 ? (ref.length === 0 ? 1 : 0) : matched / out.length;
  const r = ref.length === 0 ? (out.length === 0 ? 1 : 0) : matched / ref.length;
  return { p, r, f1: f1(p, r), map, matched };
}

function scoreB(file: CorpusFile, raw: string, ref: BRef): Result {
  const notes: string[] = [];
  if (ref.cases) {
    const t0 = performance.now();
    let exact = 0;
    for (const c of ref.cases) {
      const { segments } = bParse(file, `WEBVTT\n\n00:00.000 --> 00:01.000\n${c.data}\n`);
      const text = collapse(segments.map((s) => s.text).join(" "));
      if (text === collapse(c.expected)) exact++;
      else if (notes.length < 40) notes.push(`${JSON.stringify(c.data)} → ${JSON.stringify(text)}, expected ${JSON.stringify(collapse(c.expected))}`);
    }
    const score = exact / Math.max(1, ref.cases.length);
    return { id: file.id, section: "b", score, metrics: { cases: ref.cases.length, exact, textExact: round(score) }, ms: performance.now() - t0, notes };
  }
  const t0 = performance.now();
  const { segments, error } = bParse(file, raw);
  const ms = performance.now() - t0;
  const outTokens: { w: string; seg: number }[] = segments.flatMap((s, i) => tokens(s.text).map((w) => ({ w, seg: i })));
  const leaks = segments.filter((s) => LEAK.test(s.text)).length;
  const metrics: Record<string, number> = { segments: segments.length, leaks, failed: error ? 1 : 0 };
  if (error) notes.push(`refused: ${error}`);
  for (const s of segments.filter((s) => LEAK.test(s.text)).slice(0, 5)) notes.push(`markup kept: ${JSON.stringify(s.text.slice(0, 120))}`);

  const words = (ref as BRef & { words?: [number, string][] }).words;
  if (ref.rolling && words) {
    const order = wordsInOrder(outTokens.map((t) => t.w), words.map((w) => w[1]));
    let timed = 0;
    let matched = 0;
    order.map.forEach((j, i) => {
      if (j < 0) return;
      matched++;
      const seg = segments[outTokens[i].seg];
      const t = words[j][0];
      if (t >= seg.start - 0.25 && t <= seg.end + 0.25) timed++;
    });
    const wordTime = matched === 0 ? 0 : timed / matched;
    metrics.wordF1 = round(order.f1);
    metrics.wordP = round(order.p);
    metrics.wordR = round(order.r);
    metrics.wordTime = round(wordTime);
    metrics.extraWords = Math.max(0, outTokens.length - order.matched);
    if (order.p < 0.9) notes.push(`${outTokens.length} words kept for ${words.length} spoken: lines repeated`);
    return { id: file.id, section: "b", score: mean([order.f1, wordTime]), metrics, ms, notes };
  }

  const cues = ref.cues.map((c) => ({ ...c, text: collapse(c.text) })).filter((c) => c.text !== "").sort((a, b) => a.start - b.start);
  const used = new Set<number>();
  let matched = 0;
  const matchOf: number[] = [];
  for (const cue of cues) {
    const k = segments.findIndex((s, i) => !used.has(i) && Math.abs(s.start - cue.start) <= 0.0015 && collapse(s.text) === cue.text);
    matchOf.push(k);
    if (k >= 0) {
      used.add(k);
      matched++;
    }
  }
  const cueP = segments.length === 0 ? (cues.length === 0 ? 1 : 0) : matched / segments.length;
  const cueR = cues.length === 0 ? (segments.length === 0 ? 1 : 0) : matched / cues.length;
  const order = wordsInOrder(outTokens.map((t) => t.w), cues.flatMap((c) => tokens(c.text)));
  metrics.cueF1 = round(f1(cueP, cueR));
  metrics.cueP = round(cueP);
  metrics.cueR = round(cueR);
  metrics.wordF1 = round(order.f1);
  metrics.extraWords = Math.max(0, outTokens.length - order.matched);
  const parts = [f1(cueP, cueR), order.f1];
  // Voices: a cue that names its voice (<v Name>) keeps it as the segment's
  // speaker, one id per name.
  const voiced = cues.map((c, i) => [c, matchOf[i]] as const).filter(([c]) => c.voice);
  if (voiced.length > 0) {
    const idOf = new Map<string, string>();
    let kept = 0;
    for (const [c, k] of voiced) {
      const id = k >= 0 ? segments[k].speaker : undefined;
      if (id === undefined) continue;
      if (!idOf.has(c.voice!)) idOf.set(c.voice!, id);
      if (idOf.get(c.voice!) === id && [...idOf.entries()].every(([v, i]) => v === c.voice || i !== id)) kept++;
    }
    metrics.voices = voiced.length;
    metrics.voicesKept = kept;
    parts.push(kept / voiced.length);
    if (kept < voiced.length) notes.push(`${voiced.length - kept} of ${voiced.length} cues lost their voice's name`);
  }
  for (const [i, cue] of cues.entries()) {
    if (matchOf[i] >= 0 || notes.length >= 14) continue;
    const near = segments.find((s) => Math.abs(s.start - cue.start) <= 0.0015);
    notes.push(`cue ${cue.start.toFixed(3)} ${JSON.stringify(cue.text.slice(0, 90))} → ${near ? JSON.stringify(near.text.slice(0, 90)) : "no segment at that time"}`);
  }
  return { id: file.id, section: "b", score: mean(parts), metrics, ms, notes };
}

// ── Section c: lines and paragraphs ─────────────────────────────────────────

type NlpToken = { token: string; speaker: string; start: number | null; end: number | null; punct: string };
function readNlp(raw: string): NlpToken[] {
  return raw
    .split("\n")
    .slice(1)
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const [token, speaker, ts, endTs, punct] = l.split("|");
      return { token, speaker, start: ts ? Number(ts) : null, end: endTs ? Number(endTs) : null, punct: punct ?? "" };
    });
}

type Line = { start: number; end: number; text: string; speaker?: string };
type Paragraphed = { lines: Line[]; paragraphs: { start: number; lines: number }[]; ms: number; modelLines: number; modelBatches: number; markupToModel: number };

/** The code under test from segments to what the pane shows: the stored
    lines (transcriptLines: clip, order, group, clean), the voices (named
    from the text only: nameSpeakers), and the pane's paragraphs. */
async function linesAndParagraphs(segments: Segment[]): Promise<Paragraphed> {
  const t0 = performance.now();
  const { lines } = await transcriptLines(segments, null, null);
  const diarized = lines.some((l) => l.speaker !== undefined);
  const voices = diarized ? await nameSpeakers(lines, null) : { byLine: [] as (string | null)[] };
  const shown = lines.map((l, i) => ({ id: String(i), text: l.text, startTime: l.start, endTime: l.end, speaker: voices.byLine[i] ?? null }));
  const paragraphs = transcriptParagraphs(shown).map((p) => ({ start: p[0].startTime, lines: p.length }));
  const ms = performance.now() - t0;
  // What the cleanup model would read: the grouped lines, 150 a call.
  return {
    lines,
    paragraphs,
    ms,
    modelLines: lines.length,
    modelBatches: Math.ceil(lines.length / 150),
    markupToModel: lines.filter((l) => LEAK.test(l.text)).length,
  };
}

type TimedWord = { w: string; start: number; end: number; speaker?: string };

/** Every input word once, in order, inside its line's time. */
function keptAndTimed(out: Paragraphed, input: TimedWord[]) {
  const outTokens = out.lines.flatMap((l, i) => tokens(l.text).map((w) => ({ w, line: i })));
  const inNorm = input.map((t) => norm(t.w));
  const map = align(outTokens.map((t) => norm(t.w)), inNorm);
  const hit = new Uint8Array(input.length);
  let matched = 0;
  let timed = 0;
  const voicesOf = out.lines.map(() => new Set<string>());
  map.forEach((j, i) => {
    if (j < 0) return;
    matched++;
    hit[j] = 1;
    const line = out.lines[outTokens[i].line];
    const w = input[j];
    if (w.start >= line.start - 0.05 && w.end <= line.end + 0.05) timed++;
    if (w.speaker !== undefined) voicesOf[outTokens[i].line].add(w.speaker);
  });
  const fillersDropped = input.filter((t, j) => !hit[j] && FILLERS.has(norm(t.w))).length;
  const needed = input.length - fillersDropped;
  const p = outTokens.length === 0 ? 0 : matched / outTokens.length;
  const r = needed === 0 ? 1 : matched / needed;
  let disorder = 0;
  for (let i = 1; i < out.lines.length; i++) {
    const a = out.lines[i - 1];
    const b = out.lines[i];
    if (b.start < a.start || b.start < a.end - 0.001 || b.end < b.start) disorder++;
  }
  return {
    kept: f1(p, r),
    keptP: p,
    keptR: r,
    extra: outTokens.length - matched,
    dropped: needed - matched,
    timeCover: matched === 0 ? 0 : timed / matched,
    disorder,
    mixedVoices: voicesOf.filter((s) => s.size > 1).length,
  };
}

// A stubbed cleanup reply that moves the last two words of every line onto
// the next: the soundness check must refuse it line by line.
function guardCatches(lines: Line[]): number {
  if (lines.length < 2) return 1;
  let caught = 0;
  let judged = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    const words = lines[i + 1].text.split(" ");
    const moved = `${lines[i].text} ${words.slice(0, 2).join(" ")}`;
    if (tokens(lines[i].text).length < 4) continue;
    judged++;
    if (!lineIsSound(lines[i].text, moved)) caught++;
  }
  return judged === 0 ? 1 : caught / judged;
}

async function scoreEarnings(file: CorpusFile): Promise<Result> {
  const notes: string[] = [];
  const asr = readNlp(readFileSync(fileOf(file.id), "utf8")).filter((t) => t.start !== null && t.end !== null);
  const human = readNlp(readFileSync(referenceOf(file.id), "utf8"));
  const speakerIds = new Map<string, number>();
  const words = asr.map((t) => {
    if (!speakerIds.has(t.speaker)) speakerIds.set(t.speaker, speakerIds.size);
    return { word: t.token.toLowerCase(), punctuated_word: `${t.token}${t.punct}`, start: t.start!, end: t.end!, speaker: speakerIds.get(t.speaker)! };
  });
  // The Deepgram rung's answer without utterances: the words, each with its voice.
  const body = { results: { channels: [{ alternatives: [{ words }] }] } };
  const t0 = performance.now();
  const segments = deepgramSegments(body);
  const parseMs = performance.now() - t0;
  const out = await linesAndParagraphs(segments);
  const input: TimedWord[] = words.map((w) => ({ w: w.punctuated_word, start: w.start, end: w.end, speaker: String(w.speaker) }));
  const k = keptAndTimed(out, input);

  // Paragraph breaks against the human transcript: the ASR word a paragraph
  // starts on, carried to the human transcript's word by alignment.
  const asrStarts = words.map((w) => w.start);
  const breaksAsr = out.paragraphs.slice(1).map((p) => asrStarts.findIndex((s) => s >= p.start - 0.001)).filter((i) => i > 0);
  const toHuman = align(words.map((w) => norm(w.punctuated_word)), human.map((h) => norm(h.token)));
  const carry = (i: number) => {
    for (let x = i; x < toHuman.length; x++) if (toHuman[x] >= 0) return toHuman[x];
    return human.length;
  };
  const turns: number[] = [];
  const sentenceStarts = new Set<number>([0]);
  for (let i = 1; i < human.length; i++) {
    if (human[i].speaker !== human[i - 1].speaker) turns.push(i);
    if (/[.?!]/.test(human[i - 1].punct)) sentenceStarts.add(i);
  }
  const turnHit = new Set<number>();
  let tp = 0;
  let fp = 0;
  const misplaced: number[] = [];
  for (const b of breaksAsr.map(carry)) {
    const turn = turns.find((t) => !turnHit.has(t) && Math.abs(t - b) <= 2);
    if (turn !== undefined) {
      turnHit.add(turn);
      tp++;
    } else if (![b - 1, b, b + 1].some((x) => sentenceStarts.has(x))) {
      fp++;
      misplaced.push(b);
    }
  }
  const paraP = tp + fp === 0 ? 1 : tp / (tp + fp);
  const paraR = turns.length === 0 ? 1 : tp / turns.length;
  const paraF1 = f1(paraP, paraR);
  const context = (i: number) => human.slice(Math.max(0, i - 6), i + 6).map((h, x) => `${x === Math.min(6, i) ? "‖ " : ""}${h.token}${h.punct}`).join(" ");
  for (const b of misplaced.slice(0, 6)) notes.push(`break inside a sentence: ${context(b)}`);
  for (const t of turns.filter((t) => !turnHit.has(t)).slice(0, 6)) notes.push(`speaker change with no break: ${context(t)}`);
  return {
    id: file.id,
    section: "c",
    score: mean([k.kept, k.timeCover, paraF1]),
    metrics: {
      lines: out.lines.length,
      paragraphs: out.paragraphs.length,
      kept: round(k.kept),
      extraWords: k.extra,
      droppedWords: k.dropped,
      timeCover: round(k.timeCover),
      disorder: k.disorder,
      mixedVoices: k.mixedVoices,
      paraF1: round(paraF1),
      paraP: round(paraP),
      paraR: round(paraR),
      turns: turns.length,
      modelBatches: out.modelBatches,
      markupToModel: out.markupToModel,
      guard: round(guardCatches(out.lines)),
    },
    ms: parseMs + out.ms,
    notes,
  };
}

/** A real caption file of section b through its parser and on to the
    stored lines: every spoken word once, in order, and the moment it starts
    inside its line's time. A word's moment is the time the file stamps it
    (YouTube's word times) or else its cue's start: a cue's end overlaps the
    next cue in auto captions, so only the start is the word's. */
async function scoreCaptionLines(file: CorpusFile, raw: string, ref: BRef): Promise<Result | null> {
  const words = (ref as BRef & { words?: [number, string][] }).words;
  const input: TimedWord[] = ref.rolling && words
    ? words.map(([t, w]) => ({ w, start: t, end: t }))
    : ref.cues.flatMap((c) => tokens(c.text).map((w) => ({ w, start: c.start, end: c.start })));
  if (input.length < 20) return null;
  const t0 = performance.now();
  const { segments } = bParse(file, raw);
  const parseMs = performance.now() - t0;
  const out = await linesAndParagraphs(segments);
  const k = keptAndTimed(out, input);
  const notes: string[] = [];
  if (k.extra > 0) notes.push(`${k.extra} words stored that were not spoken (or not once)`);
  if (out.markupToModel > 0) notes.push(`${out.markupToModel} lines reach cleanup with markup in them`);
  return {
    id: `${file.id}:lines`,
    section: "c",
    score: mean([k.kept, k.timeCover]),
    metrics: {
      lines: out.lines.length,
      paragraphs: out.paragraphs.length,
      kept: round(k.kept),
      extraWords: k.extra,
      droppedWords: k.dropped,
      timeCover: round(k.timeCover),
      disorder: k.disorder,
      markupToModel: out.markupToModel,
      guard: round(guardCatches(out.lines)),
    },
    ms: parseMs + out.ms,
    notes,
  };
}

// ── Run ─────────────────────────────────────────────────────────────────────

if (!existsSync(join(MEDIA_ROOT, "files")) || !existsSync(REFS)) {
  console.log("No files yet: run with --fetch first.");
  process.exit(1);
}

const pick = (f: CorpusFile) =>
  (!sectionOnly || f.section === sectionOnly || (sectionOnly === "c" && f.section === "b")) &&
  (!only || only.includes(f.id)) &&
  (!detail || detail === f.id || detail.split(":")[0] === f.id) &&
  existsSync(fileOf(f.id));

const results: Result[] = [];
const missing: string[] = [];
for (const file of corpus.files.filter(pick)) {
  try {
    if (file.section === "a") {
      const refPath = join(REFS, `${file.id}.json`);
      if (!existsSync(refPath)) {
        missing.push(file.id);
        continue;
      }
      const bytes = new Uint8Array(readFileSync(fileOf(file.id)));
      if (!sectionOnly || sectionOnly === "a") results.push(scoreA(file, bytes, JSON.parse(readFileSync(refPath, "utf8")) as ARef));
    } else if (file.section === "b") {
      const raw = readFileSync(fileOf(file.id), "utf8");
      const ref = bReference(file, raw);
      if (!ref) {
        missing.push(file.id);
        continue;
      }
      if (!sectionOnly || sectionOnly === "b") results.push(scoreB(file, raw, ref));
      if ((!sectionOnly || sectionOnly === "c") && !ref.cases && !file.source?.startsWith("wpt")) {
        const lines = await scoreCaptionLines(file, raw, ref);
        if (lines) results.push(lines);
      }
    } else if (file.section === "c") {
      if (!existsSync(referenceOf(file.id))) {
        missing.push(file.id);
        continue;
      }
      results.push(await scoreEarnings(file));
    }
  } catch (err) {
    console.log(`  ${file.id}: the bench failed: ${err instanceof Error ? err.stack : err}`);
    results.push({ id: file.id, section: file.section, score: 0, metrics: { crashed: 1 }, ms: 0, notes: [] });
  }
}
if (!process.env.MEDIA_KEEP_TMP) rmSync(TMP, { recursive: true, force: true });

const shown = detail ? results.filter((r) => r.id === detail || r.id.split(":")[0] === detail) : results;
if (detail) {
  for (const r of shown) {
    console.log(`\n${r.id}  score ${fmt(r.score)}  ${(r.ms).toFixed(1)} ms`);
    console.log(`  ${Object.entries(r.metrics).map(([k, v]) => `${k} ${v}`).join("  ")}`);
    for (const n of r.notes) console.log(`  · ${n}`);
  }
  process.exit(0);
}

const sections = ["a", "b", "c"].filter((s) => results.some((r) => r.section === s));
const sum = (s: string, key: string) => results.filter((r) => r.section === s).reduce((t, r) => t + (r.metrics[key] ?? 0), 0);
const avg = (s: string, key: string) => mean(results.filter((r) => r.section === s && r.metrics[key] !== undefined).map((r) => r.metrics[key]));
const total: Record<string, number> = {};
for (const s of sections) total[s] = round(mean(results.filter((r) => r.section === s).map((r) => r.score)));
total.all = round(mean(sections.map((s) => total[s])));

const LABEL: Record<string, string> = { a: "a. container reading", b: "b. captions", c: "c. lines and paragraphs" };
for (const s of sections) {
  const rs = results.filter((r) => r.section === s);
  console.log(`\n${LABEL[s]}: ${rs.length} files, score ${fmt(total[s])}, ${rs.reduce((t, r) => t + r.ms, 0).toFixed(0)} ms in the code under test`);
  if (s === "a") {
    console.log(`  kind right ${sum("a", "kindOk")}/${rs.length}  MIME right ${sum("a", "mimeOk")}/${rs.length}  split ${fmt(avg("a", "split"))} over ${rs.filter((r) => r.metrics.split !== undefined).length} files: ${sum("a", "chunks")} chunks, ${sum("a", "chunksOffFrame")} off a frame, ${sum("a", "chunksUndecoded")} not decoding whole, ${fmt(sum("a", "lostSeconds"))} s lost, ${sum("a", "splitFailed")} refused`);
  }
  if (s === "b") {
    console.log(`  cue F1 ${fmt(avg("b", "cueF1"))}  word F1 ${fmt(avg("b", "wordF1"))}  word times ${fmt(avg("b", "wordTime"))}  cue text exact ${fmt(avg("b", "textExact"))}  markup kept ${sum("b", "leaks")}  extra words ${sum("b", "extraWords")}  voices kept ${sum("b", "voicesKept")}/${sum("b", "voices")}  refused ${sum("b", "failed")}`);
  }
  if (s === "c") {
    console.log(`  kept once ${fmt(avg("c", "kept"))}  time cover ${fmt(avg("c", "timeCover"))}  paragraph F1 ${fmt(avg("c", "paraF1"))} (P ${fmt(avg("c", "paraP"))} R ${fmt(avg("c", "paraR"))})  extra words ${sum("c", "extraWords")}  dropped ${sum("c", "droppedWords")}  out of order ${sum("c", "disorder")}  mixed voices ${sum("c", "mixedVoices")}`);
    console.log(`  to the cleanup model: ${sum("c", "modelBatches")} batches, ${sum("c", "markupToModel")} lines with markup; stubbed reply moving words between lines refused ${fmt(avg("c", "guard"))}`);
  }
  for (const r of [...rs].sort((x, y) => x.score - y.score).slice(0, worst)) {
    if (r.score >= 0.9995) break;
    console.log(`  ${fmt(r.score)}  ${r.id.padEnd(34)} ${r.notes[0]?.slice(0, 110) ?? ""}`);
  }
}
console.log(`\nTotal ${fmt(total.all)}  (${sections.map((s) => `${s} ${fmt(total[s])}`).join(", ")})  ${results.length} results`);
if (missing.length > 0) console.log(`No reference for: ${missing.join(", ")}`);

const jsonOut = value("--json");
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 1));

type Baseline = { total: Record<string, number>; files: Record<string, number> };
if (flag("--save-baseline")) {
  const prior: Baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { total: {}, files: {} };
  for (const r of results) prior.files[r.id] = round(r.score);
  if (!only && !sectionOnly) prior.total = total;
  writeFileSync(BASELINE, JSON.stringify(prior, null, 1) + "\n");
  console.log(`Saved ${results.length} results to ${BASELINE}`);
}
if (flag("--baseline") && existsSync(BASELINE)) {
  const base: Baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  const drops = results.filter((r) => base.files[r.id] !== undefined && r.score < base.files[r.id] - 0.01);
  const rises = results.filter((r) => base.files[r.id] !== undefined && r.score > base.files[r.id] + 0.01);
  console.log(`\nAgainst the baseline (total ${base.total.all !== undefined ? fmt(base.total.all) : "?"}): ${rises.length} rose, ${drops.length} dropped`);
  for (const r of rises) console.log(`  rose    ${r.id.padEnd(34)} ${fmt(base.files[r.id])} → ${fmt(r.score)}`);
  for (const r of drops) console.log(`  dropped ${r.id.padEnd(34)} ${fmt(base.files[r.id])} → ${fmt(r.score)}`);
  if (drops.length > 0) process.exitCode = 1;
}


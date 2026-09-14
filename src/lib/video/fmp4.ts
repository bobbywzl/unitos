// A fragmented MP4 audio stream cut at its own segment boundaries
// (SPEC.md §11). YouTube's DASH audio streams (audio/mp4, AAC) are one init
// segment (ftyp + moov), one sidx box that indexes every media segment (its
// byte size and its duration), then the media segments (moof + mdat) in
// order. Init plus any run of whole media segments is a valid fragmented
// MP4 on its own, so a stream past the Whisper cap splits into under-cap
// chunks that each decode cleanly, the way an MP3 splits at frame
// boundaries (lib/video/mp3.ts). Each chunk transcribes on its own clock and
// its start time shifts the segments back onto the stream's.

import type { Mp3Chunk } from "@/lib/video/mp3";

export type ByteRange = { start: number; end: number }; // inclusive, as YouTube reports them

type Segment = { offset: number; size: number; seconds: number };

function u32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}
function u64(bytes: Uint8Array, at: number): number {
  return u32(bytes, at) * 4294967296 + u32(bytes, at + 4);
}
function box(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
}

/** The media segments the sidx box at `index` describes: byte offset, size,
    and duration in seconds. Null when the bytes carry no readable sidx. */
export function readSidx(bytes: Uint8Array, index: ByteRange): Segment[] | null {
  const at = index.start;
  if (at + 32 > bytes.length || box(bytes, at) !== "sidx") return null;
  const version = bytes[at + 8];
  let p = at + 12;
  p += 4; // reference_ID
  const timescale = u32(bytes, p);
  p += 4;
  let firstOffset: number;
  if (version === 0) {
    p += 4; // earliest_presentation_time
    firstOffset = u32(bytes, p);
    p += 4;
  } else {
    p += 8;
    firstOffset = u64(bytes, p);
    p += 8;
  }
  p += 2; // reserved
  const count = (bytes[p] << 8) | bytes[p + 1];
  p += 2;
  if (timescale === 0 || count === 0 || p + count * 12 > bytes.length) return null;
  const segments: Segment[] = [];
  let offset = index.end + 1 + firstOffset;
  for (let i = 0; i < count; i++) {
    const sizeField = u32(bytes, p);
    const referenceType = sizeField >>> 31;
    const size = sizeField & 0x7fffffff;
    const seconds = u32(bytes, p + 4) / timescale;
    p += 12;
    if (referenceType === 1) return null; // an index of indexes; not YouTube's shape
    if (size === 0 || offset + size > bytes.length) return null;
    segments.push({ offset, size, seconds });
    offset += size;
  }
  return segments;
}

/** The stream split into chunks under `maxChunkBytes`, each the init segment
    plus a run of whole media segments, with the time its first segment
    starts at. Null when the stream is not indexed the way YouTube's are, or
    one segment alone is over the cap. */
export function splitFmp4(
  bytes: Uint8Array,
  ranges: { init: ByteRange; index: ByteRange },
  maxChunkBytes: number,
): Mp3Chunk[] | null {
  if (ranges.init.start !== 0 || ranges.init.end + 1 !== ranges.index.start) return null;
  const segments = readSidx(bytes, ranges.index);
  if (!segments) return null;
  const init = bytes.subarray(ranges.init.start, ranges.init.end + 1);
  if (init.length >= maxChunkBytes) return null;

  const chunks: Mp3Chunk[] = [];
  let run: Segment[] = [];
  let runBytes = 0;
  let runStart = 0;
  let clock = 0;
  const flush = () => {
    if (run.length === 0) return;
    const out = new Uint8Array(init.length + runBytes);
    out.set(init, 0);
    let at = init.length;
    for (const s of run) {
      out.set(bytes.subarray(s.offset, s.offset + s.size), at);
      at += s.size;
    }
    chunks.push({ bytes: out, startTime: runStart });
    run = [];
    runBytes = 0;
  };
  for (const s of segments) {
    if (init.length + s.size > maxChunkBytes) return null;
    if (run.length > 0 && init.length + runBytes + s.size > maxChunkBytes) flush();
    if (run.length === 0) runStart = clock;
    run.push(s);
    runBytes += s.size;
    clock += s.seconds;
  }
  flush();
  return chunks.length > 0 ? chunks : null;
}

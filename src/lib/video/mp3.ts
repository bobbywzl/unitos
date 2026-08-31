// MP3 frame parsing for chunked transcription (SPEC.md §11). Whisper-family
// providers cap an upload at 25 MB, so a long MP3 splits at frame boundaries
// into chunks under the cap; each chunk carries its start time on the audio's
// clock, and the chunk transcripts shift back onto it. MP3 frames are
// self-contained, so a chunk that starts on a frame boundary decodes cleanly.

export type Mp3Chunk = { bytes: Uint8Array; startTime: number };

// kbps by [version][layer][bitrateIndex]; index 0 and 15 are invalid.
// version: 0 = MPEG1, 1 = MPEG2/2.5. layer: 0 = I, 1 = II, 2 = III.
const BITRATES: number[][][] = [
  [
    [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  ],
  [
    [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  ],
];

// Hz by [versionBits][sampleRateIndex]. versionBits: 0 = MPEG2.5, 2 = MPEG2, 3 = MPEG1.
const SAMPLE_RATES: Record<number, number[]> = {
  0: [11025, 12000, 8000],
  2: [22050, 24000, 16000],
  3: [44100, 48000, 32000],
};

type FrameHeader = { length: number; seconds: number };

// One frame header at `at`, or null when the bytes there are not a frame.
function parseFrame(bytes: Uint8Array, at: number): FrameHeader | null {
  if (at + 4 > bytes.length) return null;
  const b1 = bytes[at];
  const b2 = bytes[at + 1];
  if (b1 !== 0xff || (b2 & 0xe0) !== 0xe0) return null;
  const versionBits = (b2 >> 3) & 0x03; // 0 = 2.5, 1 = reserved, 2 = 2, 3 = 1
  const layerBits = (b2 >> 1) & 0x03; // 0 = reserved, 1 = III, 2 = II, 3 = I
  if (versionBits === 1 || layerBits === 0) return null;
  const b3 = bytes[at + 2];
  const bitrateIndex = (b3 >> 4) & 0x0f;
  const sampleRateIndex = (b3 >> 2) & 0x03;
  if (bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return null;
  const padding = (b3 >> 1) & 0x01;

  const mpeg1 = versionBits === 3;
  const layer = 4 - layerBits; // 1, 2, or 3
  const bitrate = BITRATES[mpeg1 ? 0 : 1][layer - 1][bitrateIndex] * 1000;
  const sampleRate = SAMPLE_RATES[versionBits][sampleRateIndex];
  const samples = layer === 1 ? 384 : layer === 3 && !mpeg1 ? 576 : 1152;
  const length =
    layer === 1
      ? (Math.floor((12 * bitrate) / sampleRate) + padding) * 4
      : Math.floor(((samples / 8) * bitrate) / sampleRate) + padding;
  if (length < 4) return null;
  return { length, seconds: samples / sampleRate };
}

// The audio start: past the ID3v2 tag when one leads the file.
function audioStart(bytes: Uint8Array): number {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
  const size =
    ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
  return Math.min(bytes.length, 10 + size);
}

// A stray byte pattern can read as a frame header; garbage past this much in
// one stretch means the file is not a parseable MP3.
const MAX_GARBAGE_RUN = 64 * 1024;

/** Split an MP3 at frame boundaries into chunks of at most maxChunkBytes,
    each tagged with its start time. Null when the bytes do not parse as MP3
    frames — the caller falls back to its uncut path. */
export function splitMp3(bytes: Uint8Array, maxChunkBytes: number): Mp3Chunk[] | null {
  const chunks: Mp3Chunk[] = [];
  let at = audioStart(bytes);
  let chunkStart = at;
  let chunkTime = 0;
  let time = 0;
  let garbage = 0;
  let frames = 0;

  while (at < bytes.length) {
    const frame = parseFrame(bytes, at);
    if (!frame) {
      // Resync: scan forward for the next frame. The tail of a file is often
      // an ID3v1 tag or padding; a long garbage run mid-file means not-MP3.
      garbage += 1;
      if (garbage > MAX_GARBAGE_RUN) return null;
      at += 1;
      continue;
    }
    if (at + frame.length > bytes.length) break; // truncated final frame
    garbage = 0;
    if (at + frame.length - chunkStart > maxChunkBytes) {
      if (at === chunkStart) return null; // one frame larger than the budget
      chunks.push({ bytes: bytes.subarray(chunkStart, at), startTime: chunkTime });
      chunkStart = at;
      chunkTime = time;
    }
    time += frame.seconds;
    at += frame.length;
    frames += 1;
  }

  if (frames < 16) return null; // a real MP3 has thousands of frames
  if (at > chunkStart) chunks.push({ bytes: bytes.subarray(chunkStart, at), startTime: chunkTime });
  return chunks.length > 0 ? chunks : null;
}

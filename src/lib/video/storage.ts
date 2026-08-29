import { db } from "@/lib/db";

// Server-side video and audio storage (SPEC.md §11): bytes live in VideoChunk
// rows of one uniform chunkSize (the upload staging slice size), so a byte
// range maps straight to chunk indices and streams without assembling the file
// in memory.

// Sniff the container by magic bytes — video and audio alike. The client's
// MIME type is never trusted. An audio/* result makes the document an audio
// document: same storage, same transcript machinery, audio player.
export function sniffMedia(bytes: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (brand.startsWith("qt")) return "video/quicktime";
    // M4A/M4B brands mark an audio-only MPEG-4 container.
    if (brand.startsWith("M4A") || brand.startsWith("M4B")) return "audio/mp4";
    return "video/mp4";
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return "video/webm";
  }
  if (bytes.length >= 4 && ascii(0, 4) === "OggS") {
    // The first Ogg page names the codec: Theora is video; Vorbis, Opus, and
    // FLAC are audio. An unrecognized codec keeps the old video answer.
    const head = ascii(0, Math.min(bytes.length, 512));
    if (head.includes("theora")) return "video/ogg";
    if (head.includes("vorbis") || head.includes("OpusHead") || head.includes("FLAC")) {
      return "audio/ogg";
    }
    return "video/ogg";
  }
  if (bytes.length >= 3 && ascii(0, 3) === "ID3") return "audio/mpeg";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    // MPEG audio frame sync. Layer bits 00 mean ADTS AAC; anything else is MP3.
    return ((bytes[1] >> 1) & 0x03) === 0 ? "audio/aac" : "audio/mpeg";
  }
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  if (bytes.length >= 4 && ascii(0, 4) === "fLaC") return "audio/flac";
  return null;
}

export type ByteRange =
  | { kind: "full" }
  | { kind: "range"; start: number; end: number }
  | { kind: "invalid" };

// Parse a Range header against the asset size: bytes=a-b, bytes=a-, bytes=-n.
export function parseByteRange(header: string | null, size: number): ByteRange {
  if (!header) return { kind: "full" };
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (match[1] === "" && match[2] === "")) return { kind: "invalid" };
  let start: number;
  let end: number;
  if (match[1] === "") {
    // bytes=-n: the final n bytes.
    const suffix = Number(match[2]);
    if (suffix === 0) return { kind: "invalid" };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start >= size || end < start) return { kind: "invalid" };
  return { kind: "range", start, end };
}

// Stream bytes [start, end] (inclusive) of a video, one stored chunk per pull.
export function videoByteStream(
  videoId: string,
  chunkSize: number,
  start: number,
  end: number,
): ReadableStream<Uint8Array> {
  let index = Math.floor(start / chunkSize);
  let offset = start - index * chunkSize;
  let remaining = end - start + 1;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (remaining <= 0) {
        controller.close();
        return;
      }
      const chunk = await db.videoChunk.findUnique({
        where: { videoId_index: { videoId, index } },
        select: { data: true },
      });
      const slice = chunk?.data.subarray(offset, Math.min(chunk.data.length, offset + remaining));
      if (!slice || slice.length === 0) {
        controller.error(new Error(`Video chunk ${index} is missing`));
        return;
      }
      controller.enqueue(slice);
      remaining -= slice.length;
      offset = 0;
      index += 1;
      if (remaining <= 0) controller.close();
    },
  });
}

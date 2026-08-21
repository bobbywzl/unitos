import { z } from "zod";

// ── Video (SPEC.md §11) ─────────────────────────────────────────────────────
// Shared shapes for video documents: the drawn region, the time anchor, the
// annotation as the player and deck render it, and the Find result.

// Videos cap at 200 MB. Upload staging slices are the stored chunk size too, so
// completing a video upload copies staged rows to VideoChunk rows without ever
// assembling the file in memory.
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
export const UPLOAD_CHUNK_BYTES = 3_500_000;

// A drawn region on the video frame, in percent coordinates (0–100) of the
// frame — never pixels — so it stays glued to the same spot at any player size.
// The draw tool makes a freehand closed loop (kind "path"); kind "ellipse"
// stays valid for annotations drawn before the loop tool.
export const regionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ellipse"),
    cx: z.number().min(0).max(100),
    cy: z.number().min(0).max(100),
    rx: z.number().min(0.5).max(60),
    ry: z.number().min(0.5).max(60),
  }),
  z.object({
    kind: z.literal("path"),
    points: z
      .array(z.tuple([z.number().min(0).max(100), z.number().min(0).max(100)]))
      .min(3)
      .max(400),
  }),
]);
export type Region = z.infer<typeof regionSchema>;

export function parseRegion(value: unknown): Region | null {
  const parsed = regionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The region's bounding box in percent coordinates, for frame cropping and
    card placement. */
export function regionBounds(region: Region): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} {
  if (region.kind === "ellipse") {
    return {
      x1: region.cx - region.rx,
      y1: region.cy - region.ry,
      x2: region.cx + region.rx,
      y2: region.cy + region.ry,
    };
  }
  const xs = region.points.map(([x]) => x);
  const ys = region.points.map(([, y]) => y);
  return {
    x1: Math.min(...xs),
    y1: Math.min(...ys),
    x2: Math.max(...xs),
    y2: Math.max(...ys),
  };
}

/** A closed SVG path for a loop's points, in the overlay's percent space. */
export function regionPathD(points: [number, number][]): string {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ") + " Z";
}

// The time range of a video anchor. endTime is always after startTime.
export const timeRangeSchema = z
  .object({
    startTime: z.number().min(0),
    endTime: z.number().min(0),
  })
  .refine((r) => r.endTime > r.startTime, { message: "endTime must be after startTime" });

/** One annotation on the video: a note in the hidden Annotations section whose
    source carries a time range and an optional region. The overlay shows it
    while playback is inside its range; the deck lists it as a card. */
export type VideoAnnotationItem = {
  noteId: string;
  sourceId: string;
  kind: "comment" | "explain";
  content: string;
  startTime: number;
  endTime: number;
  region: Region | null;
};

export type TranscriptStatusName = "NONE" | "PENDING" | "READY" | "FAILED";

/** What the video pane needs to know about the video. kind UPLOAD streams
    from /api/video/[documentId]; kind YOUTUBE plays through the IFrame player. */
export type VideoInfo = {
  kind: "UPLOAD" | "YOUTUBE";
  youtubeId: string | null;
  mimeType: string | null;
  size: number | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  transcriptStatus: TranscriptStatusName;
  transcriptError: string | null;
  transcriptStale: boolean; // PENDING but the run is dead; Transcribe may start again
};

// A PENDING older than this is a dead run: the transcribe function timed out
// or crashed before writing FAILED. The route lets it start again; the pane
// shows Transcribe again instead of a spinner.
export const TRANSCRIBE_STALE_MS = 10 * 60 * 1000;

export function transcriptIsStale(
  status: TranscriptStatusName,
  startedAt: Date | null,
): boolean {
  return (
    status === "PENDING" &&
    (startedAt === null || Date.now() - startedAt.getTime() > TRANSCRIBE_STALE_MS)
  );
}

/** One transcript line: a TRANSCRIPT block with its time range. */
export type TranscriptLine = {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
};

/** One FIND match, resolved server-side from the model's block ids. */
export type VideoFindMatch = {
  startTime: number;
  endTime: number;
  explanation: string;
  quotedText: string;
  blockIds: string[];
};

// 0:07 under a minute, 1:32 under an hour, 1:02:05 over. Used everywhere a
// time renders: transcript, chips, deck cards, the scrubber clock.
export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatTimeRange(startTime: number, endTime: number): string {
  return `${formatTime(startTime)}–${formatTime(endTime)}`;
}

// Inverse of formatTime for the composer's time inputs: "92", "1:32", "1:02:05".
export function parseTimeInput(value: string): number | null {
  const parts = value.trim().split(":");
  if (parts.length === 0 || parts.length > 3) return null;
  if (parts.some((p) => p === "" || !/^\d+(\.\d+)?$/.test(p))) return null;
  return parts.map(Number).reduce((total, n) => total * 60 + n, 0);
}

import { z } from "zod";

// ── Video (SPEC.md §11) ─────────────────────────────────────────────────────
// Shared shapes for video documents: the drawn region, the time anchor, the
// annotation as the player and deck render it, and the Find result.

// A drawn region on the video frame, in percent coordinates (0–100) of the
// frame — never pixels — so it stays glued to the same spot at any player size.
export const regionSchema = z.object({
  kind: z.literal("ellipse"),
  cx: z.number().min(0).max(100),
  cy: z.number().min(0).max(100),
  rx: z.number().min(0.5).max(60),
  ry: z.number().min(0.5).max(60),
});
export type Region = z.infer<typeof regionSchema>;

export function parseRegion(value: unknown): Region | null {
  const parsed = regionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
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

/** What the video pane needs to know about the stored video. */
export type VideoInfo = {
  mimeType: string;
  size: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  transcriptStatus: TranscriptStatusName;
  transcriptError: string | null;
};

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

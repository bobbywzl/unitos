import type { SummaryDepth } from "@/lib/types";

// Context passed to every prompt template. Templates are one file per DerivationType,
// each exporting a single function (ctx) => string (CLAUDE.md).
// The reader's context comes from the Context tab: stored as ReaderProfile globally,
// as notebook.profile when a work overrides it. Any field may be empty.
export type ReaderProfileCtx = {
  background: string;
  purpose: string;
  application: string;
} | null;

export type PromptCtx = {
  profile: ReaderProfileCtx;
  documentTitle: string;
  // Anchored selection with surrounding context (±2 blocks), for selection-level derivations.
  anchoredText: string;
  contextBefore: string;
  contextAfter: string;
  // Section skeleton of the notebook, for EXTRACT.
  sectionSkeleton: { id: string; title: string; parentTitle: string | null }[];
  // Summary depth, for SUMMARIZE.
  depth?: SummaryDepth;
  // Set when EXPLAIN targets a figure block: the model deciphers the visual.
  // kind image: the image is attached to the message. kind svg: the chart's SVG
  // source is in svgSource. kind video: the model only has caption and context.
  figure?: { kind: "image" | "svg" | "video" | "figure"; caption: string; svgSource?: string };
  // Set when EXPLAIN targets a moment of a video document (SPEC.md §11).
  // hasFrame: the paused frame is attached to the message; hasRegion: the
  // reader circled a spot and the frame is cropped toward it.
  // frameDescription: a vision model watched the clip (YouTube: the frame
  // cannot attach) and this is what is on screen.
  video?: {
    timeRange: string; // "0:12–0:31"
    transcriptExcerpt: string; // transcript at that range; "" = none
    hasFrame: boolean;
    hasRegion: boolean;
    frameDescription?: string;
  };
  // The search, for FIND.
  query?: string;
};

export function profileLines(profile: ReaderProfileCtx): string {
  const fields = profile
    ? (
        [
          ["Background", profile.background],
          ["Purpose", profile.purpose],
          ["Application", profile.application],
        ] as const
      ).filter(([, value]) => value.trim() !== "")
    : [];
  if (fields.length === 0) {
    return "Reader context: not set. Assume a technically literate generalist.";
  }
  return ["Reader context:", ...fields.map(([label, value]) => `- ${label}: ${value}`)].join("\n");
}

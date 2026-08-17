import type { SummaryDepth } from "@/lib/types";

// Context passed to every prompt template. Templates are one file per DerivationType,
// each exporting a single function (ctx) => string (CLAUDE.md).
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
};

export function profileLines(profile: ReaderProfileCtx): string {
  if (!profile) return "Reader profile: not set. Assume a technically literate generalist.";
  return [
    "Reader profile:",
    `- Background: ${profile.background}`,
    `- Purpose: ${profile.purpose}`,
    `- Application: ${profile.application}`,
  ].join("\n");
}

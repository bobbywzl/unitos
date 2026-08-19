import type { DerivationType } from "@prisma/client";

// Model per derivation type (SPEC.md §2). One place to change.
export const DERIVATION_MODEL: Record<DerivationType, string> = {
  EXPLAIN: "claude-sonnet-4-6",
  SIMPLIFY: "claude-sonnet-4-6",
  SALIENCE: "claude-sonnet-4-6",
  EXTRACT: "claude-sonnet-4-6",
  SUMMARIZE: "claude-sonnet-4-6",
  SYNTHESIS: "claude-sonnet-4-6",
};

export const MAX_OUTPUT_TOKENS: Record<DerivationType, number> = {
  EXPLAIN: 1024,
  SIMPLIFY: 1024,
  SALIENCE: 4096,
  EXTRACT: 2048,
  SUMMARIZE: 2048,
  SYNTHESIS: 8192,
};

export const ANNOTATIONS_SECTION_TITLE = "Annotations";

// A streaming derivation commits HTTP 200 the moment the stream opens, so a
// failure after that reports in-band: the stream ends with this token and the
// reason. The client splits it off and shows the reason, never a silent stall.
export const STREAM_ERROR_TOKEN = "\u0000error\u0000";

export function splitStreamError(text: string): { text: string; error: string | null } {
  const at = text.indexOf(STREAM_ERROR_TOKEN);
  if (at === -1) return { text, error: null };
  return {
    text: text.slice(0, at),
    error: text.slice(at + STREAM_ERROR_TOKEN.length) || "The model call failed.",
  };
}

// EXPLAIN and SIMPLIFY persist their annotation before the stream closes, then
// the stream ends with this token + the note id. The client splits it off, so
// the card can delete its annotation and a refresh always finds the stored mark.
export const STREAM_NOTE_TOKEN = "\u0000note\u0000";

export function splitStreamNote(text: string): { text: string; noteId: string | null } {
  const at = text.indexOf(STREAM_NOTE_TOKEN);
  if (at === -1) return { text, noteId: null };
  return {
    text: text.slice(0, at),
    noteId: text.slice(at + STREAM_NOTE_TOKEN.length) || null,
  };
}

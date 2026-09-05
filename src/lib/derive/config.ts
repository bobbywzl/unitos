import type { DerivationType } from "@prisma/client";
import { isLang, LANG_COOKIE } from "@/lib/i18n/config";
import { translate } from "@/lib/i18n/dictionaries";

// Model per derivation type (SPEC.md §2). One place to change.
export const DERIVATION_MODEL: Record<DerivationType, string> = {
  EXPLAIN: "claude-opus-5",
  SIMPLIFY: "claude-opus-5",
  SALIENCE: "claude-opus-5",
  EXTRACT: "claude-opus-5",
  SUMMARIZE: "claude-opus-5",
  SYNTHESIS: "claude-opus-5",
  FIND: "claude-opus-5",
  DISTILL: "claude-opus-5",
  FORMALIZE: "claude-opus-5",
  ASK: "claude-opus-5",
  COMPARE: "claude-opus-5",
  // A figure or table is read by the model that reads visuals best with the
  // least invention: the most capable model, the one upload and parse already
  // trust (PARSE_MODEL). A misread number is worse than a slow answer.
  ANALYZE: "claude-fable-5-1",
  VOICE: "claude-opus-5", // no model call of its own: the transcription ladder does the work
};

// Reasoning tokens count against this ceiling on current models, so every
// budget leaves room for the model to think before it writes. Too tight a
// ceiling truncates a JSON derivation mid-object and fails validation.
export const MAX_OUTPUT_TOKENS: Record<DerivationType, number> = {
  EXPLAIN: 4096,
  SIMPLIFY: 4096,
  SALIENCE: 8192,
  EXTRACT: 8192,
  SUMMARIZE: 8192,
  SYNTHESIS: 16384,
  FIND: 8192,
  DISTILL: 8192,
  FORMALIZE: 32768, // a long transcript's article is long
  ASK: 4096,
  COMPARE: 16384, // two documents' points, each with its spans
  ANALYZE: 4096, // three short sections, like an explanation
  VOICE: 0,
};

// The ingest-time corpus scan for recommended links (SPEC.md §13). Not a
// DerivationType — it runs as a background job, not through /api/derive.
export const CONNECT_MODEL = "claude-opus-5";

// Upload and parse run on the most capable model: what the parse gets wrong,
// every later tool inherits. One constant for the upload assistant's review
// and instruction check (SPEC.md §15), the URL core and structure passes
// (SPEC.md §2), Import PDF's judgment, and conversion (SPEC.md §16).
export const PARSE_MODEL = "claude-fable-5-1";

// The upload assistant's review and instruction check (SPEC.md §15). Not a
// DerivationType — it runs before ingest, not through /api/derive.
export const UPLOAD_MODEL = PARSE_MODEL;

// Handwritten documents (SPEC.md §16). Not DerivationTypes: classification
// runs inside Import PDF, conversion as a background job.
export const CLASSIFY_MODEL = PARSE_MODEL;
export const CONVERT_MODEL = PARSE_MODEL;

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
    error: text.slice(at + STREAM_ERROR_TOKEN.length) || modelCallFailed(),
  };
}

// The token with no reason falls back to a translated line. Only the client
// splits streams, so the language comes from the cookie, same as lib/api.ts.
function modelCallFailed(): string {
  if (typeof document === "undefined") return translate("en", "common.modelCallFailed");
  const value = document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]+)`))?.[1];
  return translate(isLang(value) ? value : "en", "common.modelCallFailed");
}

// EXPLAIN, SIMPLIFY, and ANALYZE persist their annotation before the stream
// closes, then the stream ends with this token + the note id. The client splits it off, so
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

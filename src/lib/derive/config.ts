import type { DerivationType } from "@prisma/client";
import { isLang, LANG_COOKIE } from "@/lib/i18n/config";
import { translate } from "@/lib/i18n/dictionaries";

// The one model (SPEC.md §2): Kimi K3, Moonshot AI's flagship, behind every AI
// feature. The client lives in lib/kimi.ts, not here: client components import
// this file.
export const KIMI_K3 = "kimi-k3";

// Reasoning effort per call. Kimi K3 always reasons; "max" is its default and
// its slowest. The reader's tools answer at "high"; ANALYZE reads a figure or
// table at "max": a misread number is worse than a slow answer.
export type KimiEffort = "low" | "high" | "max";
export const DEFAULT_EFFORT: KimiEffort = "high";

// Model per derivation type (SPEC.md §2). One place to change.
export const DERIVATION_MODEL: Record<DerivationType, string> = {
  EXPLAIN: KIMI_K3,
  SIMPLIFY: KIMI_K3,
  SALIENCE: KIMI_K3,
  EXTRACT: KIMI_K3,
  SUMMARIZE: KIMI_K3,
  SYNTHESIS: KIMI_K3,
  FIND: KIMI_K3,
  DISTILL: KIMI_K3,
  FORMALIZE: KIMI_K3,
  ASK: KIMI_K3,
  COMPARE: KIMI_K3,
  ANALYZE: KIMI_K3,
  VOICE: KIMI_K3, // no model call of its own: the transcription ladder does the work
};

export const DERIVATION_EFFORT: Record<DerivationType, KimiEffort> = {
  EXPLAIN: DEFAULT_EFFORT,
  SIMPLIFY: DEFAULT_EFFORT,
  SALIENCE: DEFAULT_EFFORT,
  EXTRACT: DEFAULT_EFFORT,
  SUMMARIZE: DEFAULT_EFFORT,
  SYNTHESIS: DEFAULT_EFFORT,
  FIND: DEFAULT_EFFORT,
  DISTILL: DEFAULT_EFFORT,
  FORMALIZE: DEFAULT_EFFORT,
  ASK: DEFAULT_EFFORT,
  COMPARE: DEFAULT_EFFORT,
  ANALYZE: "max",
  VOICE: DEFAULT_EFFORT,
};

// Kimi K3 counts its reasoning tokens against this ceiling too (Moonshot asks
// for 16000 or more), so every budget leaves room for the model to think
// before it writes. Too tight a ceiling truncates a JSON derivation mid-object
// and fails validation.
export const MAX_OUTPUT_TOKENS: Record<DerivationType, number> = {
  EXPLAIN: 16384,
  SIMPLIFY: 16384,
  SALIENCE: 24576,
  EXTRACT: 24576,
  SUMMARIZE: 24576,
  SYNTHESIS: 32768,
  FIND: 24576,
  DISTILL: 24576,
  FORMALIZE: 65536, // a long transcript's article is long
  ASK: 16384,
  COMPARE: 32768, // two documents' points, each with its spans
  ANALYZE: 32768, // a table's rows come back as data
  VOICE: 0,
};

// The ingest-time corpus scan for recommended links (SPEC.md §13). Not a
// DerivationType — it runs as a background job, not through /api/derive.
export const CONNECT_MODEL = KIMI_K3;

// Upload and parse run on the same model as every other tool: what the parse
// gets wrong, every later tool inherits. One constant for the upload
// assistant's review and instruction check (SPEC.md §15), the URL core and
// structure passes (SPEC.md §2), Import PDF's judgment, and conversion
// (SPEC.md §16).
export const PARSE_MODEL = KIMI_K3;

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

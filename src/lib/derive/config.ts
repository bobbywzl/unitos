import type { DerivationType } from "@prisma/client";
import { isLang, LANG_COOKIE } from "@/lib/i18n/config";
import { translate } from "@/lib/i18n/dictionaries";

// Two models (SPEC.md §2). Kimi K3, Moonshot AI's flagship, is behind every AI
// feature but the handwritten passes and Visualize, which run on Claude
// Opus 5 (HANDWRITTEN_MODEL and VISUALIZE_MODEL below). The clients live in
// lib/kimi.ts and lib/claude.ts, not here: client components import this
// file.
export const KIMI_K3 = "kimi-k3";
export const CLAUDE_FABLE_5_1 = "claude-fable-5-1";
export const CLAUDE_OPUS_5 = "claude-opus-5";
// Gemini's flash model reads video (SPEC.md §11): transcription and clip
// descriptions. The client is lib/video/gemini.ts.
export const GEMINI_FLASH = "gemini-3.7-flash";

// The three constants above are the roles' defaults. The bimonthly model
// update (lib/models.ts, /api/cron/models) moves each role to the newest
// version of its family as the provider's model list publishes it; the
// clients (lib/kimi.ts, lib/claude.ts, lib/video/gemini.ts) resolve a
// default id to the role's current id on every call. A constant that is not
// a role default (an alias rung like gemini-flash-latest) is called as is.

// Reasoning effort per call. Kimi K3 always reasons; "max" is its default and
// its slowest. The reader's tools answer at "high"; ANALYZE reads a figure or
// table at "max": a misread number is worse than a slow answer. KEYPOINTS
// (the reader's Distill) reads the whole document at "low", the one tool that
// does: a distillation is careful bullet pointing of what the document says,
// not a problem to reason through. Kimi counts its reasoning against the
// output budget, and the budget is the clock — a call free to think for tens
// of thousands of tokens takes minutes and outlives the request that made it.
// At "max" a long document spent the budget thinking and the run failed with
// no points; at "high" with a budget large enough to cover the thinking, the
// run outran the request instead and the reader got nothing back at all.
// Thinking short is what makes Distill answer.
export type KimiEffort = "low" | "high" | "max";
export const DEFAULT_EFFORT: KimiEffort = "high";

// Reasoning effort per Claude call. Claude Fable 5.1 always reasons; "max" is
// its slowest and its most thorough.
export type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";

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
  KEYPOINTS: KIMI_K3,
  FORMALIZE: KIMI_K3,
  ASK: KIMI_K3,
  COMPARE: KIMI_K3,
  ANALYZE: KIMI_K3,
  VOICE: KIMI_K3, // no model call of its own: the transcription ladder does the work
  VISUALIZE: CLAUDE_OPUS_5, // the strongest model at drawing: the picture has to be faithful or refused (SPEC.md §20)
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
  KEYPOINTS: "low",
  FORMALIZE: DEFAULT_EFFORT,
  ASK: DEFAULT_EFFORT,
  COMPARE: DEFAULT_EFFORT,
  ANALYZE: "max",
  VOICE: DEFAULT_EFFORT,
  VISUALIZE: "max", // not a Kimi call: VISUALIZE_EFFORT below is the effort used
};

// VISUALIZE (SPEC.md §20, Unitos Ultra) runs on Claude Opus 5 at its highest
// reasoning effort: the model first judges whether a picture can carry the
// passage's core idea with certainty, and draws only then. Opus 5 leads the
// board for vector graphics written as code, which is what a visualization
// is, and costs half of Claude Fable 5.1 for the same drawing.
export const VISUALIZE_MODEL = CLAUDE_OPUS_5;
export const VISUALIZE_EFFORT: ClaudeEffort = "max";

// The check (SPEC.md §20): a second call on the same model and effort, after
// the picture is drawn and laid out. It is the one pass that sees the
// finished picture — the pass that drew it never does — so it catches what
// only the result shows: a diagram that reads as a strip, a drawing the
// reduction cut into, a caption that says more than the picture does. It
// keeps the picture, replaces it, or withdraws it. One place to turn off.
export const VISUALIZE_CHECK = true;
// Past this a picture or an animation is kept as drawn: reading back an SVG
// this large costs more than the check is worth, and one that big is rare. A
// simulation is checked on its spec whatever its size — its frames are the
// server's.
export const VISUALIZE_CHECK_MAX_SVG = 40_000;

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
  KEYPOINTS: 32768, // a long document's points, with room for the short reasoning before them
  FORMALIZE: 65536, // a long transcript's article is long
  ASK: 16384,
  COMPARE: 32768, // two documents' points, each with its spans
  ANALYZE: 32768, // three short sections, read at "max" effort: room for the reasoning
  VOICE: 0,
  VISUALIZE: 32768, // the judgment, then a diagram spec or an SVG; an animation's SVG is long
};

// The ingest-time corpus scan for recommended links (SPEC.md §13). Not a
// DerivationType — it runs as a background job, not through /api/derive. Two
// passes, the scan and the check, both at the reader's effort: the scan
// reads the whole project, and "max" over that much text outruns the request.
export const CONNECT_MODEL = KIMI_K3;
export const CONNECT_EFFORT: KimiEffort = DEFAULT_EFFORT;

// Stitch (SPEC.md §22): the assistant over the project's documents, from the
// graph. The documents are read through their skeletons (SKELETON_* below):
// a select pass reads every skeleton and names the blocks the command needs
// — ids only, at "low": a reading, the same as KEYPOINTS. Past
// STITCH_SKELETON_BUDGET of skeleton text a route pass at "low" reads the
// gists and part summaries first and names the parts, and the select pass
// reads only those parts' lines, ranked against the command when they
// still run past the budget (lib/graph/rank.ts). The answer pass reads the
// selected blocks' real text at the reader's effort and answers with links,
// a generated document, or both. Documents under STITCH_WHOLE_THRESHOLD
// together skip every pass but the answer: the answer pass reads them
// whole. Not a DerivationType — it runs through
// /api/notebooks/[notebookId]/stitch.
export const STITCH_MODEL = KIMI_K3;
export const STITCH_ROUTE_EFFORT: KimiEffort = "low";
export const STITCH_SELECT_EFFORT: KimiEffort = "low";
export const STITCH_SELECT_MAX_OUTPUT_TOKENS = 16384; // a list of ids, with the short reasoning before it
export const STITCH_EFFORT: KimiEffort = "high";
export const STITCH_MAX_OUTPUT_TOKENS = 32768; // a page of whole-block references and the model's own writing
export const STITCH_WHOLE_THRESHOLD = 120_000; // chars of document text; under it the answer pass reads the documents whole
export const STITCH_SKELETON_BUDGET = 200_000; // chars of skeleton text one select call reads; past it the route pass runs first
export const STITCH_SELECTED_BUDGET = 200_000; // chars of real block text the answer pass reads
// The model passes together get this long; the route's limit (300 s) keeps
// the rest for storing the answer. Past it the run stops and the reader is
// told to narrow the command instead of reading a stream that ended empty.
export const STITCH_DEADLINE_MS = 270_000;

// The skeleton of a document (SPEC.md §22): the document collapsed for
// Stitch — a gist, one summary per part of the contents, one line per
// block that keeps every claim and number and drops the wording. Built in
// the background after an add (lib/graph/skeleton.ts), one call per window
// of SKELETON_WINDOW_CHARS at "low": a reading, like KEYPOINTS, and the
// lines are copied more than composed. The same model as Stitch; a cheaper
// model would do (the pass is a reading, not reasoning) and is one constant
// away once a second client is wired for it. Rebuilt when more than
// SKELETON_STALE_FRACTION of the document's text has changed since; under
// that the changed blocks read as their own first words, no model call.
export const SKELETON_MODEL = KIMI_K3;
export const SKELETON_EFFORT: KimiEffort = "low";
export const SKELETON_MAX_OUTPUT_TOKENS = 32768; // a line per block of the window, with the short reasoning before them
export const SKELETON_WINDOW_CHARS = 100_000;
export const SKELETON_STALE_FRACTION = 0.1;
export const SKELETON_STALE_MS = 10 * 60_000; // a build older than this is a dead run

// The contents of a document (SPEC.md §26): the parts the reader jumps
// between, each with the block it starts at. One call over the whole
// document at "low", like KEYPOINTS: a reading of where the parts begin,
// not a problem to reason through, and a long document at "high" outran
// the request.
export const CONTENTS_MODEL = KIMI_K3;
export const CONTENTS_EFFORT: KimiEffort = "low";
export const CONTENTS_MAX_OUTPUT_TOKENS = 16384; // a list of titles and block ids, with the short reasoning before it

// The merge of notes (SPEC.md §6): the reader drops a note on another and
// picks Merge with AI, and the model writes the one note that replaces both.
// It rewrites the reader's own words, so it reasons at the reader's effort.
export const MERGE_MODEL = KIMI_K3;
export const MERGE_EFFORT: KimiEffort = DEFAULT_EFFORT;

// The gist of a note — the phrase its collapsed row shows (SPEC.md §6): a
// five-word label from a short text, so the lowest effort.
export const GIST_MODEL = KIMI_K3;
export const GIST_EFFORT: KimiEffort = "low";

// The parse passes — the URL core, structure, and layout passes (SPEC.md §2)
// — run on Kimi K3 at high effort. The passes answer with ops by block
// index, a reading of the page rather than a problem to solve, and the
// figure rules are the code's (lib/parse/structure.ts, layout.ts: a figure
// with media is never dropped), so the parse keeps its figures under any
// model. A claude- id here runs through lib/claude.ts instead; the passes
// call whichever client the id belongs to (lib/parse/model.ts), and the
// prompts are the same either way. What the parse gets wrong every later
// tool inherits: keep the effort high.
export const PARSE_MODEL = KIMI_K3;
export const PARSE_EFFORT: KimiEffort = "high";

// The upload assistant's review and instruction check (SPEC.md §15). Not a
// DerivationType — it runs before ingest, not through /api/derive.
export const UPLOAD_MODEL = PARSE_MODEL;

// Handwritten documents (SPEC.md §16): Import PDF's judgment and conversion
// read page images, and run on Claude Opus 5 at high effort. Not
// DerivationTypes: classification runs inside Import PDF, conversion as a
// background job. The client is lib/claude.ts.
export const HANDWRITTEN_MODEL = CLAUDE_OPUS_5;
export const HANDWRITTEN_EFFORT: ClaudeEffort = "high";
export const CLASSIFY_MODEL = HANDWRITTEN_MODEL;
export const CONVERT_MODEL = HANDWRITTEN_MODEL;

export const ANNOTATIONS_SECTION_TITLE = "Annotations";

// A streaming derivation commits HTTP 200 the moment the stream opens, so a
// failure after that reports in-band: the stream ends with this token and the
// reason. The client splits it off and shows the reason, never a silent stall.
// The heartbeat spaces before the first text delta (lib/derive/text-stream.ts)
// leave with the text's leading whitespace.
export const STREAM_ERROR_TOKEN = "\u0000error\u0000";

export function splitStreamError(text: string): { text: string; error: string | null } {
  const at = text.indexOf(STREAM_ERROR_TOKEN);
  if (at === -1) return { text: text.trimStart(), error: null };
  return {
    text: text.slice(0, at).trimStart(),
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

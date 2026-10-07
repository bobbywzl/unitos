import type { DerivationType } from "@prisma/client";
import { isLang, LANG_COOKIE } from "@/lib/i18n/config";
import { translate } from "@/lib/i18n/dictionaries";
import type { AssistantAction } from "@/lib/types";

// The models (SPEC.md §2). The assistant — its answers and its edit
// commands — runs on Gemini 3.8 Flash (GEMINI_3_8_FLASH below; the client is
// lib/gemini.ts); where no Gemini key is set it falls back to GLM 5.3
// (lib/feature-models.ts). GLM 5.3, Z.ai's flagship, is behind the reader's
// tools, the assistant with Web on, Stitch's answer, and the merge of notes; GLM 5.3
// Flash, its small sibling, behind every reading but the parse — the
// readings copy claims into structure, and Flash reads a million tokens for
// a tenth of the price. The parse passes run on Claude Opus 5.5 at max
// effort (PARSE_MODEL below): what the parse gets wrong, every later tool
// inherits.
// Both run through the gateway (lib/gateway.ts): without it, a GLM id
// resolves to Kimi K3 (lib/models.ts). Kimi K3, Moonshot AI's flagship,
// keeps what GLM 5.3 cannot do: it reads images (VISION_MODEL: a circled
// figure, a picture in the assistant, a video frame). The handwritten passes and Visualize
// run on Claude Opus 5.5 (HANDWRITTEN_MODEL and VISUALIZE_MODEL below). The
// clients live in lib/kimi.ts (the OpenAI-compatible client: Kimi, and
// under the gateway GLM) and lib/claude.ts, not here: client components
// import this file.
export const KIMI_K3 = "kimi-k3";
export const GLM_5_3 = "glm-5.3";
export const GLM_5_3_FLASH = "glm-5.3-flash";
export const CLAUDE_FABLE_5_1 = "claude-fable-5-1";
export const CLAUDE_OPUS_5_5 = "claude-opus-5-5";
// GLM 5.3 takes text alone. A call that carries an image — Circle & ask on
// a figure, a page image, a picture attached to the assistant, a video
// frame — goes to Kimi K3 instead, whatever the feature's model.
export const VISION_MODEL = KIMI_K3;
// The assistant with Web on runs on GLM 5.3, the same model as with Web
// off. The search follows the model that answers (lib/kimi.ts): Z.ai's Web
// Search API under GLM, Moonshot's web-search formula under Kimi K3 — which
// is what a GLM id resolves to without the gateway.
export const WEB_SEARCH_MODEL = GLM_5_3;
// The voice command (SPEC.md §6) runs on Claude Sonnet 5 (VOICE_MODEL below).
export const CLAUDE_SONNET_5 = "claude-sonnet-5";
// Gemini's flash model reads video (SPEC.md §11): transcription and clip
// descriptions. The client is lib/video/gemini.ts.
export const GEMINI_FLASH = "gemini-3.7-flash";
// The assistant (SPEC.md §7): its answers and its edit commands. Called as
// written, not as the gemini role's default: the bimonthly model update
// moves the video's flash, and the assistant stays on 3.8 Flash until
// someone changes this line. Gemini reads pictures, so a picture in the
// assistant stays on it too (VISION_MODEL is for the models that cannot).
export const GEMINI_3_8_FLASH = "gemini-3.8-flash";

// The constants above are the roles' defaults. The bimonthly model update
// (lib/models.ts, /api/cron/models) moves each role to the newest version
// of its family as the provider's model list publishes it; the clients
// (lib/kimi.ts, lib/claude.ts, lib/video/gemini.ts) resolve a default id to
// the role's current id on every call. A constant that is not a role
// default (an alias rung like gemini-flash-latest) is called as is.

// Reasoning effort per call, for the OpenAI-compatible client's models. Kimi
// K3 and GLM 5.3 always reason and take the same three levels; "max" is the
// default of both and the slowest. The reader's tools answer at "high";
// ANALYZE reads a figure or table at "max": a misread number is worse than
// a slow answer. A reading of a whole document (the skeleton, the contents,
// Stitch's select pass) runs at "low": Kimi counts its reasoning against the
// output budget, and the budget is the clock — a call free to think for tens
// of thousands of tokens takes minutes and outlives the request that made it.
export type KimiEffort = "low" | "high" | "max";
export const DEFAULT_EFFORT: KimiEffort = "high";

// Reasoning effort per Claude call. Claude Fable 5.1 always reasons; "max" is
// its slowest and its most thorough.
export type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";

// An SVG chart (SPEC.md §2): a figure whose media is inline SVG. Wherever
// a model reads one — Analyze on it, the assistant acting on it — the call
// goes to Claude Opus 5.5 with the whole source (lib/derive/svg-chart.ts),
// whatever the feature's model: reading a drawing from its code is where
// Opus 5.5 leads, and GLM 5.3 reads it as XML with no picture. High effort,
// not max: a chart of thousands of elements at max outlives the request.
export const SVG_CHART_MODEL = CLAUDE_OPUS_5_5;
export const SVG_CHART_EFFORT: ClaudeEffort = "high";

// Model per derivation type (SPEC.md §2). One place to change. GLM 5.3 for
// the tools that reason over a passage or answer the reader; GLM 5.3 Flash
// for the readings, which find and copy passages into structure. Extract
// (DISTILL) runs on Kimi K3: a question against the whole document, and
// the quotes have to be copied exactly. Define runs on GLM 5.3 Flash: a
// definition is one sentence, two at most, like the glossary's, and the
// reader waits for it with the toolbar open.
export const DERIVATION_MODEL: Record<DerivationType, string> = {
  EXPLAIN: GLM_5_3,
  SIMPLIFY: GLM_5_3,
  SALIENCE: GLM_5_3_FLASH,
  EXTRACT: GLM_5_3_FLASH,
  SUMMARIZE: GLM_5_3,
  SYNTHESIS: GEMINI_3_8_FLASH,
  FIND: GLM_5_3_FLASH,
  DISTILL: KIMI_K3, // Extract: the reader's question and the quotes that answer it
  FORMALIZE: GLM_5_3,
  ASK: GLM_5_3,
  COMPARE: GLM_5_3,
  ANALYZE: GLM_5_3, // an image attached goes to VISION_MODEL, an SVG chart to SVG_CHART_MODEL (api/derive)
  VOICE: CLAUDE_SONNET_5, // the voice command (SPEC.md §6): VOICE_MODEL below, not a chat call
  VISUALIZE: CLAUDE_OPUS_5_5, // the strongest model at drawing: the picture has to be faithful or refused (SPEC.md §20)
  DEFINE: GLM_5_3_FLASH, // one word in its sentence (SPEC.md §6)
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
  VISUALIZE: "max", // not a Kimi call: VISUALIZE_EFFORT below is the effort used
  DEFINE: "low", // a word in its sentence needs little reasoning, and the reader is waiting
};

// The voice command (SPEC.md §6): a spoken command over the open document and
// the section's notes becomes pending notes with the document's quotes as
// sources. Claude Sonnet 5: it follows a multi-part spoken instruction and
// copies quotes exactly at a fifth of Opus 5.5's price ($2 / $10 per million
// tokens against $5 / $25), and its context holds a whole document with the
// notes; the document prefix is cached, so a second command on the same
// document reads it at a tenth of the price. Deep Thinking runs at "high",
// Fast Thinking at "low" (lib/assistant/thinking.ts).
export const VOICE_MODEL = CLAUDE_SONNET_5;
export const VOICE_EFFORT: Record<"fast" | "deep", ClaudeEffort> = { fast: "low", deep: "high" };

// Save as note (SPEC.md §7): an answer organized into one note, its quotes
// copied verbatim from the blocks the answer cites. The voice command's
// reasons hold: Claude Sonnet 5 copies quotes exactly and keeps every point.
export const ORGANIZE_MODEL = CLAUDE_SONNET_5;
export const ORGANIZE_EFFORT: ClaudeEffort = "medium";
export const ORGANIZE_MAX_OUTPUT_TOKENS = 16384;

// The note's assistant (SPEC.md §6): a message about the open note becomes
// an answer and, when the message asks for a change, the note as it should
// read. Claude Sonnet 5, for the same reasons: it follows an instruction to
// the letter and keeps every quote word for word. With the web on, the web
// feature's model answers, like every assistant surface.
export const NOTE_ASSISTANT_MODEL = CLAUDE_SONNET_5;
export const NOTE_ASSISTANT_EFFORT: Record<"fast" | "deep", ClaudeEffort> = { fast: "low", deep: "high" };
export const NOTE_ASSISTANT_MAX_OUTPUT_TOKENS = 32768;

// VISUALIZE (SPEC.md §20, Unitos Ultra) runs on Claude Opus 5.5 at its highest
// reasoning effort: the model first judges whether a picture can carry the
// passage's core idea with certainty, and draws only then. Opus 5.5 leads the
// board for vector graphics written as code, which is what a visualization
// is, and costs half of Claude Fable 5.1 for the same drawing.
export const VISUALIZE_MODEL = CLAUDE_OPUS_5_5;
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
  FORMALIZE: 65536, // a long transcript's article is long
  ASK: 16384,
  COMPARE: 32768, // two documents' points, each with its spans
  ANALYZE: 32768, // three short sections, read at "max" effort: room for the reasoning
  VOICE: 16384, // a few notes with their quotes, and the short reasoning before them
  VISUALIZE: 32768, // the judgment, then a diagram spec or an SVG; an animation's SVG is long
  DEFINE: 16384, // two sentences at most; the floor Moonshot asks for
};

// The ingest-time corpus scan for recommended links (SPEC.md §13). Not a
// DerivationType — it runs as a background job, not through /api/derive. Two
// passes, the scan and the check, both at the reader's effort: the scan
// reads the whole project, and "max" over that much text outruns the request.
export const CONNECT_MODEL = GLM_5_3_FLASH;
export const CONNECT_EFFORT: KimiEffort = DEFAULT_EFFORT;

// Stitch (SPEC.md §22): the assistant over the project's documents, from the
// graph. The documents are read through their skeletons (SKELETON_* below):
// a select pass reads every skeleton and names the blocks the command needs
// — ids only, at "low": a reading, not a problem to reason through. Past
// STITCH_GROUPED_MAX of skeleton a route pass at "low" reads the
// gists and part summaries first and names the parts, and the select pass
// reads only those parts' lines, ranked against the command when they
// still run past the budget (lib/graph/rank.ts). The answer pass reads the
// selected blocks' real text at the reader's effort, up to the budget of
// the command's kind, and answers in the reply, with links, a generated
// document, or a mix. Documents under STITCH_WHOLE_THRESHOLD
// together skip every pass but the answer: the answer pass reads them
// whole. Not a DerivationType — it runs through
// /api/notebooks/[notebookId]/stitch.
export const STITCH_MODEL = GLM_5_3; // the answer pass
export const STITCH_SELECT_MODEL = GLM_5_3_FLASH; // the route and select passes: readings of the skeletons
export const STITCH_ROUTE_EFFORT: KimiEffort = "low";
export const STITCH_SELECT_EFFORT: KimiEffort = "low";
export const STITCH_SELECT_MAX_OUTPUT_TOKENS = 16384; // a list of ids, with the short reasoning before it
export const STITCH_EFFORT: KimiEffort = "high";
export const STITCH_MAX_OUTPUT_TOKENS = 32768; // a page of whole-block references and the model's own writing
// Every Stitch budget below is in estimated tokens (lib/tokens.ts: Latin
// chars / 4, a CJK character 1), so a Chinese project reads what an English
// project of the same token count reads, at the same cost.
export const STITCH_WHOLE_THRESHOLD = 30_000; // under it the answer pass reads the documents whole
export const STITCH_SKELETON_BUDGET = 50_000; // skeleton one select call reads; past it the lines are read in groups
// What the answer pass reads after selection, by what the command asks for
// (commandKind, lib/graph/stitch.ts): an answer, links, or a page. A
// question's budget stays under the whole threshold, so the reading passes
// pay for themselves; a page keeps the breadth a gather needs.
export const STITCH_SELECTED_BUDGET = { question: 15_000, links: 30_000, page: 50_000 } as const;
export const STITCH_SELECTED_BLOCKS = { question: 150, links: 300, page: 400 } as const;
// Past STITCH_SKELETON_BUDGET the select pass reads every line in groups of
// this much skeleton, the groups at once, so no line goes unread and no
// call reads more than a few documents' worth; the route pass runs first
// only past STITCH_GROUPED_MAX of skeleton (about 300 articles). A question
// or a links command reads the groups up to STITCH_CUT_OVER of skeleton:
// the groups' prefixes cache from the second command on, at about a fifth
// of the price, which beats an uncached cut of a third of their size. Past
// it, a question reads the lines ranked against it and the words of its
// expansion (lib/graph/rank.ts, STITCH_EXPAND_*), cut to
// STITCH_QUESTION_SKELETON, links to twice that: one call, not one per group.
export const STITCH_SKELETON_GROUP = 15_000;
export const STITCH_GROUPED_MAX = 300_000;
export const STITCH_CUT_OVER = 100_000;
export const STITCH_QUESTION_SKELETON = 20_000;
export const STITCH_LINKS_SKELETON = 40_000;
// The expansion (SPEC.md §22): one cheap call on the stitch-select model
// writes the words a passage that answers would use — synonyms, the
// translator's word, names, the field's terms — so the ranked cut finds a
// line that shares no word with the command. A failed call ranks against
// the command alone.
export const STITCH_EXPAND_EFFORT: KimiEffort = "low";
export const STITCH_EXPAND_MAX_OUTPUT_TOKENS = 2048;
export const STITCH_EXPAND_WORDS = 15;
// A generated document of the project is read with every document when
// nothing is picked. False leaves generated documents out of that default
// read (a picked generated document is always read). Owner's call (pending;
// the recommended option is false).
export const STITCH_READS_GENERATED = false;
// The language Stitch replies in (SPEC.md §22): "ui", the reader's interface
// language (the cookie, else Accept-Language); or "command", the command's
// language when it is plainly in one (a Chinese question gets a Chinese
// reply under an English interface), else the interface's. Quotes keep
// the documents' words either way. Owner's call (pending); "ui" until then.
export const STITCH_REPLY_LANGUAGE: "ui" | "command" = "ui";
export const STITCH_GROUP_CONCURRENCY = 6;
// The route's limits: a command over STITCH_COMMAND_MAX chars is refused
// with a message that says so; a history turn is cut to
// STITCH_HISTORY_TURN_MAX chars and the history to its last
// STITCH_HISTORY_MAX turns, never refused. The reading passes read the
// last STITCH_READ_HISTORY commands of the reader, not the replies.
export const STITCH_COMMAND_MAX = 4_000;
export const STITCH_HISTORY_TURN_MAX = 8_000;
export const STITCH_HISTORY_MAX = 20;
export const STITCH_READ_HISTORY = 6; // a bare "make that a page" at turn 9 still has its topic (ANS4-09)
// The answer pass's layout after a pick: under STITCH_HISTORY_FIRST_MIN
// tokens of conversation, the picked blocks in the system message and the
// conversation after them (nothing of the conversation caches, since the
// blocks change every command); past it, the conversation first and the
// blocks in the last message, so each turn reads the turns before it from
// the cache (COST4-01). Off (Infinity): judged blind on four turns of a
// 10-turn conversation, history-first lost 3 of 4 and was terser, as in
// round 3; and a 10-turn conversation of Linda's shape holds ~2.2k tokens
// of history, under a 3k line. On at 3_000 it would save 5–7% of a 10-turn
// conversation of long English replies, ~15% in Chinese (round 4 cost
// audit). Engine4 RESULT.md.
export const STITCH_HISTORY_FIRST_MIN = Infinity;
// The model passes together get this long; the route's limit (300 s) keeps
// the rest for storing the answer. Past it the run stops and the reader is
// told to narrow the command instead of reading a stream that ended empty.
export const STITCH_DEADLINE_MS = 270_000;
// The assistant at Project scope (SPEC.md §7, lib/assistant/project-reading.ts):
// a project with more document text than this is read the way Stitch reads
// it, through the skeletons, for each message; under it the digest goes whole.
export const ASSISTANT_WHOLE_THRESHOLD = 120_000; // chars of document text (project-reading.ts counts chars)

// The skeleton of a document (SPEC.md §22): the document collapsed for
// Stitch — a gist, one summary per part of the contents, one line per
// block that keeps every claim and number and drops the wording. Built in
// the background after an add (lib/graph/skeleton.ts), one call per window
// of SKELETON_WINDOW_CHARS at "low": a reading, and the
// lines are copied more than composed, so GLM 5.3 Flash. Rebuilt when more than
// SKELETON_STALE_FRACTION of the document's text has changed since; under
// that the changed blocks read as their own first words, no model call.
export const SKELETON_MODEL = GLM_5_3_FLASH;
export const SKELETON_EFFORT: KimiEffort = "low";
export const SKELETON_MAX_OUTPUT_TOKENS = 32768; // a line per block of the window, with the short reasoning before them
export const SKELETON_WINDOW_CHARS = 100_000;
export const SKELETON_STALE_FRACTION = 0.1;
// The build lock (Document.skeletonStartedAt): its holder refreshes it every
// SKELETON_HEARTBEAT_MS while it builds, so a lock not refreshed for
// SKELETON_STALE_MS is a dead run's (a deploy restart, a killed warm, a
// crash) and the next run takes it over. A command waits for another
// process's build at most SKELETON_WAIT_MS, then reads the stored skeleton
// (its changed blocks as their own first words), or first words alone
// (REV4-03).
export const SKELETON_HEARTBEAT_MS = 10_000;
export const SKELETON_STALE_MS = 45_000;
export const SKELETON_WAIT_MS = 5_000;
// A skeleton builds only when it can be read: a project of the document past
// STITCH_WHOLE_THRESHOLD tokens or ASSISTANT_WHOLE_THRESHOLD chars. While a
// document is being written it rebuilds at most once per SKELETON_QUIET_MS:
// an edit under that since the last build waits for the next edit, a Stitch
// command (ensureSkeleton builds at once), or the graph opening (warmSkeletons).
export const SKELETON_QUIET_MS = 10 * 60_000;
export const SKELETON_BUILD_CONCURRENCY = 12; // documents ensureSkeleton builds at once
// Windows in flight (COST4-08): a document's windows go out SKELETON_WINDOW_CONCURRENCY
// at a time, and every build in the process shares SKELETON_WINDOWS_IN_FLIGHT,
// so a project of large imports never sends a burst of calls that a rate
// limit turns into failed builds.
export const SKELETON_WINDOW_CONCURRENCY = 4;
export const SKELETON_WINDOWS_IN_FLIGHT = 12;

// The contents of a document (SPEC.md §26): the parts the reader jumps
// between, each with the block it starts at. One call over the whole
// document at "low": a reading of where the parts begin,
// not a problem to reason through, and a long document at "high" outran
// the request. GLM 5.3, not Flash: a part's title and its start are what
// the reader navigates by, and Flash cut parts and misnamed them.
export const CONTENTS_MODEL = GLM_5_3;
export const CONTENTS_EFFORT: KimiEffort = "low";
export const CONTENTS_MAX_OUTPUT_TOKENS = 16384; // a list of titles and block ids, with the short reasoning before it

// Collapse (SPEC.md §28): every block of the article to its core — what the
// block really says, in plain words, at a tenth to a third of its length,
// in the light of the whole document. One call per window of
// COLLAPSE_WINDOW_CHARS of block text, the windows at once, each under the
// cached prefix of the whole document. A judgement of what each block
// serves in the whole document, then plain writing, read by every reader in
// place of the article: Claude Opus 5.5, the best writer of the roster, at
// the default effort — a document collapses once, so the cost is one call
// per document, not per reader.
export const COLLAPSE_MODEL = CLAUDE_OPUS_5_5;
export const COLLAPSE_EFFORT: KimiEffort = DEFAULT_EFFORT;
export const COLLAPSE_MAX_OUTPUT_TOKENS = 32768; // a core per block of the window, with the reasoning before them
export const COLLAPSE_WINDOW_CHARS = 30_000;

// The assistant's suggestions (SPEC.md §29): the assistant edits a rich text
// as suggestions an editor accepts or rejects. Claude Sonnet 5, as the voice
// command: it copies `find` exactly (a misquote is a skipped change) and
// follows many rules at once at a fifth of Opus 5.5's price, and the
// document prefix is cached, so every window and every command on the same
// document reads it from the cache. Deep Thinking at "high", Fast Thinking
// at "low". A whole document runs one call per window of the scope's text,
// SUGGEST_PARALLEL at once.
export const SUGGEST_MODEL = CLAUDE_SONNET_5;
export const SUGGEST_EFFORT: Record<"fast" | "deep", ClaudeEffort> = { fast: "low", deep: "high" };
export const SUGGEST_MAX_OUTPUT_TOKENS = 32768; // room for the reasoning and the ops
// The one pass (lib/assistant/one-pass.ts): a scope this long or shorter is
// read in one call, the whole document as context and the answer by
// reference; a rewrite of all of it is about 10,000 output tokens. Longer
// goes by the windows.
export const ONE_PASS_MAX_CHARS = 40_000;
export const SUGGEST_CHECK_MAX_OUTPUT_TOKENS = 8192; // the check's reasoning and the ops it drops
export const SUGGEST_MAX_OPS = 80; // per call: a window's worth; more is a model running away
export const SUGGEST_WINDOW_CHARS = 8_000; // a window's full rewrite is about 2,500 output tokens: under a minute
export const SUGGEST_WINDOW_ROWS = 60; // short lines and empty paragraphs take an op each: a window's rows stay under SUGGEST_MAX_OPS
export const SUGGEST_MAX_WINDOWS = 12; // per command, about 16,000 words; past it the reader selects words or names a section
export const SUGGEST_PARALLEL = 4; // windows at once: the gateway's rate limits
export const SUGGEST_MAX_NEW_CHARS = 100_000; // new text per command, across its windows
export const SUGGEST_DEADLINE_MS = 270_000; // the route allows 300 s; windows not started by then are reported

// The merge of notes (SPEC.md §6): the reader drops a note on another and
// picks Merge with AI, and the model writes the one note that replaces both.
// It rewrites the reader's own words, so it reasons at the reader's effort.
export const MERGE_MODEL = GLM_5_3;
export const MERGE_EFFORT: KimiEffort = DEFAULT_EFFORT;

// The gist of a note — the phrase its collapsed row shows (SPEC.md §6): a
// five-word label from a short text, so the lowest effort.
export const GIST_MODEL = GLM_5_3_FLASH;
export const GIST_EFFORT: KimiEffort = "low";

// The parse passes — the URL core, structure, and layout passes (SPEC.md §2)
// — run on Claude Opus 5.5 at max effort, the strongest reader of a page's
// own HTML. The passes answer with ops by block index, and what the parse
// gets wrong every later tool inherits — a heading read as a paragraph, a
// figure row split, a caption dropped — so the parse gets the strongest
// model at its most thorough, not the cheapest. The figure rules stay the
// code's (lib/parse/structure.ts, layout.ts: a figure with media is never
// dropped), whatever the model. "max" is the slowest effort: the layout
// pass reads the page's whole HTML against the request's time budget
// (modelPassDeadline), and a pass that outruns it is skipped and the
// mechanical parse stands. A claude- id here runs through lib/claude.ts;
// any other id through lib/kimi.ts (lib/model-call.ts), with the same
// prompts, so the model is one constant.
export const PARSE_MODEL = CLAUDE_OPUS_5_5;
export const PARSE_EFFORT: ClaudeEffort = "max";

// The vision check (SPEC.md §2, lib/parse/vision-check.ts): the last pass
// of a URL import reads pictures of the page and of the reader's rendering
// side by side, so it runs on the model that reads images. VISION_CHECK=off
// in the environment turns it off. Up to this many pictures per set.
export const VISION_CHECK_MODEL = VISION_MODEL;
export const VISION_CHECK_EFFORT: KimiEffort = "high";
export const VISION_CHECK_TILES = 8;

// The upload assistant's review and instruction check (SPEC.md §15). Not a
// DerivationType — it runs before ingest, not through /api/derive.
export const UPLOAD_MODEL = PARSE_MODEL;

// Handwritten documents (SPEC.md §16): Import PDF's judgment and conversion
// read page images, and run on Claude Opus 5.5 at high effort. Not
// DerivationTypes: classification runs inside Import PDF, conversion as a
// background job. The client is lib/claude.ts.
export const HANDWRITTEN_MODEL = CLAUDE_OPUS_5_5;
export const HANDWRITTEN_EFFORT: ClaudeEffort = "high";
export const CLASSIFY_MODEL = HANDWRITTEN_MODEL;
export const CONVERT_MODEL = HANDWRITTEN_MODEL;
// A scan of printed pages reads inside the add, against its time limit
// (lib/handwritten/convert.ts transcribePages): print reads at low effort.
export const SCAN_EFFORT: ClaudeEffort = "low";

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

// The sidebar assistant's plan (SPEC.md §7): the answer streams, then the
// token, then the plan as JSON — the actions the reader approves in the
// plan card, and the warnings for the ones that did not validate.
export const STREAM_PLAN_TOKEN = "\u0000plan\u0000";

export function splitStreamPlan(text: string): {
  text: string;
  plan: { actions: AssistantAction[]; warnings: string[] } | null;
} {
  const at = text.indexOf(STREAM_PLAN_TOKEN);
  if (at === -1) return { text, plan: null };
  let plan: { actions: AssistantAction[]; warnings: string[] } | null = null;
  try {
    const parsed = JSON.parse(text.slice(at + STREAM_PLAN_TOKEN.length)) as {
      actions?: AssistantAction[];
      warnings?: string[];
    };
    plan = { actions: parsed.actions ?? [], warnings: parsed.warnings ?? [] };
  } catch {
    // Still streaming, or cut off: no plan yet.
  }
  return { text: text.slice(0, at).trimEnd(), plan };
}

export function splitStreamNote(text: string): { text: string; noteId: string | null } {
  const at = text.indexOf(STREAM_NOTE_TOKEN);
  if (at === -1) return { text, noteId: null };
  return {
    text: text.slice(0, at),
    noteId: text.slice(at + STREAM_NOTE_TOKEN.length) || null,
  };
}
